// Disposable local stack for API tests: an embedded Postgres with TLS, a stand-in for
// Supabase Auth's JWKS endpoint, and the real API process pointed at both. Nothing here
// reads .env.local or touches a hosted database.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import selfsigned from "selfsigned";

export interface LocalStack {
  apiUrl: string;
  databaseUrl: string;
  databaseCa: string;
  createCustomer(authUserId: string, email: string, displayName?: string): Promise<void>;
  signToken(authUserId: string, email: string): Promise<string>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(url: string, api: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error(`API exited during startup:\n${output()}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`API did not become healthy within 60s:\n${output()}`);
}

export async function startLocalStack(): Promise<LocalStack> {
  const workDir = await mkdtemp(join(tmpdir(), "ivy-pizza-test-"));
  const stoppers: Array<() => Promise<void>> = [];
  const stop = async () => {
    for (const stopper of stoppers.reverse()) {
      try {
        await stopper();
      } catch {
        // Keep cleaning up the remaining pieces.
      }
    }
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    // The API always connects with TLS and a pinned CA, so the local database does too.
    const certificate = selfsigned.generate([{ name: "commonName", value: "localhost" }], {
      days: 1,
      keySize: 2048,
      algorithm: "sha256",
      extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] }],
    });
    const certPath = join(workDir, "server.crt");
    const keyPath = join(workDir, "server.key");
    await writeFile(certPath, certificate.cert);
    await writeFile(keyPath, certificate.private, { mode: 0o600 });

    const databasePort = await freePort();
    const password = "local-test-only";
    const postgres = new EmbeddedPostgres({
      databaseDir: join(workDir, "data"),
      user: "postgres",
      password,
      port: databasePort,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      postgresFlags: [
        "-c", "ssl=on",
        "-c", `ssl_cert_file=${certPath.split("\\").join("/")}`,
        "-c", `ssl_key_file=${keyPath.split("\\").join("/")}`,
      ],
      onLog: () => {},
    });
    await postgres.initialise();
    await postgres.start();
    stoppers.push(() => postgres.stop());
    await postgres.createDatabase("ivy");
    const databaseUrl = `postgresql://postgres:${password}@localhost:${databasePort}/ivy`;

    // Stand-ins for what Supabase provides before our migrations run.
    const setup = new pg.Client({ connectionString: databaseUrl, ssl: { ca: certificate.cert } });
    await setup.connect();
    await setup.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id UUID PRIMARY KEY,
        email TEXT,
        phone TEXT,
        raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB
      );
    `);
    await setup.end();

    const authPort = await freePort();
    const supabaseUrl = `http://127.0.0.1:${authPort}`;
    const issuer = `${supabaseUrl}/auth/v1`;
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "local-test", alg: "ES256", use: "sig" };
    const authServer = http.createServer((request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((done) => authServer.listen(authPort, "127.0.0.1", done));
    stoppers.push(() => new Promise((done) => authServer.close(() => done())));

    // Every setting the API reads is set explicitly so .env.local values are never used.
    const apiPort = await freePort();
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    let apiOutput = "";
    const api = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "server/index.ts"], {
      cwd: resolve("."),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        DATABASE_CA_CERT: certPath,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: "local-test",
        PORT: String(apiPort),
        API_PORT: String(apiPort),
        APP_BASE_PATH: "",
        CORS_ORIGINS: "http://127.0.0.1:5173",
        BUSINESS_TIMEZONE: "Africa/Lagos",
        CHECKOUT_DELIVERY_FEE_MINOR: "150000",
        CHECKOUT_TAX_BASIS_POINTS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    api.stdout?.on("data", (chunk) => { apiOutput += chunk; });
    api.stderr?.on("data", (chunk) => { apiOutput += chunk; });
    stoppers.push(async () => {
      if (api.exitCode !== null) return;
      const exited = new Promise((done) => api.once("exit", done));
      api.kill();
      await exited;
    });
    await waitForHealth(apiUrl, api, () => apiOutput);

    return {
      apiUrl,
      databaseUrl,
      databaseCa: certificate.cert,
      async createCustomer(authUserId, email, displayName) {
        // Mirrors a Supabase sign-up: the auth.users trigger creates the profile and role.
        const client = new pg.Client({ connectionString: databaseUrl, ssl: { ca: certificate.cert } });
        await client.connect();
        try {
          await client.query(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3::JSONB)",
            [authUserId, email, JSON.stringify(displayName ? { display_name: displayName } : {})],
          );
        } finally {
          await client.end();
        }
      },
      signToken(authUserId, email) {
        return new SignJWT({ email, role: "authenticated" })
          .setProtectedHeader({ alg: "ES256", kid: "local-test" })
          .setIssuer(issuer)
          .setAudience("authenticated")
          .setSubject(authUserId)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
