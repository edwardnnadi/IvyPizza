import { createHash, randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { acquireLock, database, isDuplicateKeyError, parseJson, releaseLock, type Queryable } from "../database.js";
import { optionalAuth } from "../auth.js";
import { canonicalLine, MenuQuoteError, parseBasketInput, type BasketInputLine } from "../menu-pricing.js";
import { parseCheckoutContext, priceCheckout, type CheckoutContext } from "../checkout.js";
import { slotIsFull, transferWindowMinutes, validateSchedule } from "../ordering.js";
import { guestCheckoutEnabled, transferDetails } from "../settings.js";
import { queueOrderEmail } from "../order-emails.js";
import {
  expireUnpaidTransfers, findOrderByNumber, guestTokenMatches, hashGuestToken, nationalPhone, trackingView, type OrderRow,
} from "../order-view.js";

const orders = Router();
const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderNumberPattern = /^IVY-\d{8}$/;
const phonePattern = /^\+?[0-9\s()-]{7,24}$/;
const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

interface DeliveryDetails {
  recipientName: string;
  phone: string;
  address: string;
  landmark: string;
  instructions: string | null;
}

interface ContactDetails {
  name: string;
  phone: string;
  email: string | null;
}

type PaymentMethod = "on_delivery" | "transfer";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDelivery(input: unknown): DeliveryDetails {
  const value = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const recipientName = text(value.recipientName);
  const phone = text(value.phone);
  const address = text(value.address);
  const landmark = text(value.landmark);
  const instructions = text(value.instructions);
  if (!recipientName || recipientName.length > 100) throw new MenuQuoteError(400, "Enter a recipient name of up to 100 characters");
  if (!phonePattern.test(phone)) throw new MenuQuoteError(400, "Enter a valid delivery phone number");
  if (!address || address.length > 500) throw new MenuQuoteError(400, "Enter a delivery address of up to 500 characters");
  if (!landmark) throw new MenuQuoteError(400, "Add a nearby landmark so the rider can find you");
  if (landmark.length > 200) throw new MenuQuoteError(400, "Landmark must be 200 characters or fewer");
  if (instructions.length > 500) throw new MenuQuoteError(400, "Delivery instructions must be 500 characters or fewer");
  return { recipientName, phone, address, landmark, instructions: instructions || null };
}

function parseContact(input: unknown, fallbackName: string | null): ContactDetails {
  const value = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const name = text(value.name) || fallbackName || "";
  const phone = text(value.phone);
  const email = text(value.email).toLowerCase();
  if (!name || name.length > 100) throw new MenuQuoteError(400, "Enter your name");
  if (!phonePattern.test(phone)) throw new MenuQuoteError(400, "Enter a valid phone number");
  if (email && (!emailPattern.test(email) || email.length > 254)) throw new MenuQuoteError(400, "Check your email address");
  return { name, phone, email: email || null };
}

function parseSchedule(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) throw new MenuQuoteError(400, "Choose a valid time");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new MenuQuoteError(400, "Choose a valid time");
  return date;
}

function parsePaymentMethod(value: unknown): PaymentMethod {
  if (value === undefined || value === null || value === "on_delivery") return "on_delivery";
  if (value === "transfer") {
    if (!transferDetails()) throw new MenuQuoteError(422, "Bank transfer isn't available right now. Choose pay on delivery.");
    return "transfer";
  }
  if (value === "card") throw new MenuQuoteError(422, "Card payments aren't available yet. Choose another way to pay.");
  throw new MenuQuoteError(400, "Choose a way to pay");
}

function existingOrderResponse(order: { id: string; order_number: string; fulfillment_status: string; payment_status: string }, replayed: boolean) {
  return { orderId: order.id, orderNumber: order.order_number, fulfillmentStatus: order.fulfillment_status, paymentStatus: order.payment_status, replayed };
}

function respondError(error: unknown, response: import("express").Response, next: import("express").NextFunction): void {
  if (error instanceof MenuQuoteError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }
  next(error);
}

interface PreviousOrder { id: string; order_number: string; fulfillment_status: string; payment_status: string; idempotency_fingerprint: string | null }

