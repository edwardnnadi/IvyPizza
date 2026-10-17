import { ivyAuth, type IvySession } from "../auth.js";
import { apiUrl } from "../api.js";
import { esc, money } from "./format.js";
import { findItem } from "./menu-data.js";
import { navigate } from "./router.js";

export interface AccountProfile {
  id: string;
  displayName: string;
  email: string | null;
  roles: string[];
}

export interface DashboardOrder {
  orderNumber: string;
  fulfillmentStatus: string;
  paymentStatus: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  items: Array<{ name: string; quantity: number }>;
}

interface CustomerDashboard {
  orderCount: number;
  activeOrderCount: number;
  orders: DashboardOrder[];
  recommendations: Array<{ id: string; name: string; category: string; priceMinor: number; currency: string }>;
}

export const accountMarkup = `
  <dialog class="ivy-dialog" id="account-dialog" aria-labelledby="account-title">
    <div class="ivy-panel">
      <button class="ivy-close" id="account-close" type="button" aria-label="Close account dialog">×</button>
      <p class="eyebrow">The Ivy Pizza</p>
      <h2 id="account-title">Your account</h2>
      <p class="ivy-intro" id="account-intro">Sign in to your Ivy account or create one to get started.</p>
      <div class="ivy-tabs" id="account-tabs" role="tablist" aria-label="Account access" data-mode="signin">
        <button type="button" data-mode="signin" role="tab" aria-selected="true">Sign in</button>
        <button type="button" data-mode="signup" role="tab" aria-selected="false">Create account</button>
        <span class="ivy-tabs-ind" aria-hidden="true"></span>
      </div>
      <form id="auth-form">
        <div class="ivy-expand" id="name-field"><div>
          <label class="ivy-field">Full name<input name="display_name" autocomplete="name" maxlength="100" /></label>
        </div></div>
        <label class="ivy-field">Email address<input name="email" type="email" autocomplete="email" required maxlength="254" /></label>
        <label class="ivy-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
        <button class="auth-inline-link" id="forgot-password" type="button">Forgot password?</button>
        <button class="ivy-submit" id="auth-submit" type="submit">Sign in</button>
      </form>
      <form id="password-reset-form" hidden>
        <label class="ivy-field">New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128" /></label>
        <button class="ivy-submit" type="submit">Save new password</button>
      </form>
      <div id="profile-card" hidden>
        <div class="profile">
          <span class="profile-initial" id="profile-initial" aria-hidden="true"></span>
          <div style="min-width:0">
            <p class="profile-name" id="profile-name"></p>
            <p class="profile-email" id="profile-email"></p>
            <p class="profile-roles" id="profile-roles"></p>
          </div>
        </div>
        <section class="customer-dashboard" aria-labelledby="dashboard-heading">
          <div class="dashboard-summary">
            <div><strong id="dashboard-order-count">—</strong><span>Orders placed</span></div>
            <div><strong id="dashboard-active-count">—</strong><span>In progress</span></div>
          </div>
          <div class="dashboard-block">
            <h3 id="dashboard-heading">Your orders</h3>
            <div class="dashboard-orders" id="dashboard-orders" aria-live="polite"><p>Loading your order history…</p></div>
          </div>
          <div class="dashboard-block">
            <h3>Popular picks</h3>
            <div class="dashboard-picks" id="dashboard-picks"></div>
          </div>
        </section>
        <button class="ivy-submit outline" id="sign-out" type="button">Sign out</button>
      </div>
      <p class="ivy-message" id="auth-message" role="status" aria-live="polite"></p>
    </div>
  </dialog>
`;

let session: IvySession | null = null;
let profile: AccountProfile | null = null;
let restored = false;
const listeners = new Set<() => void>();

export function currentSession(): IvySession | null {
  return session;
}

export function currentProfile(): AccountProfile | null {
  return profile;
}

/** False until the first session check has finished, so pages can wait instead of flashing "signed out". */
export function sessionRestored(): boolean {
  return restored;
}

