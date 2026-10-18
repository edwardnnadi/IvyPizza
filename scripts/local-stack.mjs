#!/usr/bin/env node
// Local testing stack: MariaDB in Docker, the API and the web app, with a test account for every role.
// Emails are not sent; read them at http://127.0.0.1:5173/__dev/outbox.
//
//   npm run local              start everything (kitchen open around the clock)
//   npm run local -- --real-hours   keep the kitchen's real opening hours
//   npm run local:reset        wipe the local database and start fresh
//   npm run local:down         stop the database container
//
// LOCAL TESTING ONLY. The passwords below are for this throwaway database and nothing else.
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const container = "ivy-pizza-local";
const volume = "ivy-pizza-local-data";
const databasePort = 3317;
const databasePassword = "ivy-local-only";
const databaseUrl = `mysql://ivy:${databasePassword}@127.0.0.1:${databasePort}/ivy`;
const web = "http://127.0.0.1:5173";
const api = "http://127.0.0.1:3001";

export const localPassword = "ivy-local-pass-2026";
export const localAccounts = [
  { email: "customer@ivy.test", name: "Ada Okafor", roles: [] },
  { email: "owner@ivy.test", name: "Ngozi Owner", roles: ["owner"] },
  { email: "manager@ivy.test", name: "Tunde Manager", roles: ["manager"] },
  { email: "kitchen@ivy.test", name: "Chidi Cook", roles: ["kitchen"] },
  { email: "rider@ivy.test", name: "Musa Bello", roles: ["rider"] },
  { email: "hr@ivy.test", name: "Halima HR", roles: ["hr"] },
];

const args = new Set(process.argv.slice(2));
const docker = (...parameters) => execFileSync("docker", parameters, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const log = (message) => console.log(`\x1b[33m[local]\x1b[0m ${message}`);

function containerState() {
  try {
    return docker("inspect", "-f", "{{.State.Running}}", container) === "true" ? "running" : "stopped";
  } catch {
    return "missing";
  }
}

if (args.has("down")) {
  if (containerState() !== "missing") docker("stop", container);
  log("Local database stopped. Data is kept; run npm run local:reset to wipe it.");
  process.exit(0);
}

// Another API or Vite on these ports would receive our requests (and the seed) instead of ours.
async function portInUse(port) {
  const net = await import("node:net");
  return new Promise((done) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("error", () => done(false));
  });
}
for (const port of [3001, 5173]) {
  if (await portInUse(port)) {
    console.error(`Port ${port} is already in use (another dev server?). Stop it and run npm run local again.`);
    process.exit(1);
  }
}

try {
  docker("info", "--format", "{{.ServerVersion}}");
} catch {
  console.error("Docker is not running. Start Docker Desktop and try again.");
  process.exit(1);
}

if (args.has("--reset")) {
  if (containerState() !== "missing") docker("rm", "-f", container);
  try { docker("volume", "rm", volume); } catch { /* already gone */ }
  log("Local database wiped.");
}

const state = containerState();
if (state === "missing") {
  log("Creating the local MariaDB container (first run downloads the image)…");
  docker("run", "-d", "--name", container, "-v", `${volume}:/var/lib/mysql`, "-p", `127.0.0.1:${databasePort}:3306`,
    "-e", `MARIADB_ROOT_PASSWORD=${databasePassword}`, "-e", "MARIADB_DATABASE=ivy", "-e", "MARIADB_USER=ivy", "-e", `MARIADB_PASSWORD=${databasePassword}`,
    "mariadb:11.4");
} else if (state === "stopped") {
  docker("start", container);
}

async function waitForDatabase() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const connection = await mysql.createConnection(databaseUrl);
      await connection.end();
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
  throw new Error("The local database did not start within two minutes.");
}

log("Waiting for the database…");
await waitForDatabase();

