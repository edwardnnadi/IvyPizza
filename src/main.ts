import { ivyAuth, type IvyAuth, type IvySession } from "./auth.js";
import { apiUrl } from "./api.js";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root was not found.");

const clientAuth = ivyAuth;

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

const managerMarkup = `
  <div class="kitchen-app">
    <header class="kitchen-topbar">
      <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
      <div class="kitchen-top-actions">
        <span class="kitchen-staff-name" id="manager-staff-name"></span>
        <button class="kitchen-top-button" id="manager-refresh" type="button" hidden>Refresh orders</button>
        <button class="kitchen-top-button" id="manager-sign-out" type="button" hidden>Sign out</button>
      </div>
    </header>
    <main class="kitchen-shell">
      <section class="kitchen-login" id="manager-login">
        <div class="eyebrow dark">Staff access</div>
        <h1>Manager screen</h1>
        <p>Sign in with a manager or owner account to accept new orders and confirm bank transfers.</p>
        <form id="manager-login-form">
          <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
          <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
          <button class="btn account-submit" id="manager-login-submit" type="submit">Sign in</button>
        </form>
        <p class="kitchen-message" id="manager-login-message" role="status" aria-live="polite"></p>
        <p class="auth-config-note" id="manager-config-note" hidden>Staff sign-in is not configured. Please contact the site administrator.</p>
      </section>
      <section class="kitchen-denied" id="manager-denied" hidden>
        <div class="eyebrow dark">Staff access</div>
        <h1>Manager access required</h1>
        <p>This account does not have a manager or owner role. Ask HR or an owner to grant the correct staff role.</p>
        <button class="btn" id="manager-denied-sign-out" type="button">Sign out</button>
      </section>
      <section class="kitchen-board" id="manager-board" hidden>
        <div class="kitchen-board-heading">
          <div><div class="eyebrow dark">The Ivy Pizza</div><h1>New orders</h1><p>Accept or reject each order, and confirm bank transfers when the money arrives. The list refreshes automatically.</p></div>
          <div class="kitchen-live"><span></span> Live orders</div>
        </div>
        <p class="kitchen-message" id="manager-message" role="status" aria-live="polite"></p>
        <h2 class="manager-section-title">Waiting for a decision <span id="manager-waiting-count"></span></h2>
        <div class="kitchen-order-grid" id="manager-waiting" aria-live="polite"></div>
        <h2 class="manager-section-title">In progress and delivered today <span id="manager-accepted-count"></span></h2>
        <div class="kitchen-order-grid" id="manager-accepted"></div>
      </section>
    </main>
  </div>
`;

const staffPath = window.location.pathname.replace(/\/+$/, "");
const isHrScreen = window.location.pathname.replace(/\/+$/, "") === "/hr";
const isManagerScreen = window.location.pathname.replace(/\/+$/, "") === "/manager";

if (staffPath === "/kitchen") {
  void import("./staff/kitchen.js").then(({ startKitchenScreen }) => startKitchenScreen(app));
} else if (staffPath === "/rider") {
  void import("./staff/rider.js").then(({ startRiderScreen }) => startRiderScreen(app));
} else if (staffPath === "/owner") {
  void import("./staff/owner.js").then(({ startOwnerScreen }) => startOwnerScreen(app));
} else if (isHrScreen) {
  app.innerHTML = hrMarkup;
  initializeHrScreen(clientAuth);
} else if (isManagerScreen) {
  app.innerHTML = managerMarkup;
  initializeManagerScreen(clientAuth);
} else {
  // The storefront loads as its own chunk so staff screens never download it.
  void import("./shop/app.js").then(({ startStorefront }) => startStorefront(app));
}

