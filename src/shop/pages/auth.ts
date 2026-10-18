import { currentSession, requestPasswordReset, resendVerification, resetPassword, sessionRestored, signIn, signUp, onAccountChange } from "../account.js";
import { esc } from "../format.js";
import { navigate } from "../router.js";

export type AuthPage = "signin" | "signup" | "verify" | "forgot" | "reset";

/** Only same-site paths are allowed as a return address. */
function safeNext(value: string | null, fallback = "/account"): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !/^\/(signin|signup|verify-email|forgot-password|reset-password)/.test(value) ? value : fallback;
}

const passwordRules = (password: string, email = "") => [
  { ok: password.length >= 8, text: "At least 8 characters" },
  { ok: /[A-Za-z]/.test(password) && /\d/.test(password), text: "Letters and at least one number" },
  { ok: !email || !password.toLowerCase().includes(email.split("@")[0]!.toLowerCase() || "\u0000"), text: "Not based on your email" },
];

function rulesMarkup(password: string, email = ""): string {
  return `<ul class="pw-rules" aria-live="polite">${passwordRules(password, email).map((rule) => `<li class="${rule.ok ? "ok" : ""}"><span aria-hidden="true">${rule.ok ? "✓" : "•"}</span> ${esc(rule.text)}${rule.ok ? `<span class="visually-hidden"> (done)</span>` : ""}</li>`).join("")}</ul>`;
}

function shell(title: string, intro: string, body: string): string {
  return `<section class="auth-page view"><div class="auth-card panel">
    <p class="kicker">The Ivy Pizza</p>
    <h1 class="page-title" tabindex="-1" data-page-heading style="font-size:clamp(30px,4vw,40px)">${esc(title)}</h1>
    <p class="muted" style="margin:10px 0 20px;line-height:1.6">${intro}</p>
    ${body}
  </div></section>`;
}

const passwordField = (id: string, label: string, autocomplete: string) => `
  <div class="field"><label for="${id}">${esc(label)}</label>
    <div class="pw-wrap"><input id="${id}" name="password" type="password" autocomplete="${autocomplete}" required minlength="8" maxlength="128" /><button type="button" class="pw-toggle" data-toggle-pw="${id}" aria-label="Show password">Show</button></div>
  </div>`;

