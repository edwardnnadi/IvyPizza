import { fromNodeHeaders } from "better-auth/node";
import type { RequestHandler } from "express";
import { auth } from "./better-auth.js";
import { acquireLock, database, isDuplicateKeyError, parseJson, releaseLock, type Queryable } from "./database.js";

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

// Finds the application profile for a Better Auth user, linking an existing profile with the same
// email or creating one, and makes sure it has the customer role. Returns null if the email
// already belongs to a profile linked to a different sign-in.
async function linkProfile(
  client: Queryable,
  user: { id: string; email: string; name: string },
): Promise<AuthPrincipal | null> {
  const displayName = user.name || user.email;
  const { rows: [existing] } = await client.query<{ id: string }>(
    `SELECT id FROM users
     WHERE better_auth_user_id = ? OR (better_auth_user_id IS NULL AND lower(email) = lower(?))
     ORDER BY better_auth_user_id = ? DESC
     LIMIT 1 FOR UPDATE`,
    [user.id, user.email, user.id],
  );
  let profileId: string;
  if (existing) {
    await client.query(
      "UPDATE users SET better_auth_user_id = ?, email = ?, display_name = ? WHERE id = ?",
      [user.id, user.email, displayName, existing.id],
    );
    profileId = existing.id;
  } else {
    const { rows: [created] } = await client.query<{ id: string }>(
      "INSERT INTO users (better_auth_user_id, email, display_name) VALUES (?, ?, ?) RETURNING id",
      [user.id, user.email, displayName],
    );
    profileId = created!.id;
  }
  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE name = 'customer'
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [profileId],
  );
  const { rows } = await client.query<{ display_name: string; email: string | null; role: Role | null }>(
    `SELECT u.display_name, u.email, r.name AS role
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = ?`,
    [profileId],
  );
  const profile = rows[0];
  if (!profile) return null;
  return {
    authUserId: user.id,
    profileId,
    email: profile.email,
    displayName: profile.display_name,
    roles: rows.flatMap((row) => (row.role ? [row.role] : [])),
  };
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
    let principal: AuthPrincipal | null = null;
    try {
      // Serialize first requests for the same email so one profile is created and linked.
      const lock = await acquireLock(client, `profile:${session.user.email.toLowerCase()}`);
      try {
        await client.query("START TRANSACTION");
        principal = await linkProfile(client, session.user);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if (!isDuplicateKeyError(error)) throw error;
      } finally {
        await releaseLock(client, lock);
      }
    } finally {
      client.release();
    }
    if (!principal) {
      response.status(409).json({ error: "This email is already linked to another account" });
      return;
    }
    request.principal = principal;
    next();
  } catch (error) {
    next(error);
  }
};

/** Loads the principal when a confirmed session is present, and carries on without one otherwise (guest checkout). */
export const optionalAuth: RequestHandler = async (request, response, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session?.user || !session.user.emailVerified) {
      next();
      return;
    }
    await requireAuth(request, response, next);
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
    const result = await database.query("SELECT 1 FROM orders WHERE id = ? AND customer_id = ?", [orderId, principal.profileId]);
    if (result.rowCount) return true;
  }
  if (principal.roles.includes("rider")) {
    const result = await database.query("SELECT 1 FROM rider_assignments WHERE order_id = ? AND rider_id = ? AND ended_at IS NULL", [orderId, principal.profileId]);
    if (result.rowCount) return true;
  }
  return false;
}

export async function loadKitchenOrderSummary(principal: AuthPrincipal, orderId: string): Promise<Record<string, unknown> | null> {
  if (!principal.roles.includes("kitchen")) return null;
  const { rows: [order] } = await database.query(
    `SELECT id, order_number, fulfillment_status, created_at FROM orders
     WHERE id = ? AND fulfillment_status IN ('accepted', 'preparing', 'ready_for_delivery')`, [orderId]);
  if (!order) return null;
  const { rows: items } = await database.query<{ item_snapshot: unknown; quantity: number; unit_price_minor: number; line_total_minor: number }>(
    `SELECT item_snapshot, quantity, unit_price_minor, line_total_minor FROM order_items
     WHERE order_id = ? ORDER BY id`, [orderId]);
  return {
    ...order,
    items: items.map((item) => ({
      item: parseJson(item.item_snapshot),
      quantity: item.quantity,
      unit_price_minor: item.unit_price_minor,
      line_total_minor: item.line_total_minor,
    })),
  };
}
