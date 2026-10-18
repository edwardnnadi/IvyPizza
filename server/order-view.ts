import { createHash, timingSafeEqual } from "node:crypto";
import type { Queryable } from "./database.js";
import { database, parseJson } from "./database.js";
import { transferDetails, kitchenPhone } from "./settings.js";
import { queueOrderEmail } from "./order-emails.js";

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function guestTokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const given = Buffer.from(hashGuestToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** Digits only, without the +234 or leading 0, so "+234 803…" and "0803…" compare equal. */
export function nationalPhone(value: string): string {
  return value.replace(/\D/g, "").replace(/^234/, "").replace(/^0/, "");
}

/**
 * Cancels bank-transfer orders whose payment window passed without the customer reporting a transfer.
 * Runs lazily wherever orders are read, so no scheduler is needed.
 */
export async function expireUnpaidTransfers(): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("START TRANSACTION");
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM orders
       WHERE payment_method = 'transfer' AND payment_status = 'pending' AND transfer_reported_at IS NULL
         AND fulfillment_status = 'awaiting_acceptance' AND payment_due_at < NOW(3)
       FOR UPDATE SKIP LOCKED`,
    );
    for (const { id } of rows) {
      await client.query("UPDATE orders SET fulfillment_status = 'cancelled', payment_status = 'failed' WHERE id = ?", [id]);
      await client.query(
        `INSERT INTO order_status_events (order_id, actor_id, previous_status, new_status, reason)
         VALUES (?, NULL, 'awaiting_acceptance', 'cancelled', 'Bank transfer not received in time')`,
        [id],
      );
    }
    await client.query("COMMIT");
    for (const { id } of rows) queueOrderEmail(id, "cancelled");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string | null;
  fulfillment_status: string;
  payment_status: string;
  payment_method: string;
  fulfilment_mode: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  delivery_fee_minor: number;
  tax_minor: number;
  total_minor: number;
  voucher_code: string | null;
  delivery_snapshot: unknown;
  scheduled_for: Date | null;
  payment_due_at: Date | null;
  transfer_reported_at: Date | null;
  guest_token_hash: string | null;
  created_at: Date;
  store_id: string | null;
  zone_id: string | null;
}

export async function findOrderByNumber(client: Queryable, orderNumber: string): Promise<OrderRow | null> {
  const { rows: [order] } = await client.query<OrderRow>("SELECT * FROM orders WHERE order_number = ?", [orderNumber]);
  return order ?? null;
}

/** What the customer's tracker and confirmation show. Never includes staff names beyond the rider's first name. */
export async function trackingView(order: OrderRow): Promise<Record<string, unknown>> {
  const [items, events, store, zone, rider] = await Promise.all([
    database.query<{ item_snapshot: unknown; quantity: number; line_total_minor: number }>(
      "SELECT item_snapshot, quantity, line_total_minor FROM order_items WHERE order_id = ? ORDER BY id", [order.id]),
    database.query<{ new_status: string; created_at: Date; reason: string | null }>(
      "SELECT new_status, created_at, reason FROM order_status_events WHERE order_id = ? ORDER BY created_at", [order.id]),
    order.store_id
      ? database.query<{ name: string; address: string; ready_minutes_min: number; ready_minutes_max: number }>(
        "SELECT name, address, ready_minutes_min, ready_minutes_max FROM stores WHERE id = ?", [order.store_id])
      : Promise.resolve({ rows: [] }),
    order.zone_id
      ? database.query<{ name: string; eta_min: number | null; eta_max: number | null }>(
        "SELECT name, eta_min, eta_max FROM delivery_zones WHERE id = ?", [order.zone_id])
      : Promise.resolve({ rows: [] }),
    database.query<{ display_name: string }>(
      `SELECT u.display_name FROM rider_assignments ra JOIN users u ON u.id = ra.rider_id
       WHERE ra.order_id = ? AND ra.ended_at IS NULL`, [order.id]),
  ]);
  const snapshot = parseJson<Record<string, unknown>>(order.delivery_snapshot) ?? {};
  const latest = (status: string) => [...events.rows].reverse().find((event) => event.new_status === status);
  const transfer = transferDetails();
  const storeRow = store.rows[0];
  const zoneRow = zone.rows[0];
  const exit = events.rows.length ? events.rows[events.rows.length - 1] : undefined;
  return {
    orderNumber: order.order_number,
    mode: order.fulfilment_mode,
    fulfillmentStatus: order.fulfillment_status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    createdAt: new Date(order.created_at).toISOString(),
    scheduledFor: order.scheduled_for ? new Date(order.scheduled_for).toISOString() : null,
    statusChangedAt: exit ? new Date(exit.created_at).toISOString() : null,
    statusReason: exit && ["rejected", "cancelled", "delivery_exception"].includes(order.fulfillment_status) ? exit.reason : null,
    preparingSince: latest("preparing") ? new Date(latest("preparing")!.created_at).toISOString() : null,
    readyMinutes: storeRow ? { min: storeRow.ready_minutes_min, max: storeRow.ready_minutes_max } : null,
    eta: zoneRow?.eta_min && zoneRow.eta_max ? { min: zoneRow.eta_min, max: zoneRow.eta_max } : null,
    store: storeRow ? { name: storeRow.name, address: storeRow.address } : null,
    area: zoneRow?.name ?? null,
    recipientFirstName: String(snapshot.recipientName ?? "").split(/\s+/)[0] || null,
    destination: order.fulfilment_mode === "pickup" ? null : snapshot.address ?? null,
    items: items.rows.map((row) => {
      const item = parseJson<{ name?: string; summary?: string }>(row.item_snapshot);
      return { name: item.name ?? "Item", summary: item.summary ?? "", quantity: row.quantity, lineTotalMinor: row.line_total_minor };
    }),
    currency: order.currency,
    subtotalMinor: order.subtotal_minor,
    discountMinor: order.discount_minor,
    deliveryFeeMinor: order.delivery_fee_minor,
    taxMinor: order.tax_minor,
    totalMinor: order.total_minor,
    voucherCode: order.voucher_code,
    transfer: order.payment_method === "transfer" && order.payment_status === "pending" && transfer
      ? { ...transfer, dueAt: order.payment_due_at ? new Date(order.payment_due_at).toISOString() : null, reportedAt: order.transfer_reported_at ? new Date(order.transfer_reported_at).toISOString() : null }
      : null,
    rider: order.fulfillment_status === "out_for_delivery" && rider.rows[0] ? { firstName: rider.rows[0].display_name.split(/\s+/)[0] } : null,
    kitchenPhone: kitchenPhone(),
  };
}