export function renderAuth(view: HTMLElement, page: AuthPage): () => void {
  const params = new URLSearchParams(window.location.search);
  const next = safeNext(params.get("next"));
  const nextQuery = next !== "/account" ? `?next=${encodeURIComponent(next)}` : "";
  let cleanup = (): void => undefined;

  const notice = (text: string, kind: "error" | "ok" | "info" = "error") => `<p class="notice ${kind}" role="${kind === "error" ? "alert" : "status"}" style="margin:0 0 14px">${esc(text)}</p>`;

  const render = (): void => {
    // Signed-in visitors don't need these pages (except to reset a password they asked to change).
    if (sessionRestored() && currentSession() && (page === "signin" || page === "signup")) {
      navigate(next, { replace: true });
      return;
    }
    if (page === "signin") {
      const message = params.get("message");
      view.innerHTML = shell("Sign in", "Welcome back. Sign in to order faster with your saved addresses and order history.", `
        ${message ? notice(message, "info") : ""}
        ${params.get("reset") === "1" ? notice("Your password has been updated. Sign in with your new password.", "ok") : ""}
        <form class="form-grid" data-form novalidate>
          <div class="field"><label for="au-email">Email</label><input id="au-email" name="email" type="email" autocomplete="email" required maxlength="254" /></div>
          ${passwordField("au-password", "Password", "current-password")}
          <a class="link-btn" href="/forgot-password${nextQuery}" style="justify-self:end;min-height:32px">Forgot password?</a>
          <div data-error></div>
          <button class="btn btn-gold" type="submit" style="min-height:52px">Sign in</button>
        </form>
        <p class="muted" style="margin:18px 0 0;font-size:14px">New to Ivy? <a href="/signup${nextQuery}" style="font-weight:800">Create an account</a></p>`);
    } else if (page === "signup") {
      view.innerHTML = shell("Create your account", "It takes under a minute. We'll email you a link to confirm your address.", `
        <form class="form-grid" data-form novalidate>
          <div class="field"><label for="au-name">Full name</label><input id="au-name" name="name" autocomplete="name" required maxlength="100" /></div>
          <div class="field"><label for="au-email">Email</label><input id="au-email" name="email" type="email" autocomplete="email" required maxlength="254" /></div>
          ${passwordField("au-password", "Password", "new-password")}
          <div data-rules>${rulesMarkup("")}</div>
          <div data-error></div>
          <button class="btn btn-gold" type="submit" style="min-height:52px">Create account</button>
          <p class="legal">By creating an account you agree to our terms. We only email you about your orders unless you opt in.</p>
        </form>
        <p class="muted" style="margin:18px 0 0;font-size:14px">Already have an account? <a href="/signin${nextQuery}" style="font-weight:800">Sign in</a></p>`);
    } else if (page === "verify") {
      const email = params.get("email") ?? "";
      const expired = params.get("expired") === "1";
      view.innerHTML = shell(expired ? "That link has expired" : "Check your email", expired
        ? "Confirmation links work for a limited time. Enter your email and we'll send a fresh one."
        : `We've sent a confirmation link${email ? ` to <strong>${esc(email)}</strong>` : ""}. Open it on this device to finish creating your account.`, `
        <form class="form-grid" data-form novalidate>
          ${expired || !email ? `<div class="field"><label for="au-email">Email</label><input id="au-email" name="email" type="email" autocomplete="email" required value="${esc(email)}" /></div>` : `<input type="hidden" name="email" value="${esc(email)}" />`}
          <div data-error></div>
          <button class="btn btn-outline" type="submit" data-resend>Send ${expired ? "a new link" : "it again"}</button>
        </form>
        <p class="muted" style="margin:18px 0 0;font-size:14px">Already confirmed? <a href="/signin${nextQuery}" style="font-weight:800">Sign in</a> · Wrong email? <a href="/signup${nextQuery}" style="font-weight:800">Start again</a></p>`);
    } else if (page === "forgot") {
      view.innerHTML = shell("Reset your password", "Enter the email you use for Ivy and we'll send you a link to choose a new password.", `
        <form class="form-grid" data-form novalidate>
          <div class="field"><label for="au-email">Email</label><input id="au-email" name="email" type="email" autocomplete="email" required maxlength="254" /></div>
          <div data-error></div>
          <button class="btn btn-gold" type="submit" style="min-height:52px">Send reset link</button>
        </form>
        <p class="muted" style="margin:18px 0 0;font-size:14px">Remembered it? <a href="/signin${nextQuery}" style="font-weight:800">Sign in</a></p>`);
    } else {
      const token = params.get("resetToken");
      view.innerHTML = token ? shell("Choose a new password", "Pick something you haven't used before.", `
        <form class="form-grid" data-form novalidate>
          ${passwordField("au-password", "New password", "new-password")}
          <div data-rules>${rulesMarkup("")}</div>
          <div data-error></div>
          <button class="btn btn-gold" type="submit" style="min-height:52px">Save new password</button>
        </form>`) : shell("This link isn't complete", "Open the reset link from your email again, or request a new one.", `<a class="btn btn-gold" href="/forgot-password">Request a new link</a>`);
    }
  };

  const showError = (text: string, kind: "error" | "ok" | "info" = "error") => {
    const slot = view.querySelector("[data-error]");
    if (slot) slot.innerHTML = text ? notice(text, kind) : "";
  };

  const onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.name === "password" || input.name === "email") {
      const rules = view.querySelector("[data-rules]");
      const form = view.querySelector<HTMLFormElement>("[data-form]");
      if (rules && form) rules.innerHTML = rulesMarkup(String(new FormData(form).get("password") ?? ""), String(new FormData(form).get("email") ?? ""));
    }
  };

  const onClick = (event: Event): void => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-toggle-pw]");
    if (!toggle) return;
    const input = view.querySelector<HTMLInputElement>(`#${toggle.dataset.togglePw}`);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  };

  const onSubmit = async (event: Event): Promise<void> => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const label = submit.textContent;
    const busy = (on: boolean) => { submit.disabled = on; submit.textContent = on ? "Please wait…" : label; };
    if ((page === "signin" || page === "signup" || page === "forgot" || page === "verify") && !/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    if (page === "signin") {
      if (!password) return showError("Enter your password.");
      busy(true);
      const failure = await signIn(email, password);
      busy(false);
      if (failure) {
        showError(failure);
        if (/confirm your email/i.test(failure)) navigate(`/verify-email?email=${encodeURIComponent(email)}${nextQuery ? `&next=${encodeURIComponent(next)}` : ""}`);
        return;
      }
      navigate(next, { replace: true });
    } else if (page === "signup") {
      const name = String(data.get("name") ?? "").trim();
      if (!name) return showError("Enter your name.");
      if (!passwordRules(password, email).every((rule) => rule.ok)) return showError("Choose a password that meets all three rules.");
      busy(true);
      const failure = await signUp(name, email, password, next);
      busy(false);
      if (failure) return showError(failure);
      navigate(`/verify-email?email=${encodeURIComponent(email)}${nextQuery ? `&next=${encodeURIComponent(next)}` : ""}`, { replace: true });
    } else if (page === "verify") {
      busy(true);
      const failure = await resendVerification(email, next);
      if (failure) {
        busy(false);
        return showError(failure);
      }
      showError("Sent. Check your inbox and spam folder.", "ok");
      // A short cool-down stops repeated sends.
      submit.textContent = "Sent";
      window.setTimeout(() => busy(false), 30_000);
    } else if (page === "forgot") {
      busy(true);
      const failure = await requestPasswordReset(email);
      busy(false);
      showError(failure ?? "If there's an account for this email, a reset link is on its way.", failure ? "error" : "ok");
    } else {
      if (!passwordRules(password).slice(0, 2).every((rule) => rule.ok)) return showError("Choose a password with at least 8 characters, letters and a number.");
      busy(true);
      const failure = await resetPassword(params.get("resetToken") ?? "", password);
      busy(false);
      if (failure) return showError(failure);
      navigate("/signin?reset=1", { replace: true });
    }
  };

  render();
  view.addEventListener("input", onInput);
  view.addEventListener("click", onClick);
  view.addEventListener("submit", onSubmit);
  const stop = onAccountChange(() => {
    if ((page === "signin" || page === "signup") && currentSession()) navigate(next, { replace: true });
  });
  cleanup = () => {
    stop();
    view.removeEventListener("input", onInput);
    view.removeEventListener("click", onClick);
    view.removeEventListener("submit", onSubmit);
  };
  return cleanup;
}
