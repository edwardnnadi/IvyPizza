import { Router } from "express";
import { database, isDuplicateKeyError } from "../database.js";
import { requireAnyRole, requireAuth } from "../auth.js";

const hr = Router();
const hrAccess = [requireAuth, requireAnyRole("hr", "owner")];
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const assignableRoles = new Set(["kitchen", "manager", "rider", "hr"]);

hr.get("/staff", ...hrAccess, async (_request, response, next) => {
  try {
    const staff = await database.query<Record<string, unknown> & { roles: string | null }>(
      `SELECT staff.user_id AS id,
              app_user.email,
              app_user.display_name AS displayName,
              staff.employment_status AS employmentStatus,
              staff.employee_number AS employeeNumber,
              staff.employed_at AS employedAt,
              GROUP_CONCAT(DISTINCT CASE WHEN role.name <> 'customer' THEN role.name END ORDER BY role.name) AS roles
       FROM staff_employment AS staff
       JOIN users AS app_user ON app_user.id = staff.user_id
       LEFT JOIN user_roles AS user_role ON user_role.user_id = staff.user_id
       LEFT JOIN roles AS role ON role.id = user_role.role_id
       GROUP BY staff.user_id, app_user.email, app_user.display_name, staff.employment_status,
                staff.employee_number, staff.employed_at
       ORDER BY staff.employment_status = 'employed' DESC, app_user.display_name ASC
       LIMIT 200`,
    );
    const result = { rows: staff.rows.map((member) => ({ ...member, roles: member.roles ? member.roles.split(",") : [] })) };
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
    await client.query("START TRANSACTION");
    const profileResult = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = ? FOR UPDATE",
      [email],
    );
    const profile = profileResult.rows[0];
    if (!profile) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "No Ivy account uses that email yet. Ask the staff member to create an account first." });
      return;
    }

    // Not ON DUPLICATE KEY UPDATE: that would also fire on an employee number clash and
    // update the other staff member's record instead of refusing.
    const employment = await client.query(
      "SELECT 1 FROM staff_employment WHERE user_id = ? FOR UPDATE",
      [profile.id],
    );
    if (employment.rowCount) {
      // Assignments run left to right and see earlier ones, so employed_at is decided before the status changes.
      await client.query(
        `UPDATE staff_employment SET
           employed_at = IF(employment_status = 'inactive', NOW(3), employed_at),
           employee_number = COALESCE(NULLIF(?, ''), employee_number),
           employment_status = 'employed',
           ended_at = NULL,
           updated_by = ?,
           updated_at = NOW(3)
         WHERE user_id = ?`,
        [employeeNumber, request.principal!.profileId, profile.id],
      );
    } else {
      await client.query(
        `INSERT INTO staff_employment
           (user_id, employment_status, employee_number, employed_at, ended_at, created_by, updated_by)
         VALUES (?, 'employed', NULLIF(?, ''), NOW(3), NULL, ?, ?)`,
        [profile.id, employeeNumber, request.principal!.profileId, request.principal!.profileId],
      );
    }
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       SELECT ?, role.id, ? FROM roles AS role WHERE role.name = ?
       ON DUPLICATE KEY UPDATE assigned_by = VALUES(assigned_by), assigned_at = NOW(3)`,
      [profile.id, request.principal!.profileId, role],
    );
    await client.query("COMMIT");
    response.status(200).json({ message: "Employment confirmed and staff role assigned" });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original database error.
    }
    if (isDuplicateKeyError(error)) {
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
    await client.query("START TRANSACTION");
    const staffResult = await client.query<{ user_id: string }>(
      "SELECT user_id FROM staff_employment WHERE user_id = ? FOR UPDATE",
      [userId],
    );
    if (!staffResult.rowCount) {
      await client.query("ROLLBACK");
      response.status(404).json({ error: "Staff record not found" });
      return;
    }
    const ownerResult = await client.query(
      `SELECT 1 FROM user_roles AS user_role
       JOIN roles AS role ON role.id = user_role.role_id
       WHERE user_role.user_id = ? AND role.name = 'owner'`,
      [userId],
    );
    if (ownerResult.rowCount) {
      await client.query("ROLLBACK");
      response.status(409).json({ error: "Owner access must be changed through the trusted owner process" });
      return;
    }

    await client.query(
      `UPDATE staff_employment
       SET employment_status = 'inactive', ended_at = NOW(3), updated_by = ?, updated_at = NOW(3)
       WHERE user_id = ?`,
      [request.principal!.profileId, userId],
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