interface KitchenProfile {
  displayName: string;
  roles: string[];
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

interface ManagerOrder {
  id: string;
  orderNumber: string;
  fulfillmentStatus: string;
  mode: "delivery" | "pickup";
  createdAt: string;
  scheduledFor: string | null;
  acceptedAt: string | null;
  paymentMethod: "on_delivery" | "transfer" | "card";
  paymentStatus: string;
  transferReportedAt: string | null;
  paymentDueAt: string | null;
  currency: string;
  totalMinor: number;
  area: string | null;
  store: string | null;
  recipient: { name: string | null; phone: string | null };
  address: string | null;
  landmark: string | null;
  deliveryInstructions: string | null;
  items: Array<{ name: string; summary: string; instructions: string | null; quantity: number }>;
  rider: { id: string; name: string | null } | null;
  statusReason: string | null;
}

function initializeManagerScreen(client: IvyAuth | null): void {
  const loginPanel = document.querySelector<HTMLElement>("#manager-login")!;
  const loginForm = document.querySelector<HTMLFormElement>("#manager-login-form")!;
  const loginMessage = document.querySelector<HTMLParagraphElement>("#manager-login-message")!;
  const configNote = document.querySelector<HTMLParagraphElement>("#manager-config-note")!;
  const deniedPanel = document.querySelector<HTMLElement>("#manager-denied")!;
  const board = document.querySelector<HTMLElement>("#manager-board")!;
  const message = document.querySelector<HTMLParagraphElement>("#manager-message")!;
  const waitingGrid = document.querySelector<HTMLDivElement>("#manager-waiting")!;
  const acceptedGrid = document.querySelector<HTMLDivElement>("#manager-accepted")!;
  const waitingCount = document.querySelector<HTMLSpanElement>("#manager-waiting-count")!;
  const acceptedCount = document.querySelector<HTMLSpanElement>("#manager-accepted-count")!;
  const refreshButton = document.querySelector<HTMLButtonElement>("#manager-refresh")!;
  const signOutButton = document.querySelector<HTMLButtonElement>("#manager-sign-out")!;
  const staffName = document.querySelector<HTMLSpanElement>("#manager-staff-name")!;
  let currentSession: IvySession | null = null;
  let refreshTimer: number | undefined;
  let loadGeneration = 0;
  let riders: Array<{ id: string; name: string; activeDeliveries: number }> = [];
  // While a decision is saving, polls skip re-rendering so the card is not swapped out mid-click.
  let busy = false;
  // A decision's confirmation stays on screen for one poll interval before "Updated …" replaces it.
  let noticeUntil = 0;

  const clock = (value: string) => new Date(value).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);

  function showLogin(text = ""): void {
    loadGeneration += 1;
    currentSession = null;
    loginPanel.hidden = false;
    deniedPanel.hidden = true;
    board.hidden = true;
    refreshButton.hidden = true;
    signOutButton.hidden = true;
    staffName.textContent = "";
    loginMessage.textContent = text;
  }

