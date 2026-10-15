import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import { auth } from "./better-auth.js";
import { database } from "./database.js";

export const roles = ["customer", "kitchen", "manager", "rider", "hr", "owner"] as const;
export type Role = (typeof roles)[number];

export interface AuthPrincipal {
  authUserId: string;
  profileId: string;
  email: string | null;
  displayName: string;
  roles: Role[];
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
    }
  }
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session?.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!session.user.emailVerified) {
      response.status(401).json({ error: "Confirm your email address before continuing" });
      return;
    }

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [session.user.email.toLowerCase()]);
      const profile = await client.query<{
        profile_id: string;
        display_name: string;
        email: string | null;
        roles: Role[];
      }>(
        `WITH selected AS (
           SELECT id FROM public.users
           WHERE better_auth_user_id = $1
              OR (better_auth_user_id IS NULL AND lower(email) = lower($2))
           ORDER BY (better_auth_user_id = $1) DESC NULLS LAST
           LIMIT 1
         ), linked AS (
           UPDATE public.users AS u
           SET better_auth_user_id = $1, email = $2, display_name = $3
           FROM selected
           WHERE u.id = selected.id
             AND (u.better_auth_user_id IS NULL OR u.better_auth_user_id = $1)
           RETURNING u.id, u.display_name, u.email
         ), created AS (
           INSERT INTO public.users (better_auth_user_id, email, display_name)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (SELECT 1 FROM linked)
             AND NOT EXISTS (SELECT 1 FROM public.users WHERE better_auth_user_id = $1)
           RETURNING id, display_name, email
         ), profile AS (
           SELECT * FROM linked UNION ALL SELECT * FROM created
         ), customer_role AS (
           INSERT INTO public.user_roles (user_id, role_id)
           SELECT profile.id, role.id FROM profile JOIN public.roles role ON role.name = 'customer'
           ON CONFLICT DO NOTHING
           RETURNING user_id, role_id
         ), profile_roles AS (
           -- Rows inserted by customer_role are invisible to user_roles reads in this
           -- same statement, so a first request must take the new grant from RETURNING.
           SELECT ur.user_id, ur.role_id FROM public.user_roles ur JOIN profile ON ur.user_id = profile.id
           UNION
           SELECT user_id, role_id FROM customer_role
         )
         SELECT profile.id AS profile_id, profile.display_name, profile.email,
                COALESCE(array_agg(DISTINCT role.name) FILTER (WHERE role.name IS NOT NULL), ARRAY[]::TEXT[]) AS roles
         FROM profile
         LEFT JOIN profile_roles pr ON pr.user_id = profile.id
         LEFT JOIN public.roles role ON role.id = pr.role_id
         GROUP BY profile.id, profile.display_name, profile.email`,
        [session.user.id, session.user.email, session.user.name || session.user.email],
      );
      await client.query("COMMIT");
      const row = profile.rows[0];
      if (!row) {
        response.status(409).json({ error: "This email is already linked to another account" });
        return;
      }
      request.principal = {
        authUserId: session.user.id,
        profileId: row.profile_id,
        email: row.email,
        displayName: row.display_name,
        roles: row.roles,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function requireAnyRole(...allowedRoles: Role[]): RequestHandler {
  return (request, response, next) => {
    if (!request.principal) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!allowedRoles.some((role) => request.principal?.roles.includes(role))) {
      response.status(403).json({ error: "Insufficient permission" });
      return;
    }
    next();
  };
}

export async function canAccessOrder(principal: AuthPrincipal, orderId: string): Promise<boolean> {
  if (principal.roles.some((role) => role === "manager" || role === "owner")) return true;
  if (principal.roles.includes("customer")) {
    const result = await database.query("SELECT 1 FROM public.orders WHERE id = $1 AND customer_id = $2", [orderId, principal.profileId]);
    if (result.rowCount) return true;
  }
  if (principal.roles.includes("rider")) {
    const result = await database.query(`SELECT 1 FROM public.rider_assignments WHERE order_id = $1 AND rider_id = $2 AND ended_at IS NULL`, [orderId, principal.profileId]);
    if (result.rowCount) return true;
  }
  return false;
}

export async function loadKitchenOrderSummary(principal: AuthPrincipal, orderId: string): Promise<Record<string, unknown> | null> {
  if (!principal.roles.includes("kitchen")) return null;
  const result = await database.query(
    `SELECT o.id, o.order_number, o.fulfillment_status, o.created_at,
            COALESCE(jsonb_agg(jsonb_build_object('item', oi.item_snapshot, 'quantity', oi.quantity,
              'unit_price_minor', oi.unit_price_minor, 'line_total_minor', oi.line_total_minor) ORDER BY oi.id)
              FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
     FROM public.orders o LEFT JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.id = $1 AND o.fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery')
     GROUP BY o.id`, [orderId]);
  return result.rows[0] ?? null;
}
