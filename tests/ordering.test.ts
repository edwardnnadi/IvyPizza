// Ordering features end to end: zones, vouchers, the pizza builder, pickup, scheduling, guests and transfers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import { startLocalStack, type LocalStack } from "./support/local-stack.js";
import { extraCheeseMinor, toppingCostMinor } from "../shared/pizza-rules.js";

interface MenuOption { id: string; type: string; code: string | null; available: boolean; priceDeltaMinor: number; isDefault: boolean; multiplierBp: number | null }
interface MenuItem { id: string; slug: string; category: string; priceMinor: number; allergens: string[]; options: MenuOption[] }
type Json = Record<string, any>;

let stack: LocalStack;
let customerCookie: string;
let menu: MenuItem[];
let suya: MenuItem;
let burger: MenuItem;
let side: MenuItem;

const delivery = { recipientName: "Ada Okafor", phone: "+234 803 123 4567", address: "14 Kumasi Crescent, Wuse 2, Abuja", landmark: "Opposite Banex Plaza" };
const contact = { name: "Musa Bello", phone: "0805 555 0101", email: "musa.guest@ivy.test" };

async function call(path: string, options: { cookie?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(stack.apiUrl + path, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, json: (await response.json().catch(() => null) ?? {}) as Json };
}

async function sql(query: string, params: unknown[] = []): Promise<any[]> {
  const connection = await mysql.createConnection(stack.databaseUrl);
  try {
    const [rows] = await connection.query(query, params);
    return rows as any[];
  } finally {
    await connection.end();
  }
}

const option = (item: MenuItem, type: string, code: string): MenuOption => {
  const found = item.options.find((candidate) => candidate.type === type && candidate.code === code);
  assert.ok(found, `${item.slug} has ${type} ${code}`);
  return found;
};

function order(body: Json, cookie = customerCookie) {
  return call("/api/orders", { cookie, method: "POST", body: { idempotencyKey: randomUUID(), zoneId: "wuse2", delivery, ...body } });
}

/** A basket comfortably above every delivery minimum. */
const bigBasket = () => [{ menuItemId: burger.id, quantity: 3, optionIds: [] }];

before(async () => {
  stack = await startLocalStack();
  customerCookie = (await stack.createCustomer("ordering.test@ivy.test", "Ada Okafor")).cookie;
  menu = (await call("/api/menu")).json.items;
  suya = menu.find((item) => item.slug === "ivy-suya-pizza")!;
  burger = menu.find((item) => item.slug === "ivy-classic-burger")!;
  side = menu.find((item) => item.slug === "seasoned-fries")!;
  assert.ok(suya && burger && side);
});

after(async () => {
  await stack?.stop();
});

test("the menu carries allergens, sides and drinks, and the pizza builder's options", () => {
  assert.deepEqual(suya.allergens, ["Gluten", "Milk", "Peanut"]);
  assert.ok(menu.some((item) => item.category === "Drinks"));
  assert.deepEqual(suya.options.filter((candidate) => candidate.type === "topping" && candidate.isDefault).map((candidate) => candidate.code).sort(), ["onions", "peppers", "suya"]);
  assert.equal(option(suya, "sauce", "suya").isDefault, true);
  assert.equal(option(suya, "size", "large").multiplierBp, 12_500);
});

test("ordering config lists kitchens, delivery areas, time slots and payment methods", async () => {
  const config = (await call("/api/ordering/config")).json;
  assert.equal(config.stores[0].id, "wuse");
  assert.equal(config.stores[0].open, true);
  assert.equal(config.zones.find((zone: Json) => zone.id === "lugbe").delivers, false);
  assert.equal(config.zones.find((zone: Json) => zone.id === "wuse2").feeMinor, 100_000);
  assert.ok(config.slots.wuse[1].slots.length > 10, "tomorrow has slots");
  assert.deepEqual(config.payments, { onDelivery: true, transfer: true, card: false });
  assert.equal(config.guestCheckout, true);
});

test("quotes apply the area's fee and minimum", async () => {
  const quote = await call("/api/menu/quote", { method: "POST", body: { items: [{ menuItemId: side.id, quantity: 1, optionIds: [] }], zoneId: "maitama" } });
  assert.equal(quote.status, 200);
  assert.equal(quote.json.deliveryFeeMinor, 150_000);
  assert.equal(quote.json.minimumMinor, 1_000_000);
  assert.equal(quote.json.shortMinor, 1_000_000 - side.priceMinor);
  const pickup = await call("/api/menu/quote", { method: "POST", body: { items: [{ menuItemId: side.id, quantity: 1, optionIds: [] }], mode: "pickup" } });
  assert.equal(pickup.json.deliveryFeeMinor, 0);
  assert.equal(pickup.json.shortMinor, 0);
});

test("vouchers discount, waive delivery, and explain why a code doesn't apply", async () => {
  const items = [{ menuItemId: burger.id, quantity: 10, optionIds: [] }];
  const ivy10 = await call("/api/menu/quote", { method: "POST", body: { items, zoneId: "wuse2", voucherCode: "ivy10" } });
  assert.equal(ivy10.json.discountMinor, 300_000, "10% of ₦50,000 is capped at ₦3,000");
  assert.equal(ivy10.json.totalMinor, ivy10.json.subtotalMinor - 300_000 + 100_000);
  const freedel = await call("/api/menu/quote", { method: "POST", body: { items, zoneId: "wuse2", voucherCode: "FREEDEL" } });
  assert.equal(freedel.json.deliveryFeeMinor, 0);
  const pickupFreedel = await call("/api/menu/quote", { method: "POST", body: { items, mode: "pickup", voucherCode: "FREEDEL" } });
  assert.match(pickupFreedel.json.voucherError, /only works on delivery/);
  const expired = await call("/api/menu/quote", { method: "POST", body: { items, zoneId: "wuse2", voucherCode: "SUMMER25" } });
  assert.match(expired.json.voucherError, /expired on 30 September/);
  assert.equal(expired.json.discountMinor, 0);
  const unknown = await call("/api/menu/quote", { method: "POST", body: { items, zoneId: "wuse2", voucherCode: "NOPE99" } });
  assert.match(unknown.json.voucherError, /don't recognise/);
});

test("the builder prices half toppings, extra portions, removed recipe toppings and extra cheese", async () => {
  const large = option(suya, "size", "large");
  const stuffed = option(suya, "crust", "stuffed");
  const jalapenos = option(suya, "topping", "jalapenos");
  const suyaBeef = option(suya, "topping", "suya");
  const peppers = option(suya, "topping", "peppers");
  const line = {
    menuItemId: suya.id,
    quantity: 1,
    optionIds: [large.id, stuffed.id],
    // Onions removed; peppers kept; suya beef doubled; jalapeños on the left half only.
    toppings: [
      { optionId: suyaBeef.id, side: "whole", amount: "extra" },
      { optionId: peppers.id, side: "whole", amount: "normal" },
      { optionId: jalapenos.id, side: "left", amount: "normal" },
    ],
    cheese: "extra",
    instructions: "Well done, please",
  };
  const quote = await call("/api/menu/quote", { method: "POST", body: { items: [line], mode: "pickup" } });
  assert.equal(quote.status, 200, JSON.stringify(quote.json));
  const multiplierBp = large.multiplierBp!;
  const expected = suya.priceMinor + large.priceDeltaMinor + stuffed.priceDeltaMinor
    + toppingCostMinor({ unitMinor: suyaBeef.priceDeltaMinor, multiplierBp, inRecipe: true, side: "whole", amount: "extra" })
    + toppingCostMinor({ unitMinor: jalapenos.priceDeltaMinor, multiplierBp, inRecipe: false, side: "left", amount: "normal" })
    + extraCheeseMinor(multiplierBp);
  assert.equal(quote.json.subtotalMinor, expected);
  assert.match(quote.json.lines[0].summary, /No red onions/);
  assert.match(quote.json.lines[0].summary, /Jalapeños \(left half\)/);
  assert.match(quote.json.lines[0].summary, /Extra cheese/);
  assert.equal(quote.json.lines[0].instructions, "Well done, please");
});

test("the builder refuses combinations the kitchen can't make", async (t) => {
  const regular = option(suya, "size", "regular");
  const toppings = suya.options.filter((candidate) => candidate.type === "topping").slice(0, 9).map((candidate) => ({ optionId: candidate.id, side: "whole", amount: "normal" }));
  const cases: Array<[string, Json]> = [
    ["stuffed crust on a Regular", { menuItemId: suya.id, quantity: 1, optionIds: [regular.id, option(suya, "crust", "stuffed").id] }],
    ["nine toppings", { menuItemId: suya.id, quantity: 1, optionIds: [regular.id], toppings }],
    ["toppings on a burger", { menuItemId: burger.id, quantity: 1, optionIds: [], cheese: "extra" }],
    ["two sauces", { menuItemId: suya.id, quantity: 1, optionIds: [regular.id, option(suya, "sauce", "tomato").id, option(suya, "sauce", "bbq").id] }],
    ["instructions over 140 characters", { menuItemId: side.id, quantity: 1, optionIds: [], instructions: "x".repeat(141) }],
  ];
  for (const [name, line] of cases) {
    await t.test(name, async () => {
      const quote = await call("/api/menu/quote", { method: "POST", body: { items: [line], mode: "pickup" } });
      assert.equal(quote.status, 400, JSON.stringify(quote.json));
    });
  }
});

test("burgers take extras and leave-outs", async () => {
  const meal = option(burger, "extra", "meal");
  const noOnions = option(burger, "removal", "no-onions");
  const quote = await call("/api/menu/quote", { method: "POST", body: { items: [{ menuItemId: burger.id, quantity: 1, optionIds: [meal.id, noOnions.id] }], mode: "pickup" } });
  assert.equal(quote.json.subtotalMinor, burger.priceMinor + meal.priceDeltaMinor);
  assert.match(quote.json.lines[0].summary, /No onions/);
});

test("orders below the area minimum are refused", async () => {
  const response = await order({ items: [{ menuItemId: side.id, quantity: 1, optionIds: [] }] });
  assert.equal(response.status, 422);
  assert.match(response.json.error, /minimum for Wuse 2/);
});

test("a voucher order stores its discount and stays internally consistent", async () => {
  const response = await order({ items: [{ menuItemId: burger.id, quantity: 4, optionIds: [] }], voucherCode: "IVY10" });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  assert.equal(response.json.discountMinor, 200_000);
  const [row] = await sql("SELECT voucher_code, discount_minor, total_minor, subtotal_minor, delivery_fee_minor FROM orders WHERE order_number = ?", [response.json.orderNumber]);
  assert.equal(row.voucher_code, "IVY10");
  assert.equal(row.total_minor, row.subtotal_minor - row.discount_minor + row.delivery_fee_minor);
  const invalid = await order({ items: bigBasket(), voucherCode: "SUMMER25" });
  assert.equal(invalid.status, 422);
});

test("pickup orders need no area and charge no delivery", async () => {
  const response = await call("/api/orders", {
    cookie: customerCookie, method: "POST",
    body: { idempotencyKey: randomUUID(), mode: "pickup", storeId: "wuse", contact: { phone: "+234 803 123 4567" }, items: [{ menuItemId: side.id, quantity: 1, optionIds: [] }] },
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  assert.equal(response.json.deliveryFeeMinor, 0);
  assert.equal(response.json.mode, "pickup");
  const [row] = await sql("SELECT fulfilment_mode, zone_id, JSON_VALUE(delivery_snapshot, '$.recipientName') AS name FROM orders WHERE order_number = ?", [response.json.orderNumber]);
  assert.deepEqual({ ...row }, { fulfilment_mode: "pickup", zone_id: null, name: "Ada Okafor" });
});

test("scheduled orders take a real slot and respect its capacity", async () => {
  const config = (await call("/api/ordering/config")).json;
  const slot = config.slots.wuse[1].slots[4];
  const first = await order({ items: bigBasket(), scheduledFor: slot.at });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.scheduledFor, slot.at);
  assert.equal((await order({ items: bigBasket(), scheduledFor: "2020-01-01T10:00:00.000Z" })).status, 400);
  await sql("UPDATE stores SET slot_capacity = 1 WHERE id = 'wuse'");
  try {
    const full = await order({ items: bigBasket(), scheduledFor: slot.at });
    assert.equal(full.status, 409);
    const refreshed = (await call("/api/ordering/config")).json;
    assert.equal(refreshed.slots.wuse[1].slots[4].available, false);
  } finally {
    await sql("UPDATE stores SET slot_capacity = 8 WHERE id = 'wuse'");
  }
});

test("a paused kitchen refuses orders with its message", async () => {
  await sql("UPDATE stores SET accepting_orders = FALSE, paused_message = 'Back at 6pm after a quick break.' WHERE id = 'wuse'");
  try {
    const response = await order({ items: bigBasket() });
    assert.equal(response.status, 409);
    assert.equal(response.json.error, "Back at 6pm after a quick break.");
  } finally {
    await sql("UPDATE stores SET accepting_orders = TRUE, paused_message = NULL WHERE id = 'wuse'");
  }
});

test("guests can order and follow their order with its token or by phone", async () => {
  const placed = await order({ items: bigBasket(), contact }, "");
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  const { orderNumber, guestToken } = placed.json;
  assert.ok(guestToken);
  assert.equal((await call(`/api/orders/${orderNumber}`)).status, 404, "no token, no access");
  assert.equal((await call(`/api/orders/${orderNumber}?token=wrong-token-wrong-token-1234`)).status, 404);
  assert.equal((await call(`/api/orders/${orderNumber}`, { cookie: customerCookie })).status, 404, "other customers can't see it");
  const view = await call(`/api/orders/${orderNumber}`, { headers: { "x-order-token": guestToken } });
  assert.equal(view.status, 200);
  assert.equal(view.json.fulfillmentStatus, "awaiting_acceptance");
  assert.equal(view.json.area, "Wuse 2");
  assert.equal(view.json.recipientFirstName, "Ada");
  const lookup = await call("/api/orders/lookup", { method: "POST", body: { orderNumber, phone: "0803 123 4567" } });
  assert.equal(lookup.status, 200);
  const wrongPhone = await call("/api/orders/lookup", { method: "POST", body: { orderNumber, phone: "0803 000 0000" } });
  assert.equal(wrongPhone.status, 404);
  const [row] = await sql("SELECT customer_id, guest_token_hash, JSON_VALUE(guest_contact, '$.email') AS email FROM orders WHERE order_number = ?", [orderNumber]);
  assert.equal(row.customer_id, null);
  assert.notEqual(row.guest_token_hash, guestToken, "only a hash is stored");
  assert.equal(row.email, "musa.guest@ivy.test");
});

test("guest checkouts are idempotent too", async () => {
  const idempotencyKey = randomUUID();
  const body = { idempotencyKey, zoneId: "wuse2", delivery, contact, items: bigBasket() };
  const responses = await Promise.all(Array.from({ length: 5 }, () => call("/api/orders", { method: "POST", body })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 200, 200, 201]);
});

test("bank transfer orders show account details, accept a payment report, and expire when unpaid", async () => {
  const placed = await order({ items: bigBasket(), paymentMethod: "transfer" });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  assert.equal(placed.json.transfer.accountNumber, "0123456789");
  const reported = await call(`/api/orders/${placed.json.orderNumber}/transfer-reported`, { cookie: customerCookie, method: "POST" });
  assert.equal(reported.status, 200);
  assert.ok(reported.json.transfer.reportedAt);

  const unpaid = await order({ items: bigBasket(), paymentMethod: "transfer" });
  await sql("UPDATE orders SET payment_due_at = NOW(3) - INTERVAL 1 MINUTE WHERE order_number = ?", [unpaid.json.orderNumber]);
  const expired = await call(`/api/orders/${unpaid.json.orderNumber}`, { cookie: customerCookie });
  assert.equal(expired.json.fulfillmentStatus, "cancelled");
  assert.equal(expired.json.paymentStatus, "failed");
  assert.equal(expired.json.statusReason, "Bank transfer not received in time");
  const stillReported = await call(`/api/orders/${placed.json.orderNumber}`, { cookie: customerCookie });
  assert.equal(stillReported.json.fulfillmentStatus, "awaiting_acceptance", "reported transfers are not cancelled");
  assert.equal((await order({ items: bigBasket(), paymentMethod: "card" })).status, 422);
});

test("order snapshots keep what the kitchen needs to make each pizza", async () => {
  const regular = option(suya, "size", "regular");
  const placed = await order({
    items: [{ menuItemId: suya.id, quantity: 1, optionIds: [regular.id], toppings: [{ optionId: option(suya, "topping", "suya").id, side: "right", amount: "normal" }], instructions: "Cut into squares" }],
    zoneId: undefined, mode: "pickup", contact: { phone: "+234 803 123 4567" },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  const [row] = await sql(
    "SELECT oi.item_snapshot FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.order_number = ?", [placed.json.orderNumber]);
  const snapshot = typeof row.item_snapshot === "string" ? JSON.parse(row.item_snapshot) : row.item_snapshot;
  assert.deepEqual(snapshot.removed.sort(), ["Green peppers", "Red onions"]);
  assert.equal(snapshot.instructions, "Cut into squares");
  assert.equal(snapshot.options.find((entry: Json) => entry.type === "topping").side, "right");
  assert.match(snapshot.summary, /Suya beef \(right half\)/);
});