function findPrevious(client: Queryable, customerId: string | null, key: string) {
  return client.query<PreviousOrder>(
    `SELECT id, order_number, fulfillment_status, payment_status, idempotency_fingerprint
     FROM orders WHERE ${customerId ? "customer_id = ?" : "customer_id IS NULL"} AND idempotency_key = ?`,
    customerId ? [customerId, key] : [key],
  );
}

orders.post("/", optionalAuth, async (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const principal = request.principal;
  if (!principal && !guestCheckoutEnabled()) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  if (principal && !principal.roles.includes("customer")) {
    response.status(403).json({ error: "Insufficient permission" });
    return;
  }
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    response.status(400).json({ error: "A valid checkout idempotency key is required" });
    return;
  }

  let lines: BasketInputLine[];
  let context: CheckoutContext;
  let delivery: DeliveryDetails | null = null;
  let contact: ContactDetails | null = null;
  let scheduledFor: Date | null;
  let paymentMethod: PaymentMethod;
  try {
    lines = parseBasketInput({ items: body.items });
    context = parseCheckoutContext(body);
    if (context.mode === "delivery") delivery = parseDelivery(body.delivery);
    // Guests always give contact details; signed-in pickup orders need at least a phone number.
    if (!principal || context.mode === "pickup") {
      contact = parseContact(body.contact ?? (delivery ? { name: delivery.recipientName, phone: delivery.phone } : undefined), principal?.displayName ?? null);
    }
    scheduledFor = parseSchedule(body.scheduledFor);
    paymentMethod = parsePaymentMethod(body.paymentMethod);
  } catch (error) {
    respondError(error, response, next);
    return;
  }

  const saveAddress = body.saveAddress === true && !!principal && !!delivery;
  const addressLabel = typeof body.addressLabel === "string" ? body.addressLabel.trim() : "Saved address";
  if (saveAddress && (!addressLabel || addressLabel.length > 60)) {
    response.status(400).json({ error: "Saved address label must be 1 to 60 characters" });
    return;
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    delivery, contact, lines: lines.map(canonicalLine), context, scheduledFor: scheduledFor?.toISOString() ?? null, paymentMethod,
    saveAddress, addressLabel: saveAddress ? addressLabel : null,
  })).digest("hex");
  const customerId = principal?.profileId ?? null;
  const client = await database.connect();
  const locks: string[] = [];
  try {
    locks.push(await acquireLock(client, `checkout:${customerId ?? "guest"}:${idempotencyKey}`));
    await client.query("START TRANSACTION");
    const previous = await findPrevious(client, customerId, idempotencyKey);
    if (previous.rows[0]) {
      await client.query("ROLLBACK");
      if (previous.rows[0].idempotency_fingerprint !== fingerprint) {
        response.status(409).json({
          error: "This checkout key was already used with different details. No second order was created.",
          existingOrderNumber: previous.rows[0].order_number,
        });
        return;
      }
      response.status(200).json(existingOrderResponse(previous.rows[0], true));
      return;
    }

    const now = new Date();
    const priced = await priceCheckout(client, lines, context, { forOrder: true, now });
    if (context.mode === "delivery" && priced.shortMinor > 0) {
      const naira = (minor: number) => `₦${(minor / 100).toLocaleString("en-NG")}`;
      throw new MenuQuoteError(422, `Add ${naira(priced.shortMinor)} more to reach the ${naira(priced.minimumMinor)} minimum for ${priced.zone!.name}.`);
    }
    await validateSchedule(client, priced.store, scheduledFor, now);
    if (scheduledFor) {
      // Serialise orders for the same slot so capacity holds under concurrent checkouts.
      locks.push(await acquireLock(client, `slot:${priced.store.id}:${scheduledFor.toISOString()}`));
      if (await slotIsFull(client, priced.store, scheduledFor)) throw new MenuQuoteError(409, "That time slot just filled up. Choose another slot.");
    }

    const numberResult = await client.query<{ value: number }>("SELECT NEXTVAL(order_number_seq) AS value");
    const orderNumber = `IVY-${String(numberResult.rows[0]!.value).padStart(8, "0")}`;
    const snapshot = context.mode === "delivery"
      ? { ...delivery!, fulfillmentMethod: "delivery", area: priced.zone!.name, ...(contact?.email ? { email: contact.email } : {}) }
      : { recipientName: contact!.name, phone: contact!.phone, ...(contact!.email ? { email: contact!.email } : {}), fulfillmentMethod: "pickup", store: priced.store.name };
    const guestToken = principal ? null : randomBytes(24).toString("base64url");
    const totals = priced.totals;
    const inserted = await client.query<{ id: string; order_number: string; fulfillment_status: string; payment_status: string }>(
      `INSERT INTO orders
         (order_number, customer_id, fulfillment_status, payment_status, currency,
          subtotal_minor, discount_minor, delivery_fee_minor, tax_minor, total_minor, delivery_snapshot,
          idempotency_key, idempotency_fingerprint, fulfilment_mode, store_id, zone_id, scheduled_for,
          voucher_code, payment_method, payment_due_at, guest_contact, guest_token_hash)
       VALUES (?, ?, 'awaiting_acceptance', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, order_number, fulfillment_status, payment_status`,
      [orderNumber, customerId, priced.currency, totals.subtotalMinor, totals.discountMinor, totals.deliveryFeeMinor,
        totals.taxMinor, totals.totalMinor, JSON.stringify(snapshot), idempotencyKey, fingerprint, context.mode,
        priced.store.id, priced.zone?.id ?? null, scheduledFor, priced.voucher?.code ?? null, paymentMethod,
        paymentMethod === "transfer" ? new Date(now.getTime() + transferWindowMinutes * 60_000) : null,
        principal ? null : JSON.stringify(contact), guestToken ? hashGuestToken(guestToken) : null],
    );
    const order = inserted.rows[0]!;

    for (const [index, line] of priced.lines.entries()) {
      const itemSnapshot = JSON.stringify({
        // The customer's own choices, so "reorder" can rebuild the line.
        input: lines[index],
        menuItemId: line.menuItemId,
        name: line.name,
        category: line.category,
        options: line.options.map(({ id: _id, ...option }) => option),
        removed: line.removed,
        ...(line.cheese ? { cheese: line.cheese } : {}),
        ...(line.sauceAmount ? { sauceAmount: line.sauceAmount } : {}),
        ...(line.instructions ? { instructions: line.instructions } : {}),
        summary: line.summary,
      });
      await client.query(
        "INSERT INTO order_items (order_id, item_snapshot, quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, ?, ?)",
        [order.id, itemSnapshot, line.quantity, line.unitPriceMinor, line.lineTotalMinor],
      );
    }
    await client.query(
      "INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status) VALUES (?, ?, NULL, 'awaiting_acceptance')",
      [order.id, customerId],
    );
    if (saveAddress && delivery) {
      await client.query(
        // A customer's first saved address becomes their default.
        `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, landmark, instructions, is_default)
         SELECT ?, ?, ?, ?, ?, ?, ?, NOT EXISTS (SELECT 1 FROM customer_addresses WHERE customer_id = ?)`,
        [customerId, addressLabel, delivery.recipientName, delivery.phone, delivery.address, delivery.landmark, delivery.instructions, customerId],
      );
    }
    await client.query("COMMIT");
    queueOrderEmail(order.id, "placed");
    const transfer = paymentMethod === "transfer" ? transferDetails() : null;
    response.status(201).json({
      ...existingOrderResponse(order, false),
      currency: priced.currency,
      ...totals,
      mode: context.mode,
      paymentMethod,
      scheduledFor: scheduledFor?.toISOString() ?? null,
      ...(guestToken ? { guestToken } : {}),
      ...(transfer ? { transfer: { ...transfer, dueAt: new Date(now.getTime() + transferWindowMinutes * 60_000).toISOString() } } : {}),
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    if (isDuplicateKeyError(error)) {
      try {
        const previous = await findPrevious(database, customerId, idempotencyKey);
        if (previous.rows[0]) {
          if (previous.rows[0].idempotency_fingerprint !== fingerprint) {
            response.status(409).json({
              error: "This checkout key was already used with different details. No second order was created.",
              existingOrderNumber: previous.rows[0].order_number,
            });
            return;
          }
          response.status(200).json(existingOrderResponse(previous.rows[0], true));
          return;
        }
      } catch (lookupError) {
        next(lookupError);
        return;
      }
    }
    respondError(error, response, next);
  } finally {
    try {
      for (const lock of locks.reverse()) await releaseLock(client, lock);
    } finally {
      client.release();
    }
  }
});

