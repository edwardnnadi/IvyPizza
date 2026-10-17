import { ivyAuth, type IvyAuth, type IvySession } from "./auth.js";
import { apiUrl } from "./api.js";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root was not found.");

const clientAuth = ivyAuth;

const kitchenMarkup = `
  <div class="kitchen-app">
    <header class="kitchen-topbar">
      <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
      <div class="kitchen-top-actions">
        <span class="kitchen-staff-name" id="kitchen-staff-name"></span>
        <button class="kitchen-top-button" id="kitchen-refresh" type="button" hidden>Refresh queue</button>
        <button class="kitchen-top-button" id="kitchen-sign-out" type="button" hidden>Sign out</button>
      </div>
    </header>
    <main class="kitchen-shell">
      <section class="kitchen-login" id="kitchen-login">
        <div class="eyebrow dark">Staff access</div>
        <h1>Kitchen screen</h1>
        <p>Sign in with your Ivy staff account to view active orders.</p>
        <form id="kitchen-login-form">
          <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
          <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
          <button class="btn account-submit" id="kitchen-login-submit" type="submit">Sign in</button>
        </form>
        <p class="kitchen-message" id="kitchen-login-message" role="status" aria-live="polite"></p>
        <p class="auth-config-note" id="kitchen-config-note" hidden>Staff sign-in is not configured. Please contact the site administrator.</p>
      </section>
      <section class="kitchen-denied" id="kitchen-denied" hidden>
        <div class="eyebrow dark">Staff access</div>
        <h1>Kitchen access required</h1>
        <p>This account does not have a kitchen, manager, or owner role. Ask an owner to grant the correct staff role.</p>
        <button class="btn" id="kitchen-denied-sign-out" type="button">Sign out</button>
      </section>
      <section class="kitchen-board" id="kitchen-board" hidden>
        <div class="kitchen-board-heading">
          <div><div class="eyebrow dark">The Ivy Pizza</div><h1>Kitchen queue</h1><p>Active orders, oldest first. The queue refreshes automatically.</p></div>
          <div class="kitchen-live"><span></span> Live queue</div>
        </div>
        <p class="kitchen-message" id="kitchen-queue-message" role="status" aria-live="polite"></p>
        <div class="kitchen-order-grid" id="kitchen-order-grid" aria-live="polite"></div>
      </section>
    </main>
  </div>
`;

