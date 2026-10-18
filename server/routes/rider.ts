import { Router, type Request, type Response, type NextFunction } from "express";
import { database, parseJson, type Queryable } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";
import { queueOrderEmail, type OrderEmailKind } from "../order-emails.js";
import { markPaidOnHandover, recordStatus } from "./manager.js";

const rider = Router();
const riderAccess = [requireAuth, requireAnyRole("rider")];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exceptionReasons = new Set(["No answer", "Wrong address", "Customer refused", "Couldn't reach the address", "Other"]);

/** The rider's assigned deliveries that are still in progress, oldest first, plus how many they finished today. */
rider.get("/deliveries", ...riderAccess, async (request, response, next) => {
  try {
    const riderId = request.principal!.profileId;
    const { rows } = await database.query<{
      id: string; order_number: string; fulfillment_status: string; payment_method: string; payment_status: string;
      total_minor: number; currency: string; delivery_snapshot: unknown; zone_name: string | null; scheduled_for: Date | null; created_at: Date;
    }>(
      `SELECT o.id, o.order_number, o.fulfillment_status, o.payment_method, o.payment_status, o.total_minor, o.currency,
              o.delivery_snapshot, z.name AS zone_name, o.scheduled_for, o.created_at
       FROM rider_assignments ra
       JOIN orders o ON o.id = ra.order_id
       LEFT JOIN delivery_zones z ON z.id = o.zone_id
       WHERE ra.rider_id = ? AND ra.ended_at IS NULL
         AND o.fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivery_exception')
       ORDER BY o.created_at`,
      [riderId],
    );
    const ids = rows.map((row) => row.id);
    const items = ids.length
      ? await database.query<{ order_id: string; item_snapshot: unknown; quantity: number }>("SELECT order_id, item_snapshot, quantity FROM order_items WHERE order_id IN (?) ORDER BY id", [ids])
      : { rows: [] };
    const { rows: [done] } = await database.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM order_status_events e JOIN rider_assignments ra ON ra.order_id = e.order_id AND ra.rider_id = ?
       WHERE e.new_status = 'delivered' AND e.created_at >= CURRENT_DATE`,
      [riderId],
    );
    response.set("Cache-Control", "no-store");
    response.json({
      deliveredToday: Number(done?.count ?? 0),
      deliveries: rows.map((row) => {
        const snapshot = parseJson<Record<string, string | null>>(row.delivery_snapshot) ?? {};
        return {
          id: row.id,
          orderNumber: row.order_number,
          fulfillmentStatus: row.fulfillment_status,
          customerFirstName: String(snapshot.recipientName ?? "").split(/\s+/)[0] || "Customer",
          phone: snapshot.phone ?? null,
          address: snapshot.address ?? null,
          landmark: snapshot.landmark ?? null,
          instructions: snapshot.instructions ?? null,
          area: row.zone_name ?? snapshot.area ?? null,
          scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
          createdAt: new Date(row.created_at).toISOString(),
          // What the rider must collect at the door.
          collectMinor: row.payment_method === "on_delivery" && row.payment_status === "pending" ? row.total_minor : 0,
          currency: row.currency,
          items: items.rows.filter((item) => item.order_id === row.id).map((item) => `${item.quantity}× ${parseJson<{ name?: string }>(item.item_snapshot)?.name ?? "Item"}`),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

interface RiderOrder {
  id: string;
  fulfillment_status: string;
  payment_method: string;
  payment_status: string;
  total_minor: number;
  currency: string;
}

class Conflict extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function changeDelivery(
  request: Request, response: Response, next: NextFunction,
  change: (client: Queryable, order: RiderOrder, riderId: string) => Promise<{ status: string; email?: OrderEmailKind }>,
): Promise<void> {
  const { orderId } = request.params;
  if (typeof orderId !== "string" || !idPattern.test(orderId)) {
    response.status(400).json({ error: "Invalid order ID" });
    return;
  }
  const riderId = request.principal!.profileId;
  const client = await database.connect();
  try {
    await client.query("START TRANSACTION");
    const { rows: [order] } = await client.query<RiderOrder>(
      `SELECT o.id, o.fulfillment_status, o.payment_method, o.payment_status, o.total_minor, o.currency
       FROM orders o JOIN rider_assignments ra ON ra.order_id = o.id AND ra.ended_at IS NULL AND ra.rider_id = ?
       WHERE o.id = ? FOR UPDATE`,
      [riderId, orderId],
    );
    // Someone else's delivery looks the same as no delivery.
    if (!order) throw new Conflict(404, "This delivery isn't assigned to you");
    const { status, email } = await change(client, order, riderId);
    await client.query("COMMIT");
    if (email) queueOrderEmail(order.id, email);
    response.json({ id: order.id, fulfillmentStatus: status });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Conflict) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
}

rider.patch("/orders/:orderId/out", ...riderAccess, (request, response, next) =>
  changeDelivery(request, response, next, async (client, order, riderId) => {
    if (order.fulfillment_status !== "ready_for_delivery") throw new Conflict(409, "Pick this order up once the kitchen marks it ready");
    await client.query("UPDATE orders SET fulfillment_status = 'out_for_delivery' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, riderId, order.fulfillment_status, "out_for_delivery", null);
    return { status: "out_for_delivery", email: "out_for_delivery" };
  }));

rider.patch("/orders/:orderId/delivered", ...riderAccess, (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const collected = body.collected === "cash" || body.collected === "pos" ? body.collected : null;
  return changeDelivery(request, response, next, async (client, order, riderId) => {
    if (order.fulfillment_status !== "out_for_delivery") throw new Conflict(409, "Only orders out for delivery can be marked delivered");
    if (order.payment_method === "on_delivery" && order.payment_status === "pending") {
      if (!collected) throw new Conflict(400, "Confirm how the customer paid: cash or POS");
      await markPaidOnHandover(client, order, collected);
    }
    await client.query("UPDATE orders SET fulfillment_status = 'delivered' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, riderId, order.fulfillment_status, "delivered", collected ? `Collected by ${collected === "pos" ? "POS" : "cash"}` : null);
    return { status: "delivered", email: "delivered" };
  });
});

rider.patch("/orders/:orderId/exception", ...riderAccess, (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  if (!exceptionReasons.has(reason)) {
    response.status(400).json({ error: "Choose what went wrong" });
    return;
  }
  return changeDelivery(request, response, next, async (client, order, riderId) => {
    if (order.fulfillment_status !== "out_for_delivery") throw new Conflict(409, "Only orders out for delivery can have a delivery problem");
    await client.query("UPDATE orders SET fulfillment_status = 'delivery_exception' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, riderId, order.fulfillment_status, "delivery_exception", note ? `${reason}: ${note}` : reason);
    return { status: "delivery_exception" };
  });
});

export default rider;
