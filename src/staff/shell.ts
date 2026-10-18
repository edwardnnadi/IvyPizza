import "./staff.css";
import { ivyAuth, type IvySession } from "../auth.js";
import { apiUrl } from "../api.js";

export interface StaffProfile {
  id: string;
  displayName: string;
  roles: string[];
}

export interface StaffContext {
  profile: StaffProfile;
  board: HTMLElement;
  /** Fetch with the session cookie; a 401 sends the screen back to sign-in. */
  request(path: string, init?: RequestInit): Promise<Response>;
  setMessage(text: string, kind?: "info" | "error"): void;
  addTopButton(label: string, onClick: () => void): HTMLButtonElement;
  /** Runs `task` every `ms` while signed in; stops on sign-out. */
  every(ms: number, task: () => void): void;
}

interface ShellOptions {
  title: string;
  eyebrow: string;
  intro: string;
  roles: string[];
  deniedText: string;
  /** Wider layout for boards with columns. */
  wide?: boolean;
  start(context: StaffContext): void | Promise<void>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

export const naira = (minor: number, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);

export const clock = (value: string | Date) => new Date(value).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Sign-in, role check, top bar and polling shared by the staff screens. */
export function startStaffScreen(app: HTMLElement, options: ShellOptions): void {
  app.innerHTML = `
    <div class="kitchen-app staff-app">
      <header class="kitchen-topbar">
        <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
        <div class="kitchen-top-actions" data-top>
          <span class="kitchen-staff-name" data-name></span>
          <button class="kitchen-top-button" type="button" data-sign-out hidden>Sign out</button>
        </div>
      </header>
      <main class="kitchen-shell ${options.wide ? "staff-wide" : ""}">
        <section class="kitchen-login" data-login>
          <div class="eyebrow dark">${escapeHtml(options.eyebrow)}</div>
          <h1>${escapeHtml(options.title)}</h1>
          <p>${escapeHtml(options.intro)}</p>
          <form data-login-form>
            <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
            <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
            <button class="btn account-submit" type="submit">Sign in</button>
          </form>
          <p class="kitchen-message" data-login-message role="status" aria-live="polite"></p>
        </section>
        <section class="kitchen-denied" data-denied hidden>
          <div class="eyebrow dark">${escapeHtml(options.eyebrow)}</div>
          <h1>Access required</h1>
          <p>${escapeHtml(options.deniedText)}</p>
          <button class="btn" type="button" data-sign-out>Sign out</button>
        </section>
        <section data-board hidden></section>
      </main>
    </div>`;
  const $ = <T extends Element>(selector: string) => app.querySelector<T>(selector)!;
  const login = $<HTMLElement>("[data-login]");
  const loginForm = $<HTMLFormElement>("[data-login-form]");
  const loginMessage = $<HTMLParagraphElement>("[data-login-message]");
  const denied = $<HTMLElement>("[data-denied]");
  const board = $<HTMLElement>("[data-board]");
  const name = $<HTMLElement>("[data-name]");
  const top = $<HTMLElement>("[data-top]");
  let timers: number[] = [];
  let extraButtons: HTMLButtonElement[] = [];
  let generation = 0;

  const stop = () => {
    timers.forEach((timer) => window.clearInterval(timer));
    timers = [];
  };

  function showLogin(text = ""): void {
    generation += 1;
    stop();
    extraButtons.forEach((button) => button.remove());
    extraButtons = [];
    login.hidden = false;
    denied.hidden = true;
    board.hidden = true;
    board.replaceChildren();
    name.textContent = "";
    app.querySelectorAll<HTMLButtonElement>("[data-sign-out]").forEach((button) => { if (button.closest("header")) button.hidden = true; });
    loginMessage.textContent = text;
  }

  async function open(session: IvySession | null): Promise<void> {
    if (!session) return showLogin();
    const current = ++generation;
    loginMessage.textContent = "Checking your access…";
    try {
      const response = await fetch(apiUrl("/api/me"), { credentials: "include" });
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Please sign in again." : "Could not verify this account.");
      const profile = await response.json() as StaffProfile;
      if (current !== generation) return;
      const permitted = profile.roles.some((role) => options.roles.includes(role));
      login.hidden = true;
      denied.hidden = permitted;
      board.hidden = !permitted;
      name.textContent = profile.displayName;
      app.querySelectorAll<HTMLButtonElement>("header [data-sign-out]").forEach((button) => { button.hidden = false; });
      if (!permitted) return;
      const messageLine = document.createElement("p");
      messageLine.className = "kitchen-message";
      messageLine.setAttribute("role", "status");
      messageLine.setAttribute("aria-live", "polite");
      const context: StaffContext = {
        profile,
        board,
        request: async (path, init = {}) => {
          const headers = new Headers(init.headers);
          if (init.body) headers.set("Content-Type", "application/json");
          const result = await fetch(apiUrl(path), { ...init, headers, credentials: "include" });
          if (result.status === 401) showLogin("Your session expired. Sign in again to continue.");
          return result;
        },
        setMessage: (text, kind = "info") => {
          messageLine.textContent = text;
          messageLine.dataset.kind = kind;
        },
        addTopButton: (label, onClick) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "kitchen-top-button";
          button.textContent = label;
          button.addEventListener("click", onClick);
          top.insertBefore(button, top.querySelector("[data-sign-out]"));
          extraButtons.push(button);
          return button;
        },
        every: (ms, task) => {
          timers.push(window.setInterval(task, ms));
        },
      };
      board.replaceChildren();
      await options.start(context);
      board.prepend(messageLine);
    } catch (error) {
      if (current === generation) showLogin(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
    submit.disabled = true;
    loginMessage.textContent = "Signing in…";
    const data = new FormData(loginForm);
    const { data: result, error } = await ivyAuth.auth.signInWithPassword({ email: String(data.get("email") ?? "").trim(), password: String(data.get("password") ?? "") });
    submit.disabled = false;
    if (error) loginMessage.textContent = /verif|confirm/i.test(error.message) ? "Confirm your email address first, then sign in." : error.message;
    else if (!result.session) loginMessage.textContent = "Your email address must be confirmed before you can sign in.";
  });
  app.addEventListener("click", async (event) => {
    if (!(event.target as HTMLElement).closest("[data-sign-out]")) return;
    await ivyAuth.auth.signOut();
  });
  ivyAuth.auth.onAuthStateChange((_event, session) => void open(session));
  void ivyAuth.auth.getSession().then(({ data }) => void open(data.session));
}

/** A short, polite beep for new tickets (Web Audio, no file to download). */
export function beep(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.5);
    oscillator.onended = () => void audio.close();
  } catch {
    // Sound is a nicety; the screen still updates.
  }
}
