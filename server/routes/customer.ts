import { Router } from "express";
import { database } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const customer = Router();
const customerAccess = [requireAuth, requireAnyRole("customer")];

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