  function stopPolling(): void {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(label: string, className: string, onClick: (target: HTMLButtonElement) => void): HTMLButtonElement {
    const target = element("button", className, label);
    target.type = "button";
    target.addEventListener("click", () => onClick(target));
    return target;
  }

  function paymentLine(order: ManagerOrder): HTMLElement {
    const row = element("div", "manager-payment");
    const method = order.paymentMethod === "transfer" ? "Bank transfer" : order.paymentMethod === "card" ? "Card" : "Pay on delivery";
    row.append(element("strong", "", `${method} · ${money(order.totalMinor, order.currency)}`));
    if (order.paymentMethod === "transfer") {
      if (order.paymentStatus === "paid") row.append(element("span", "manager-badge is-paid", "Transfer received"));
      else if (order.transferReportedAt) row.append(element("span", "manager-badge is-reported", "Customer says paid"));
      else if (order.paymentDueAt) row.append(element("span", "manager-badge is-waiting", `Not paid yet · cancels at ${clock(order.paymentDueAt)}`));
    }
    return row;
  }

  function orderCard(order: ManagerOrder): HTMLElement {
    const card = element("article", "kitchen-order-card manager-order-card");
    const top = element("div", "kitchen-order-top");
    top.append(
      element("h2", "", order.orderNumber),
      element("span", `kitchen-status status-${order.fulfillmentStatus}`, order.fulfillmentStatus.replaceAll("_", " ")),
    );

    const where = order.mode === "pickup" ? `Pickup${order.store ? ` at ${order.store}` : ""}` : `Delivery${order.area ? ` to ${order.area}` : ""}`;
    const when = order.scheduledFor ? `For ${clock(order.scheduledFor)}` : "ASAP";
    const placed = order.acceptedAt && order.fulfillmentStatus !== "awaiting_acceptance"
      ? `Placed ${clock(order.createdAt)} · Accepted ${clock(order.acceptedAt)}`
      : `Placed ${clock(order.createdAt)}`;
    const time = element("p", `kitchen-order-time${order.scheduledFor ? " is-scheduled" : ""}`, `${where} · ${when} · ${placed}`);

    const customer = element("div", "manager-customer");
    customer.append(element("strong", "", order.recipient.name ?? "Customer"));
    if (order.recipient.phone) {
      const phone = element("a", "", order.recipient.phone);
      phone.href = `tel:${order.recipient.phone.replace(/[^\d+]/g, "")}`;
      customer.append(phone);
    }
    if (order.address) customer.append(element("span", "", [order.address, order.landmark].filter(Boolean).join(" · ")));
    if (order.deliveryInstructions) customer.append(element("span", "", `Rider note: ${order.deliveryInstructions}`));

    const list = element("ul", "kitchen-items");
    for (const item of order.items) {
      const body = element("div");
      body.append(element("strong", "", item.name));
      if (item.summary) body.append(element("span", "manager-item-summary", item.summary));
      if (item.instructions) body.append(element("p", "kitchen-note", `Note: ${item.instructions}`));
      const row = element("li");
      row.append(element("span", "kitchen-item-quantity", `${item.quantity}×`), body);
      list.append(row);
    }
    card.append(top, time, customer, paymentLine(order), list);

    if (order.fulfillmentStatus === "awaiting_acceptance") {
      const awaitingTransfer = order.paymentMethod === "transfer" && order.paymentStatus !== "paid";
      const actions = element("div", "manager-actions");
      if (awaitingTransfer) actions.append(button("Mark transfer received", "btn manager-primary", (target) => void decide(order, target, "payment")));
      const accept = button("Accept", "btn manager-primary", (target) => void decide(order, target, "accept"));
      accept.disabled = awaitingTransfer;
      actions.append(accept, button("Reject", "manager-reject", (target) => void decide(order, target, "reject")));
      card.append(actions);
      if (awaitingTransfer) card.append(element("p", "manager-hint", "Check the account for this amount and mark it received before accepting."));
    } else {
      card.append(dispatchControls(order));
    }
    return card;
  }

  /** Rider assignment, counter collection, retries and cancelling for orders already accepted. */
  function dispatchControls(order: ManagerOrder): HTMLElement {
    const box = element("div", "manager-dispatch");
    const status = order.fulfillmentStatus;
    if (status === "delivered") {
      box.append(element("p", "manager-hint", order.mode === "pickup" ? "Collected." : `Delivered${order.rider?.name ? ` by ${order.rider.name}` : ""}.`));
      return box;
    }
    if (status === "delivery_exception") {
      box.append(element("p", "manager-problem", `Delivery problem: ${order.statusReason ?? "reported by the rider"}`));
      box.append(button("Retry delivery", "btn manager-primary", (target) => void dispatch(order, target, "retry", "PATCH", {})));
    }
    if (order.mode === "delivery") {
      const row = element("div", "manager-rider-row");
      row.append(element("span", "", order.rider?.name ? `Rider: ${order.rider.name}` : "No rider yet"));
      const select = element("select", "manager-rider-select");
      select.setAttribute("aria-label", `Rider for ${order.orderNumber}`);
      select.append(new Option(riders.length ? "Choose a rider" : "No riders on staff", ""));
      for (const rider of riders) select.append(new Option(`${rider.name}${rider.activeDeliveries ? ` (${rider.activeDeliveries} active)` : ""}`, rider.id, false, rider.id === order.rider?.id));
      const assign = button(order.rider ? "Reassign" : "Assign", "manager-reject", (target) => {
        if (!select.value) return;
        void dispatch(order, target, "assign", "POST", { riderId: select.value });
      });
      row.append(select, assign);
      box.append(row);
    }
    if (status === "ready_for_delivery" && order.mode === "pickup") {
      box.append(button("Mark collected", "btn manager-primary", (target) => void dispatch(order, target, "collected", "PATCH", {})));
    }
    box.append(button("Cancel order", "manager-reject", (target) => {
      const reason = window.prompt(`Why are you cancelling ${order.orderNumber}? The customer sees this reason.`)?.trim();
      if (reason) void dispatch(order, target, "cancel", "PATCH", { reason });
    }));
    return box;
  }

  async function dispatch(order: ManagerOrder, target: HTMLButtonElement, action: string, method: string, body: Record<string, unknown>): Promise<void> {
    busy = true;
    const label = target.textContent;
    target.disabled = true;
    target.textContent = "Saving…";
    try {
      const response = await fetchWithSession(`/api/manager/orders/${encodeURIComponent(order.id)}/${action}`, { method, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update this order.");
      message.textContent = action === "assign" ? `Rider assigned to ${order.orderNumber}.`
        : action === "collected" ? `${order.orderNumber} collected.`
        : action === "retry" ? `${order.orderNumber} is back out for delivery.`
        : `${order.orderNumber} cancelled.`;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not update this order.";
      target.disabled = false;
      target.textContent = label;
    } finally {
      busy = false;
      noticeUntil = Date.now() + 20_000;
    }
    await refreshOrders(true);
  }

  function fill(grid: HTMLElement, orders: ManagerOrder[], emptyTitle: string, emptyText: string): void {
    grid.replaceChildren();
    if (!orders.length) {
      const empty = element("div", "kitchen-empty");
      empty.append(element("div", "kitchen-empty-mark", "✓"), element("h2", "", emptyTitle), element("p", "", emptyText));
      grid.append(empty);
      return;
    }
    grid.append(...orders.map(orderCard));
  }

  function renderOrders(orders: ManagerOrder[]): void {
    const waiting = orders.filter((order) => order.fulfillmentStatus === "awaiting_acceptance");
    const accepted = orders.filter((order) => order.fulfillmentStatus !== "awaiting_acceptance")
      .sort((a, b) => (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""));
    waitingCount.textContent = waiting.length ? `(${waiting.length})` : "";
    acceptedCount.textContent = accepted.length ? `(${accepted.length})` : "";
    fill(waitingGrid, waiting, "Nothing waiting", "New orders appear here as customers place them.");
    fill(acceptedGrid, accepted, "None yet today", "Orders you accept today are listed here.");
  }

  async function fetchWithSession(url: string, init: RequestInit = {}): Promise<Response> {
    if (!currentSession) throw new Error("Your session has ended. Please sign in again.");
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    return fetch(apiUrl(url), { ...init, headers, credentials: "include" });
  }

  async function refreshOrders(quiet = false): Promise<void> {
    if (!currentSession || (quiet && busy)) return;
    if (!quiet) {
      refreshButton.disabled = true;
      message.textContent = "Refreshing orders…";
    }
    try {
      const [response, riderResponse] = await Promise.all([fetchWithSession("/api/manager/orders"), fetchWithSession("/api/manager/riders")]);
      if (riderResponse.ok) riders = ((await riderResponse.json()) as { riders: typeof riders }).riders;
      if (!response.ok) {
        if (response.status === 401) throw new Error("Your session expired. Sign in again to continue.");
        if (response.status === 403) throw new Error("This account no longer has manager access.");
        throw new Error("Could not load orders. Try refreshing.");
      }
      const result = (await response.json()) as { orders: ManagerOrder[] };
      if (quiet && busy) return;
      renderOrders(result.orders);
      if (!quiet || Date.now() > noticeUntil) message.textContent = `Updated ${clock(new Date().toISOString())}`;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not load orders.";
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function decide(order: ManagerOrder, target: HTMLButtonElement, action: "accept" | "reject" | "payment"): Promise<void> {
    let body: Record<string, unknown> = {};
    if (action === "reject") {
      const reason = window.prompt(`Why are you rejecting ${order.orderNumber}? The customer sees this reason.`)?.trim();
      if (!reason) return;
      body = { reason };
    } else if (action === "payment") {
      if (!window.confirm(`Has ${money(order.totalMinor, order.currency)} for ${order.orderNumber} arrived in the account?`)) return;
      body = { status: "paid" };
    }
    busy = true;
    const label = target.textContent;
    target.disabled = true;
    target.textContent = "Saving…";
    try {
      const response = await fetchWithSession(`/api/manager/orders/${encodeURIComponent(order.id)}/${action}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update this order.");
      message.textContent = action === "accept" ? `${order.orderNumber} accepted and sent to the kitchen.`
        : action === "reject" ? `${order.orderNumber} rejected.`
        : `Transfer for ${order.orderNumber} marked as received. You can accept it now.`;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not update this order.";
      target.disabled = false;
      target.textContent = label;
    } finally {
      busy = false;
      noticeUntil = Date.now() + 20_000;
    }
    await refreshOrders(true);
  }

  async function loadManagerScreen(session: IvySession): Promise<void> {
    const generation = ++loadGeneration;
    currentSession = session;
    loginMessage.textContent = "Checking manager access…";
    try {
      const response = await fetchWithSession("/api/me");
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Please sign in again." : "Could not verify this account. Please try again.");
      const profile = (await response.json()) as KitchenProfile;
      if (generation !== loadGeneration) return;
      const permitted = profile.roles.some((role) => ["manager", "owner"].includes(role));
      loginPanel.hidden = true;
      deniedPanel.hidden = permitted;
      board.hidden = !permitted;
      refreshButton.hidden = !permitted;
      signOutButton.hidden = false;
      staffName.textContent = profile.displayName;
      if (!permitted) return;
      await refreshOrders();
      stopPolling();
      refreshTimer = window.setInterval(() => void refreshOrders(true), 20_000);
    } catch (error) {
      if (generation !== loadGeneration) return;
      showLogin(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  if (!client) {
    configNote.hidden = false;
    loginForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((control) => {
      control.disabled = true;
    });
    return;
  }
  const authClient = client;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.querySelector<HTMLButtonElement>("#manager-login-submit")!;
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
      await loadManagerScreen(data.session);
    } catch (error) {
      loginMessage.textContent = error instanceof Error ? error.message : "Could not sign in.";
    } finally {
      submit.disabled = false;
    }
  });

  async function signOut(): Promise<void> {
    stopPolling();
    const { error } = await authClient.auth.signOut();
    if (error) {
      message.textContent = "Could not sign out. Please try again.";
      return;
    }
    waitingGrid.replaceChildren();
    acceptedGrid.replaceChildren();
    showLogin();
  }

  refreshButton.addEventListener("click", () => void refreshOrders());
  signOutButton.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#manager-denied-sign-out")!.addEventListener("click", () => void signOut());
  void authClient.auth.getSession().then(({ data, error }) => {
    if (error) showLogin("Could not restore your session. Please sign in again.");
    else if (data.session) void loadManagerScreen(data.session);
  });
  authClient.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      stopPolling();
      showLogin();
    } else {
      currentSession = session;
    }
  });
}
