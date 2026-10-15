// Signed-in checkout, end to end, against the local stack (see support/local-stack.ts).
// Tests run in order and share state: later checks count the orders earlier ones created.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import { startLocalStack, type LocalStack } from "./support/local-stack.js";

interface MenuOption { id: string; type: "size" | "extra"; available: boolean; priceDeltaMinor: number }
interface MenuItem { id: string; category: string; priceMinor: number; options: MenuOption[] }
type Json = Record<string, any>;

const customerId = "11111111-1111-4111-8111-111111111111";
const otherCustomerId = "22222222-2222-4222-8222-222222222222";
const unprovisionedId = "33333333-3333-4333-8333-333333333333";
const deliveryFeeMinor = 150_000;
const delivery = {
  recipientName: "Test Customer",
  phone: "+234 801 234 5678",
  address: "12 Test Street, Lekki, Lagos",
  landmark: "Near the test bus stop",
  instructions: "Call on arrival",
};

let stack: LocalStack;
let customerToken: string;
let otherToken: string;
let unprovisionedToken: string;
let pizza: MenuItem;
let burger: MenuItem;
let size: MenuOption;
let extra: MenuOption;
let items: Array<{ menuItemId: string; quantity: number; optionIds: string[] }>;
let expectedSubtotal: number;
let firstOrder: Json;
let burstKey: string;
const firstKey = randomUUID();

async function call(path: string, options: { token?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(stack.apiUrl + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = await response.json().catch(() => null) as Json | null;
  return { status: response.status, json: json ?? {} };
}

function placeOrder(token: string, body: Json) {
  return call("/api/orders", { token, method: "POST", body });
}

function orderBody(overrides: Json = {}): Json {
  return { idempotencyKey: firstKey, delivery, items, saveAddress: true, addressLabel: "Home", ...overrides };
}

before(async () => {
  stack = await startLocalStack();
  await stack.createCustomer(customerId, "customer.test@ivy.test", "Test Customer");
  await stack.createCustomer(otherCustomerId, "other.test@ivy.test");
  customerToken = await stack.signToken(customerId, "customer.test@ivy.test");
  otherToken = await stack.signToken(otherCustomerId, "other.test@ivy.test");
  unprovisionedToken = await stack.signToken(unprovisionedId, "noprofile.test@ivy.test");

  const menu = (await call("/api/menu")).json.items as MenuItem[];
  pizza = menu.find((item) => item.category === "Pizzas")!;
  burger = menu.find((item) => item.category === "Burgers")!;
  size = pizza.options.find((option) => option.available && option.type === "size" && option.priceDeltaMinor > 0)!;
  extra = pizza.options.find((option) => option.available && option.type === "extra")!;
  assert.ok(pizza && burger && size && extra, "seeded menu has a pizza with sizes and extras, and a burger");
  items = [
    { menuItemId: pizza.id, quantity: 2, optionIds: [size.id, extra.id] },
    { menuItemId: burger.id, quantity: 1, optionIds: [] },
  ];
  expectedSubtotal = (pizza.priceMinor + size.priceDeltaMinor + extra.priceDeltaMinor) * 2 + burger.priceMinor;
});

after(async () => {
  await stack?.stop();
});

test("sign-up creates a profile with the customer role", async () => {
  const me = await call("/api/me", { token: customerToken });
  assert.equal(me.status, 200);
  assert.ok(JSON.stringify(me.json).includes("customer"));
});

test("orders require a valid sign-in and a provisioned profile", async () => {
  assert.equal((await placeOrder("", {})).status, 401);
  assert.equal((await placeOrder("abc.def.ghi", {})).status, 401);
  assert.equal((await call("/api/me", { token: unprovisionedToken })).status, 403);
});

test("quote is priced by the server", async () => {
  const quote = await call("/api/menu/quote", { method: "POST", body: { items } });
  assert.equal(quote.status, 200);
  assert.equal(quote.json.subtotalMinor, expectedSubtotal);
});

test("checkout creates an order awaiting acceptance with correct totals", async () => {
  const response = await placeOrder(customerToken, orderBody());
  assert.equal(response.status, 201, JSON.stringify(response.json));
  firstOrder = response.json;
  assert.match(firstOrder.orderNumber, /^IVY-\d{8}$/);
  assert.equal(firstOrder.subtotalMinor, expectedSubtotal);
  assert.equal(firstOrder.deliveryFeeMinor, deliveryFeeMinor);
  assert.equal(firstOrder.totalMinor, expectedSubtotal + deliveryFeeMinor);
  assert.equal(firstOrder.fulfillmentStatus, "awaiting_acceptance");
  assert.equal(firstOrder.paymentStatus, "pending");
});

test("resubmitting the same checkout returns the original order", async () => {
  const response = await placeOrder(customerToken, orderBody());
  assert.equal(response.status, 200);
  assert.equal(response.json.replayed, true);
  assert.equal(response.json.orderNumber, firstOrder.orderNumber);
});

test("10 simultaneous submits create exactly one order", async () => {
  burstKey = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => placeOrder(customerToken, orderBody({ idempotencyKey: burstKey, saveAddress: false }))),
  );
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(responses.map((response) => response.json.orderNumber)).size, 1);
  assert.equal(responses.filter((response) => response.json.replayed === true).length, 9);
});