export function onAccountChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

export async function fetchDashboard(): Promise<CustomerDashboard> {
  const response = await fetch(apiUrl("/api/customer/dashboard"), { credentials: "include" });
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) throw new Error("We could not load your orders. Please try again.");
  return response.json() as Promise<CustomerDashboard>;
}

async function loadProfile(): Promise<AccountProfile> {
  const response = await fetch(apiUrl("/api/me"), { credentials: "include" });
  if (!response.ok) {
    if (response.status === 403) throw new Error("Your account profile is still being prepared. Please try again shortly.");
    if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
    throw new Error("We could not load your account. Please try again.");
  }
  return response.json() as Promise<AccountProfile>;
}

/** Signs in from anywhere (the checkout uses this inline). Returns an error message, or null on success. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const { data, error } = await ivyAuth.auth.signInWithPassword({ email, password });
  if (error) {
    return /verif|confirm/i.test(error.message)
      ? "Please confirm your email first. We sent another confirmation link if the account is still unverified."
      : error.message;
  }
  if (!data.session) return "Your email address must be confirmed before you can sign in.";
  return null;
}

let openDialog: (mode?: "signin" | "signup", message?: string) => void = () => undefined;

export function openAccount(mode?: "signin" | "signup", message?: string): void {
  openDialog(mode, message);
}

/** Wires the account dialog. Call once after `accountMarkup` is in the page. */
export function initAccount(): void {
  const $ = <T extends Element = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
  const dialog = $<HTMLDialogElement>("#account-dialog");
  const authForm = $<HTMLFormElement>("#auth-form");
  const authMessage = $<HTMLParagraphElement>("#auth-message");
  const accountTabs = $<HTMLDivElement>("#account-tabs");
  const nameField = $<HTMLDivElement>("#name-field");
  const accountIntro = $<HTMLParagraphElement>("#account-intro");
  const profileCard = $<HTMLDivElement>("#profile-card");
  let authMode: "signin" | "signup" = "signin";
  let profileLoadGeneration = 0;

  function setMessage(message: string, kind: "info" | "ok" | "error" = "info"): void {
    authMessage.textContent = message;
    authMessage.dataset.kind = kind;
  }

  function setAuthMode(mode: "signin" | "signup"): void {
    authMode = mode;
    accountTabs.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.mode === mode));
    });
    accountTabs.dataset.mode = mode;
    nameField.classList.toggle("is-open", mode === "signup");
    accountIntro.textContent = mode === "signup"
      ? "Create an Ivy account to save your details for faster ordering."
      : "Sign in to your Ivy account or create one to get started.";
    nameField.querySelector("input")?.toggleAttribute("required", mode === "signup");
    $<HTMLButtonElement>("#forgot-password").hidden = mode === "signup";
    authForm.querySelector<HTMLInputElement>('[name="password"]')?.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
    $<HTMLButtonElement>("#auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
    setMessage("");
  }

  openDialog = (mode, message) => {
    if (mode && !session) setAuthMode(mode);
    if (message && !session) setMessage(message);
    if (!dialog.open) dialog.showModal();
    if (!authForm.hidden) authForm.querySelector<HTMLInputElement>(authMode === "signup" ? '[name="display_name"]' : '[name="email"]')?.focus();
  };

  function showSignedOut(): void {
    profileLoadGeneration += 1;
    session = null;
    profile = null;
    accountTabs.hidden = false;
    authForm.hidden = false;
    profileCard.hidden = true;
    setAuthMode(authMode);
    emit();
  }

  async function showSignedIn(next: IvySession): Promise<void> {
    const generation = ++profileLoadGeneration;
    session = next;
    accountTabs.hidden = true;
    authForm.hidden = true;
    profileCard.hidden = false;
    accountIntro.textContent = "You are signed in to your Ivy account.";
    emit();
    setMessage("Loading your account…");
    try {
      const loaded = await loadProfile();
      if (generation !== profileLoadGeneration) return;
      profile = loaded;
      $("#profile-name").textContent = loaded.displayName;
      $("#profile-email").textContent = loaded.email ?? "";
      $("#profile-roles").textContent = loaded.roles.join(" · ") || "Customer";
      $("#profile-initial").textContent = loaded.displayName.charAt(0).toUpperCase();
      emit();
      await renderDashboard();
      if (generation !== profileLoadGeneration) return;
      setMessage("");
    } catch (error) {
      if (generation !== profileLoadGeneration) return;
      setMessage(error instanceof Error ? error.message : "We could not load your account.", "error");
    }
  }

  async function renderDashboard(): Promise<void> {
    const dashboard = await fetchDashboard();
    $("#dashboard-order-count").textContent = String(dashboard.orderCount);
    $("#dashboard-active-count").textContent = String(dashboard.activeOrderCount);
    $("#dashboard-orders").innerHTML = dashboard.orders.length
      ? dashboard.orders.map((order) => `
          <a class="dashboard-order" href="/track/${encodeURIComponent(order.orderNumber)}">
            <span class="dashboard-order-heading"><strong>${esc(order.orderNumber)}</strong><span>${esc(order.fulfillmentStatus.replaceAll("_", " "))}</span></span>
            <p>${esc(order.items.map((item) => `${item.quantity}× ${item.name}`).join(", "))} · ${esc(money(order.totalMinor, order.currency))}</p>
            <small>${esc(new Date(order.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }))}</small>
          </a>`).join("")
      : "<p>Your first order will appear here. Browse the menu to get started.</p>";
    $("#dashboard-picks").innerHTML = dashboard.recommendations.map((item) => `
      <div class="dashboard-pick">
        <div><strong>${esc(item.name)}</strong><small>${esc(money(item.priceMinor, item.currency))}</small></div>
        <button type="button" data-pick="${esc(item.id)}">Order</button>
      </div>`).join("");
  }

  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === dialog) dialog.close();
    if (target.closest(".dashboard-order")) dialog.close();
    const pick = target.closest<HTMLButtonElement>("[data-pick]");
    if (pick) {
      dialog.close();
      const item = findItem(pick.dataset.pick ?? "");
      navigate(item ? `/menu/${item.slug}` : "/menu");
    }
  });
  $<HTMLButtonElement>("#account-close").addEventListener("click", () => dialog.close());
  accountTabs.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.mode === "signup" ? "signup" : "signin"));
  });
  $<HTMLButtonElement>("#forgot-password").addEventListener("click", async () => {
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

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(authForm);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const submit = $<HTMLButtonElement>("#auth-submit");
    submit.disabled = true;
    setMessage(authMode === "signup" ? "Creating your account…" : "Signing in…");
    try {
      if (authMode === "signup") {
        const displayName = String(formData.get("display_name") ?? "").trim();
        const { data, error } = await ivyAuth.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
        if (error) throw error;
        if (!data.session) setMessage("Account created. Check your email to confirm it, then sign in here.", "ok");
        else await showSignedIn(data.session);
      } else {
        const failure = await signIn(email, password);
        if (failure) throw new Error(failure);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not complete that request.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  $<HTMLButtonElement>("#sign-out").addEventListener("click", async () => {
    const { error } = await ivyAuth.auth.signOut();
    if (error) {
      setMessage("We could not sign you out. Please try again.", "error");
      return;
    }
    setAuthMode("signin");
    setMessage("You’re signed out.", "ok");
  });

  ivyAuth.auth.onAuthStateChange((_event, next) => {
    if (next) void showSignedIn(next);
    else showSignedOut();
  });

  void ivyAuth.auth.getSession().then(({ data, error }) => {
    restored = true;
    if (error) {
      showSignedOut();
      return;
    }
    if (data.session) void showSignedIn(data.session);
    else emit();
  });

  const resetToken = new URLSearchParams(window.location.search).get("resetToken");
  if (resetToken) {
    const resetForm = $<HTMLFormElement>("#password-reset-form");
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
