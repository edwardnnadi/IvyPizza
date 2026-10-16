import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql, { type PoolConnection, type PoolOptions } from "mysql2/promise";

// Load local secrets for development; hosted environments inject their own values.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in .env.local for local development.");
}

const url = new URL(connectionString);
if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
  throw new Error("DATABASE_URL must be a mysql:// or mariadb:// connection string");
}

const options: PoolOptions = {
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  // On WhoGoHost the database is on the same server; the UNIX socket avoids TCP entirely.
  ...(process.env.DATABASE_SOCKET_PATH ? { socketPath: process.env.DATABASE_SOCKET_PATH } : {}),
  ...(process.env.DATABASE_CA_CERT ? {
    ssl: { ca: readFileSync(resolve(process.env.DATABASE_CA_CERT), "utf8"), rejectUnauthorized: true },
  } : {}),
  charset: "utf8mb4_unicode_ci",
  timezone: "Z",
  connectionLimit: 8,
  connectTimeout: 10_000,
  idleTimeout: 30_000,
  // BOOLEAN columns are TINYINT(1) in MariaDB; return them as JavaScript booleans.
  typeCast(field, next) {
    if (field.type === "TINY" && field.length === 1) {
      const value = field.string();
      return value === null ? null : value === "1";
    }
    return next();
  },
};

// Better Auth uses this pool directly through its MySQL adapter.
export const pool = mysql.createPool(options);
pool.pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number;
}

export interface Queryable {
  query<Row = Record<string, any>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

export interface DatabaseClient extends Queryable {
  release(): void;
}

async function run<Row>(target: Pick<PoolConnection, "query">, sql: string, params: unknown[] = []): Promise<QueryResult<Row>> {
  const [result] = await target.query(sql, params);
  if (Array.isArray(result)) return { rows: result as Row[], rowCount: result.length };
  return { rows: [], rowCount: (result as { affectedRows?: number }).affectedRows ?? 0 };
}

export const database = {
  query<Row = Record<string, any>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>> {
    return run<Row>(pool, sql, params);
  },
  async connect(): Promise<DatabaseClient> {
    const connection = await pool.getConnection();
    return {
      query: <Row = Record<string, any>>(sql: string, params?: unknown[]) => run<Row>(connection, sql, params),
      release: () => connection.release(),
    };
  },
  end(): Promise<void> {
    return pool.end();
  },
};

// Named locks serialize work across requests (MariaDB's equivalent of a Postgres advisory lock).
// They belong to the connection, so they must be released on the same client.
export async function acquireLock(client: Queryable, key: string, timeoutSeconds = 10): Promise<string> {
  const name = `ivy:${createHash("sha1").update(key).digest("hex")}`;
  const { rows } = await client.query<{ acquired: number | null }>("SELECT GET_LOCK(?, ?) AS acquired", [name, timeoutSeconds]);
  if (rows[0]?.acquired !== 1) throw new Error("Timed out waiting for a database lock");
  return name;
}

export async function releaseLock(client: Queryable, name: string): Promise<void> {
  await client.query("SELECT RELEASE_LOCK(?)", [name]);
}

// MariaDB returns JSON columns as text.
export function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

export async function runMigrations(): Promise<void> {
  // Migrations contain several statements (and trigger bodies), so they use a dedicated connection.
  const connection = await mysql.createConnection({ ...options, multipleStatements: true });
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [[locked]] = await connection.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('ivy:schema-migrations', 60) AS acquired");
    if (locked?.acquired !== 1) throw new Error("Another process is running database migrations");
    try {
      const directory = resolve(process.cwd(), "server/migrations");
      const files = (await readdir(directory))
        .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
        .sort();

      for (const name of files) {
        const version = Number(name.slice(0, 3));
        const [existing] = await connection.query("SELECT 1 FROM schema_migrations WHERE version = ?", [version]);
        if ((existing as unknown[]).length) continue;

        // MariaDB commits DDL implicitly, so each migration must be safe to re-run if it fails partway.
        const sql = await readFile(resolve(directory, name), "utf8");
        await connection.query(sql);
        await connection.query("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [version, name]);
        console.log(`Applied database migration ${name}`);
      }
    } finally {
      await connection.query("SELECT RELEASE_LOCK('ivy:schema-migrations')");
    }
  } finally {
    await connection.end();
  }
}
