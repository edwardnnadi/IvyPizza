// HR staffing and kitchen order handling, end to end, against the local stack (see support/local-stack.ts).
// Tests run in order and share state.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import { startLocalStack, type LocalStack } from "./support/local-stack.js";

type Json = Record<string, any>;

let stack: LocalStack;
let ownerCookie: string;
let staffCookie: string;
let customerCookie: string;
let staffProfileId: string;
let orderId: string;

async function call(path: string, options: { cookie?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(stack.apiUrl + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = await response.json().catch(() => null) as Json | null;
  return { status: response.status, json: json ?? {} };
}

async function sql(statement: string, params: unknown[] = []) {
  const connection = await mysql.createConnection(stack.databaseUrl);
  try {
    const [rows] = await connection.query(statement, params);
    return rows as mysql.RowDataPacket[];
  } finally {
    await connection.end();
  }
}

before(async () => {
  stack = await startLocalStack();
  const owner = await stack.createCustomer("owner.test@ivy.test", "Test Owner");
  const staff = await stack.createCustomer("staff.test@ivy.test", "Test Cook");
  const customer = await stack.createCustomer("diner.test@ivy.test", "Test Diner");
  ownerCookie = owner.cookie;
  staffCookie = staff.cookie;
  customerCookie = customer.cookie;
  // Owners are appointed outside the app.
  await sql(`INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'owner' WHERE u.better_auth_user_id = ?`, [owner.userId]);
  staffProfileId = (await sql("SELECT id FROM users WHERE better_auth_user_id = ?", [staff.userId]))[0]!.id;

  const menu = (await call("/api/menu")).json.items as Array<{ id: string; category: string }>;
  const burger = menu.find((item) => item.category === "Burgers")!;
  const order = await call("/api/orders", {
    cookie: customerCookie,
    method: "POST",
    body: {
      idempotencyKey: randomUUID(),
      delivery: { recipientName: "Test Diner", phone: "+234 801 000 0000", address: "1 Test Road, Lagos" },
      items: [{ menuItemId: burger.id, quantity: 2, optionIds: [] }],
    },
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  orderId = order.json.orderId;
});

after(async () => {
  await stack?.stop();
});

test("HR can employ a staff member and grant a kitchen role", async () => {
  assert.equal((await call("/api/kitchen/orders", { cookie: staffCookie })).status, 403);
  const assigned = await call("/api/hr/staff/assign", {
    cookie: ownerCookie,
    method: "POST",
    body: { email: "Staff.Test@ivy.test", role: "kitchen", employeeNumber: "IVY-001" },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));

  const list = await call("/api/hr/staff", { cookie: ownerCookie });
  assert.equal(list.status, 200);
  const member = list.json.staff.find((row: Json) => row.id === staffProfileId);
  assert.equal(member.employmentStatus, "employed");
  assert.equal(member.employeeNumber, "IVY-001");
  assert.deepEqual(member.roles, ["kitchen"]);
});

test("staff account emails come from the staff mailbox", async () => {
  const reset = await fetch(stack.apiUrl + "/api/auth/request-password-reset", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "staff.test@ivy.test", redirectTo: "http://127.0.0.1:5173/" }),
  });
  assert.equal(reset.status, 200);
  const { email } = await (await fetch(stack.apiUrl + "/__test/emails")).json() as { email: Json | null };
  assert.equal(email?.to, "staff.test@ivy.test");
  assert.equal(email?.mailbox, "staff");
  assert.equal(email?.from, "The Ivy Pizza <staff@theivypizza.com>");
});

test("employee numbers are unique", async () => {
  const response = await call("/api/hr/staff/assign", {
    cookie: ownerCookie,
    method: "POST",
    body: { email: "diner.test@ivy.test", role: "rider", employeeNumber: "IVY-001" },
  });
  assert.equal(response.status, 409);
  // The clash must not touch the existing staff member's record.
  const [employment] = await sql("SELECT employment_status, employee_number FROM staff_employment WHERE user_id = ?", [staffProfileId]);
  assert.equal(employment!.employee_number, "IVY-001");
  assert.equal((await sql("SELECT COUNT(*) AS n FROM staff_employment"))[0]!.n, 1);
});

test("kitchen staff see accepted orders and move them through preparation", async () => {
  await sql("UPDATE orders SET fulfillment_status = 'accepted' WHERE id = ?", [orderId]);
  const queue = await call("/api/kitchen/orders", { cookie: staffCookie });
  assert.equal(queue.status, 200);
  const order = queue.json.orders.find((row: Json) => row.id === orderId);
  assert.equal(order.fulfillment_status, "accepted");
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 2);
  assert.equal(typeof order.items[0].item, "object");
  assert.equal(order.items[0].item.category, "Burgers");

  const path = `/api/kitchen/orders/${orderId}/status`;
  assert.equal((await call(path, { cookie: staffCookie, method: "PATCH", body: { status: "ready_for_delivery" } })).status, 409);
  assert.equal((await call(path, { cookie: staffCookie, method: "PATCH", body: { status: "preparing" } })).status, 200);
  assert.equal((await call(path, { cookie: staffCookie, method: "PATCH", body: { status: "preparing" } })).status, 409);
  assert.equal((await call(path, { cookie: staffCookie, method: "PATCH", body: { status: "ready_for_delivery" } })).status, 200);
  assert.equal((await call(path, { cookie: customerCookie, method: "PATCH", body: { status: "preparing" } })).status, 403);

  const events = await sql("SELECT previous_status, new_status FROM order_status_events WHERE order_id = ? ORDER BY created_at", [orderId]);
  assert.deepEqual(events.map((event) => event.new_status), ["awaiting_acceptance", "preparing", "ready_for_delivery"]);
});

test("ending employment removes staff roles", async () => {
  const offboarded = await call(`/api/hr/staff/${staffProfileId}/offboard`, { cookie: ownerCookie, method: "PATCH" });
  assert.equal(offboarded.status, 200, JSON.stringify(offboarded.json));
  assert.equal((await call("/api/kitchen/orders", { cookie: staffCookie })).status, 403);

  const member = (await call("/api/hr/staff", { cookie: ownerCookie })).json.staff.find((row: Json) => row.id === staffProfileId);
  assert.equal(member.employmentStatus, "inactive");
  assert.deepEqual(member.roles, []);
});

test("re-employing a former staff member restarts their employment", async () => {
  const [before] = await sql("SELECT employed_at FROM staff_employment WHERE user_id = ?", [staffProfileId]);
  const assigned = await call("/api/hr/staff/assign", {
    cookie: ownerCookie,
    method: "POST",
    body: { email: "staff.test@ivy.test", role: "rider" },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  const [after] = await sql("SELECT employment_status, employee_number, employed_at, ended_at FROM staff_employment WHERE user_id = ?", [staffProfileId]);
  assert.equal(after!.employment_status, "employed");
  assert.equal(after!.employee_number, "IVY-001");
  assert.equal(after!.ended_at, null);
  assert.ok(after!.employed_at > before!.employed_at);
});

test("only an owner can grant the HR role", async () => {
  await sql(`INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'hr'`, [staffProfileId]);
  const response = await call("/api/hr/staff/assign", {
    cookie: staffCookie,
    method: "POST",
    body: { email: "diner.test@ivy.test", role: "hr" },
  });
  assert.equal(response.status, 403);
});