/** The signed-in owner, staff who manage orders, or a guest holding the order's token. */
function canView(request: Request, order: OrderRow): boolean {
  const principal = request.principal;
  if (principal?.roles.some((role) => role === "manager" || role === "owner")) return true;
  if (principal && order.customer_id === principal.profileId) return true;
  const token = typeof request.query.token === "string" ? request.query.token : request.header("x-order-token") ?? "";
  return guestTokenMatches(token, order.guest_token_hash);
}

// Order number plus phone lets anyone with the receipt follow an order. Failed guesses are throttled per
// address; successful lookups are not, so a guest's tracker can keep polling.
const failedLookups = new Map<string, { count: number; resetAt: number }>();
function lookupAllowed(ip: string): boolean {
  const entry = failedLookups.get(ip);
  return !entry || entry.resetAt < Date.now() || entry.count < 10;
}
function recordFailedLookup(ip: string): void {
  const now = Date.now();
  const entry = failedLookups.get(ip);
  if (!entry || entry.resetAt < now) {
    if (failedLookups.size > 10_000) failedLookups.clear();
    failedLookups.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
  } else {
    entry.count += 1;
  }
}

orders.post("/lookup", async (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const orderNumber = text(body.orderNumber).toUpperCase();
  const phone = nationalPhone(text(body.phone));
  if (!orderNumberPattern.test(orderNumber) || phone.length < 7) {
    response.status(400).json({ error: "Enter your order number (like IVY-00000123) and the phone number on the order" });
    return;
  }
  if (!lookupAllowed(request.ip ?? "unknown")) {
    response.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
    return;
  }
  try {
    await expireUnpaidTransfers();
    const order = await findOrderByNumber(database, orderNumber);
    const snapshotPhone = order ? nationalPhone(String(parseJson<{ phone?: string }>(order.delivery_snapshot)?.phone ?? "")) : "";
    if (!order || !snapshotPhone || snapshotPhone !== phone) {
      recordFailedLookup(request.ip ?? "unknown");
      response.status(404).json({ error: "We couldn't find an order with that number and phone. Check both and try again." });
      return;
    }
    response.set("Cache-Control", "no-store");
    response.json(await trackingView(order));
  } catch (error) {
    next(error);
  }
});

