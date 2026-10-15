import { ivyAuth, type IvyAuth, type IvySession } from "./auth.js";
import { apiUrl } from "./api.js";
import "./style.css";
import { initializePublicMenu } from "./menu.js";
import { publicMarkup } from "./site-markup.js";
import { initializeMotion } from "./motion.js";
import "./site.css";

interface AccountProfile {
  id: string;
  displayName: string;
  email: string | null;
  roles: string[];
}

interface CustomerDashboard {
  orderCount: number;
  activeOrderCount: number;
  orders: Array<{
    orderNumber: string;
    fulfillmentStatus: string;
    paymentStatus: string;
    totalMinor: number;
    currency: string;
    createdAt: string;
    items: Array<{ name: string; quantity: number }>;
  }>;
  recommendations: Array<{ id: string; name: string; category: string; priceMinor: number; currency: string }>;
}

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
app.innerHTML = isKitchenScreen ? kitchenMarkup : isHrScreen ? hrMarkup : publicMarkup;

if (isKitchenScreen) {
  initializeKitchenScreen(clientAuth);
} else if (isHrScreen) {
  initializeHrScreen(clientAuth);
} else {

initializeMotion();
initializePublicMenu(clientAuth, showAccount);

const dialog = document.querySelector<HTMLDialogElement>("#account-dialog")!;
const authForm = document.querySelector<HTMLFormElement>("#auth-form")!;
const authMessage = document.querySelector<HTMLParagraphElement>("#auth-message")!;
const accountTabs = document.querySelector<HTMLDivElement>("#account-tabs")!;
const nameField = document.querySelector<HTMLDivElement>("#name-field")!;
const accountIntro = document.querySelector<HTMLParagraphElement>("#account-intro")!;
const accountTrigger = document.querySelector<HTMLButtonElement>("#account-open")!;
const profileCard = document.querySelector<HTMLDivElement>("#profile-card")!;
const configNote = document.querySelector<HTMLParagraphElement>("#auth-config-note")!;
let authMode: "signin" | "signup" = "signin";
let profileLoadGeneration = 0;

function setMessage(message: string, kind: "info" | "ok" | "error" = "info"): void {
  authMessage.textContent = message;
  authMessage.dataset.kind = kind;
}

function setAuthMode(mode: "signin" | "signup"): void {
  authMode = mode;
  document.querySelectorAll<HTMLButtonElement>("#account-tabs [data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.setAttribute("aria-selected", String(active));
  });
  accountTabs.dataset.mode = mode;
  nameField.classList.toggle("is-open", mode === "signup");
  accountIntro.textContent = mode === "signup"
    ? "Create an Ivy account to save your details for faster ordering."
    : "Sign in to your Ivy account or create one to get started.";
  nameField.querySelector("input")?.toggleAttribute("required", mode === "signup");
  document.querySelector<HTMLButtonElement>("#forgot-password")!.hidden = mode === "signup";
  authForm.querySelector<HTMLInputElement>('[name="password"]')?.setAttribute(
    "autocomplete",
    mode === "signup" ? "new-password" : "current-password",
  );
  document.querySelector<HTMLButtonElement>("#auth-submit")!.textContent = mode === "signup" ? "Create account" : "Sign in";
  setMessage("");
}

function showAccount(): void {
  if (dialog.open) return;
  dialog.showModal();
  if (!authForm.hidden) authForm.querySelector<HTMLInputElement>('[name="email"]')?.focus();
}

let signedInName: string | null = null;
const narrowViewport = window.matchMedia("(max-width: 759px)");

function setTriggerLabel(name: string | null): void {
  signedInName = name;
  accountTrigger.textContent = name ? name.split(/\s+/)[0]! : narrowViewport.matches ? "Account" : "My account";
}
narrowViewport.addEventListener("change", () => setTriggerLabel(signedInName));
setTriggerLabel(null);

