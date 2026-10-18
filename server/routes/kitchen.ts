import { Router } from "express";
import { database, parseJson } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";
import { expireUnpaidTransfers } from "../order-view.js";
import { queueOrderEmail } from "../order-emails.js";

const kitchen = Router();
const staffAccess = [requireAuth, requireAnyRole("kitchen", "manager", "owner")];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKitchenStatuses = new Set(["preparing", "ready_for_delivery"]);

kitchen.get("/orders", ...staffAccess, async (_request, response, next) => {
  try {
    await expireUnpaidTransfers();
    // Active tickets, plus anything cancelled in the last 30 minutes after it reached the kitchen, so cooks stop work on it.
    const orders = await database.query<Record<string, unknown> & { id: string }>(
      `SELECT o.id, o.order_number, o.fulfillment_status, o.created_at, o.fulfilment_mode, o.scheduled_for,
              (SELECT MAX(created_at) FROM order_status_events e WHERE e.order_id = o.id AND e.new_status = 'accepted') AS accepted_at,
              (SELECT MAX(created_at) FROM order_status_events e WHERE e.order_id = o.id AND e.new_status = 'preparing') AS preparing_at,
              (SELECT reason FROM order_status_events e WHERE e.order_id = o.id AND e.new_status = 'cancelled' ORDER BY created_at DESC LIMIT 1) AS cancel_reason
       FROM orders o
       WHERE o.fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery')
          OR (o.fulfillment_status = 'cancelled' AND EXISTS (
            SELECT 1 FROM order_status_events e WHERE e.order_id = o.id AND e.new_status = 'cancelled'
              AND e.previous_status IN ('accepted', 'preparing', 'ready_for_delivery') AND e.created_at >= NOW(3) - INTERVAL 30 MINUTE))
       ORDER BY COALESCE(o.scheduled_for, o.created_at) ASC`,
    );
    const orderIds = orders.rows.map((order) => order.id);
    const items = orderIds.length
      ? await database.query<{ order_id: string; item_snapshot: unknown; quantity: number; unit_price_minor: number; line_total_minor: number }>(
        `SELECT order_id, item_snapshot, quantity, unit_price_minor, line_total_minor
         FROM order_items WHERE order_id IN (?) ORDER BY id`,
        [orderIds],
      )
      : { rows: [] };
    const itemsByOrder = new Map<string, unknown[]>();
    for (const { order_id, item_snapshot, ...line } of items.rows) {
      itemsByOrder.set(order_id, [...(itemsByOrder.get(order_id) ?? []), { item: parseJson(item_snapshot), ...line }]);
    }
    response.set("Cache-Control", "no-store");
    response.json({ orders: orders.rows.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] })) });
  } catch (error) {
    next(error);
  }
});

kitchen.patch("/orders/:orderId/status", ...staffAccess, async (request, response, next) => {
  const { orderId } = request.params;
  const body: unknown = request.body;
  const status = typeof body === "object" && body !== null && "status" in body && typeof body.status === "string" ? body.status : null;

  if (typeof orderId !== "string" || !idPattern.test(orderId)) {
    response.status(400).json({ error: "Invalid order ID" });
    return;
  }
  if (!status || !allowedKitchenStatuses.has(status)) {
    response.status(400).json({ error: "Status must be preparing or ready_for_delivery" });
    return;
  }

  const expectedPreviousStatus = status === "preparing" ? "accepted" : "preparing";
  const client = await database.connect();
  try {
    await client.query("START TRANSACTION");
    const orderResult = await client.query<{ id: string; fulfillment_status: string; fulfilment_mode: string }>(
      "SELECT id, fulfillment_status, fulfilment_mode FROM orders WHERE id = ? FOR UPDATE",
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.fulfillment_status !== expectedPreviousStatus) {
      await client.query("ROLLBACK");
      response.status(409).json({
        error: order.fulfillment_status === "cancelled" ? "This order was cancelled. Stop work on it." : "Order status has changed or the requested transition is not allowed",
        currentStatus: order.fulfillment_status,
      });
      return;
    }

    await client.query("UPDATE orders SET fulfillment_status = ? WHERE id = ?", [status, orderId]);
    await client.query(
      "INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status) VALUES (?, ?, ?, ?)",
      [orderId, request.principal!.profileId, order.fulfillment_status, status],
    );
    await client.query("COMMIT");
    if (status === "ready_for_delivery" && order.fulfilment_mode === "pickup") queueOrderEmail(order.id, "ready_for_pickup");
    response.json({ id: order.id, fulfillmentStatus: status });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original database error.
    }
    next(error);
  } finally {
    client.release();
  }
});

/** Menu availability for "86ing" sold-out items and toppings. */
kitchen.get("/menu", ...staffAccess, async (_request, response, next) => {
  try {
    const [items, options] = await Promise.all([
      database.query<{ id: string; name: string; category: string; available: boolean }>(
        "SELECT id, name, category, available FROM menu_items WHERE price_minor IS NOT NULL ORDER BY display_order, name"),
      // Toppings are the same across pizzas, so they are toggled by name for every pizza at once.
      database.query<{ name: string; available: number; total: number }>(
        `SELECT o.name, SUM(o.available) AS available, COUNT(*) AS total FROM menu_options o
         WHERE o.option_type IN ('topping', 'crust', 'sauce') AND o.price_delta_minor IS NOT NULL
         GROUP BY o.name ORDER BY MIN(o.option_type), MIN(o.display_order), o.name`),
    ]);
    response.set("Cache-Control", "no-store");
    response.json({
      items: items.rows,
      ingredients: options.rows.map((row) => ({ name: row.name, available: Number(row.available) === Number(row.total) })),
    });
  } catch (error) {
    next(error);
  }
});

kitchen.patch("/menu/items/:itemId", ...staffAccess, async (request, response, next) => {
  const { itemId } = request.params;
  const available = (request.body as { available?: unknown } | undefined)?.available;
  if (typeof itemId !== "string" || !idPattern.test(itemId) || typeof available !== "boolean") {
    response.status(400).json({ error: "Send the item and whether it is available" });
    return;
  }
  try {
    const result = await database.query("UPDATE menu_items SET available = ? WHERE id = ? AND price_minor IS NOT NULL", [available, itemId]);
    if (!result.rowCount) {
      response.status(404).json({ error: "Menu item not found" });
      return;
    }
    response.json({ id: itemId, available });
  } catch (error) {
    next(error);
  }
});

kitchen.patch("/menu/ingredients", ...staffAccess, async (request, response, next) => {
  const body = (request.body ?? {}) as { name?: unknown; available?: unknown };
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200 || typeof body.available !== "boolean") {
    response.status(400).json({ error: "Send the ingredient name and whether it is available" });
    return;
  }
  try {
    const result = await database.query(
      "UPDATE menu_options SET available = ? WHERE name = ? AND option_type IN ('topping', 'crust', 'sauce')",
      [body.available, body.name.trim()],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Ingredient not found" });
      return;
    }
    response.json({ name: body.name.trim(), available: body.available });
  } catch (error) {
    next(error);
  }
});

export default kitchen;