orders.get("/:orderNumber", optionalAuth, async (request, response, next) => {
  const orderNumber = String(request.params.orderNumber ?? "").toUpperCase();
  if (!orderNumberPattern.test(orderNumber)) {
    response.status(400).json({ error: "Invalid order number" });
    return;
  }
  try {
    await expireUnpaidTransfers();
    const order = await findOrderByNumber(database, orderNumber);
    // Not found and not yours look the same, so order numbers can't be probed.
    if (!order || !canView(request, order)) {
      response.status(404).json({ error: "Order not found" });
      return;
    }
    response.set("Cache-Control", "no-store");
    response.json(await trackingView(order));
  } catch (error) {
    next(error);
  }
});

orders.post("/:orderNumber/transfer-reported", optionalAuth, async (request, response, next) => {
  const orderNumber = String(request.params.orderNumber ?? "").toUpperCase();
  if (!orderNumberPattern.test(orderNumber)) {
    response.status(400).json({ error: "Invalid order number" });
    return;
  }
  try {
    await expireUnpaidTransfers();
    const order = await findOrderByNumber(database, orderNumber);
    if (!order || !canView(request, order)) {
      response.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.payment_method !== "transfer" || order.payment_status !== "pending" || order.fulfillment_status !== "awaiting_acceptance") {
      response.status(409).json({ error: order.fulfillment_status === "cancelled" ? "This order was cancelled because the transfer wasn't received in time." : "This order isn't waiting for a transfer." });
      return;
    }
    await database.query("UPDATE orders SET transfer_reported_at = COALESCE(transfer_reported_at, NOW(3)) WHERE id = ?", [order.id]);
    response.json(await trackingView((await findOrderByNumber(database, orderNumber))!));
  } catch (error) {
    next(error);
  }
});

export default orders;
