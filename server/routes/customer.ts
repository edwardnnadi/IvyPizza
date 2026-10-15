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
        `SELECT COUNT(*)::INT AS "orderCount",
                COUNT(*) FILTER (WHERE fulfillment_status IN ('awaiting_acceptance', 'accepted', 'preparing', 'ready_for_delivery', 'out_for_delivery'))::INT AS "activeOrderCount"
         FROM public.orders WHERE customer_id = $1`, [customerId]),
      database.query(
        `SELECT o.id, o.order_number AS "orderNumber", o.fulfillment_status AS "fulfillmentStatus",
                o.payment_status AS "paymentStatus", o.currency, o.total_minor AS "totalMinor",
                o.created_at AS "createdAt",
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'name', oi.item_snapshot->>'name', 'quantity', oi.quantity
                ) ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::jsonb) AS items
         FROM public.orders o WHERE o.customer_id = $1
         ORDER BY o.created_at DESC LIMIT 12`, [customerId]),
      database.query(
        `SELECT mi.id, mi.name, mi.category, mi.description, mi.price_minor AS "priceMinor", mi.currency
         FROM public.menu_items mi
         LEFT JOIN LATERAL (
           SELECT SUM(oi.quantity)::INT AS quantity
           FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
           WHERE oi.item_snapshot->>'menuItemId' = mi.id::TEXT
         ) popularity ON TRUE
         WHERE mi.available = TRUE AND mi.price_minor IS NOT NULL
         ORDER BY COALESCE(popularity.quantity, 0) DESC, mi.name
         LIMIT 4`),
    ]);
    response.set("Cache-Control", "no-store");
    response.json({ ...summary.rows[0], orders: orders.rows, recommendations: recommendations.rows });
  } catch (error) {
    next(error);
  }
});

customer.get("/addresses", ...customerAccess, async (request, response, next) => {
  try {
    const result = await database.query(
      `SELECT id, label, recipient_name AS "recipientName", phone, address,
              landmark, instructions, created_at AS "createdAt"
       FROM public.customer_addresses
       WHERE customer_id = $1
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