function showSignedOut(): void {
  profileLoadGeneration += 1;
  accountTabs.hidden = false;
  authForm.hidden = false;
  profileCard.hidden = true;
  setTriggerLabel(null);
  accountIntro.textContent = authMode === "signup"
    ? "Create an Ivy account to save your details for faster ordering."
    : "Sign in to your Ivy account or create one to get started.";
}

async function loadProfile(session: IvySession): Promise<AccountProfile> {
  const response = await fetch(apiUrl("/api/me"), {
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("Your account profile is still being prepared. Please try again shortly.");
    if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
    throw new Error("We could not load your account. Please try again.");
  }
  return response.json() as Promise<AccountProfile>;
}

async function showSignedIn(session: IvySession): Promise<void> {
  const generation = ++profileLoadGeneration;
  accountTabs.hidden = true;
  authForm.hidden = true;
  profileCard.hidden = false;
  accountIntro.textContent = "You are signed in to your Ivy account.";
  setMessage("Loading your account…");
  try {
    const profile = await loadProfile(session);
    if (generation !== profileLoadGeneration) return;
    document.querySelector<HTMLParagraphElement>("#profile-name")!.textContent = profile.displayName;
    document.querySelector<HTMLParagraphElement>("#profile-email")!.textContent = profile.email ?? "";
    document.querySelector<HTMLParagraphElement>("#profile-roles")!.textContent = profile.roles.join(" · ") || "Customer";
    document.querySelector<HTMLSpanElement>("#profile-initial")!.textContent = profile.displayName.charAt(0).toUpperCase();
    setTriggerLabel(profile.displayName);
    await loadCustomerDashboard();
    if (generation !== profileLoadGeneration) return;
    setMessage("You’re signed in.", "ok");
  } catch (error) {
    if (generation !== profileLoadGeneration) return;
    setMessage(error instanceof Error ? error.message : "We could not load your account.", "error");
  }
}

async function loadCustomerDashboard(): Promise<void> {
  const response = await fetch(apiUrl("/api/customer/dashboard"), { credentials: "include" });
  if (!response.ok) throw new Error("We could not load your order history. Please try again.");
  const dashboard = await response.json() as CustomerDashboard;
  document.querySelector<HTMLElement>("#dashboard-order-count")!.textContent = String(dashboard.orderCount);
  document.querySelector<HTMLElement>("#dashboard-active-count")!.textContent = String(dashboard.activeOrderCount);
  const orderList = document.querySelector<HTMLDivElement>("#dashboard-orders")!;
  orderList.replaceChildren();
  if (!dashboard.orders.length) {
    const empty = document.createElement("p");
    empty.textContent = "Your first order will appear here. Browse the menu to get started.";
    orderList.append(empty);
  }
  for (const order of dashboard.orders) {
    const card = document.createElement("article");
    card.className = "dashboard-order";
    const heading = document.createElement("div");
    heading.className = "dashboard-order-heading";
    const number = document.createElement("strong");
    number.textContent = order.orderNumber;
    const status = document.createElement("span");
    status.textContent = order.fulfillmentStatus.replaceAll("_", " ");
    heading.append(number, status);
    const details = document.createElement("p");
    details.textContent = `${order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")} · ${new Intl.NumberFormat("en-NG", { style: "currency", currency: order.currency, maximumFractionDigits: 0 }).format(order.totalMinor / 100)}`;
    const date = document.createElement("small");
    date.textContent = new Date(order.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
    card.append(heading, details, date);
    orderList.append(card);
  }

  const picks = document.querySelector<HTMLDivElement>("#dashboard-picks")!;
  picks.replaceChildren();
  for (const item of dashboard.recommendations) {
    const row = document.createElement("div");
    row.className = "dashboard-pick";
    const name = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.name;
    const price = document.createElement("small");
    price.textContent = new Intl.NumberFormat("en-NG", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.priceMinor / 100);
    name.append(title, price);
    const browse = document.createElement("button");
    browse.type = "button";
    browse.textContent = "See menu";
    browse.addEventListener("click", () => {
      dialog.close();
      document.querySelector<HTMLButtonElement>('#menu-filters [data-category="All"]')?.click();
      document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    row.append(name, browse);
    picks.append(row);
  }
}

document.querySelector<HTMLButtonElement>("#account-open")!.addEventListener("click", showAccount);
document.querySelector<HTMLButtonElement>("#account-close")!.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.querySelectorAll<HTMLButtonElement>("#account-tabs [data-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.mode === "signup" ? "signup" : "signin"));
});
document.querySelector<HTMLButtonElement>("#forgot-password")!.addEventListener("click", async () => {
  const email = authForm.querySelector<HTMLInputElement>('[name="email"]')!.value.trim();
  if (!email) {
    setMessage("Enter your email address first, and we’ll send a reset link if an account exists.");
    authForm.querySelector<HTMLInputElement>('[name="email"]')!.focus();
    return;
  }
  setMessage("Sending a password reset link…");
  const { error } = await ivyAuth.auth.resetPasswordForEmail(email, `${window.location.origin}/`);
  setMessage(error ? "We could not send a reset link. Please try again later." : "If an account exists for this email, a password reset link is on its way.", error ? "error" : "ok");
});

if (!clientAuth) {
  configNote.hidden = false;
  authForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach((element) => {
    element.disabled = true;
  });
  accountTabs.querySelectorAll("button").forEach((button) => ((button as HTMLButtonElement).disabled = true));
} else {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(authForm);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const submit = document.querySelector<HTMLButtonElement>("#auth-submit")!;
    submit.disabled = true;
    setMessage(authMode === "signup" ? "Creating your account…" : "Signing in…");

    try {
      if (authMode === "signup") {
        const displayName = String(formData.get("display_name") ?? "").trim();
        const { data, error } = await clientAuth.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage("Account created. Check your email to confirm it, then sign in here.", "ok");
        } else {
          await showSignedIn(data.session);
        }
      } else {
        const { data, error } = await clientAuth.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error("Your email address must be confirmed before you can sign in.");
        await showSignedIn(data.session);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "We could not complete that request.";
      setMessage(/verif|confirm/i.test(reason)
        ? "Please confirm your email first. We sent another confirmation link if the account is still unverified."
        : reason, "error");
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector<HTMLButtonElement>("#sign-out")!.addEventListener("click", async () => {
    const { error } = await clientAuth.auth.signOut();
    if (error) {
      setMessage("We could not sign you out. Please try again.", "error");
      return;
    }
    showSignedOut();
    setAuthMode("signin");
    setMessage("You’re signed out.", "ok");
  });

  void clientAuth.auth.getSession().then(({ data, error }) => {
    if (error) {
      showSignedOut();
      setMessage("We could not restore your session. Please sign in again.", "error");
      return;
    }
    if (data.session) void showSignedIn(data.session);
  });

  clientAuth.auth.onAuthStateChange((_event, session) => {
    if (session) void showSignedIn(session);
    else showSignedOut();
  });
}

const resetToken = new URLSearchParams(window.location.search).get("resetToken");
if (resetToken) {
  const resetForm = document.querySelector<HTMLFormElement>("#password-reset-form")!;
  accountTabs.hidden = true;
  authForm.hidden = true;
  profileCard.hidden = true;
  resetForm.hidden = false;
  accountIntro.textContent = "Choose a new password for your Ivy account.";
  dialog.showModal();
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = resetForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    const newPassword = String(new FormData(resetForm).get("newPassword") ?? "");
    const { error } = await ivyAuth.auth.resetPassword(resetToken, newPassword);
    if (error) {
      setMessage("This password reset link is invalid or expired. Request a new one from sign in.", "error");
      submit.disabled = false;
      return;
    }
    window.history.replaceState({}, "", window.location.pathname);
    resetForm.hidden = true;
    authForm.hidden = false;
    accountTabs.hidden = false;
    setAuthMode("signin");
    setMessage("Your password has been updated. Sign in with your new password.", "ok");
    submit.disabled = false;
  });
}

setAuthMode("signin");
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
