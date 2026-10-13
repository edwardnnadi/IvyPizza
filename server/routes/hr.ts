import { Router } from "express";
import { database } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const hr = Router();
const hrAccess = [requireAuth, requireAnyRole("hr", "owner")];
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const assignableRoles = new Set(["kitchen", "manager", "rider", "hr"]);

hr.get("/staff", ...hrAccess, async (_request, response, next) => {
  try {
    const result = await database.query(
      `SELECT staff.user_id AS id,
              app_user.email,
              app_user.display_name AS "displayName",
              staff.employment_status AS "employmentStatus",
              staff.employee_number AS "employeeNumber",
              staff.employed_at AS "employedAt",
              COALESCE(
                array_agg(DISTINCT role.name) FILTER (WHERE role.name IS NOT NULL AND role.name <> 'customer'),
                ARRAY[]::TEXT[]
              ) AS roles
       FROM public.staff_employment AS staff
       JOIN public.users AS app_user ON app_user.id = staff.user_id
       LEFT JOIN public.user_roles AS user_role ON user_role.user_id = staff.user_id
       LEFT JOIN public.roles AS role ON role.id = user_role.role_id
       GROUP BY staff.user_id, app_user.email, app_user.display_name
       ORDER BY (staff.employment_status = 'employed') DESC, app_user.display_name ASC
       LIMIT 200`,
    );
    response.json({ staff: result.rows });
  } catch (error) {
    next(error);
  }
});

hr.post("/staff/assign", ...hrAccess, async (request, response, next) => {
  const body: unknown = request.body;
  const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  const role = typeof body === "object" && body !== null && "role" in body && typeof body.role === "string"
    ? body.role
    : "";
  const employeeNumber = typeof body === "object" && body !== null && "employeeNumber" in body && typeof body.employeeNumber === "string"
    ? body.employeeNumber.trim()
    : "";

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ error: "Enter a valid staff account email" });
    return;
  }
  if (!assignableRoles.has(role)) {
    response.status(400).json({ error: "Select kitchen, manager, rider, or HR" });
    return;
  }
  if (employeeNumber.length > 60) {
    response.status(400).json({ error: "Employee number must be 60 characters or fewer" });
    return;
  }
  if (role === "hr" && !request.principal?.roles.includes("owner")) {
    response.status(403).json({ error: "Only an owner can grant the HR role" });
    return;
  }

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const profileResult = await client.query<{ id: string }>(
      "SELECT id FROM public.users WHERE lower(email) = $1 FOR UPDATE",
      [email],
    );
    const profile = profileResult.rows[0];
    if (!profile) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "No Ivy account uses that email yet. Ask the staff member to create an account first." });
      return;
    }

    await client.query(
      `INSERT INTO public.staff_employment
         (user_id, employment_status, employee_number, employed_at, ended_at, created_by, updated_by)
       VALUES ($1, 'employed', NULLIF($2, ''), NOW(), NULL, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         employment_status = 'employed',
         employee_number = COALESCE(EXCLUDED.employee_number, public.staff_employment.employee_number),
         employed_at = CASE
           WHEN public.staff_employment.employment_status = 'inactive' THEN NOW()
           ELSE public.staff_employment.employed_at
         END,
         ended_at = NULL,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [profile.id, employeeNumber, request.principal!.profileId],
    );
    await client.query(
      `INSERT INTO public.user_roles (user_id, role_id, assigned_by)
       SELECT $1, role.id, $3 FROM public.roles AS role WHERE role.name = $2
       ON CONFLICT (user_id, role_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by, assigned_at = NOW()`,
      [profile.id, role, request.principal!.profileId],
    );
    await client.query("COMMIT");
    response.status(200).json({ message: "Employment confirmed and staff role assigned" });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original database error.
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "That employee number is already in use" });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

hr.patch("/staff/:userId/offboard", ...hrAccess, async (request, response, next) => {
  const { userId } = request.params;
  if (typeof userId !== "string" || !userIdPattern.test(userId)) {
    response.status(400).json({ error: "Invalid staff profile ID" });
    return;
  }

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const staffResult = await client.query<{ user_id: string }>(
      "SELECT user_id FROM public.staff_employment WHERE user_id = $1 FOR UPDATE",
      [userId],
    );
    if (!staffResult.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Staff record not found" });
      return;
    }
    const ownerResult = await client.query(
      `SELECT 1 FROM public.user_roles AS user_role
       JOIN public.roles AS role ON role.id = user_role.role_id
       WHERE user_role.user_id = $1 AND role.name = 'owner'`,
      [userId],
    );
    if (ownerResult.rowCount) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Owner access must be changed through the trusted owner process" });
      return;
    }

    await client.query(
      `UPDATE public.staff_employment
       SET employment_status = 'inactive', ended_at = NOW(), updated_by = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, request.principal!.profileId],
    );
    await client.query("COMMIT");
    response.json({ message: "Employment ended and staff roles removed" });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original database error.
    }
    next(error);
  } finally {
    client.release();
  }
});

export default hr;
