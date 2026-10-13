import dotenv from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// Load local secrets for development; hosted environments inject their own values.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in .env.local for local development.");
}

export const database = new Pool({
  connectionString,
  ssl: {
    ca: readFileSync(resolve(process.env.DATABASE_CA_CERT ?? "./prod-ca-2021.crt"), "utf8"),
    rejectUnauthorized: true,
  },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function runMigrations(): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await database.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS name TEXT");
  await database.query("UPDATE schema_migrations SET name = 'legacy_' || version::TEXT WHERE name IS NULL");

  const client = await database.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [731_902_116]);
    const directory = resolve(process.cwd(), "server/migrations");
    const files = (await readdir(directory))
      .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    for (const name of files) {
      const version = Number(name.slice(0, 3));
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (existing.rowCount) continue;

      const sql = await readFile(resolve(directory, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [version, name]);
        await client.query("COMMIT");
        console.log(`Applied database migration ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [731_902_116]);
    } finally {
      client.release();
    }
  }
}