const children = [];
function run(name, command, parameters, env = {}) {
  const child = spawn(command, parameters, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = name === "api" ? "\x1b[36m[api]\x1b[0m " : "\x1b[35m[web]\x1b[0m ";
  const forward = (stream, target) => stream.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) target.write(`${prefix}${line}\n`);
  });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${prefix}stopped (exit ${code}). Stopping the local stack.`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("api", process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "watch", "server/index.ts"], {
  NODE_ENV: "development",
  PORT: "3001",
  API_PORT: "3001",
  APP_BASE_PATH: "",
  DATABASE_URL: databaseUrl,
  DATABASE_SOCKET_PATH: "",
  DATABASE_CA_CERT: "",
  // The browser talks to the API through Vite's proxy, so auth cookies and links use the web origin.
  BETTER_AUTH_URL: web,
  BETTER_AUTH_SECRET: "ivy-local-only-better-auth-secret-not-for-production-0123456789",
  AUTH_TRUSTED_ORIGINS: `${web},http://localhost:5173`,
  AUTH_FRONTEND_URL: web,
  AUTH_COOKIE_DOMAIN: "",
  CORS_ORIGINS: `${web},http://localhost:5173`,
  EMAIL_PROVIDER: "log",
  BUSINESS_TIMEZONE: "Africa/Lagos",
  CHECKOUT_TAX_BASIS_POINTS: "0",
  GUEST_CHECKOUT: "true",
  TRANSFER_BANK_NAME: "Local Test Bank",
  TRANSFER_ACCOUNT_NUMBER: "0000000000",
  TRANSFER_ACCOUNT_NAME: "The Ivy Pizza (local test)",
  KITCHEN_PHONE: "",
});

async function waitForApi() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${api}/api/health`)).ok) return;
    } catch { /* starting */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("The API did not become healthy within 90 seconds.");
}

log("Starting the API and applying migrations…");
await waitForApi();

// Seed: verified accounts for every role. Safe to run on every start.
const connection = await mysql.createConnection(databaseUrl);
try {
  for (const account of localAccounts) {
    await fetch(`${api}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: web },
      body: JSON.stringify({ name: account.name, email: account.email, password: localPassword, callbackURL: `${web}/` }),
    }).catch(() => undefined);
  }
  await connection.query("UPDATE `user` SET emailVerified = TRUE WHERE email IN (?)", [localAccounts.map((account) => account.email)]);
  await connection.query(
    "INSERT IGNORE INTO users (better_auth_user_id, email, display_name) SELECT id, email, name FROM `user` WHERE email IN (?)",
    [localAccounts.map((account) => account.email)]);
  const [[owner]] = await connection.query("SELECT id FROM users WHERE email = 'owner@ivy.test'");
  for (const account of localAccounts) {
    const [[profile]] = await connection.query("SELECT id FROM users WHERE email = ?", [account.email]);
    if (!profile) continue;
    await connection.query("INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'customer'", [profile.id]);
    for (const role of account.roles) {
      // Staff roles need an employment record (enforced by a database trigger); owners don't.
      if (role !== "owner") {
        await connection.query(
          "INSERT IGNORE INTO staff_employment (user_id, created_by, updated_by) VALUES (?, ?, ?)", [profile.id, owner.id, owner.id]);
      }
      await connection.query("INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = ?", [profile.id, role]);
    }
  }
  if (!args.has("--real-hours")) await connection.query("UPDATE stores SET opens_minute = 0, closes_minute = 1440, accepting_orders = TRUE");
} finally {
  await connection.end();
}

run("web", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--strictPort"]);
await new Promise((done) => setTimeout(done, 1500));

const pad = (value, width) => value.padEnd(width);
console.log(`
\x1b[32mThe Ivy Pizza is running locally.\x1b[0m

  Storefront   ${web}
  Manager      ${web}/manager     Kitchen  ${web}/kitchen
  Rider        ${web}/rider       Owner    ${web}/owner      HR  ${web}/hr
  Dev outbox   ${web}/__dev/outbox  (emails the app would send)

  Test accounts (password for all: ${localPassword})
${localAccounts.map((account) => `    ${pad(account.email, 22)} ${account.roles.length ? account.roles.join(", ") : "customer"}`).join("\n")}

  Kitchen hours: ${args.has("--real-hours") ? "real (11:00–23:00 Abuja time)" : "open around the clock (use --real-hours for 11:00–23:00)"}
  Bank transfer: Local Test Bank 0000000000. Guests can check out.
  Press Ctrl+C to stop. The database keeps its data between runs.
`);
