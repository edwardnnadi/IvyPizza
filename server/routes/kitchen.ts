import { Router } from "express";
import { database } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const kitchen = Router();
const staffAccess = [requireAuth, requireAnyRole("kitchen", "manager", "owner")];
const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKitchenStatuses = new Set(["preparing", "ready_for_delivery"]);

kitchen.get("/orders", ...staffAccess, async (_request, response, next) => {
  try {
    const result = await database.query(
      `SELECT o.id,
              o.order_number,
              o.fulfillment_status,
              o.created_at,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'item', oi.item_snapshot,
                    'quantity', oi.quantity,
                    'unit_price_minor', oi.unit_price_minor,
                    'line_total_minor', oi.line_total_minor
                  ) ORDER BY oi.id
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'::jsonb
              ) AS items
       FROM public.orders AS o
       LEFT JOIN public.order_items AS oi ON oi.order_id = o.id
       WHERE o.fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery')
       GROUP BY o.id
       ORDER BY o.created_at ASC`,
    );
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
    await client.query("BEGIN");
    const orderResult = await client.query<{ id: string; fulfillment_status: string }>(
      "SELECT id, fulfillment_status FROM public.orders WHERE id = $1 FOR UPDATE",
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
      "UPDATE public.orders SET fulfillment_status = $2 WHERE id = $1",
      [orderId, status],
    );
    await client.query(
      `INSERT INTO public.order_status_events (order_id, actor_id, previous_status, new_status)
       VALUES ($1, $2, $3, $4)`,
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
