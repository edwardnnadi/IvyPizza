import { createRemoteJWKSet, jwtVerify } from "jose";
import type { RequestHandler } from "express";
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

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const jwks = supabaseUrl
  ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`))
  : null;
const issuer = supabaseUrl ? `${supabaseUrl}/auth/v1` : null;

export const requireAuth: RequestHandler = async (request, response, next) => {
  if (!jwks || !issuer) {
    response.status(503).json({ error: "Authentication is not configured" });
    return;
  }

  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  let authUserId: string;
  let email: string | null;
  try {
    const { payload } = await jwtVerify(match[1], jwks, {
      issuer,
      audience: "authenticated",
    });
    if (typeof payload.sub !== "string") throw new Error("JWT subject is missing");
    authUserId = payload.sub;
    email = typeof payload.email === "string" ? payload.email : null;
  } catch {
    response.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  try {
    const result = await database.query<{
      profile_id: string;
      display_name: string;
      email: string | null;
      roles: Role[];
    }>(
      `SELECT app_user.id AS profile_id,
              app_user.display_name,
              app_user.email,
              COALESCE(array_agg(DISTINCT role.name) FILTER (WHERE role.name IS NOT NULL), ARRAY[]::TEXT[]) AS roles
       FROM public.users AS app_user
       LEFT JOIN public.user_roles AS user_role ON user_role.user_id = app_user.id
       LEFT JOIN public.roles AS role ON role.id = user_role.role_id
       WHERE app_user.auth_user_id = $1
       GROUP BY app_user.id`,
      [authUserId],
    );

    const profile = result.rows[0];
    if (!profile) {
      response.status(403).json({ error: "Account profile is not ready" });
      return;
    }

    request.principal = {
      authUserId,
      profileId: profile.profile_id,
      email: profile.email ?? email,
      displayName: profile.display_name,
      roles: profile.roles,
    };
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
    const result = await database.query(
      "SELECT 1 FROM public.orders WHERE id = $1 AND customer_id = $2",
      [orderId, principal.profileId],
    );
    if (result.rowCount) return true;
  }

  if (principal.roles.includes("rider")) {
    const result = await database.query(
      `SELECT 1 FROM public.rider_assignments
       WHERE order_id = $1 AND rider_id = $2 AND ended_at IS NULL`,
      [orderId, principal.profileId],
    );
    if (result.rowCount) return true;
  }

  // Kitchen screens use a separate projection that never returns address/contact fields.
  return false;
}

export async function loadKitchenOrderSummary(
  principal: AuthPrincipal,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  if (!principal.roles.includes("kitchen")) return null;

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
     WHERE o.id = $1
       AND o.fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery')
     GROUP BY o.id`,
    [orderId],
  );
  return result.rows[0] ?? null;
}
