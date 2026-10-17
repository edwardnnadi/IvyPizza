// Signed-in checkout, end to end, against the local stack (see support/local-stack.ts).
// Tests run in order and share state: later checks count the orders earlier ones created.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import { startLocalStack, type LocalStack } from "./support/local-stack.js";
import { toppingCostMinor } from "../shared/pizza-rules.js";

interface MenuOption { id: string; type: string; available: boolean; priceDeltaMinor: number; isDefault: boolean; multiplierBp: number | null }
interface MenuItem { id: string; category: string; priceMinor: number; options: MenuOption[] }
type Json = Record<string, any>;

// Wuse 2 in the development zones (003_ordering.sql).
const zoneId = "wuse2";
const deliveryFeeMinor = 100_000;
const delivery = {
  recipientName: "Test Customer",
  phone: "+234 801 234 5678",
  address: "12 Test Street, Wuse 2, Abuja",
  landmark: "Near the test bus stop",
  instructions: "Call on arrival",
};

let stack: LocalStack;
let customerCookie: string;
let otherCookie: string;
let customerAuthId: string;
let pizza: MenuItem;
let burger: MenuItem;
let size: MenuOption;
let extra: MenuOption;
let items: Array<{ menuItemId: string; quantity: number; optionIds: string[] }>;
let expectedSubtotal: number;
let firstOrder: Json;
let burstKey: string;
const firstKey = randomUUID();

async function call(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(stack.apiUrl + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = await response.json().catch(() => null) as Json | null;
  return { status: response.status, json: json ?? {} };
}

function placeOrder(cookie: string, body: Json) {
  return call("/api/orders", { cookie, method: "POST", body });
}

function orderBody(overrides: Json = {}): Json {
  return { idempotencyKey: firstKey, zoneId, delivery, items, saveAddress: true, addressLabel: "Home", ...overrides };
}

before(async () => {
  stack = await startLocalStack();
  const customer = await stack.createCustomer("customer.test@ivy.test", "Test Customer");
  const other = await stack.createCustomer("other.test@ivy.test");
  customerCookie = customer.cookie;
  otherCookie = other.cookie;
  customerAuthId = customer.userId;

  const menu = (await call("/api/menu")).json.items as MenuItem[];
  pizza = menu.find((item) => item.category === "Pizzas")!;
  burger = menu.find((item) => item.category === "Burgers")!;
  size = pizza.options.find((option) => option.available && option.type === "size" && option.priceDeltaMinor > 0)!;
  // An added (non-recipe) topping sent the older way, in optionIds: whole pizza, normal amount.
  extra = pizza.options.find((option) => option.available && option.type === "topping" && !option.isDefault)!;
  assert.ok(pizza && burger && size && extra, "seeded menu has a pizza with sizes and toppings, and a burger");
  items = [
    { menuItemId: pizza.id, quantity: 2, optionIds: [size.id, extra.id] },
    { menuItemId: burger.id, quantity: 1, optionIds: [] },
  ];
  const toppingMinor = toppingCostMinor({ unitMinor: extra.priceDeltaMinor, multiplierBp: size.multiplierBp!, inRecipe: false, side: "whole", amount: "normal" });
  expectedSubtotal = (pizza.priceMinor + size.priceDeltaMinor + toppingMinor) * 2 + burger.priceMinor;
});

after(async () => {
  await stack?.stop();
});

test("email-confirmed sign-up creates a profile with the customer role", async () => {
  const me = await call("/api/me", { cookie: customerCookie });
  assert.equal(me.status, 200);
  assert.ok(JSON.stringify(me.json).includes("customer"));
});

test("unconfirmed sign-in resends the email confirmation", async () => {
  const signup = await fetch(stack.apiUrl + "/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Pending Customer", email: "pending.test@ivy.test", password: "test-password-123", callbackURL: `${stack.apiUrl}/` }),
  });
  assert.equal(signup.status, 200);
  const firstMail = await (await fetch(stack.apiUrl + "/__test/emails")).json() as { email: { to: string; mailbox: string; from: string } | null };
  assert.equal(firstMail.email?.to, "pending.test@ivy.test");
  assert.equal(firstMail.email?.mailbox, "customers");
  assert.equal(firstMail.email?.from, "The Ivy Pizza <customers@theivypizza.com>");

  const signIn = await fetch(stack.apiUrl + "/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "pending.test@ivy.test", password: "test-password-123" }),
  });
  assert.equal(signIn.status, 403);
  const resentMail = await (await fetch(stack.apiUrl + "/__test/emails")).json() as { email: { to: string; subject: string } | null };
  assert.equal(resentMail.email?.to, "pending.test@ivy.test");
  assert.match(resentMail.email?.subject ?? "", /confirm/i);
});

