import express from "express";
import { toNodeHandler } from "better-auth/node";
import { database, runMigrations } from "./database.js";
import { auth, runBetterAuthMigrations } from "./better-auth.js";
import { devOutboxEmails, mailboxes, takeTestEmail, usingDevOutbox, type Mailbox } from "./email.js";
import { requireAuth } from "./auth.js";
import kitchen from "./routes/kitchen.js";
import hr from "./routes/hr.js";
import menu from "./routes/menu.js";
import customer from "./routes/customer.js";
import orders from "./routes/orders.js";
import ordering from "./routes/ordering.js";
import manager from "./routes/manager.js";
import rider from "./routes/rider.js";
import support from "./routes/support.js";
import owner from "./routes/owner.js";

const app = express();
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const appBasePath = process.env.APP_BASE_PATH?.replace(/\/+$/, "");
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

app.disable("x-powered-by");
app.use((request, response, next) => {
  const origin = request.header("origin");
  if (origin && allowedOrigins.has(origin.replace(/\/+$/, ""))) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Order-Token");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.vary("Origin");
  }
  if (request.method === "OPTIONS") {
    response.sendStatus(origin && allowedOrigins.has(origin.replace(/\/+$/, "")) ? 204 : 403);
    return;
  }
  next();
});
if (appBasePath) {
  app.use((request, _response, next) => {
    if (request.url !== appBasePath && !request.url.startsWith(`${appBasePath}/`)) {
      request.url = `${appBasePath}${request.url.startsWith("/") ? request.url : `/${request.url}`}`;
    }
    next();
  });
}
app.all("/api/auth/*splat", toNodeHandler(auth));

if (process.env.NODE_ENV === "test") {
  app.get("/__test/emails", (request, response) => {
    const wanted = typeof request.query.mailbox === "string" && mailboxes.includes(request.query.mailbox as Mailbox) ? [request.query.mailbox as Mailbox] : undefined;
    response.json({ email: takeTestEmail(wanted) ?? null });
  });
}

if (usingDevOutbox()) {
  // Local testing: read the emails the app would have sent, with working links.
  app.get("/__dev/outbox", (_request, response) => {
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
    const items = devOutboxEmails().map((email) => `<article style="border:1px solid #ddd;border-radius:8px;padding:16px;margin:0 0 14px;background:#fff">
      <p style="margin:0 0 6px;color:#555;font-size:13px">${escape(new Date(email.sentAt).toLocaleString("en-GB"))} · ${escape(email.mailbox)} → <strong>${escape(email.to)}</strong></p>
      <h2 style="margin:0 0 10px;font-size:18px">${escape(email.subject)}</h2><div>${email.html}</div></article>`).join("");
    response.set("Cache-Control", "no-store").type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dev outbox</title>
      <body style="margin:0;padding:24px;background:#f7f3ea;font-family:system-ui,sans-serif;color:#122019"><h1 style="margin:0 0 6px">Dev outbox</h1>
      <p style="margin:0 0 20px;color:#555">Emails the app would have sent (newest first, last 50). Local testing only: EMAIL_PROVIDER=log.</p>${items || "<p>No emails yet.</p>"}</body>`);
  });
}

app.use(express.json({ limit: "32kb" }));

app.get("/api/health", async (_request, response) => {
  try {
    await database.query("SELECT 1");
    response.json({ status: "ok", database: "connected", phase: 4 });
  } catch {
    response.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/me", requireAuth, (request, response) => {
  const principal = request.principal;
  if (!principal) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  response.json({
    id: principal.profileId,
    displayName: principal.displayName,
    email: principal.email,
    roles: principal.roles,
  });
});

app.use("/api/kitchen", kitchen);
app.use("/api/hr", hr);
app.use("/api/menu", menu);
app.use("/api/customer", customer);
app.use("/api/orders", orders);
app.use("/api/ordering", ordering);
app.use("/api/manager", manager);
app.use("/api/rider", rider);
app.use("/api/support", support);
app.use("/api/owner", owner);

app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error("Request failed");
  response.status(500).json({ error: "The request could not be completed" });
});

await runMigrations();
await runBetterAuthMigrations();
app.listen(port, "0.0.0.0", () => console.log(`Ivy Pizza API listening on port ${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await database.end();
    process.exit(0);
  });
}
