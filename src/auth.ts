import { apiUrl } from "./api.js";

export interface IvySession {
  user: { id: string; email: string; user_metadata: { display_name: string } };
}

type AuthResult = { data: { session: IvySession | null }; error: Error | null };
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "INITIAL_SESSION";

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(`/api/auth/${path}`), {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(result.message ?? result.error ?? "Authentication request failed.");
  return result;
}

function toSession(user: { id: string; email: string; name?: string } | null | undefined): IvySession | null {
  return user ? { user: { id: user.id, email: user.email, user_metadata: { display_name: user.name ?? user.email } } } : null;
}

export class IvyAuth {
  private listeners = new Set<(event: AuthEvent, session: IvySession | null) => void>();

  readonly auth = {
    getSession: async (): Promise<AuthResult> => {
      try {
        const result = await authRequest<{ user?: { id: string; email: string; name?: string } | null } | null>("get-session");
        return { data: { session: toSession(result?.user) }, error: null };
      } catch (error) {
        return { data: { session: null }, error: error instanceof Error ? error : new Error("Could not restore session") };
      }
    },
    signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: { display_name?: string }; emailRedirectTo?: string } }): Promise<AuthResult> => {
      try {
        await authRequest("sign-up/email", {
          name: options?.data?.display_name ?? email,
          email,
          password,
          callbackURL: options?.emailRedirectTo ?? window.location.origin,
        });
        return { data: { session: null }, error: null };
      } catch (error) {
        return { data: { session: null }, error: error instanceof Error ? error : new Error("Could not create account") };
      }
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }): Promise<AuthResult> => {
      try {
        const result = await authRequest<{ user: { id: string; email: string; name?: string } }>("sign-in/email", {
          email,
          password,
          callbackURL: window.location.origin,
        });
        const session = toSession(result.user);
        this.emit("SIGNED_IN", session);
        return { data: { session }, error: null };
      } catch (error) {
        return { data: { session: null }, error: error instanceof Error ? error : new Error("Could not sign in") };
      }
    },
    signOut: async (): Promise<{ error: Error | null }> => {
      try {
        await authRequest("sign-out", {});
        this.emit("SIGNED_OUT", null);
        return { error: null };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error("Could not sign out") };
      }
    },
    resetPasswordForEmail: async (email: string, redirectTo = window.location.origin): Promise<{ error: Error | null }> => {
      try {
        await authRequest("request-password-reset", { email, redirectTo });
        return { error: null };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error("Could not request password reset") };
      }
    },
    resetPassword: async (token: string, newPassword: string): Promise<{ error: Error | null }> => {
      try {
        await authRequest("reset-password", { token, newPassword });
        return { error: null };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error("Could not reset password") };
      }
    },
    onAuthStateChange: (callback: (event: AuthEvent, session: IvySession | null) => void) => {
      this.listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => this.listeners.delete(callback) } } };
    },
  };

  private emit(event: AuthEvent, session: IvySession | null): void {
    for (const listener of this.listeners) listener(event, session);
  }
}

export const ivyAuth = new IvyAuth();
