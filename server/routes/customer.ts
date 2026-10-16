import { Router } from "express";
import { database } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const customer = Router();
const customerAccess = [requireAuth, requireAnyRole("customer")];

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

customer.get("/addresses", ...customerAccess, async (request, response, next) => {
  try {
    const result = await database.query(
      `SELECT id, label, recipient_name AS recipientName, phone, address,
              landmark, instructions, created_at AS createdAt
       FROM customer_addresses
       WHERE customer_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [request.principal!.profileId],
    );
    response.set("Cache-Control", "no-store");
    response.json({ addresses: result.rows });
  } catch (error) {
    next(error);
  }
});

export default customer;
