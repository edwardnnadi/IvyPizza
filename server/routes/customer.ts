import { Router, type Request } from "express";
import { database, parseJson } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const customer = Router();
const customerAccess = [requireAuth, requireAnyRole("customer")];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const orderNumberPattern = /^IVY-\d{8}$/;
const phonePattern = /^\+?[0-9\s()-]{7,24}$/;

function body(request: Request): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

class InputError extends Error {}

customer.get("/dashboard", ...customerAccess, async (request, response, next) => {
  try {
    const customerId = request.principal!.profileId;
    const [summary, orders, recommendations] = await Promise.all([
      database.query(
        `SELECT COUNT(*) AS orderCount,
                COUNT(CASE WHEN fulfillment_status IN ('awaiting_acceptance', 'accepted', 'preparing', 'ready_for_delivery', 'out_for_delivery') THEN 1 END) AS activeOrderCount
         FROM orders WHERE customer_id = ?`, [customerId]),
      database.query<Record<string, unknown> & { id: string }>(
        `SELECT id, order_number AS orderNumber, fulfillment_status AS fulfillmentStatus,
                payment_status AS paymentStatus, currency, total_minor AS totalMinor,
                created_at AS createdAt
         FROM orders WHERE customer_id = ?
         ORDER BY created_at DESC LIMIT 12`, [customerId]),
      database.query(
        `SELECT mi.id, mi.name, mi.category, mi.description, mi.price_minor AS priceMinor, mi.currency
         FROM menu_items mi
         WHERE mi.available = TRUE AND mi.price_minor IS NOT NULL
         ORDER BY (
           SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
           WHERE JSON_VALUE(oi.item_snapshot, '$.menuItemId') = CAST(mi.id AS CHAR)
         ) DESC, mi.name
         LIMIT 4`),
    ]);
    const orderIds = orders.rows.map((order) => order.id);
    const items = orderIds.length
      ? await database.query<{ orderId: string; name: string; quantity: number }>(
        `SELECT order_id AS orderId, JSON_VALUE(item_snapshot, '$.name') AS name, quantity
         FROM order_items WHERE order_id IN (?) ORDER BY id`, [orderIds])
      : { rows: [] };
    const itemsByOrder = new Map<string, Array<{ name: string; quantity: number }>>();
    for (const { orderId, ...item } of items.rows) {
      itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), item]);
    }
    for (const order of orders.rows) order.items = itemsByOrder.get(order.id) ?? [];
    response.set("Cache-Control", "no-store");
    response.json({ ...summary.rows[0], orders: orders.rows, recommendations: recommendations.rows });
  } catch (error) {
    next(error);
  }
});

customer.get("/profile", ...customerAccess, async (request, response, next) => {
  try {
    const { rows: [profile] } = await database.query<{ display_name: string; email: string | null; phone: string | null; created_at: Date }>(
      "SELECT display_name, email, phone, created_at FROM users WHERE id = ?", [request.principal!.profileId]);
    response.set("Cache-Control", "no-store");
    response.json({
      displayName: profile?.display_name ?? "",
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      memberSince: profile ? new Date(profile.created_at).toISOString() : null,
    });
  } catch (error) {
    next(error);
  }
});

customer.patch("/profile", ...customerAccess, async (request, response, next) => {
  const input = body(request);
  const displayName = text(input.displayName);
  const phone = text(input.phone);
  if (!displayName || displayName.length > 100) {
    response.status(400).json({ error: "Enter your name, up to 100 characters" });
    return;
  }
  if (phone && !phonePattern.test(phone)) {
    response.status(400).json({ error: "Enter a valid phone number" });
    return;
  }
  try {
    await database.query("UPDATE users SET display_name = ?, phone = ? WHERE id = ?", [displayName, phone || null, request.principal!.profileId]);
    // The sign-in record keeps the name too; otherwise the next request would put the old name back.
    await database.query("UPDATE `user` SET name = ? WHERE id = ?", [displayName, request.principal!.authUserId]);
    response.json({ displayName, phone: phone || null });
  } catch (error) {
    next(error);
  }
});

customer.get("/addresses", ...customerAccess, async (request, response, next) => {
  try {
    const result = await database.query(
      `SELECT id, label, recipient_name AS recipientName, phone, address,
              landmark, instructions, is_default AS isDefault, created_at AS createdAt
       FROM customer_addresses
       WHERE customer_id = ?
       ORDER BY is_default DESC, created_at DESC
       LIMIT 50`,
      [request.principal!.profileId],
    );
    response.set("Cache-Control", "no-store");
    response.json({ addresses: result.rows });
  } catch (error) {
    next(error);
  }
});

