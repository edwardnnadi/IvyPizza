import { Router, type Request, type Response, type NextFunction } from "express";
import { database, parseJson, type Queryable } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";
import { expireUnpaidTransfers } from "../order-view.js";
import { businessClock, businessTimeToUtc } from "../ordering.js";
import { queueOrderEmail, type OrderEmailKind } from "../order-emails.js";

const manager = Router();
const managerAccess = [requireAuth, requireAnyRole("manager", "owner")];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxReasonLength = 500;
const activeStatuses = ["accepted", "preparing", "ready_for_delivery", "out_for_delivery", "delivery_exception"];
const terminalStatuses = new Set(["delivered", "rejected", "cancelled"]);

interface ManagerOrderRow {
  id: string;
  order_number: string;
  fulfillment_status: string;
  fulfilment_mode: string;
  created_at: Date;
  scheduled_for: Date | null;
  payment_method: string;
  payment_status: string;
  transfer_reported_at: Date | null;
  payment_due_at: Date | null;
  currency: string;
  total_minor: number;
  delivery_snapshot: unknown;
  store_name: string | null;
  zone_name: string | null;
  accepted_at: Date | null;
  rider_id: string | null;
  rider_name: string | null;
  status_reason: string | null;
}

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

/** Orders waiting for a decision, every order still in progress, and the ones delivered since midnight. Rejected and cancelled orders leave the list. */
manager.get("/orders", ...managerAccess, async (_request, response, next) => {
  try {
    await expireUnpaidTransfers();
    const startOfToday = businessTimeToUtc(businessClock(new Date()).date, 0);
    const orders = await database.query<ManagerOrderRow>(
      `SELECT o.id, o.order_number, o.fulfillment_status, o.fulfilment_mode, o.created_at, o.scheduled_for,
              o.payment_method, o.payment_status, o.transfer_reported_at, o.payment_due_at, o.currency, o.total_minor,
              o.delivery_snapshot, s.name AS store_name, z.name AS zone_name,
              (SELECT MAX(created_at) FROM order_status_events e WHERE e.order_id = o.id AND e.new_status = 'accepted') AS accepted_at,
              ra.rider_id, ru.display_name AS rider_name,
              (SELECT reason FROM order_status_events e WHERE e.order_id = o.id ORDER BY e.created_at DESC LIMIT 1) AS status_reason
       FROM orders o
       LEFT JOIN stores s ON s.id = o.store_id
       LEFT JOIN delivery_zones z ON z.id = o.zone_id
       LEFT JOIN rider_assignments ra ON ra.order_id = o.id AND ra.ended_at IS NULL
       LEFT JOIN users ru ON ru.id = ra.rider_id
       WHERE o.fulfillment_status = 'awaiting_acceptance'
          OR o.fulfillment_status IN (?)
          OR (o.fulfillment_status = 'delivered' AND o.created_at >= ?)
       ORDER BY o.fulfillment_status = 'awaiting_acceptance' DESC, o.created_at ASC`,
      [activeStatuses, startOfToday],
    );
    const orderIds = orders.rows.map((order) => order.id);
    const items = orderIds.length
      ? await database.query<{ order_id: string; item_snapshot: unknown; quantity: number }>(
        "SELECT order_id, item_snapshot, quantity FROM order_items WHERE order_id IN (?) ORDER BY id",
        [orderIds],
      )
      : { rows: [] };
    const itemsByOrder = new Map<string, unknown[]>();
    for (const { order_id, item_snapshot, quantity } of items.rows) {
      const item = parseJson<{ name?: string; summary?: string; instructions?: string }>(item_snapshot) ?? {};
      itemsByOrder.set(order_id, [...(itemsByOrder.get(order_id) ?? []), {
        name: item.name ?? "Item", summary: item.summary ?? "", instructions: item.instructions ?? null, quantity,
      }]);
    }
    response.set("Cache-Control", "no-store");
    response.json({
      orders: orders.rows.map((order) => {
        const snapshot = parseJson<Record<string, unknown>>(order.delivery_snapshot) ?? {};
        const text = (value: unknown) => (typeof value === "string" && value ? value : null);
        return {
          id: order.id,
          orderNumber: order.order_number,
          fulfillmentStatus: order.fulfillment_status,
          mode: order.fulfilment_mode,
          createdAt: iso(order.created_at),
          scheduledFor: iso(order.scheduled_for),
          acceptedAt: iso(order.accepted_at),
          paymentMethod: order.payment_method,
          paymentStatus: order.payment_status,
          transferReportedAt: iso(order.transfer_reported_at),
          paymentDueAt: iso(order.payment_due_at),
          currency: order.currency,
          totalMinor: order.total_minor,
          area: order.zone_name ?? text(snapshot.area),
          store: order.store_name ?? text(snapshot.store),
          recipient: { name: text(snapshot.recipientName), phone: text(snapshot.phone) },
          address: order.fulfilment_mode === "pickup" ? null : text(snapshot.address),
          landmark: text(snapshot.landmark),
          deliveryInstructions: text(snapshot.instructions),
          rider: order.rider_id ? { id: order.rider_id, name: order.rider_name } : null,
          statusReason: order.status_reason,
          items: itemsByOrder.get(order.id) ?? [],
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

/** Riders who can be given deliveries: an active employment record and the rider role. */
manager.get("/riders", ...managerAccess, async (_request, response, next) => {
  try {
    const { rows } = await database.query<{ id: string; display_name: string; active_deliveries: number }>(
      `SELECT u.id, u.display_name,
              (SELECT COUNT(*) FROM rider_assignments ra JOIN orders o ON o.id = ra.order_id
               WHERE ra.rider_id = u.id AND ra.ended_at IS NULL AND o.fulfillment_status IN ('ready_for_delivery', 'out_for_delivery')) AS active_deliveries
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.name = 'rider'
       JOIN staff_employment se ON se.user_id = u.id AND se.employment_status = 'employed'
       ORDER BY u.display_name`,
    );
    response.json({ riders: rows.map((row) => ({ id: row.id, name: row.display_name, activeDeliveries: Number(row.active_deliveries) })) });
  } catch (error) {
    next(error);
  }
});

interface LockedOrder {
  id: string;
  fulfillment_status: string;
  fulfilment_mode: string;
  payment_method: string;
  payment_status: string;
  currency: string;
  total_minor: number;
}

class Conflict extends Error {
  constructor(public status: number, message: string, public detail: Record<string, unknown> = {}) { super(message); }
}

/** Locks the order, runs `change`, commits, then sends the customer email the change asked for. */
async function changeOrder(
  request: Request,
  response: Response,
  next: NextFunction,
  change: (client: Queryable, order: LockedOrder, actorId: string) => Promise<{ result: Record<string, unknown>; email?: OrderEmailKind }>,
): Promise<void> {
  const { orderId } = request.params;
  if (typeof orderId !== "string" || !idPattern.test(orderId)) {
    response.status(400).json({ error: "Invalid order ID" });
    return;
  }
  const client = await database.connect();
  try {
    await client.query("START TRANSACTION");
    const { rows: [order] } = await client.query<LockedOrder>(
      "SELECT id, fulfillment_status, fulfilment_mode, payment_method, payment_status, currency, total_minor FROM orders WHERE id = ? FOR UPDATE",
      [orderId],
    );
    if (!order) throw new Conflict(404, "Order not found");
    const { result, email } = await change(client, order, request.principal!.profileId);
    await client.query("COMMIT");
    if (email) queueOrderEmail(order.id, email);
    response.json({ id: order.id, ...result });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Conflict) {
      response.status(error.status).json({ error: error.message, ...error.detail });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
}

function requireStatus(order: LockedOrder, allowed: string[], message: string): void {
  if (!allowed.includes(order.fulfillment_status)) throw new Conflict(409, message, { currentStatus: order.fulfillment_status });
}

export async function recordStatus(client: Queryable, orderId: string, actorId: string | null, previous: string, next: string, reason: string | null): Promise<void> {
  await client.query(
    "INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status, reason) VALUES (?, ?, ?, ?, ?)",
    [orderId, actorId, previous, next, reason],
  );
}

function readReason(request: Request): string | null {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  return reason && reason.length <= maxReasonLength ? reason : null;
}

manager.patch("/orders/:orderId/accept", ...managerAccess, (request, response, next) =>
  changeOrder(request, response, next, async (client, order, actorId) => {
    requireStatus(order, ["awaiting_acceptance"], "This order is no longer waiting for a decision");
    if (order.payment_method === "transfer" && order.payment_status !== "paid") {
      throw new Conflict(409, "Mark the bank transfer as received before accepting this order", { paymentStatus: order.payment_status });
    }
    await client.query("UPDATE orders SET fulfillment_status = 'accepted' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "accepted", null);
    return { result: { fulfillmentStatus: "accepted" } };
  }));

manager.patch("/orders/:orderId/reject", ...managerAccess, (request, response, next) => {
  const reason = readReason(request);
  if (!reason) {
    response.status(400).json({ error: `Give a reason of up to ${maxReasonLength} characters` });
    return;
  }
  return changeOrder(request, response, next, async (client, order, actorId) => {
    requireStatus(order, ["awaiting_acceptance"], "This order is no longer waiting for a decision");
    // Money already received has to go back to the customer.
    const paymentStatus = order.payment_status === "paid" ? "refund_pending" : order.payment_status;
    await client.query("UPDATE orders SET fulfillment_status = 'rejected', payment_status = ? WHERE id = ?", [paymentStatus, order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "rejected", reason);
    return { result: { fulfillmentStatus: "rejected", paymentStatus }, email: "rejected" };
  });
});

manager.patch("/orders/:orderId/payment", ...managerAccess, (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  if (body.status !== "paid") {
    response.status(400).json({ error: "Status must be paid" });
    return;
  }
  return changeOrder(request, response, next, async (client, order, actorId) => {
    if (order.payment_method !== "transfer") throw new Conflict(409, "Only bank transfer payments are confirmed here");
    if (order.payment_status !== "pending") throw new Conflict(409, "This payment is no longer pending", { paymentStatus: order.payment_status });
    requireStatus(order, ["awaiting_acceptance"], "This order is no longer waiting for a decision");
    await client.query("UPDATE orders SET payment_status = 'paid' WHERE id = ?", [order.id]);
    await client.query(
      "INSERT INTO payment_records (order_id, provider, amount_minor, currency, status) VALUES (?, 'bank_transfer', ?, ?, 'paid')",
      [order.id, order.total_minor, order.currency],
    );
    // The fulfilment status stays put; the event keeps who confirmed the money, and when.
    await recordStatus(client, order.id, actorId, order.fulfillment_status, order.fulfillment_status, "Bank transfer received");
    return { result: { paymentStatus: "paid" } };
  });
});

/** Gives a delivery to a rider, ending any earlier assignment (one active rider per order). */
manager.post("/orders/:orderId/assign", ...managerAccess, (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const riderId = typeof body.riderId === "string" ? body.riderId : "";
  if (!idPattern.test(riderId)) {
    response.status(400).json({ error: "Choose a rider" });
    return;
  }
  return changeOrder(request, response, next, async (client, order, actorId) => {
    if (order.fulfilment_mode !== "delivery") throw new Conflict(409, "Pickup orders don't need a rider");
    requireStatus(order, ["accepted", "preparing", "ready_for_delivery", "out_for_delivery", "delivery_exception"], "This order can't be given to a rider now");
    const { rowCount } = await client.query(
      `SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.name = 'rider'
       JOIN staff_employment se ON se.user_id = u.id AND se.employment_status = 'employed' WHERE u.id = ?`,
      [riderId],
    );
    if (!rowCount) throw new Conflict(400, "That person isn't an employed rider");
    await client.query("UPDATE rider_assignments SET ended_at = NOW(3) WHERE order_id = ? AND ended_at IS NULL", [order.id]);
    await client.query("INSERT INTO rider_assignments (order_id, rider_id, assigned_by) VALUES (?, ?, ?)", [order.id, riderId, actorId]);
    return { result: { riderId } };
  });
});

/** A pickup order handed over at the counter. Pay-at-counter orders are paid now. */
manager.patch("/orders/:orderId/collected", ...managerAccess, (request, response, next) =>
  changeOrder(request, response, next, async (client, order, actorId) => {
    if (order.fulfilment_mode !== "pickup") throw new Conflict(409, "Only pickup orders are collected at the counter");
    requireStatus(order, ["ready_for_delivery"], "This order isn't ready for collection");
    await markPaidOnHandover(client, order, "counter");
    await client.query("UPDATE orders SET fulfillment_status = 'delivered' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "delivered", "Collected at the counter");
    return { result: { fulfillmentStatus: "delivered" }, email: "delivered" };
  }));

/** Sends a delivery that hit a problem back out (the customer answered, the address was found). */
manager.patch("/orders/:orderId/retry", ...managerAccess, (request, response, next) =>
  changeOrder(request, response, next, async (client, order, actorId) => {
    requireStatus(order, ["delivery_exception"], "Only deliveries with a problem can be retried");
    await client.query("UPDATE orders SET fulfillment_status = 'out_for_delivery' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "out_for_delivery", "Delivery retried");
    return { result: { fulfillmentStatus: "out_for_delivery" } };
  }));

manager.patch("/orders/:orderId/cancel", ...managerAccess, (request, response, next) => {
  const reason = readReason(request);
  if (!reason) {
    response.status(400).json({ error: `Give a reason of up to ${maxReasonLength} characters` });
    return;
  }
  return changeOrder(request, response, next, async (client, order, actorId) => {
    if (terminalStatuses.has(order.fulfillment_status)) throw new Conflict(409, "This order is already finished", { currentStatus: order.fulfillment_status });
    const paymentStatus = order.payment_status === "paid" ? "refund_pending" : order.payment_status;
    await client.query("UPDATE orders SET fulfillment_status = 'cancelled', payment_status = ? WHERE id = ?", [paymentStatus, order.id]);
    await client.query("UPDATE rider_assignments SET ended_at = NOW(3) WHERE order_id = ? AND ended_at IS NULL", [order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "cancelled", reason);
    return { result: { fulfillmentStatus: "cancelled", paymentStatus }, email: "cancelled" };
  });
});

/** Pay-on-delivery and pay-at-counter orders become paid when the food is handed over. */
export async function markPaidOnHandover(client: Queryable, order: Pick<LockedOrder, "id" | "payment_method" | "payment_status" | "total_minor" | "currency">, provider: "cash" | "pos" | "counter"): Promise<void> {
  if (order.payment_method !== "on_delivery" || order.payment_status !== "pending") return;
  await client.query("UPDATE orders SET payment_status = 'paid' WHERE id = ?", [order.id]);
  await client.query(
    "INSERT INTO payment_records (order_id, provider, amount_minor, currency, status) VALUES (?, ?, ?, ?, 'paid')",
    [order.id, provider, order.total_minor, order.currency],
  );
}

export default manager;
