import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import selfsigned from "selfsigned";

export interface TestCustomer { cookie: string; userId: string; }
export interface LocalStack {
  apiUrl: string;
  databaseUrl: string;
  databaseCa: string;
  // loadProfile=false skips the warm-up /api/me call so tests can exercise a session's first request.
  createCustomer(email: string, displayName?: string, options?: { loadProfile?: boolean }): Promise<TestCustomer>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer(); server.unref(); server.on("error", reject);
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
    try { if ((await fetch(`${url}/api/health`)).ok) return; } catch { /* startup in progress */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`API did not become healthy within 60s:\n${output()}`);
}

export async function startLocalStack(): Promise<LocalStack> {
  const workDir = await mkdtemp(join(tmpdir(), "ivy-pizza-test-"));
  const stoppers: Array<() => Promise<void>> = [];
  const stop = async () => {
    for (const stopper of stoppers.reverse()) { try { await stopper(); } catch { /* finish cleanup */ } }
    await rm(workDir, { recursive: true, force: true });
  };
  try {
    const certificate = selfsigned.generate([{ name: "commonName", value: "localhost" }], {
      days: 1, keySize: 2048, algorithm: "sha256",
      extensions: [{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] }],
    });
    const certPath = join(workDir, "server.crt");
    const keyPath = join(workDir, "server.key");
    await writeFile(certPath, certificate.cert);
    await writeFile(keyPath, certificate.private, { mode: 0o600 });
    const databasePort = await freePort();
    const password = "local-test-only";
    const postgres = new EmbeddedPostgres({
      databaseDir: join(workDir, "data"), user: "postgres", password, port: databasePort, persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      postgresFlags: ["-c", "ssl=on", "-c", `ssl_cert_file=${certPath.replaceAll("\\", "/")}`, "-c", `ssl_key_file=${keyPath.replaceAll("\\", "/")}`],
      onLog: () => {},
    });
    await postgres.initialise(); await postgres.start(); stoppers.push(() => postgres.stop());
    await postgres.createDatabase("ivy");
    const databaseUrl = `postgresql://postgres:${password}@localhost:${databasePort}/ivy`;
    const setup = new pg.Client({ connectionString: databaseUrl, ssl: { ca: certificate.cert } });
    await setup.connect();
    await setup.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, phone TEXT, raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::JSONB);`);
    await setup.end();

    const apiPort = await freePort();
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    let apiOutput = "";
    const api = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "server/index.ts"], {
      cwd: resolve("."),
      env: {
        ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, DATABASE_CA_CERT: certPath,
        BETTER_AUTH_URL: apiUrl, BETTER_AUTH_SECRET: "local-test-only-better-auth-secret-0123456789",
        AUTH_TRUSTED_ORIGINS: apiUrl, AUTH_COOKIE_DOMAIN: "", AUTH_FRONTEND_URL: apiUrl, SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", PORT: String(apiPort), API_PORT: String(apiPort), APP_BASE_PATH: "",
        CORS_ORIGINS: "http://127.0.0.1:5173", BUSINESS_TIMEZONE: "Africa/Lagos",
        CHECKOUT_DELIVERY_FEE_MINOR: "150000", CHECKOUT_TAX_BASIS_POINTS: "0",
      }, stdio: ["ignore", "pipe", "pipe"],
    });
    api.stdout?.on("data", (chunk) => { apiOutput += chunk; });
    api.stderr?.on("data", (chunk) => { apiOutput += chunk; });
    stoppers.push(async () => {
      if (api.exitCode !== null) return;
      const exited = new Promise<void>((done) => api.once("exit", () => done())); api.kill(); await exited;
    });
    await waitForHealth(apiUrl, api, () => apiOutput);

    return {
      apiUrl, databaseUrl, databaseCa: certificate.cert,
      async createCustomer(email, displayName = "Test Customer", options = {}) {
        const signup = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: displayName, email, password: "test-password-123", callbackURL: `${apiUrl}/` }),
        });
        const signupData = await signup.json() as { user?: { id: string }; message?: string };
        if (!signup.ok || !signupData.user?.id) throw new Error(`Test sign-up failed (${signup.status}): ${JSON.stringify(signupData)}`);
        const emailResponse = await fetch(`${apiUrl}/__test/emails`);
        const { email: message } = await emailResponse.json() as { email: { text: string } | null };
        if (!message) throw new Error("Better Auth did not queue the verification email");
        const confirmationUrl = message.text.match(/https?:\/\/[^\s]+/)?.[0];
        if (!confirmationUrl) throw new Error("Verification email did not contain a confirmation URL");
        const confirmation = await fetch(confirmationUrl, { redirect: "manual" });
        const cookies = confirmation.headers.getSetCookie().map((value) => value.split(";", 1)[0]).filter(Boolean);
        if (!cookies.length) throw new Error(`Email confirmation did not issue a session (${confirmation.status})`);
        const cookie = cookies.join("; ");
        if (options.loadProfile === false) return { cookie, userId: signupData.user.id };
        const profile = await fetch(`${apiUrl}/api/me`, { headers: { cookie } });
        if (!profile.ok) throw new Error(`Confirmed account could not load profile (${profile.status}): ${await profile.text()}\nAPI log:\n${apiOutput}`);
        return { cookie, userId: signupData.user.id };
      },
      stop,
    };
  } catch (error) { await stop(); throw error; }
}