function parseAddress(input: Record<string, unknown>): { label: string; recipientName: string; phone: string; address: string; landmark: string; instructions: string | null } {
  const value = {
    label: text(input.label) || "Home",
    recipientName: text(input.recipientName),
    phone: text(input.phone),
    address: text(input.address),
    landmark: text(input.landmark),
    instructions: text(input.instructions) || null,
  };
  if (value.label.length > 60) throw new InputError("Label must be 60 characters or fewer");
  if (!value.recipientName || value.recipientName.length > 100) throw new InputError("Enter the recipient's name");
  if (!phonePattern.test(value.phone)) throw new InputError("Enter a valid phone number");
  if (!value.address || value.address.length > 500) throw new InputError("Enter the street address");
  if (!value.landmark || value.landmark.length > 200) throw new InputError("Add a nearby landmark so riders can find you");
  if (value.instructions && value.instructions.length > 500) throw new InputError("Rider notes must be 500 characters or fewer");
  return value;
}

customer.post("/addresses", ...customerAccess, async (request, response, next) => {
  try {
    const input = body(request);
    const address = parseAddress(input);
    const customerId = request.principal!.profileId;
    const { rows: [counted] } = await database.query<{ count: number }>("SELECT COUNT(*) AS count FROM customer_addresses WHERE customer_id = ?", [customerId]);
    const count = Number(counted?.count ?? 0);
    if (count >= 20) throw new InputError("You can save up to 20 addresses");
    const isDefault = input.isDefault === true || count === 0;
    if (isDefault) await database.query("UPDATE customer_addresses SET is_default = FALSE WHERE customer_id = ?", [customerId]);
    const { rows: [created] } = await database.query<{ id: string }>(
      `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, landmark, instructions, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [customerId, address.label, address.recipientName, address.phone, address.address, address.landmark, address.instructions, isDefault],
    );
    response.status(201).json({ id: created!.id, ...address, isDefault });
  } catch (error) {
    if (error instanceof InputError) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

customer.patch("/addresses/:addressId", ...customerAccess, async (request, response, next) => {
  const { addressId } = request.params;
  if (typeof addressId !== "string" || !idPattern.test(addressId)) {
    response.status(400).json({ error: "Invalid address" });
    return;
  }
  try {
    const address = parseAddress(body(request));
    const result = await database.query(
      `UPDATE customer_addresses SET label = ?, recipient_name = ?, phone = ?, address = ?, landmark = ?, instructions = ?, updated_at = NOW(3)
       WHERE id = ? AND customer_id = ?`,
      [address.label, address.recipientName, address.phone, address.address, address.landmark, address.instructions, addressId, request.principal!.profileId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Address not found" });
      return;
    }
    response.json({ id: addressId, ...address });
  } catch (error) {
    if (error instanceof InputError) {
      response.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

customer.post("/addresses/:addressId/default", ...customerAccess, async (request, response, next) => {
  const { addressId } = request.params;
  if (typeof addressId !== "string" || !idPattern.test(addressId)) {
    response.status(400).json({ error: "Invalid address" });
    return;
  }
  const client = await database.connect();
  try {
    await client.query("START TRANSACTION");
    const found = await client.query("SELECT 1 FROM customer_addresses WHERE id = ? AND customer_id = ? FOR UPDATE", [addressId, request.principal!.profileId]);
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Address not found" });
      return;
    }
    await client.query("UPDATE customer_addresses SET is_default = (id = ?) WHERE customer_id = ?", [addressId, request.principal!.profileId]);
    await client.query("COMMIT");
    response.json({ id: addressId, isDefault: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally {
    client.release();
  }
});

customer.delete("/addresses/:addressId", ...customerAccess, async (request, response, next) => {
  const { addressId } = request.params;
  if (typeof addressId !== "string" || !idPattern.test(addressId)) {
    response.status(400).json({ error: "Invalid address" });
    return;
  }
  try {
    const customerId = request.principal!.profileId;
    const { rows: [address] } = await database.query<{ is_default: boolean }>(
      "SELECT is_default FROM customer_addresses WHERE id = ? AND customer_id = ?", [addressId, customerId]);
    if (!address) {
      response.status(404).json({ error: "Address not found" });
      return;
    }
    await database.query("DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?", [addressId, customerId]);
    // Keep one default while any address remains.
    if (address.is_default) {
      await database.query("UPDATE customer_addresses SET is_default = TRUE WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1", [customerId]);
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Order history with what's needed for status badges, refunds, reviews and reordering. */
customer.get("/orders", ...customerAccess, async (request, response, next) => {
  try {
    const customerId = request.principal!.profileId;
    const { rows: orders } = await database.query<{
      id: string; order_number: string; fulfillment_status: string; payment_status: string; payment_method: string; fulfilment_mode: string;
      total_minor: number; currency: string; created_at: Date; scheduled_for: Date | null; rating: number | null; review_body: string | null;
    }>(
      `SELECT o.id, o.order_number, o.fulfillment_status, o.payment_status, o.payment_method, o.fulfilment_mode, o.total_minor, o.currency,
              o.created_at, o.scheduled_for, r.rating, r.body AS review_body
       FROM orders o LEFT JOIN reviews r ON r.order_id = o.id
       WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 50`,
      [customerId],
    );
    const ids = orders.map((order) => order.id);
    const items = ids.length
      ? await database.query<{ order_id: string; item_snapshot: unknown; quantity: number; line_total_minor: number }>(
        "SELECT order_id, item_snapshot, quantity, line_total_minor FROM order_items WHERE order_id IN (?) ORDER BY id", [ids])
      : { rows: [] };
    const refunds = ids.length
      ? (await database.query<{ order_id: string; amount_minor: number; status: string }>(
        "SELECT p.order_id, rr.amount_minor, rr.status FROM refund_records rr JOIN payment_records p ON p.id = rr.payment_id WHERE p.order_id IN (?)", [ids])).rows
      : [];
    response.set("Cache-Control", "no-store");
    response.json({
      orders: orders.map((order) => ({
        orderNumber: order.order_number,
        fulfillmentStatus: order.fulfillment_status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        mode: order.fulfilment_mode,
        totalMinor: order.total_minor,
        currency: order.currency,
        createdAt: new Date(order.created_at).toISOString(),
        scheduledFor: order.scheduled_for ? new Date(order.scheduled_for).toISOString() : null,
        review: order.rating ? { rating: order.rating, body: order.review_body ?? "" } : null,
        refundedMinor: refunds.filter((refund) => refund.order_id === order.id && refund.status === "succeeded").reduce((total, refund) => total + refund.amount_minor, 0),
        items: items.rows.filter((item) => item.order_id === order.id).map((item) => {
          const snapshot = parseJson<{ name?: string; summary?: string }>(item.item_snapshot) ?? {};
          return { name: snapshot.name ?? "Item", summary: snapshot.summary ?? "", quantity: item.quantity, lineTotalMinor: item.line_total_minor };
        }),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** The lines to put back in the basket. The storefront re-checks them against today's menu and prices. */
customer.get("/orders/:orderNumber/reorder", ...customerAccess, async (request, response, next) => {
  const orderNumber = String(request.params.orderNumber ?? "").toUpperCase();
  if (!orderNumberPattern.test(orderNumber)) {
    response.status(400).json({ error: "Invalid order number" });
    return;
  }
  try {
    const { rows } = await database.query<{ item_snapshot: unknown; quantity: number }>(
      `SELECT oi.item_snapshot, oi.quantity FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.order_number = ? AND o.customer_id = ? ORDER BY oi.id`,
      [orderNumber, request.principal!.profileId],
    );
    if (!rows.length) {
      response.status(404).json({ error: "Order not found" });
      return;
    }
    response.json({
      lines: rows.map((row) => {
        const snapshot = parseJson<{ input?: Record<string, unknown>; menuItemId?: string; name?: string }>(row.item_snapshot) ?? {};
        // Orders placed before reordering existed only kept the item; those come back with default choices.
        return {
          name: snapshot.name ?? "Item",
          exact: !!snapshot.input,
          line: snapshot.input ?? { menuItemId: snapshot.menuItemId, quantity: row.quantity, optionIds: [] },
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

customer.post("/orders/:orderNumber/review", ...customerAccess, async (request, response, next) => {
  const orderNumber = String(request.params.orderNumber ?? "").toUpperCase();
  const input = body(request);
  const rating = Number(input.rating);
  const reviewBody = text(input.body);
  if (!orderNumberPattern.test(orderNumber) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    response.status(400).json({ error: "Choose a rating from 1 to 5 stars" });
    return;
  }
  if (reviewBody.length > 1000) {
    response.status(400).json({ error: "Keep your review to 1,000 characters" });
    return;
  }
  try {
    const customerId = request.principal!.profileId;
    const { rows: [order] } = await database.query<{ id: string; fulfillment_status: string }>(
      "SELECT id, fulfillment_status FROM orders WHERE order_number = ? AND customer_id = ?", [orderNumber, customerId]);
    if (!order) {
      response.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.fulfillment_status !== "delivered") {
      response.status(409).json({ error: "You can rate an order once it has been delivered" });
      return;
    }
    await database.query(
      `INSERT INTO reviews (order_id, customer_id, rating, body) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), body = VALUES(body)`,
      [order.id, customerId, rating, reviewBody],
    );
    response.json({ orderNumber, rating, body: reviewBody });
  } catch (error) {
    next(error);
  }
});

export default customer;
