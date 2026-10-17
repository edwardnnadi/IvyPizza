// The manager screen's API: accepting and rejecting new orders and confirming bank transfers,
// end to end against the local stack (see support/local-stack.ts). Tests run in order and share state.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import { startLocalStack, type LocalStack } from "./support/local-stack.js";

type Json = Record<string, any>;

let stack: LocalStack;
let ownerCookie: string;
let managerCookie: string;
let managerProfileId: string;
let cookCookie: string;
let customerCookie: string;
let burgerId: string;
let suyaId: string;

const delivery = { recipientName: "Ada Okafor", phone: "+234 803 123 4567", address: "14 Kumasi Crescent, Wuse 2, Abuja", landmark: "Opposite Banex Plaza", instructions: "Call at the gate" };

async function call(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(stack.apiUrl + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, json: (await response.json().catch(() => null) ?? {}) as Json };
}

async function sql(statement: string, params: unknown[] = []): Promise<any[]> {
  const connection = await mysql.createConnection(stack.databaseUrl);
  try {
    const [rows] = await connection.query(statement, params);
    return rows as any[];
  } finally {
    await connection.end();
  }
}

async function placeOrder(body: Json = {}): Promise<{ id: string; number: string }> {
  const placed = await call("/api/orders", {
    cookie: customerCookie,
    method: "POST",
    body: { idempotencyKey: randomUUID(), zoneId: "wuse2", delivery, items: [{ menuItemId: burgerId, quantity: 3, optionIds: [] }], ...body },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  return { id: placed.json.orderId, number: placed.json.orderNumber };
}

const managerOrders = async (cookie = managerCookie) => (await call("/api/manager/orders", { cookie })).json.orders as Json[];
const decide = (orderId: string, action: string, body: unknown = {}, cookie = managerCookie) =>
  call(`/api/manager/orders/${orderId}/${action}`, { cookie, method: "PATCH", body });
const events = (orderId: string) =>
  sql("SELECT actor_id, previous_status, new_status, reason FROM order_status_events WHERE order_id = ? ORDER BY created_at, new_status", [orderId]);

before(async () => {
  stack = await startLocalStack();
  const owner = await stack.createCustomer("owner.manager@ivy.test", "Test Owner");
  const managerAccount = await stack.createCustomer("manager.test@ivy.test", "Test Manager");
  const cook = await stack.createCustomer("cook.manager@ivy.test", "Test Cook");
  const customer = await stack.createCustomer("diner.manager@ivy.test", "Ada Okafor");
  ownerCookie = owner.cookie;
  managerCookie = managerAccount.cookie;
  cookCookie = cook.cookie;
  customerCookie = customer.cookie;

  const profileId = async (authUserId: string) => (await sql("SELECT id FROM users WHERE better_auth_user_id = ?", [authUserId]))[0]!.id as string;
  const ownerProfileId = await profileId(owner.userId);
  managerProfileId = await profileId(managerAccount.userId);
  const cookProfileId = await profileId(cook.userId);
  // Owners are appointed outside the app; staff roles need an active employment record first.
  await sql("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'owner'", [ownerProfileId]);
  for (const [userId, role] of [[managerProfileId, "manager"], [cookProfileId, "kitchen"]] as const) {
    await sql("INSERT INTO staff_employment (user_id, created_by, updated_by) VALUES (?, ?, ?)", [userId, ownerProfileId, ownerProfileId]);
    await sql("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = ?", [userId, role]);
  }

  const menu = (await call("/api/menu")).json.items as Array<{ id: string; slug: string }>;
  burgerId = menu.find((item) => item.slug === "ivy-classic-burger")!.id;
  suyaId = menu.find((item) => item.slug === "ivy-suya-pizza")!.id;
});

after(async () => {
  await stack?.stop();
});

test("only managers and owners can use the manager API", async () => {
  const order = await placeOrder();
  assert.equal((await call("/api/manager/orders")).status, 401);
  assert.equal((await call("/api/manager/orders", { cookie: customerCookie })).status, 403);
  assert.equal((await call("/api/manager/orders", { cookie: cookCookie })).status, 403);
  assert.equal((await decide(order.id, "accept", {}, cookCookie)).status, 403);
  assert.equal((await decide(order.id, "reject", { reason: "No" }, customerCookie)).status, 403);
  assert.equal((await decide(order.id, "payment", { status: "paid" }, customerCookie)).status, 403);
  assert.equal((await call("/api/manager/orders", { cookie: ownerCookie })).status, 200);
  assert.equal((await call("/api/manager/orders", { cookie: managerCookie })).status, 200);
  assert.equal((await sql("SELECT fulfillment_status FROM orders WHERE id = ?", [order.id]))[0].fulfillment_status, "awaiting_acceptance");
});

test("new orders are listed with what the manager needs to decide", async () => {
  const pickup = await placeOrder({
    zoneId: undefined, delivery: undefined, mode: "pickup", storeId: "wuse", contact: { phone: "0805 555 0101" },
    items: [{ menuItemId: suyaId, quantity: 1, optionIds: [], instructions: "Cut into squares" }],
  });
  const delivered = await placeOrder();
  const orders = await managerOrders();

  const deliveryRow = orders.find((row) => row.id === delivered.id)!;
  assert.equal(deliveryRow.orderNumber, delivered.number);
  assert.equal(deliveryRow.fulfillmentStatus, "awaiting_acceptance");
  assert.equal(deliveryRow.mode, "delivery");
  assert.equal(deliveryRow.area, "Wuse 2");
  assert.equal(deliveryRow.paymentMethod, "on_delivery");
  assert.equal(deliveryRow.paymentStatus, "pending");
  assert.deepEqual(deliveryRow.recipient, { name: "Ada Okafor", phone: "+234 803 123 4567" });
  assert.equal(deliveryRow.deliveryInstructions, "Call at the gate");
  assert.equal(deliveryRow.items[0].quantity, 3);
  assert.equal(typeof deliveryRow.items[0].name, "string");

  const pickupRow = orders.find((row) => row.id === pickup.id)!;
  assert.equal(pickupRow.mode, "pickup");
  assert.equal(pickupRow.store, "Ivy Pizza Wuse 2");
  assert.equal(pickupRow.address, null);
  assert.equal(pickupRow.recipient.phone, "0805 555 0101");
  assert.equal(pickupRow.items[0].instructions, "Cut into squares");
  assert.match(pickupRow.items[0].summary, /Suya/);
});

test("accepting an order sends it to the kitchen and records who accepted it", async () => {
  const order = await placeOrder();
  const accepted = await decide(order.id, "accept");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  assert.equal(accepted.json.fulfillmentStatus, "accepted");
  assert.equal((await decide(order.id, "accept")).status, 409, "an order is accepted once");
  assert.equal((await decide(order.id, "reject", { reason: "Too late" })).status, 409, "an accepted order cannot be rejected here");

  const kitchen = (await call("/api/kitchen/orders", { cookie: cookCookie })).json.orders as Json[];
  assert.ok(kitchen.some((row) => row.id === order.id));
  const listed = (await managerOrders()).find((row) => row.id === order.id)!;
  assert.equal(listed.fulfillmentStatus, "accepted");
  assert.ok(listed.acceptedAt);

  assert.deepEqual((await events(order.id)).slice(1).map((event) => ({ ...event })), [
    { actor_id: managerProfileId, previous_status: "awaiting_acceptance", new_status: "accepted", reason: null },
  ]);
});

test("rejecting an order needs a reason, which the customer sees", async () => {
  const order = await placeOrder();
  assert.equal((await decide(order.id, "reject", {})).status, 400);
  assert.equal((await decide(order.id, "reject", { reason: "   " })).status, 400);
  assert.equal((await decide(order.id, "reject", { reason: "x".repeat(501) })).status, 400);
  const rejected = await decide(order.id, "reject", { reason: "Out of suya beef tonight" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
  assert.equal((await decide(order.id, "accept")).status, 409);

  assert.deepEqual((await events(order.id)).slice(1).map((event) => ({ ...event })), [
    { actor_id: managerProfileId, previous_status: "awaiting_acceptance", new_status: "rejected", reason: "Out of suya beef tonight" },
  ]);
  const tracker = await call(`/api/orders/${order.number}`, { cookie: customerCookie });
  assert.equal(tracker.json.fulfillmentStatus, "rejected");
  assert.equal(tracker.json.statusReason, "Out of suya beef tonight");
  assert.ok(!(await managerOrders()).some((row) => row.id === order.id), "rejected orders leave the list");
});

test("a bank transfer order is accepted only after the manager marks the money received", async () => {
  const order = await placeOrder({ paymentMethod: "transfer" });
  await call(`/api/orders/${order.number}/transfer-reported`, { cookie: customerCookie, method: "POST" });
  const listed = (await managerOrders()).find((row) => row.id === order.id)!;
  assert.equal(listed.paymentMethod, "transfer");
  assert.ok(listed.transferReportedAt, "the customer's report shows on the card");
  assert.ok(listed.paymentDueAt);

  const tooEarly = await decide(order.id, "accept");
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.json.paymentStatus, "pending");

  assert.equal((await decide(order.id, "payment", { status: "failed" })).status, 400);
  const paid = await decide(order.id, "payment", { status: "paid" });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  assert.equal(paid.json.paymentStatus, "paid");
  assert.equal((await decide(order.id, "payment", { status: "paid" })).status, 409, "a payment is confirmed once");
  assert.equal((await decide(order.id, "accept")).status, 200);

  const [row] = await sql("SELECT fulfillment_status, payment_status FROM orders WHERE id = ?", [order.id]);
  assert.deepEqual({ ...row }, { fulfillment_status: "accepted", payment_status: "paid" });
  const [payment] = await sql("SELECT provider, status, amount_minor = (SELECT total_minor FROM orders WHERE id = ?) AS full_amount FROM payment_records WHERE order_id = ?", [order.id, order.id]);
  assert.deepEqual({ ...payment }, { provider: "bank_transfer", status: "paid", full_amount: 1 });
  assert.deepEqual((await events(order.id)).slice(1).map((event) => ({ ...event })), [
    { actor_id: managerProfileId, previous_status: "awaiting_acceptance", new_status: "awaiting_acceptance", reason: "Bank transfer received" },
    { actor_id: managerProfileId, previous_status: "awaiting_acceptance", new_status: "accepted", reason: null },
  ]);
});

test("payments are confirmed only for pending transfers", async () => {
  const cash = await placeOrder();
  assert.equal((await decide(cash.id, "payment", { status: "paid" })).status, 409);

  const unpaid = await placeOrder({ paymentMethod: "transfer" });
  await sql("UPDATE orders SET payment_due_at = NOW(3) - INTERVAL 1 MINUTE WHERE id = ?", [unpaid.id]);
  // Listing orders cancels transfers whose window passed, as the kitchen queue does.
  assert.ok(!(await managerOrders()).some((row) => row.id === unpaid.id));
  assert.equal((await decide(unpaid.id, "payment", { status: "paid" })).status, 409);
  assert.equal((await decide(unpaid.id, "accept")).status, 409);
});

test("rejecting a paid transfer marks the money for refund", async () => {
  const order = await placeOrder({ paymentMethod: "transfer" });
  assert.equal((await decide(order.id, "payment", { status: "paid" })).status, 200);
  const rejected = await decide(order.id, "reject", { reason: "Kitchen closed early" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.paymentStatus, "refund_pending");
});

test("unknown or malformed order IDs are refused", async () => {
  assert.equal((await decide("not-an-id", "accept")).status, 400);
  assert.equal((await decide(randomUUID(), "accept")).status, 404);
});

test("events written by the manager cannot be changed afterwards", async () => {
  await assert.rejects(sql("UPDATE order_status_events SET reason = 'edited' WHERE actor_id = ?", [managerProfileId]), /append-only/);
});
