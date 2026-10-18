import { Router } from "express";
import { database } from "../database.js";
import { optionalAuth, requireAnyRole, requireAuth } from "../auth.js";
import { orderEmailsEnabled, sendEmail } from "../email.js";

const support = Router();
const topics = new Set(["order", "payment", "account", "feedback", "other"]);
const recent = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const times = (recent.get(ip) ?? []).filter((time) => time > now - 10 * 60_000);
  if (times.length >= 5) return false;
  times.push(now);
  if (recent.size > 10_000) recent.clear();
  recent.set(ip, times);
  return true;
}

/** Help requests from the help page, signed in or not. Staff read them on the manager screen. */
support.post("/", optionalAuth, async (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const name = text(body.name) || request.principal?.displayName || "";
  const contact = text(body.contact) || request.principal?.email || "";
  const topic = text(body.topic);
  const message = text(body.message);
  const orderNumber = text(body.orderNumber).toUpperCase();
  if (!name || name.length > 100) return void response.status(400).json({ error: "Enter your name" });
  if (!contact || contact.length > 254 || !/^(\+?[0-9\s()-]{7,24}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(contact)) {
    return void response.status(400).json({ error: "Enter a phone number or email we can reach you on" });
  }
  if (!topics.has(topic)) return void response.status(400).json({ error: "Choose what this is about" });
  if (!message || message.length > 2000) return void response.status(400).json({ error: "Tell us what happened, in up to 2,000 characters" });
  if (orderNumber && !/^IVY-\d{8}$/.test(orderNumber)) return void response.status(400).json({ error: "Order numbers look like IVY-00000123" });
  if (!allowed(request.ip ?? "unknown")) return void response.status(429).json({ error: "You've sent several messages. Please wait a few minutes." });
  try {
    const { rows: [created] } = await database.query<{ id: string }>(
      `INSERT INTO support_requests (customer_id, order_number, name, contact, topic, message) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [request.principal?.profileId ?? null, orderNumber || null, name, contact, topic, message],
    );
    // Copy to the solutions mailbox when one is set up; the request is stored either way.
    if (orderEmailsEnabled() && (process.env.NODE_ENV !== "production" || process.env.SMTP_SOLUTIONS_USER)) {
      void sendEmail("solutions", {
        to: process.env.SMTP_SOLUTIONS_USER ?? "solutions@theivypizza.com",
        subject: `Help request (${topic})${orderNumber ? ` · ${orderNumber}` : ""}`,
        text: `From ${name} (${contact})\n\n${message}`,
        html: `<p><strong>${escape(name)}</strong> (${escape(contact)})${orderNumber ? ` · ${escape(orderNumber)}` : ""}</p><p>${escape(message).replace(/\n/g, "<br>")}</p>`,
      }).catch((error: unknown) => console.error("Support email failed:", error instanceof Error ? error.message : error));
    }
    response.status(201).json({ id: created!.id });
  } catch (error) {
    next(error);
  }
});

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const staff = [requireAuth, requireAnyRole("manager", "owner")];

support.get("/requests", ...staff, async (_request, response, next) => {
  try {
    const { rows } = await database.query(
      `SELECT id, order_number AS orderNumber, name, contact, topic, message, status, created_at AS createdAt
       FROM support_requests WHERE status = 'open' ORDER BY created_at DESC LIMIT 100`);
    response.set("Cache-Control", "no-store").json({ requests: rows });
  } catch (error) {
    next(error);
  }
});

support.patch("/requests/:id/close", ...staff, async (request, response, next) => {
  try {
    const result = await database.query("UPDATE support_requests SET status = 'closed' WHERE id = ? AND status = 'open'", [request.params.id]);
    if (!result.rowCount) return void response.status(404).json({ error: "Request not found or already closed" });
    response.json({ id: request.params.id, status: "closed" });
  } catch (error) {
    next(error);
  }
});

export default support;
