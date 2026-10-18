import { Router } from "express";
import { database, parseJson } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";
import { businessClock, businessTimeToUtc } from "../ordering.js";

const owner = Router();
const reportAccess = [requireAuth, requireAnyRole("manager", "owner")];

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;
const average = (values: number[]) => (values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null);

/** Sales and service report for today, the last 7 days or the last 30 days (business time). */
owner.get("/report", ...reportAccess, async (request, response, next) => {
  const days = [1, 7, 30].includes(Number(request.query.days)) ? Number(request.query.days) : 1;
  try {
    const today = businessClock(new Date()).date;
    const firstDay = addDays(today, -(days - 1));
    const from = businessTimeToUtc(firstDay, 0);
    const { rows: orders } = await database.query<{
      id: string; fulfillment_status: string; payment_status: string; fulfilment_mode: string; total_minor: number; discount_minor: number;
      created_at: Date; scheduled_for: Date | null; zone_name: string | null; eta_max: number | null;
    }>(
      `SELECT o.id, o.fulfillment_status, o.payment_status, o.fulfilment_mode, o.total_minor, o.discount_minor, o.created_at, o.scheduled_for,
              z.name AS zone_name, z.eta_max
       FROM orders o LEFT JOIN delivery_zones z ON z.id = o.zone_id WHERE o.created_at >= ?`,
      [from],
    );
    const ids = orders.map((order) => order.id);
    const [events, items, reviews] = ids.length
      ? await Promise.all([
        database.query<{ order_id: string; new_status: string; created_at: Date }>(
          "SELECT order_id, new_status, created_at FROM order_status_events WHERE order_id IN (?) ORDER BY created_at", [ids]),
        database.query<{ order_id: string; item_snapshot: unknown; quantity: number; line_total_minor: number }>(
          "SELECT order_id, item_snapshot, quantity, line_total_minor FROM order_items WHERE order_id IN (?)", [ids]),
        database.query<{ order_number: string; rating: number; body: string; created_at: Date }>(
          `SELECT o.order_number, r.rating, r.body, r.created_at FROM reviews r JOIN orders o ON o.id = r.order_id
           WHERE r.created_at >= ? ORDER BY r.created_at DESC`, [from]),
      ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }];

    const counted = orders.filter((order) => !["rejected", "cancelled"].includes(order.fulfillment_status));
    const countedIds = new Set(counted.map((order) => order.id));
    const revenueMinor = counted.reduce((total, order) => total + order.total_minor, 0);

    const byDay = new Map<string, { orders: number; revenueMinor: number }>();
    for (let offset = 0; offset < days; offset += 1) byDay.set(addDays(firstDay, offset), { orders: 0, revenueMinor: 0 });
    const byHour = Array.from({ length: 24 }, () => 0);
    for (const order of counted) {
      const clock = businessClock(new Date(order.created_at));
      const day = byDay.get(clock.date);
      if (day) {
        day.orders += 1;
        day.revenueMinor += order.total_minor;
      }
      byHour[Math.floor(clock.minutes / 60)]! += 1;
    }

    const itemTotals = new Map<string, { quantity: number; revenueMinor: number }>();
    for (const item of items.rows) {
      if (!countedIds.has(item.order_id)) continue;
      const name = parseJson<{ name?: string }>(item.item_snapshot)?.name ?? "Item";
      const entry = itemTotals.get(name) ?? { quantity: 0, revenueMinor: 0 };
      entry.quantity += item.quantity;
      entry.revenueMinor += item.line_total_minor;
      itemTotals.set(name, entry);
    }
    const areaTotals = new Map<string, { orders: number; revenueMinor: number }>();
    for (const order of counted) {
      const name = order.fulfilment_mode === "pickup" ? "Pickup" : order.zone_name ?? "Unknown area";
      const entry = areaTotals.get(name) ?? { orders: 0, revenueMinor: 0 };
      entry.orders += 1;
      entry.revenueMinor += order.total_minor;
      areaTotals.set(name, entry);
    }

    // Service times from the status history.
    const eventsByOrder = new Map<string, Map<string, Date>>();
    for (const event of events.rows) {
      const map = eventsByOrder.get(event.order_id) ?? new Map<string, Date>();
      if (!map.has(event.new_status)) map.set(event.new_status, new Date(event.created_at));
      eventsByOrder.set(event.order_id, map);
    }
    const prepTimes: number[] = [];
    const deliveryTimes: number[] = [];
    let late = 0;
    for (const order of counted) {
      const history = eventsByOrder.get(order.id);
      if (!history) continue;
      const accepted = history.get("accepted");
      const ready = history.get("ready_for_delivery");
      const out = history.get("out_for_delivery");
      const delivered = history.get("delivered");
      if (accepted && ready) prepTimes.push(minutesBetween(accepted, ready));
      if (out && delivered) deliveryTimes.push(minutesBetween(out, delivered));
      // Late: an ASAP delivery that arrived more than 10 minutes after the area's longest ETA.
      if (delivered && !order.scheduled_for && order.fulfilment_mode === "delivery" && order.eta_max
        && minutesBetween(new Date(order.created_at), delivered) > order.eta_max + 10) late += 1;
    }

    const refunds = orders.filter((order) => ["refund_pending", "partially_refunded", "refunded"].includes(order.payment_status));
    const ratings = reviews.rows.map((review) => review.rating);
    response.set("Cache-Control", "no-store");
    response.json({
      days,
      from: from.toISOString(),
      summary: {
        orders: counted.length,
        revenueMinor,
        averageOrderMinor: counted.length ? Math.round(revenueMinor / counted.length) : 0,
        discountsMinor: counted.reduce((total, order) => total + order.discount_minor, 0),
        delivery: counted.filter((order) => order.fulfilment_mode === "delivery").length,
        pickup: counted.filter((order) => order.fulfilment_mode === "pickup").length,
        inProgress: orders.filter((order) => ["awaiting_acceptance", "accepted", "preparing", "ready_for_delivery", "out_for_delivery", "delivery_exception"].includes(order.fulfillment_status)).length,
        rejected: orders.filter((order) => order.fulfillment_status === "rejected").length,
        cancelled: orders.filter((order) => order.fulfillment_status === "cancelled").length,
        averagePrepMinutes: average(prepTimes),
        averageDeliveryMinutes: average(deliveryTimes),
        lateOrders: late,
        refunds: refunds.length,
        refundsMinor: refunds.reduce((total, order) => total + order.total_minor, 0),
        averageRating: ratings.length ? Math.round((ratings.reduce((total, value) => total + value, 0) / ratings.length) * 10) / 10 : null,
        ratings: ratings.length,
      },
      byDay: [...byDay.entries()].map(([date, value]) => ({ date, ...value })),
      byHour: byHour.map((orders, hour) => ({ hour, orders })),
      topItems: [...itemTotals.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.revenueMinor - a.revenueMinor).slice(0, 8),
      topAreas: [...areaTotals.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.orders - a.orders).slice(0, 8),
      recentReviews: reviews.rows.slice(0, 6).map((review) => ({ orderNumber: review.order_number, rating: review.rating, body: review.body, createdAt: new Date(review.created_at).toISOString() })),
    });
  } catch (error) {
    next(error);
  }
});

export default owner;