test("verified customers can sign in and reset their password by email", async () => {
  const signIn = await fetch(stack.apiUrl + "/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "customer.test@ivy.test", password: "test-password-123" }),
  });
  assert.equal(signIn.status, 200);
  assert.ok(signIn.headers.getSetCookie().some((value) => value.includes("session_token")));

  const resetRequest = await fetch(stack.apiUrl + "/api/auth/request-password-reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "customer.test@ivy.test", redirectTo: "http://127.0.0.1:5173/" }),
  });
  assert.equal(resetRequest.status, 200);
  const { email } = await (await fetch(stack.apiUrl + "/__test/emails")).json() as { email: { to: string; text: string; mailbox: string } | null };
  assert.ok(email);
  assert.equal(email.to, "customer.test@ivy.test");
  assert.equal(email.mailbox, "customers");
  const resetUrl = email.text.match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(resetUrl);
  const token = new URL(resetUrl).searchParams.get("resetToken");
  assert.ok(token);
  const reset = await fetch(stack.apiUrl + "/api/auth/reset-password", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: "new-test-password-456" }),
  });
  assert.equal(reset.status, 200);
  const signInAgain = await fetch(stack.apiUrl + "/api/auth/sign-in/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "customer.test@ivy.test", password: "new-test-password-456" }),
  });
  assert.equal(signInAgain.status, 200);
});

test("orders without a valid sign-in are treated as guest orders and need contact details", async () => {
  const body = orderBody({ idempotencyKey: randomUUID(), saveAddress: false, delivery: { ...delivery, phone: "nope" } });
  assert.equal((await placeOrder("", body)).status, 400);
  assert.equal((await placeOrder("better-auth.session_token=invalid", body)).status, 400);
});

test("quote is priced by the server", async () => {
  const quote = await call("/api/menu/quote", { method: "POST", body: { items } });
  assert.equal(quote.status, 200);
  assert.equal(quote.json.subtotalMinor, expectedSubtotal);
});

test("checkout creates an order awaiting acceptance with correct totals", async () => {
  const response = await placeOrder(customerCookie, orderBody());
  assert.equal(response.status, 201, JSON.stringify(response.json));
  firstOrder = response.json;
  assert.match(firstOrder.orderNumber, /^IVY-\d{8}$/);
  assert.equal(firstOrder.subtotalMinor, expectedSubtotal);
  assert.equal(firstOrder.deliveryFeeMinor, deliveryFeeMinor);
  assert.equal(firstOrder.totalMinor, expectedSubtotal + deliveryFeeMinor);
  assert.equal(firstOrder.fulfillmentStatus, "awaiting_acceptance");
  assert.equal(firstOrder.paymentStatus, "pending");
});

test("customer dashboard shows only the signed-in customer's orders and menu picks", async () => {
  const own = await call("/api/customer/dashboard", { cookie: customerCookie });
  assert.equal(own.status, 200);
  assert.equal(own.json.orderCount, 1);
  assert.equal(own.json.activeOrderCount, 1);
  assert.equal(own.json.orders[0].orderNumber, firstOrder.orderNumber);
  assert.equal(own.json.recommendations.length, 4);

  const other = await call("/api/customer/dashboard", { cookie: otherCookie });
  assert.equal(other.status, 200);
  assert.equal(other.json.orderCount, 0);
  assert.deepEqual(other.json.orders, []);
});

test("resubmitting the same checkout returns the original order", async () => {
  const response = await placeOrder(customerCookie, orderBody());
  assert.equal(response.status, 200);
  assert.equal(response.json.replayed, true);
  assert.equal(response.json.orderNumber, firstOrder.orderNumber);
});

test("10 simultaneous submits create exactly one order", async () => {
  burstKey = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => placeOrder(customerCookie, orderBody({ idempotencyKey: burstKey, saveAddress: false }))),
  );
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(responses.map((response) => response.json.orderNumber)).size, 1);
  assert.equal(responses.filter((response) => response.json.replayed === true).length, 9);
});

test("reusing a checkout key with different details is refused", async () => {
  const response = await placeOrder(customerCookie, orderBody({ items: [{ ...items[0], quantity: 5 }] }));
  assert.equal(response.status, 409);
  assert.equal(response.json.existingOrderNumber, firstOrder.orderNumber);
});

test("checkout keys are scoped per customer", async () => {
  const response = await placeOrder(otherCookie, orderBody({ saveAddress: false }));
  assert.equal(response.status, 201);
  assert.notEqual(response.json.orderNumber, firstOrder.orderNumber);
});

