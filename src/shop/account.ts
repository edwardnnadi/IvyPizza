import { ivyAuth, type IvySession } from "../auth.js";
import { apiUrl } from "../api.js";
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
}

let session: IvySession | null = null;
let profile: AccountProfile | null = null;
let restored = false;
let profileGeneration = 0;
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

async function loadProfile(): Promise<void> {
  const generation = ++profileGeneration;
  try {
    const response = await fetch(apiUrl("/api/me"), { credentials: "include" });
    if (!response.ok) return;
    const loaded = await response.json() as AccountProfile;
    if (generation !== profileGeneration || !session) return;
    profile = loaded;
    emit();
  } catch {
    // The header falls back to "My account" until the profile loads.
  }
}

/** Reloads the name shown in the header after the customer edits it. */
export function refreshProfile(): void {
  void loadProfile();
}

function friendly(error: Error, fallback: string): string {
  if (/verif|confirm/i.test(error.message)) return "Please confirm your email first. We've sent you another confirmation link.";
  if (/invalid (email or )?password|invalid credentials/i.test(error.message)) return "That email and password don't match. Check them and try again.";
  if (/too many|rate limit/i.test(error.message)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/already exists|already registered|use another email/i.test(error.message)) return "There's already an account with this email. Sign in instead, or reset your password.";
  return error.message || fallback;
}

/** Returns an error message, or null on success. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const { data, error } = await ivyAuth.auth.signInWithPassword({ email, password });
  if (error) return friendly(error, "We couldn't sign you in.");
  if (!data.session) return "Your email address must be confirmed before you can sign in.";
  return null;
}

export async function signUp(name: string, email: string, password: string, next: string): Promise<string | null> {
  const { error } = await ivyAuth.auth.signUp({
    email,
    password,
    options: { data: { display_name: name }, emailRedirectTo: `${window.location.origin}${next}` },
  });
  return error ? friendly(error, "We couldn't create your account.") : null;
}

export async function resendVerification(email: string, next: string): Promise<string | null> {
  try {
    const response = await fetch(apiUrl("/api/auth/send-verification-email"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, callbackURL: `${window.location.origin}${next}` }),
    });
    if (response.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
    return response.ok ? null : "We couldn't send the email. Please try again.";
  } catch {
    return "We couldn't reach the server. Check your connection and try again.";
  }
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const { error } = await ivyAuth.auth.resetPasswordForEmail(email, `${window.location.origin}/reset-password`);
  return error ? "We couldn't send a reset link. Please try again later." : null;
}

export async function resetPassword(token: string, password: string): Promise<string | null> {
  const { error } = await ivyAuth.auth.resetPassword(token, password);
  return error ? "This reset link is invalid or has expired. Request a new one." : null;
}

export async function signOut(): Promise<void> {
  await ivyAuth.auth.signOut();
}

/** Sends people to sign in (or create an account) and back to where they were. */
export function openAccount(mode: "signin" | "signup" = "signin", message?: string): void {
  if (session && !message) {
    navigate("/account");
    return;
  }
  const next = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ next });
  if (message) params.set("message", message);
  navigate(`/${mode === "signup" ? "signup" : "signin"}?${params.toString()}`);
}

/** Restores the session and keeps the account state current. Call once at start-up. */
export function initAccount(): void {
  ivyAuth.auth.onAuthStateChange((_event, next) => {
    session = next;
    if (!next) profile = null;
    emit();
    if (next) void loadProfile();
  });
  void ivyAuth.auth.getSession().then(({ data }) => {
    restored = true;
    session = data.session;
    emit();
    if (session) void loadProfile();
  });
  // Password reset emails link to /?resetToken=…; send them to the reset page.
  const resetToken = new URLSearchParams(window.location.search).get("resetToken");
  if (resetToken && window.location.pathname !== "/reset-password") {
    window.history.replaceState({}, "", `/reset-password?resetToken=${encodeURIComponent(resetToken)}`);
  }
}