const hrMarkup = `
  <div class="kitchen-app">
    <header class="kitchen-topbar">
      <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
      <div class="kitchen-top-actions">
        <span class="kitchen-staff-name" id="hr-staff-name"></span>
        <button class="kitchen-top-button" id="hr-refresh" type="button" hidden>Refresh staff</button>
        <button class="kitchen-top-button" id="hr-sign-out" type="button" hidden>Sign out</button>
      </div>
    </header>
    <main class="kitchen-shell hr-shell">
      <section class="kitchen-login" id="hr-login">
        <div class="eyebrow dark">Human resources</div>
        <h1>Staff access</h1>
        <p>Sign in with an HR or owner account to manage employed staff and their roles.</p>
        <form id="hr-login-form">
          <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
          <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
          <button class="btn account-submit" id="hr-login-submit" type="submit">Sign in</button>
        </form>
        <p class="kitchen-message" id="hr-login-message" role="status" aria-live="polite"></p>
        <p class="auth-config-note" id="hr-config-note" hidden>Staff sign-in is not configured. Please contact the site administrator.</p>
      </section>
      <section class="kitchen-denied" id="hr-denied" hidden>
        <div class="eyebrow dark">Human resources</div>
        <h1>HR access required</h1>
        <p>This account does not have an HR or owner role. Ask an owner to grant the correct access.</p>
        <button class="btn" id="hr-denied-sign-out" type="button">Sign out</button>
      </section>
      <section class="hr-board" id="hr-board" hidden>
        <div class="kitchen-board-heading">
          <div><div class="eyebrow dark">Human resources</div><h1>Staff access</h1><p>Confirm employment and assign the role needed for each staff member.</p></div>
        </div>
        <div class="hr-layout">
          <section class="hr-card">
            <h2>Confirm employment &amp; assign role</h2>
            <p>The staff member must first create an account using this email address.</p>
            <form id="hr-assign-form">
              <label class="form-field">Staff account email<input name="email" type="email" autocomplete="off" required maxlength="254" /></label>
              <label class="form-field">Employee number <span class="field-optional">Optional</span><input name="employeeNumber" type="text" maxlength="60" /></label>
              <label class="form-field">Role to assign<select name="role" required>
                <option value="kitchen">Kitchen</option>
                <option value="rider">Rider</option>
                <option value="manager">Manager</option>
                <option value="hr" id="hr-role-option" hidden>HR (owner only)</option>
              </select></label>
              <button class="btn account-submit" id="hr-assign-submit" type="submit">Confirm employment &amp; assign</button>
            </form>
            <p class="kitchen-message" id="hr-assign-message" role="status" aria-live="polite"></p>
            <p class="hr-policy">HR can grant kitchen, rider, and manager roles. Only an owner can grant the HR role. Owner access is managed through the trusted owner process.</p>
          </section>
          <section class="hr-card hr-directory-card">
            <div class="hr-directory-heading"><div><h2>Staff directory</h2><p>Only employment records are shown here.</p></div></div>
            <p class="kitchen-message" id="hr-directory-message" role="status" aria-live="polite"></p>
            <div class="hr-directory" id="hr-directory"></div>
          </section>
        </div>
      </section>
    </main>
  </div>
`;

const isKitchenScreen = window.location.pathname.replace(/\/+$/, "") === "/kitchen";
const isHrScreen = window.location.pathname.replace(/\/+$/, "") === "/hr";

if (isKitchenScreen) {
  app.innerHTML = kitchenMarkup;
  initializeKitchenScreen(clientAuth);
} else if (isHrScreen) {
  app.innerHTML = hrMarkup;
  initializeHrScreen(clientAuth);
} else {
  // The storefront loads as its own chunk so staff screens never download it.
  void import("./shop/app.js").then(({ startStorefront }) => startStorefront(app));
}

interface KitchenOrderItem {
  item: unknown;
  quantity: number;
}

interface KitchenOrder {
  id: string;
  order_number: string;
  fulfillment_status: "accepted" | "preparing" | "ready_for_delivery";
  created_at: string;
  items: KitchenOrderItem[];
}

interface KitchenProfile {
  displayName: string;
  roles: string[];
}

