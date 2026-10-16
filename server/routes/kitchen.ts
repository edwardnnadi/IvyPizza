import { Router } from "express";
import { database, parseJson } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const kitchen = Router();
const staffAccess = [requireAuth, requireAnyRole("kitchen", "manager", "owner")];
const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKitchenStatuses = new Set(["preparing", "ready_for_delivery"]);

kitchen.get("/orders", ...staffAccess, async (_request, response, next) => {
  try {
    const orders = await database.query<Record<string, unknown> & { id: string }>(
      `SELECT id, order_number, fulfillment_status, created_at
       FROM orders
       WHERE fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery')
       ORDER BY created_at ASC`,
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
    const result = { rows: orders.rows.map((order) => ({ ...order, items: itemsByOrder.get(order.id) ?? [] })) };
    response.json({ orders: result.rows });
  } catch (error) {
    next(error);
  }
});

kitchen.patch("/orders/:orderId/status", ...staffAccess, async (request, response, next) => {
  const { orderId } = request.params;
  const body: unknown = request.body;
  const status =
    typeof body === "object" && body !== null && "status" in body && typeof body.status === "string"
      ? body.status
      : null;

  if (typeof orderId !== "string" || !orderIdPattern.test(orderId)) {
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
    const orderResult = await client.query<{ id: string; fulfillment_status: string }>(
      "SELECT id, fulfillment_status FROM orders WHERE id = ? FOR UPDATE",
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
        error: "Order status has changed or the requested transition is not allowed",
        currentStatus: order.fulfillment_status,
      });
      return;
    }

    await client.query(
      "UPDATE orders SET fulfillment_status = ? WHERE id = ?",
      [status, orderId],
    );
    await client.query(
      `INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status)
       VALUES (?, ?, ?, ?)`,
      [orderId, request.principal!.profileId, order.fulfillment_status, status],
    );
    await client.query("COMMIT");
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

export default kitchen;
