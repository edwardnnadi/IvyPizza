import { createHash } from "node:crypto";
import { Router } from "express";
import { acquireLock, database, isDuplicateKeyError, releaseLock } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";
import { calculateOrderTotals } from "../order-pricing.js";
import { calculateMenuQuote, MenuQuoteError, parseBasketInput } from "../menu-pricing.js";

const orders = Router();
const customerAccess = [requireAuth, requireAnyRole("customer")];
const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DeliveryDetails {
  recipientName: string;
  phone: string;
  address: string;
  landmark: string | null;
  instructions: string | null;
}

function parseDelivery(input: unknown): DeliveryDetails {
  const value = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const recipientName = typeof value.recipientName === "string" ? value.recipientName.trim() : "";
  const phone = typeof value.phone === "string" ? value.phone.trim() : "";
  const address = typeof value.address === "string" ? value.address.trim() : "";
  const landmark = typeof value.landmark === "string" ? value.landmark.trim() : "";
  const instructions = typeof value.instructions === "string" ? value.instructions.trim() : "";
  if (!recipientName || recipientName.length > 100) throw new MenuQuoteError(400, "Enter a recipient name of up to 100 characters");
  if (!/^\+?[0-9\s()-]{7,24}$/.test(phone)) throw new MenuQuoteError(400, "Enter a valid delivery phone number");
  if (!address || address.length > 500) throw new MenuQuoteError(400, "Enter a delivery address of up to 500 characters");
  if (landmark.length > 200) throw new MenuQuoteError(400, "Landmark must be 200 characters or fewer");
  if (instructions.length > 500) throw new MenuQuoteError(400, "Delivery instructions must be 500 characters or fewer");
  return { recipientName, phone, address, landmark: landmark || null, instructions: instructions || null };
}

function existingOrderResponse(order: { id: string; order_number: string; fulfillment_status: string; payment_status: string }, replayed: boolean) {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    fulfillmentStatus: order.fulfillment_status,
    paymentStatus: order.payment_status,
    replayed,
  };
}

orders.post("/", ...customerAccess, async (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null
    ? request.body as Record<string, unknown>
    : {};
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    response.status(400).json({ error: "A valid checkout idempotency key is required" });
    return;
  }

  let delivery: DeliveryDetails;
  let lines;
  try {
    delivery = parseDelivery(body.delivery);
    lines = parseBasketInput({ items: body.items });
  } catch (error) {
    if (error instanceof MenuQuoteError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
    return;
  }

  const saveAddress = body.saveAddress === true;
  const addressLabel = typeof body.addressLabel === "string" ? body.addressLabel.trim() : "Saved address";
  if (saveAddress && (!addressLabel || addressLabel.length > 60)) {
    response.status(400).json({ error: "Saved address label must be 1 to 60 characters" });
    return;
  }
  const canonicalLines = lines.map((line) => ({
    ...line,
    optionIds: [...line.optionIds].sort(),
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ delivery, lines: canonicalLines, saveAddress, addressLabel: saveAddress ? addressLabel : null }))
    .digest("hex");
  const customerId = request.principal!.profileId;
  const lockKey = `${customerId}:${idempotencyKey}`;
  const client = await database.connect();
  let lock: string | null = null;
  try {
    lock = await acquireLock(client, `checkout:${lockKey}`);
    await client.query("START TRANSACTION");
    const previous = await client.query<{
      id: string;
      order_number: string;
      fulfillment_status: string;
      payment_status: string;
      idempotency_fingerprint: string | null;
    }>(
      `SELECT id, order_number, fulfillment_status, payment_status, idempotency_fingerprint
       FROM orders WHERE customer_id = ? AND idempotency_key = ?`,
      [customerId, idempotencyKey],
    );
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

    const quote = await calculateMenuQuote(client, lines, true);
    const totals = calculateOrderTotals(quote.subtotalMinor);
    const numberResult = await client.query<{ value: number }>("SELECT NEXTVAL(order_number_seq) AS value");
    const orderNumber = `IVY-${String(numberResult.rows[0]!.value).padStart(8, "0")}`;
    const snapshot = JSON.stringify({ ...delivery, fulfillmentMethod: "delivery" });
    const inserted = await client.query<{
      id: string;
      order_number: string;
      fulfillment_status: string;
      payment_status: string;
    }>(
      `INSERT INTO orders
         (order_number, customer_id, fulfillment_status, payment_status, currency,
          subtotal_minor, delivery_fee_minor, tax_minor, total_minor, delivery_snapshot,
          idempotency_key, idempotency_fingerprint)
       VALUES (?, ?, 'awaiting_acceptance', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, order_number, fulfillment_status, payment_status`,
      [orderNumber, customerId, quote.currency, totals.subtotalMinor, totals.deliveryFeeMinor,
        totals.taxMinor, totals.totalMinor, snapshot, idempotencyKey, fingerprint],
    );
    const order = inserted.rows[0]!;

    for (const line of quote.lines) {
      const itemSnapshot = JSON.stringify({
        menuItemId: line.menuItemId,
        name: line.name,
        category: line.category,
        options: line.options.map(({ id: _id, ...option }) => option),
      });
      await client.query(
        `INSERT INTO order_items (order_id, item_snapshot, quantity, unit_price_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?)`,
        [order.id, itemSnapshot, line.quantity, line.unitPriceMinor, line.lineTotalMinor],
      );
    }
    await client.query(
      `INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status)
       VALUES (?, ?, NULL, 'awaiting_acceptance')`,
      [order.id, customerId],
    );
    if (saveAddress) {
      await client.query(
        `INSERT INTO customer_addresses
           (customer_id, label, recipient_name, phone, address, landmark, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [customerId, addressLabel, delivery.recipientName, delivery.phone, delivery.address, delivery.landmark, delivery.instructions],
      );
    }
    await client.query("COMMIT");
    response.status(201).json({ ...existingOrderResponse(order, false), currency: quote.currency, ...totals });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    if (isDuplicateKeyError(error)) {
      try {
        const previous = await database.query<{
          id: string;
          order_number: string;
          fulfillment_status: string;
          payment_status: string;
          idempotency_fingerprint: string | null;
        }>(
          `SELECT id, order_number, fulfillment_status, payment_status, idempotency_fingerprint
           FROM orders WHERE customer_id = ? AND idempotency_key = ?`,
          [customerId, idempotencyKey],
        );
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
    if (error instanceof MenuQuoteError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  } finally {
    try {
      if (lock) await releaseLock(client, lock);
    } finally {
      client.release();
    }
  }
});

export default orders;
