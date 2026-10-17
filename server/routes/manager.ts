import { Router, type Request, type Response, type NextFunction } from "express";
import { database, parseJson, type Queryable } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";
import { expireUnpaidTransfers } from "../order-view.js";
import { businessClock, businessTimeToUtc } from "../ordering.js";

const manager = Router();
const managerAccess = [requireAuth, requireAnyRole("manager", "owner")];
const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxReasonLength = 500;

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
}

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

/** Orders waiting for a decision, plus the ones accepted since midnight business time. */
manager.get("/orders", ...managerAccess, async (_request, response, next) => {
  try {
    await expireUnpaidTransfers();
    const startOfToday = businessTimeToUtc(businessClock(new Date()).date, 0);
    const orders = await database.query<ManagerOrderRow>(
      `SELECT o.id, o.order_number, o.fulfillment_status, o.fulfilment_mode, o.created_at, o.scheduled_for,
              o.payment_method, o.payment_status, o.transfer_reported_at, o.payment_due_at, o.currency, o.total_minor,
              o.delivery_snapshot, s.name AS store_name, z.name AS zone_name, accepted.accepted_at
       FROM orders o
       LEFT JOIN stores s ON s.id = o.store_id
       LEFT JOIN delivery_zones z ON z.id = o.zone_id
       LEFT JOIN (
         SELECT order_id, MAX(created_at) AS accepted_at FROM order_status_events
         WHERE new_status = 'accepted' AND created_at >= ? GROUP BY order_id
       ) accepted ON accepted.order_id = o.id
       WHERE o.fulfillment_status = 'awaiting_acceptance' OR accepted.accepted_at IS NOT NULL
       ORDER BY o.fulfillment_status = 'awaiting_acceptance' DESC, o.created_at ASC`,
      [startOfToday],
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
          items: itemsByOrder.get(order.id) ?? [],
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

interface LockedOrder {
  id: string;
  fulfillment_status: string;
  payment_method: string;
  payment_status: string;
  currency: string;
  total_minor: number;
}

class Conflict extends Error {
  constructor(public status: number, message: string, public detail: Record<string, unknown> = {}) { super(message); }
}

/** Locks the order for the rest of the transaction, runs `change`, and commits. */
async function changeOrder(
  request: Request,
  response: Response,
  next: NextFunction,
  change: (client: Queryable, order: LockedOrder, actorId: string) => Promise<Record<string, unknown>>,
): Promise<void> {
  const { orderId } = request.params;
  if (typeof orderId !== "string" || !orderIdPattern.test(orderId)) {
    response.status(400).json({ error: "Invalid order ID" });
    return;
  }
  const client = await database.connect();
  try {
    await client.query("START TRANSACTION");
    const { rows: [order] } = await client.query<LockedOrder>(
      "SELECT id, fulfillment_status, payment_method, payment_status, currency, total_minor FROM orders WHERE id = ? FOR UPDATE",
      [orderId],
    );
    if (!order) throw new Conflict(404, "Order not found");
    const result = await change(client, order, request.principal!.profileId);
    await client.query("COMMIT");
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

function requireAwaiting(order: LockedOrder): void {
  if (order.fulfillment_status !== "awaiting_acceptance") {
    throw new Conflict(409, "This order is no longer waiting for a decision", { currentStatus: order.fulfillment_status });
  }
}

async function recordStatus(client: Queryable, orderId: string, actorId: string, previous: string, next: string, reason: string | null) {
  await client.query(
    `INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, actorId, previous, next, reason],
  );
}

manager.patch("/orders/:orderId/accept", ...managerAccess, (request, response, next) =>
  changeOrder(request, response, next, async (client, order, actorId) => {
    requireAwaiting(order);
    if (order.payment_method === "transfer" && order.payment_status !== "paid") {
      throw new Conflict(409, "Mark the bank transfer as received before accepting this order", { paymentStatus: order.payment_status });
    }
    await client.query("UPDATE orders SET fulfillment_status = 'accepted' WHERE id = ?", [order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "accepted", null);
    return { fulfillmentStatus: "accepted" };
  }));

manager.patch("/orders/:orderId/reject", ...managerAccess, (request, response, next) => {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > maxReasonLength) {
    response.status(400).json({ error: `Give a reason of up to ${maxReasonLength} characters` });
    return;
  }
  return changeOrder(request, response, next, async (client, order, actorId) => {
    requireAwaiting(order);
    // Money already received has to go back to the customer.
    const paymentStatus = order.payment_status === "paid" ? "refund_pending" : order.payment_status;
    await client.query("UPDATE orders SET fulfillment_status = 'rejected', payment_status = ? WHERE id = ?", [paymentStatus, order.id]);
    await recordStatus(client, order.id, actorId, order.fulfillment_status, "rejected", reason);
    return { fulfillmentStatus: "rejected", paymentStatus };
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
    if (order.payment_status !== "pending") {
      throw new Conflict(409, "This payment is no longer pending", { paymentStatus: order.payment_status });
    }
    requireAwaiting(order);
    await client.query("UPDATE orders SET payment_status = 'paid' WHERE id = ?", [order.id]);
    await client.query(
      "INSERT INTO payment_records (order_id, provider, amount_minor, currency, status) VALUES (?, 'bank_transfer', ?, ?, 'paid')",
      [order.id, order.total_minor, order.currency],
    );
    // The fulfilment status stays put; the event keeps who confirmed the money, and when.
    await recordStatus(client, order.id, actorId, order.fulfillment_status, order.fulfillment_status, "Bank transfer received");
    return { paymentStatus: "paid" };
  });
});

export default manager;