function initializeKitchenScreen(client: IvyAuth | null): void {
  const loginPanel = document.querySelector<HTMLElement>("#kitchen-login")!;
  const loginForm = document.querySelector<HTMLFormElement>("#kitchen-login-form")!;
  const loginMessage = document.querySelector<HTMLParagraphElement>("#kitchen-login-message")!;
  const configNote = document.querySelector<HTMLParagraphElement>("#kitchen-config-note")!;
  const deniedPanel = document.querySelector<HTMLElement>("#kitchen-denied")!;
  const board = document.querySelector<HTMLElement>("#kitchen-board")!;
  const queueMessage = document.querySelector<HTMLParagraphElement>("#kitchen-queue-message")!;
  const orderGrid = document.querySelector<HTMLDivElement>("#kitchen-order-grid")!;
  const refreshButton = document.querySelector<HTMLButtonElement>("#kitchen-refresh")!;
  const signOutButton = document.querySelector<HTMLButtonElement>("#kitchen-sign-out")!;
  const staffName = document.querySelector<HTMLSpanElement>("#kitchen-staff-name")!;
  let currentSession: IvySession | null = null;
  let refreshTimer: number | undefined;
  let loadGeneration = 0;

  function showLogin(message = ""): void {
    loadGeneration += 1;
    currentSession = null;
    loginPanel.hidden = false;
    deniedPanel.hidden = true;
    board.hidden = true;
    refreshButton.hidden = true;
    signOutButton.hidden = true;
    staffName.textContent = "";
    loginMessage.textContent = message;
  }

  function clearOrders(): void {
    orderGrid.replaceChildren();
  }

  function itemName(snapshot: unknown): string {
    if (typeof snapshot === "string") return snapshot;
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return "Menu item";
    const record = snapshot as Record<string, unknown>;
    for (const key of ["name", "item_name", "title"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
    return "Menu item";
  }

  function renderOrders(orders: KitchenOrder[]): void {
    orderGrid.replaceChildren();
    if (orders.length === 0) {
      const empty = document.createElement("div");
      empty.className = "kitchen-empty";
      empty.innerHTML = '<div class="kitchen-empty-mark">✓</div><h2>All caught up</h2><p>New accepted orders will appear here.</p>';
      orderGrid.append(empty);
      return;
    }

    for (const order of orders) {
      const card = document.createElement("article");
      card.className = "kitchen-order-card";
      const top = document.createElement("div");
      top.className = "kitchen-order-top";
      const number = document.createElement("h2");
      number.textContent = order.order_number;
      const status = document.createElement("span");
      status.className = `kitchen-status status-${order.fulfillment_status}`;
      status.textContent = order.fulfillment_status.replaceAll("_", " ");
      top.append(number, status);
      card.append(top);

      const time = document.createElement("p");
      time.className = "kitchen-order-time";
      const createdAt = new Date(order.created_at);
      time.textContent = Number.isNaN(createdAt.getTime())
        ? "Order time unavailable"
        : `Placed ${createdAt.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
      card.append(time);

      const itemList = document.createElement("ul");
      itemList.className = "kitchen-items";
      for (const item of order.items) {
        const row = document.createElement("li");
        const quantity = document.createElement("span");
        quantity.className = "kitchen-item-quantity";
        quantity.textContent = `${item.quantity}×`;
        const name = document.createElement("span");
        name.textContent = itemName(item.item);
        row.append(quantity, name);
        itemList.append(row);
      }
      card.append(itemList);

      if (order.fulfillment_status !== "ready_for_delivery") {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "btn kitchen-order-action";
        action.textContent = order.fulfillment_status === "accepted" ? "Start preparing" : "Mark ready";
        action.addEventListener("click", () => void advanceOrder(order, action));
        card.append(action);
      }
      orderGrid.append(card);
    }
  }

  async function fetchWithSession(url: string, init: RequestInit = {}): Promise<Response> {
    if (!currentSession) throw new Error("Your session has ended. Please sign in again.");
    const headers = new Headers(init.headers);

    if (init.body) headers.set("Content-Type", "application/json");
    return fetch(apiUrl(url), { ...init, headers, credentials: "include" });
  }

  async function refreshQueue(quiet = false): Promise<void> {
    if (!currentSession) return;
    if (!quiet) {
      refreshButton.disabled = true;
      queueMessage.textContent = "Refreshing orders…";
    }
    try {
      const response = await fetchWithSession("/api/kitchen/orders");
      if (!response.ok) {
        if (response.status === 401) throw new Error("Your session expired. Sign in again to continue.");
        throw new Error("Could not load orders. Try refreshing the queue.");
      }
      const result = (await response.json()) as { orders: KitchenOrder[] };
      renderOrders(result.orders);
      queueMessage.textContent = `Updated ${new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
    } catch (error) {
      queueMessage.textContent = error instanceof Error ? error.message : "Could not load orders.";
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function advanceOrder(order: KitchenOrder, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.textContent = "Saving…";
    const nextStatus = order.fulfillment_status === "accepted" ? "preparing" : "ready_for_delivery";
    try {
      const response = await fetchWithSession(`/api/kitchen/orders/${encodeURIComponent(order.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? "Could not update this order.");
      }
      queueMessage.textContent = `${order.order_number} moved to ${nextStatus.replaceAll("_", " ")}.`;
      await refreshQueue(true);
    } catch (error) {
      queueMessage.textContent = error instanceof Error ? error.message : "Could not update this order.";
      button.disabled = false;
      button.textContent = order.fulfillment_status === "accepted" ? "Start preparing" : "Mark ready";
    }
  }

  async function loadStaffScreen(session: IvySession): Promise<void> {
    const generation = ++loadGeneration;
    currentSession = session;
    loginMessage.textContent = "Checking staff access…";
    try {
      const response = await fetchWithSession("/api/me");
      if (!response.ok) {
        if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
        throw new Error("Could not verify this account. Please try again.");
      }
      const profile = (await response.json()) as KitchenProfile;
      if (generation !== loadGeneration) return;
      const permitted = profile.roles.some((role) => ["kitchen", "manager", "owner"].includes(role));
      if (!permitted) {
        loginPanel.hidden = true;
        deniedPanel.hidden = false;
        board.hidden = true;
        refreshButton.hidden = true;
        signOutButton.hidden = false;
        staffName.textContent = profile.displayName;
        return;
      }

      loginPanel.hidden = true;
      deniedPanel.hidden = true;
      board.hidden = false;
      refreshButton.hidden = false;
      signOutButton.hidden = false;
      staffName.textContent = profile.displayName;
      await refreshQueue();
      if (refreshTimer) window.clearInterval(refreshTimer);
      refreshTimer = window.setInterval(() => void refreshQueue(true), 15_000);
    } catch (error) {
      if (generation !== loadGeneration) return;
      showLogin(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  if (!client) {
    configNote.hidden = false;
    loginForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((element) => {
      element.disabled = true;
    });
    return;
  }
  const authClient = client;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector<HTMLButtonElement>("#kitchen-login-submit")!;
    submit.disabled = true;
    loginMessage.textContent = "Signing in…";
    const formData = new FormData(loginForm);
    try {
      const { data, error } = await authClient.auth.signInWithPassword({
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
      });
      if (error) throw error;
      if (!data.session) throw new Error("Your email address must be confirmed before you can sign in.");
      await loadStaffScreen(data.session);
    } catch (error) {
      loginMessage.textContent = error instanceof Error ? error.message : "Could not sign in.";
    } finally {
      submit.disabled = false;
    }
  });

  async function signOut(): Promise<void> {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = undefined;
    const { error } = await authClient.auth.signOut();
    if (error) {
      queueMessage.textContent = "Could not sign out. Please try again.";
      return;
    }
    clearOrders();
    showLogin();
  }

  refreshButton.addEventListener("click", () => void refreshQueue());
  signOutButton.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#kitchen-denied-sign-out")!.addEventListener("click", () => void signOut());

  void authClient.auth.getSession().then(({ data, error }) => {
    if (error) {
      showLogin("Could not restore your session. Please sign in again.");
    } else if (data.session) {
      void loadStaffScreen(data.session);
    }
  });

  authClient.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      if (refreshTimer) window.clearInterval(refreshTimer);
      refreshTimer = undefined;
      clearOrders();
      showLogin();
    } else {
      currentSession = session;
    }
  });
}

interface HrStaffRecord {
  id: string;
  email: string | null;
  displayName: string;
  employmentStatus: "employed" | "inactive";
  employeeNumber: string | null;
  employedAt: string;
  roles: string[];
}

function initializeHrScreen(client: IvyAuth | null): void {
  const loginPanel = document.querySelector<HTMLElement>("#hr-login")!;
  const loginForm = document.querySelector<HTMLFormElement>("#hr-login-form")!;
  const loginMessage = document.querySelector<HTMLParagraphElement>("#hr-login-message")!;
  const configNote = document.querySelector<HTMLParagraphElement>("#hr-config-note")!;
  const deniedPanel = document.querySelector<HTMLElement>("#hr-denied")!;
  const board = document.querySelector<HTMLElement>("#hr-board")!;
  const staffName = document.querySelector<HTMLSpanElement>("#hr-staff-name")!;
  const signOutButton = document.querySelector<HTMLButtonElement>("#hr-sign-out")!;
  const refreshButton = document.querySelector<HTMLButtonElement>("#hr-refresh")!;
  const assignForm = document.querySelector<HTMLFormElement>("#hr-assign-form")!;
  const assignMessage = document.querySelector<HTMLParagraphElement>("#hr-assign-message")!;
  const directoryMessage = document.querySelector<HTMLParagraphElement>("#hr-directory-message")!;
  const directory = document.querySelector<HTMLDivElement>("#hr-directory")!;
  const hrRoleOption = document.querySelector<HTMLOptionElement>("#hr-role-option")!;
  let currentSession: IvySession | null = null;
  let loadGeneration = 0;

  function showLogin(message = ""): void {
    loadGeneration += 1;
    currentSession = null;
    loginPanel.hidden = false;
    deniedPanel.hidden = true;
    board.hidden = true;
    signOutButton.hidden = true;
    refreshButton.hidden = true;
    staffName.textContent = "";
    loginMessage.textContent = message;
  }

  async function fetchWithSession(url: string, init: RequestInit = {}): Promise<Response> {
    if (!currentSession) throw new Error("Your session has ended. Please sign in again.");
    const headers = new Headers(init.headers);

    if (init.body) headers.set("Content-Type", "application/json");
    return fetch(apiUrl(url), { ...init, headers });
  }

  function renderDirectory(staff: HrStaffRecord[]): void {
    directory.replaceChildren();
    if (staff.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hr-empty";
      empty.textContent = "No staff records yet. Confirm employment and assign a role to add the first staff member.";
      directory.append(empty);
      return;
    }

    const table = document.createElement("table");
    table.className = "hr-table";
    const head = document.createElement("thead");
    head.innerHTML = "<tr><th>Staff member</th><th>Role</th><th>Employment</th><th></th></tr>";
    const body = document.createElement("tbody");
    for (const member of staff) {
      const row = document.createElement("tr");
      const person = document.createElement("td");
      const name = document.createElement("strong");
      name.textContent = member.displayName;
      const email = document.createElement("span");
      email.textContent = member.email ?? "No email on file";
      person.append(name, email);

      const roles = document.createElement("td");
      roles.textContent = member.roles.length ? member.roles.map((role) => role.replaceAll("_", " ")).join(", ") : "No role";

      const employment = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `employment-badge ${member.employmentStatus}`;
      badge.textContent = member.employmentStatus;
      employment.append(badge);

      const actions = document.createElement("td");
      if (member.employmentStatus === "employed") {
        const offboard = document.createElement("button");
        offboard.type = "button";
        offboard.className = "hr-offboard";
        offboard.textContent = "End employment";
        offboard.addEventListener("click", () => void offboardStaff(member, offboard));
        actions.append(offboard);
      }
      row.append(person, roles, employment, actions);
      body.append(row);
    }
    table.append(head, body);
    const scroll = document.createElement("div");
    scroll.className = "hr-table-scroll";
    scroll.append(table);
    directory.append(scroll);
  }

  async function loadDirectory(): Promise<void> {
    directoryMessage.textContent = "Loading staff records…";
    try {
      const response = await fetchWithSession("/api/hr/staff");
      const result = (await response.json().catch(() => ({}))) as { staff?: HrStaffRecord[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load staff records.");
      renderDirectory(result.staff ?? []);
      directoryMessage.textContent = `${result.staff?.length ?? 0} staff record${result.staff?.length === 1 ? "" : "s"}`;
    } catch (error) {
      directoryMessage.textContent = error instanceof Error ? error.message : "Could not load staff records.";
    }
  }

  async function offboardStaff(member: HrStaffRecord, button: HTMLButtonElement): Promise<void> {
    if (!window.confirm(`End employment for ${member.displayName}? Their kitchen, manager, rider, and HR roles will be removed.`)) return;
    button.disabled = true;
    button.textContent = "Updating…";
    try {
      const response = await fetchWithSession(`/api/hr/staff/${encodeURIComponent(member.id)}/offboard`, { method: "PATCH" });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update employment status.");
      directoryMessage.textContent = `${member.displayName} was offboarded and staff roles were removed.`;
      await loadDirectory();
    } catch (error) {
      directoryMessage.textContent = error instanceof Error ? error.message : "Could not update employment status.";
      button.disabled = false;
      button.textContent = "End employment";
    }
  }

  async function loadHrScreen(session: IvySession): Promise<void> {
    const generation = ++loadGeneration;
    currentSession = session;
    loginMessage.textContent = "Checking HR access…";
    try {
      const response = await fetchWithSession("/api/me");
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Please sign in again." : "Could not verify this account.");
      const profile = (await response.json()) as { displayName: string; roles: string[] };
      if (generation !== loadGeneration) return;
      const permitted = profile.roles.some((role) => ["hr", "owner"].includes(role));
      if (!permitted) {
        loginPanel.hidden = true;
        deniedPanel.hidden = false;
        board.hidden = true;
        signOutButton.hidden = false;
        staffName.textContent = profile.displayName;
        return;
      }
      loginPanel.hidden = true;
      deniedPanel.hidden = true;
      board.hidden = false;
      signOutButton.hidden = false;
      refreshButton.hidden = false;
      hrRoleOption.hidden = !profile.roles.includes("owner");
      staffName.textContent = profile.displayName;
      await loadDirectory();
    } catch (error) {
      if (generation !== loadGeneration) return;
      showLogin(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  if (!client) {
    configNote.hidden = false;
    loginForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((element) => {
      element.disabled = true;
    });
    return;
  }
  const authClient = client;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector<HTMLButtonElement>("#hr-login-submit")!;
    submit.disabled = true;
    loginMessage.textContent = "Signing in…";
    const formData = new FormData(loginForm);
    try {
      const { data, error } = await authClient.auth.signInWithPassword({
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
      });
      if (error) throw error;
      if (!data.session) throw new Error("Your email address must be confirmed before you can sign in.");
      await loadHrScreen(data.session);
    } catch (error) {
      loginMessage.textContent = error instanceof Error ? error.message : "Could not sign in.";
    } finally {
      submit.disabled = false;
    }
  });

  assignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector<HTMLButtonElement>("#hr-assign-submit")!;
    submit.disabled = true;
    assignMessage.textContent = "Confirming employment and assigning role…";
    const formData = new FormData(assignForm);
    try {
      const response = await fetchWithSession("/api/hr/staff/assign", {
        method: "POST",
        body: JSON.stringify({
          email: String(formData.get("email") ?? "").trim(),
          employeeNumber: String(formData.get("employeeNumber") ?? "").trim(),
          role: String(formData.get("role") ?? ""),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not assign that role.");
      assignForm.reset();
      assignMessage.textContent = result.message ?? "Staff role assigned.";
      await loadDirectory();
    } catch (error) {
      assignMessage.textContent = error instanceof Error ? error.message : "Could not assign that role.";
    } finally {
      submit.disabled = false;
    }
  });

  async function signOut(): Promise<void> {
    const { error } = await authClient.auth.signOut();
    if (error) {
      directoryMessage.textContent = "Could not sign out. Please try again.";
      return;
    }
    showLogin();
  }

  refreshButton.addEventListener("click", () => void loadDirectory());
  signOutButton.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#hr-denied-sign-out")!.addEventListener("click", () => void signOut());
  void authClient.auth.getSession().then(({ data, error }) => {
    if (error) showLogin("Could not restore your session. Please sign in again.");
    else if (data.session) void loadHrScreen(data.session);
  });
  authClient.auth.onAuthStateChange((_event, session) => {
    if (!session) showLogin();
    else currentSession = session;
  });
}