test("invalid checkouts are rejected without creating orders", async (t) => {
  const cases: Array<[string, Json]> = [
    ["pizza without a size", { items: [{ menuItemId: pizza.id, quantity: 1, optionIds: [extra.id] }] }],
    ["missing checkout key", { idempotencyKey: undefined }],
    ["invalid phone number", { delivery: { ...delivery, phone: "call me" } }],
    ["empty address", { delivery: { ...delivery, address: "  " } }],
    ["missing landmark", { delivery: { ...delivery, landmark: "" } }],
    ["no delivery area", { zoneId: undefined }],
    ["area we don't deliver to", { zoneId: "lugbe" }],
    ["empty basket", { items: [] }],
    ["quantity above 20", { items: [{ ...items[0], quantity: 21 }] }],
    ["unknown menu item", { items: [{ menuItemId: randomUUID(), quantity: 1 }] }],
    ["option from a different item", { items: [{ menuItemId: burger.id, quantity: 1, optionIds: [extra.id] }] }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const response = await placeOrder(customerCookie, orderBody({ idempotencyKey: randomUUID(), saveAddress: false, ...overrides }));
      assert.ok(response.status >= 400 && response.status < 500, `status ${response.status}`);
      assert.equal(typeof response.json.error, "string");
    });
  }
});

test("prices sent by the client are ignored", async () => {
  const response = await placeOrder(customerCookie, orderBody({
    idempotencyKey: randomUUID(),
    saveAddress: false,
    items: items.map((item) => ({ ...item, priceMinor: 1 })),
    totalMinor: 1,
  }));
  assert.equal(response.status, 201);
  assert.equal(response.json.totalMinor, expectedSubtotal + deliveryFeeMinor);
});

test("saved address is stored once and visible only to its owner", async () => {
  const own = await call("/api/customer/addresses", { cookie: customerCookie });
  assert.equal(own.status, 200);
  assert.equal(own.json.addresses.length, 1);
  assert.equal(own.json.addresses[0].label, "Home");
  const other = await call("/api/customer/addresses", { cookie: otherCookie });
  assert.equal(other.json.addresses.length, 0);
});

test("a new customer's first requests already carry the customer role", async () => {
  // No warm-up /api/me call: the first requests are the ones that create the profile.
  const fresh = await stack.createCustomer("first.request@ivy.test", "First Request", { loadProfile: false });
  const responses = await Promise.all([
    call("/api/customer/addresses", { cookie: fresh.cookie }),
    call("/api/customer/dashboard", { cookie: fresh.cookie }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200], JSON.stringify(responses.map((response) => response.json)));
});

test("customers cannot reach staff screens", async () => {
  assert.equal((await call("/api/kitchen/orders", { cookie: customerCookie })).status, 403);
  assert.equal((await call("/api/hr/staff", { cookie: customerCookie })).status, 403);
});

test("database holds exactly the expected, internally consistent orders", async () => {
  const connection = await mysql.createConnection(stack.databaseUrl);
  try {
    const [[stats]] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT
        (SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.customer_id
          WHERE u.better_auth_user_id = ?) AS customer_orders,
        (SELECT COUNT(*) FROM orders WHERE idempotency_key = ?) AS burst_orders,
        (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.order_number = ?) AS first_lines,
        (SELECT COUNT(*) FROM order_status_events e JOIN orders o ON o.id = e.order_id
          WHERE o.order_number = ?) AS first_events,
        (SELECT COUNT(*) FROM orders o
          WHERE o.total_minor <> o.subtotal_minor - o.discount_minor + o.delivery_fee_minor + o.tax_minor
             OR o.subtotal_minor <> (SELECT SUM(line_total_minor) FROM order_items WHERE order_id = o.id)) AS inconsistent`,
      [customerAuthId, burstKey, firstOrder.orderNumber, firstOrder.orderNumber]);
    // First checkout, the burst, and the price-tampering checkout.
    assert.equal(stats!.customer_orders, 3);
    assert.equal(stats!.burst_orders, 1);
    assert.equal(stats!.first_lines, 2);
    assert.equal(stats!.first_events, 1);
    assert.equal(stats!.inconsistent, 0);

    // Database rules hold even for writes that bypass the API.
    await assert.rejects(
      connection.query("UPDATE order_status_events SET reason = 'edited' WHERE new_status = 'awaiting_acceptance'"),
      /append-only/);
    await assert.rejects(
      connection.query(`INSERT INTO user_roles (user_id, role_id)
        SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'kitchen' WHERE u.better_auth_user_id = ?`, [customerAuthId]),
      /active employment record/);
    await assert.rejects(
      connection.query("UPDATE orders SET total_minor = total_minor + 1 WHERE order_number = ?", [firstOrder.orderNumber]),
      /orders_total_matches_components_check/);
  } finally {
    await connection.end();
  }
});
