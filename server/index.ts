import express from "express";
import { database, runMigrations } from "./database.js";
import { requireAuth } from "./auth.js";
import kitchen from "./routes/kitchen.js";
import hr from "./routes/hr.js";
import menu from "./routes/menu.js";
import customer from "./routes/customer.js";
import orders from "./routes/orders.js";

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
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
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

app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error("Request failed");
  response.status(500).json({ error: "The request could not be completed" });
});

await runMigrations();
app.listen(port, "0.0.0.0", () => console.log(`Ivy Pizza API listening on port ${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await database.end();
    process.exit(0);
  });
}
