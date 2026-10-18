// The order lifecycle after checkout, end to end: manager, kitchen, rider and customer, plus account,
// help and reporting endpoints. Runs against the local stack (see support/local-stack.ts). Tests share state.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import { startLocalStack, type LocalStack } from "./support/local-stack.js";

type Json = Record<string, any>;

let stack: LocalStack;
let managerCookie: string;
let cookCookie: string;
let riderCookie: string;
let otherRiderCookie: string;
let customerCookie: string;
let riderId: string;
let otherRiderId: string;
let burgerId: string;
let suya: Json;

const delivery = { recipientName: "Ada Okafor", phone: "+234 803 123 4567", address: "14 Kumasi Crescent, Wuse 2, Abuja", landmark: "Opposite Banex Plaza" };

async function call(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(stack.apiUrl + path, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
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

async function orderEmail(): Promise<Json | null> {
  return (await (await fetch(`${stack.apiUrl}/__test/emails?mailbox=orders`)).json()).email;
}

async function drainOrderEmails(): Promise<Json[]> {
  const emails: Json[] = [];
  for (let email = await orderEmail(); email; email = await orderEmail()) emails.push(email);
  return emails;
}

/** Order emails are sent after the commit, so give them a moment. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function placeOrder(body: Json = {}): Promise<{ id: string; number: string }> {
  const placed = await call("/api/orders", {
    cookie: customerCookie, method: "POST",
    body: { idempotencyKey: randomUUID(), zoneId: "wuse2", delivery, items: [{ menuItemId: burgerId, quantity: 2, optionIds: [] }], ...body },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  return { id: placed.json.orderId, number: placed.json.orderNumber };
}

const manage = (orderId: string, action: string, body: unknown = {}, method = "PATCH") => call(`/api/manager/orders/${orderId}/${action}`, { cookie: managerCookie, method, body });
const cook = (orderId: string, status: string) => call(`/api/kitchen/orders/${orderId}/status`, { cookie: cookCookie, method: "PATCH", body: { status } });
const ride = (orderId: string, action: string, body: unknown = {}, cookie = riderCookie) => call(`/api/rider/orders/${orderId}/${action}`, { cookie, method: "PATCH", body });
const status = async (orderId: string) => (await sql("SELECT fulfillment_status, payment_status FROM orders WHERE id = ?", [orderId]))[0];

async function throughKitchen(orderId: string): Promise<void> {
  assert.equal((await manage(orderId, "accept")).status, 200);
  assert.equal((await cook(orderId, "preparing")).status, 200);
  assert.equal((await cook(orderId, "ready_for_delivery")).status, 200);
}

before(async () => {
  stack = await startLocalStack();
  const owner = await stack.createCustomer("owner.ops@ivy.test", "Test Owner");
  const managerAccount = await stack.createCustomer("manager.ops@ivy.test", "Test Manager");
  const cookAccount = await stack.createCustomer("cook.ops@ivy.test", "Test Cook");
  const riderAccount = await stack.createCustomer("rider.ops@ivy.test", "Musa Rider");
  const otherRider = await stack.createCustomer("rider2.ops@ivy.test", "Bayo Rider");
  const customer = await stack.createCustomer("diner.ops@ivy.test", "Ada Okafor");
  managerCookie = managerAccount.cookie;
  cookCookie = cookAccount.cookie;
  riderCookie = riderAccount.cookie;
  otherRiderCookie = otherRider.cookie;
  customerCookie = customer.cookie;
  const profileId = async (authUserId: string) => (await sql("SELECT id FROM users WHERE better_auth_user_id = ?", [authUserId]))[0]!.id as string;
  const ownerId = await profileId(owner.userId);
  riderId = await profileId(riderAccount.userId);
  otherRiderId = await profileId(otherRider.userId);
  await sql("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'owner'", [ownerId]);
  for (const [account, role] of [[managerAccount, "manager"], [cookAccount, "kitchen"], [riderAccount, "rider"], [otherRider, "rider"]] as const) {
    const id = await profileId(account.userId);
    await sql("INSERT INTO staff_employment (user_id, created_by, updated_by) VALUES (?, ?, ?)", [id, ownerId, ownerId]);
    await sql("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = ?", [id, role]);
  }
  const menu = (await call("/api/menu")).json.items as Json[];
  burgerId = menu.find((item) => item.slug === "ivy-classic-burger")!.id;
  suya = menu.find((item) => item.slug === "ivy-suya-pizza")!;
  await drainOrderEmails();
});

after(async () => {
  await stack?.stop();
});

test("a delivery order goes from checkout to the customer's door, and they hear about each step", async () => {
  const order = await placeOrder();
  await settle();
  const placedEmail = await orderEmail();
  assert.equal(placedEmail?.to, "diner.ops@ivy.test");
  assert.equal(placedEmail?.mailbox, "orders");
  assert.match(placedEmail?.subject ?? "", /We've got your order IVY-/);

  await throughKitchen(order.id);
  const riders = (await call("/api/manager/riders", { cookie: managerCookie })).json.riders as Json[];
  assert.deepEqual(riders.map((entry) => entry.name).sort(), ["Bayo Rider", "Musa Rider"]);
  assert.equal((await manage(order.id, "assign", { riderId }, "POST")).status, 200);

  const list = (await call("/api/rider/deliveries", { cookie: riderCookie })).json;
  const delivery = list.deliveries.find((entry: Json) => entry.id === order.id);
  assert.equal(delivery.customerFirstName, "Ada");
  assert.equal(delivery.landmark, "Opposite Banex Plaza");
  assert.ok(delivery.collectMinor > 0, "pay-on-delivery orders show what to collect");
  assert.equal((await call("/api/rider/deliveries", { cookie: otherRiderCookie })).json.deliveries.length, 0);
  assert.equal((await ride(order.id, "out", {}, otherRiderCookie)).status, 404, "another rider can't take it");

  assert.equal((await ride(order.id, "out")).status, 200);
  assert.equal((await ride(order.id, "delivered")).status, 400, "the rider must say how the customer paid");
  assert.equal((await ride(order.id, "delivered", { collected: "pos" })).status, 200);
  assert.deepEqual({ ...(await status(order.id)) }, { fulfillment_status: "delivered", payment_status: "paid" });
  const [payment] = await sql("SELECT provider, status FROM payment_records WHERE order_id = ?", [order.id]);
  assert.deepEqual({ ...payment }, { provider: "pos", status: "paid" });
  await settle();
  const subjects = (await drainOrderEmails()).map((email) => email.subject);
  assert.ok(subjects.some((subject: string) => /on its way/.test(subject)));
  assert.ok(subjects.some((subject: string) => /Enjoy your Ivy Pizza/.test(subject)));

  const tracked = await call(`/api/orders/${order.number}`, { cookie: customerCookie });
  assert.equal(tracked.json.fulfillmentStatus, "delivered");
  assert.equal(tracked.json.paymentStatus, "paid");
});

test("the rider sees their name on the tracker while the order is out", async () => {
  const order = await placeOrder();
  await throughKitchen(order.id);
  await manage(order.id, "assign", { riderId }, "POST");
  await ride(order.id, "out");
  const tracked = await call(`/api/orders/${order.number}`, { cookie: customerCookie });
  assert.deepEqual(tracked.json.rider, { firstName: "Musa" });
  // Reassigning moves the delivery to the other rider.
  assert.equal((await manage(order.id, "assign", { riderId: otherRiderId }, "POST")).status, 200);
  assert.equal((await call("/api/rider/deliveries", { cookie: otherRiderCookie })).json.deliveries.length, 1);
  assert.equal((await ride(order.id, "delivered", { collected: "cash" }, otherRiderCookie)).status, 200);
});

test("a delivery problem can be retried, and cancelling a paid order starts a refund", async () => {
  const order = await placeOrder({ paymentMethod: "transfer" });
  assert.equal((await manage(order.id, "payment", { status: "paid" })).status, 200);
  await throughKitchen(order.id);
  await manage(order.id, "assign", { riderId }, "POST");
  await ride(order.id, "out");
  assert.equal((await ride(order.id, "exception", { reason: "Made up" })).status, 400);
  assert.equal((await ride(order.id, "exception", { reason: "No answer", note: "Called twice" })).status, 200);
  const tracked = await call(`/api/orders/${order.number}`, { cookie: customerCookie });
  assert.equal(tracked.json.fulfillmentStatus, "delivery_exception");
  assert.equal(tracked.json.statusReason, "No answer: Called twice");
  assert.equal((await manage(order.id, "retry")).status, 200);
  assert.equal((await status(order.id)).fulfillment_status, "out_for_delivery");
  assert.equal((await manage(order.id, "cancel", {})).status, 400, "cancelling needs a reason");
  assert.equal((await manage(order.id, "cancel", { reason: "Customer moved" })).status, 200);
  assert.deepEqual({ ...(await status(order.id)) }, { fulfillment_status: "cancelled", payment_status: "refund_pending" });
  assert.equal((await call("/api/rider/deliveries", { cookie: riderCookie })).json.deliveries.length, 0, "the rider's assignment ends");
  assert.equal((await manage(order.id, "cancel", { reason: "Again" })).status, 409);
});

test("pickup orders are collected at the counter, and the customer hears when it's ready", async () => {
  const placed = await call("/api/orders", {
    cookie: customerCookie, method: "POST",
    body: { idempotencyKey: randomUUID(), mode: "pickup", contact: { phone: "+234 803 123 4567" }, items: [{ menuItemId: burgerId, quantity: 1, optionIds: [] }] },
  });
  const orderId = placed.json.orderId as string;
  await drainOrderEmails();
  assert.equal((await manage(orderId, "assign", { riderId }, "POST")).status, 409, "pickup orders don't get a rider");
  await throughKitchen(orderId);
  await settle();
  assert.match((await orderEmail())?.subject ?? "", /ready to collect/);
  assert.equal((await manage(orderId, "collected")).status, 200);
  assert.deepEqual({ ...(await status(orderId)) }, { fulfillment_status: "delivered", payment_status: "paid" });
});

test("the kitchen sees cancelled tickets so cooks stop, and can mark items and toppings sold out", async () => {
  const order = await placeOrder();
  await manage(order.id, "accept");
  await cook(order.id, "preparing");
  await manage(order.id, "cancel", { reason: "Customer called to cancel" });
  const queue = (await call("/api/kitchen/orders", { cookie: cookCookie })).json.orders as Json[];
  const ticket = queue.find((entry) => entry.id === order.id)!;
  assert.equal(ticket.fulfillment_status, "cancelled");
  assert.equal(ticket.cancel_reason, "Customer called to cancel");
  assert.equal((await cook(order.id, "ready_for_delivery")).status, 409);

  const menu = (await call("/api/kitchen/menu", { cookie: cookCookie })).json;
  assert.ok(menu.ingredients.some((entry: Json) => entry.name === "Jalapeños" && entry.available));
  assert.equal((await call("/api/kitchen/menu/ingredients", { cookie: cookCookie, method: "PATCH", body: { name: "Jalapeños", available: false } })).status, 200);
  const jalapenos = suya.options.find((option: Json) => option.type === "topping" && option.code === "jalapenos");
  const regular = suya.options.find((option: Json) => option.type === "size" && option.code === "regular");
  const quote = await call("/api/menu/quote", { method: "POST", body: { mode: "pickup", items: [{ menuItemId: suya.id, quantity: 1, optionIds: [regular.id, jalapenos.id] }] } });
  assert.equal(quote.status, 409, "a sold-out topping can't be ordered");
  await call("/api/kitchen/menu/ingredients", { cookie: cookCookie, method: "PATCH", body: { name: "Jalapeños", available: true } });

  assert.equal((await call(`/api/kitchen/menu/items/${burgerId}`, { cookie: cookCookie, method: "PATCH", body: { available: false } })).status, 200);
  assert.equal((await call("/api/menu")).json.items.find((item: Json) => item.id === burgerId).available, false);
  await call(`/api/kitchen/menu/items/${burgerId}`, { cookie: cookCookie, method: "PATCH", body: { available: true } });
  assert.equal((await call("/api/kitchen/menu", { cookie: customerCookie })).status, 403);
});

test("customers manage their profile and saved addresses", async () => {
  assert.equal((await call("/api/customer/profile", { cookie: customerCookie, method: "PATCH", body: { displayName: "Ada O. Okafor", phone: "+234 803 123 4567" } })).status, 200);
  const profile = (await call("/api/customer/profile", { cookie: customerCookie })).json;
  assert.equal(profile.displayName, "Ada O. Okafor", "the new name survives the next request");
  assert.equal(profile.phone, "+234 803 123 4567");

  const address = { label: "Work", recipientName: "Ada", phone: "0803 123 4567", address: "2 Aguiyi Ironsi Street, Maitama", landmark: "Behind the bank" };
  assert.equal((await call("/api/customer/addresses", { cookie: customerCookie, method: "POST", body: { ...address, landmark: "" } })).status, 400);
  const created = await call("/api/customer/addresses", { cookie: customerCookie, method: "POST", body: address });
  assert.equal(created.status, 201);
  const second = await call("/api/customer/addresses", { cookie: customerCookie, method: "POST", body: { ...address, label: "Home" } });
  assert.equal(created.json.isDefault, true, "the first address becomes the default");
  assert.equal((await call(`/api/customer/addresses/${second.json.id}/default`, { cookie: customerCookie, method: "POST" })).status, 200);
  let list = (await call("/api/customer/addresses", { cookie: customerCookie })).json.addresses as Json[];
  assert.equal(list[0].label, "Home");
  assert.equal(list.filter((entry) => entry.isDefault).length, 1);
  assert.equal((await call(`/api/customer/addresses/${second.json.id}`, { cookie: customerCookie, method: "PATCH", body: { ...address, label: "Home (gate 2)" } })).status, 200);
  assert.equal((await call(`/api/customer/addresses/${second.json.id}`, { cookie: managerCookie, method: "DELETE" })).status, 404, "other people can't touch it");
  assert.equal((await call(`/api/customer/addresses/${second.json.id}`, { cookie: customerCookie, method: "DELETE" })).status, 204);
  list = (await call("/api/customer/addresses", { cookie: customerCookie })).json.addresses as Json[];
  assert.equal(list.length, 1);
  assert.equal(list[0].isDefault, true, "a default remains");
});

test("order history shows refunds and reviews, and reorder rebuilds the exact lines", async () => {
  const regular = suya.options.find((option: Json) => option.type === "size" && option.code === "regular");
  const suyaBeef = suya.options.find((option: Json) => option.type === "topping" && option.code === "suya");
  const line = { menuItemId: suya.id, quantity: 1, optionIds: [regular.id], toppings: [{ optionId: suyaBeef.id, side: "left", amount: "extra" }], cheese: "light", instructions: "Extra crispy" };
  const order = await placeOrder({ items: [line], mode: "pickup", zoneId: undefined, delivery: undefined, contact: { phone: "+234 803 123 4567" } });
  const history = (await call("/api/customer/orders", { cookie: customerCookie })).json.orders as Json[];
  assert.ok(history.some((entry) => entry.paymentStatus === "refund_pending"), "the cancelled paid order shows its refund");
  const reorder = await call(`/api/customer/orders/${order.number}/reorder`, { cookie: customerCookie });
  assert.equal(reorder.json.lines[0].exact, true);
  assert.deepEqual(reorder.json.lines[0].line, line);

  assert.equal((await call(`/api/customer/orders/${order.number}/review`, { cookie: customerCookie, method: "POST", body: { rating: 5 } })).status, 409, "rate after delivery");
  const delivered = history.find((entry) => entry.fulfillmentStatus === "delivered")!;
  assert.equal((await call(`/api/customer/orders/${delivered.orderNumber}/review`, { cookie: customerCookie, method: "POST", body: { rating: 6 } })).status, 400);
  assert.equal((await call(`/api/customer/orders/${delivered.orderNumber}/review`, { cookie: customerCookie, method: "POST", body: { rating: 4, body: "Hot and fast" } })).status, 200);
  assert.equal((await call(`/api/customer/orders/${delivered.orderNumber}/review`, { cookie: customerCookie, method: "POST", body: { rating: 5, body: "Even better" } })).status, 200, "a review can be updated");
  const reviewed = (await call("/api/customer/orders", { cookie: customerCookie })).json.orders.find((entry: Json) => entry.orderNumber === delivered.orderNumber);
  assert.deepEqual(reviewed.review, { rating: 5, body: "Even better" });
});

test("help requests are stored for staff, from guests too", async () => {
  const sent = await call("/api/support", { method: "POST", body: { name: "Musa", contact: "0805 555 0101", topic: "order", orderNumber: "IVY-00000001", message: "My pizza was cold." } });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal((await call("/api/support", { method: "POST", body: { name: "Musa", contact: "nope", topic: "order", message: "Hi" } })).status, 400);
  const requests = (await call("/api/support/requests", { cookie: managerCookie })).json.requests as Json[];
  assert.equal(requests[0].message, "My pizza was cold.");
  assert.equal((await call("/api/support/requests", { cookie: customerCookie })).status, 403);
  assert.equal((await call(`/api/support/requests/${requests[0].id}/close`, { cookie: managerCookie, method: "PATCH" })).status, 200);
});

test("the owner report adds up today's orders, service times and ratings", async () => {
  const report = (await call("/api/owner/report?days=1", { cookie: managerCookie })).json;
  const [{ revenue, count }] = await sql(
    "SELECT SUM(total_minor) AS revenue, COUNT(*) AS count FROM orders WHERE fulfillment_status NOT IN ('rejected', 'cancelled')");
  assert.equal(report.summary.orders, Number(count));
  assert.equal(report.summary.revenueMinor, Number(revenue));
  assert.ok(report.summary.cancelled >= 2);
  assert.equal(report.summary.averageRating, 5);
  assert.ok(report.summary.averagePrepMinutes !== null);
  assert.equal(report.byHour.length, 24);
  assert.ok(report.topItems.some((item: Json) => item.name === "Ivy Classic Burger"));
  assert.equal((await call("/api/owner/report", { cookie: riderCookie })).status, 403);
});