test("reusing a checkout key with different details is refused", async () => {
  const response = await placeOrder(customerToken, orderBody({ items: [{ ...items[0], quantity: 5 }] }));
  assert.equal(response.status, 409);
  assert.equal(response.json.existingOrderNumber, firstOrder.orderNumber);
});

test("checkout keys are scoped per customer", async () => {
  const response = await placeOrder(otherToken, orderBody({ saveAddress: false }));
  assert.equal(response.status, 201);
  assert.notEqual(response.json.orderNumber, firstOrder.orderNumber);
});

test("invalid checkouts are rejected without creating orders", async (t) => {
  const cases: Array<[string, Json]> = [
    ["pizza without a size", { items: [{ menuItemId: pizza.id, quantity: 1, optionIds: [extra.id] }] }],
    ["missing checkout key", { idempotencyKey: undefined }],
    ["invalid phone number", { delivery: { ...delivery, phone: "call me" } }],
    ["empty address", { delivery: { ...delivery, address: "  " } }],
    ["empty basket", { items: [] }],
    ["quantity above 20", { items: [{ ...items[0], quantity: 21 }] }],
    ["unknown menu item", { items: [{ menuItemId: randomUUID(), quantity: 1 }] }],
    ["option from a different item", { items: [{ menuItemId: burger.id, quantity: 1, optionIds: [extra.id] }] }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const response = await placeOrder(customerToken, orderBody({ idempotencyKey: randomUUID(), saveAddress: false, ...overrides }));
      assert.ok(response.status >= 400 && response.status < 500, `status ${response.status}`);
      assert.equal(typeof response.json.error, "string");
    });
  }
});

test("prices sent by the client are ignored", async () => {
  const response = await placeOrder(customerToken, orderBody({
    idempotencyKey: randomUUID(),
    saveAddress: false,
    items: items.map((item) => ({ ...item, priceMinor: 1 })),
    totalMinor: 1,
  }));
  assert.equal(response.status, 201);
  assert.equal(response.json.totalMinor, expectedSubtotal + deliveryFeeMinor);
});

test("saved address is stored once and visible only to its owner", async () => {
  const own = await call("/api/customer/addresses", { token: customerToken });
  assert.equal(own.status, 200);
  assert.equal(own.json.addresses.length, 1);
  assert.equal(own.json.addresses[0].label, "Home");
  const other = await call("/api/customer/addresses", { token: otherToken });
  assert.equal(other.json.addresses.length, 0);
});

test("customers cannot reach staff screens", async () => {
  assert.equal((await call("/api/kitchen/orders", { token: customerToken })).status, 403);
  assert.equal((await call("/api/hr/staff", { token: customerToken })).status, 403);
});

test("database holds exactly the expected, internally consistent orders", async () => {
  const client = new pg.Client({ connectionString: stack.databaseUrl, ssl: { ca: stack.databaseCa } });
  await client.connect();
  try {
    const { rows: [stats] } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM public.orders o JOIN public.users u ON u.id = o.customer_id
          WHERE u.auth_user_id = $1)::INT AS customer_orders,
        (SELECT COUNT(*) FROM public.orders WHERE idempotency_key = $2)::INT AS burst_orders,
        (SELECT COUNT(*) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
          WHERE o.order_number = $3)::INT AS first_lines,
        (SELECT COUNT(*) FROM public.order_status_events e JOIN public.orders o ON o.id = e.order_id
          WHERE o.order_number = $3)::INT AS first_events,
        (SELECT COUNT(*) FROM public.orders o
          WHERE o.total_minor <> o.subtotal_minor + o.delivery_fee_minor + o.tax_minor
             OR o.subtotal_minor <> (SELECT SUM(line_total_minor) FROM public.order_items WHERE order_id = o.id))::INT AS inconsistent`,
      [customerId, burstKey, firstOrder.orderNumber]);
    // First checkout, the burst, and the price-tampering checkout.
    assert.equal(stats.customer_orders, 3);
    assert.equal(stats.burst_orders, 1);
    assert.equal(stats.first_lines, 2);
    assert.equal(stats.first_events, 1);
    assert.equal(stats.inconsistent, 0);
  } finally {
    await client.end();
  }
});
