import { apiUrl } from "../../api.js";
import { ivyAuth } from "../../auth.js";
import { currentProfile, currentSession, onAccountChange, openAccount, sessionRestored, signIn } from "../account.js";
import { basketLines, checkoutKey, clearBasket, getQuoteState, onBasketChange, pricingContext, refreshQuote } from "../basket.js";
import { esc, money } from "../format.js";
import { describeBasketLine, findItem, onMenuChange, unitPriceMinor } from "../menu-data.js";
import { activeKitchenId, canOrderNow, getContext, isLocated, onContextChange, setContext, whenLabel } from "../order-context.js";
import { latestQuote, minimumCheck, unavailableLineIndexes } from "../pricing.js";
import { navigate } from "../router.js";
import { openAreaSheet, openScheduleSheet } from "../sheets.js";
import { findArea, findKitchen, guestCheckoutAllowed, loadConfig, onConfigChange, payments, pickupReadyText } from "../zones.js";
import { saveLastOrder, saveOrderToken, type PlacedOrder } from "./order-store.js";
import { summaryMarkup } from "./basket.js";

interface SavedAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  landmark: string | null;
  instructions: string | null;
}

type FieldName = "recipientName" | "phone" | "street" | "flat" | "landmark" | "instructions" | "addressLabel" | "guestName" | "guestPhone" | "guestEmail" | "pickupPhone";
type PaymentMethod = "on_delivery" | "transfer";

// Kept across visits to the page in this session, so going back to the basket never loses typing.
const form: Record<FieldName, string> & { saveAddress: boolean } = {
  recipientName: "", phone: "", street: "", flat: "", landmark: "", instructions: "", addressLabel: "Home",
  guestName: "", guestPhone: "", guestEmail: "", pickupPhone: "", saveAddress: false,
};
let detailsMode: "signin" | "guest" = "signin";
let paymentMethod: PaymentMethod = "on_delivery";

/** National number without +234 or the leading 0: "8031234567". */
function nationalDigits(value: string): string {
  return value.replace(/\D/g, "").replace(/^234/, "").replace(/^0/, "");
}

const phoneError = "Enter a 10-digit number after +234, e.g. 803 123 4567.";

function field(name: FieldName, label: string, options: { error?: string; optional?: boolean; placeholder?: string; autocomplete?: string; type?: string; hint?: string; textarea?: boolean } = {}): string {
  const id = `co-${name}`;
  const described = [options.error ? `${id}-err` : "", options.hint ? `${id}-hint` : ""].filter(Boolean).join(" ");
  const attrs = `id="${id}" data-field="${name}" ${options.autocomplete ? `autocomplete="${options.autocomplete}"` : ""} ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""} ${options.error ? `aria-invalid="true"` : ""} ${described ? `aria-describedby="${described}"` : ""} ${options.optional ? "" : "required"}`;
  return `<div class="field">
    <label for="${id}">${esc(label)}${options.optional ? ` <span class="opt-tag">(optional)</span>` : ""}</label>
    ${options.textarea ? `<textarea ${attrs} maxlength="500">${esc(form[name])}</textarea>` : `<input ${attrs} type="${options.type ?? "text"}" value="${esc(form[name])}" maxlength="${name === "street" ? 300 : 200}" />`}
    ${options.error ? `<span class="field-error" id="${id}-err">${esc(options.error)}</span>` : ""}
    ${options.hint ? `<span class="field-hint" id="${id}-hint">${esc(options.hint)}</span>` : ""}
  </div>`;
}

function phoneField(name: FieldName, label: string, error: string | undefined, hint: string): string {
  const id = `co-${name}`;
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <div class="phone-input"><span aria-hidden="true">+234</span><input id="${id}" data-field="${name}" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="803 123 4567" value="${esc(form[name])}" maxlength="16" required ${error ? `aria-invalid="true" aria-describedby="${id}-err ${id}-hint"` : `aria-describedby="${id}-hint"`} /></div>
    ${error ? `<span class="field-error" id="${id}-err">${esc(error)}</span>` : ""}
    <span class="field-hint" id="${id}-hint">${esc(hint)}</span>
  </div>`;
}

export function renderCheckout(view: HTMLElement): () => void {
  let savedAddresses: SavedAddress[] = [];
  let addressesFor: string | null = null;
  let addressChoice = "new";
  let errors: Partial<Record<FieldName | "auth" | "area", string>> = {};
  let topError = "";
  let placing = false;
  let signInError = "";
  let signingIn = false;
  const signInDraft = { email: "", password: "" };
  if (!payments().transfer) paymentMethod = "on_delivery";

  const signedIn = (): boolean => !!currentSession();
  const asGuest = (): boolean => !signedIn() && detailsMode === "guest" && guestCheckoutAllowed();

  const loadAddresses = async (): Promise<void> => {
    const session = currentSession();
    if (!session || addressesFor === session.user.id) return;
    addressesFor = session.user.id;
    try {
      const response = await fetch(apiUrl("/api/customer/addresses"), { credentials: "include" });
      if (!response.ok) return;
      const result = await response.json() as { addresses?: SavedAddress[] };
      savedAddresses = result.addresses ?? [];
      if (savedAddresses.length && addressChoice === "new" && !form.street) addressChoice = savedAddresses[0]!.id;
      render();
    } catch {
      // A new address can still be entered when saved addresses are unavailable.
    }
  };

  const blockers = (): string | null => {
    if (!basketLines().length) return "Your basket is empty.";
    if (unavailableLineIndexes().length) return "Some items are no longer available. Update your basket to continue.";
    const minimum = minimumCheck();
    if (minimum && minimum.shortMinor > 0) return `Add ${money(minimum.shortMinor)} more to reach the ${money(minimum.minimumMinor)} minimum for ${minimum.areaName}.`;
    if (getQuoteState().status === "error") return "We couldn't confirm the prices. Try again in a moment.";
    return null;
  };

  const detailsSection = (): string => {
    const session = currentSession();
    if (!sessionRestored()) return `<div class="panel co-section"><h2>1 · Your details</h2><p class="muted">Checking your account…</p></div>`;
    if (session) {
      const profile = currentProfile();
      return `<div class="panel co-section"><h2>1 · Your details</h2>
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:grid;gap:2px;font-size:15px"><strong>${esc(profile?.displayName ?? session.user.user_metadata.display_name)}</strong><span class="muted">${esc(session.user.email)}</span></div>
          <button class="link-btn" type="button" data-sign-out>Sign out</button>
        </div></div>`;
    }
    if (asGuest()) {
      return `<div class="panel co-section" id="co-details"><h2>1 · Your details</h2>
        <div class="form-grid">
          ${field("guestName", "Full name", { error: errors.guestName, autocomplete: "name" })}
          ${phoneField("guestPhone", "Phone", errors.guestPhone, getContext().mode === "delivery" ? "The rider calls this number if they can't find you." : "We text you when your order is ready.")}
          ${field("guestEmail", "Email for your receipt", { error: errors.guestEmail, optional: true, autocomplete: "email", type: "email" })}
          <p style="margin:0;font-size:14px" class="muted">Have an account? <button class="link-btn" type="button" data-details="signin" style="min-height:32px;padding:0">Sign in</button></p>
        </div></div>`;
    }
    return `<div class="panel co-section ${errors.auth ? "has-error" : ""}" id="co-details"><h2>1 · Your details</h2>
      <form class="form-grid" data-signin novalidate>
        <div class="field"><label for="si-email">Email</label><input id="si-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div>
        <div class="field"><label for="si-pw">Password</label><input id="si-pw" name="password" type="password" autocomplete="current-password" required minlength="8" /></div>
        ${signInError ? `<p class="notice error" role="alert" style="margin:0">${esc(signInError)}</p>` : ""}
        <button class="btn btn-green" type="submit" ${signingIn ? "disabled" : ""}>${signingIn ? `<span class="spinner" aria-hidden="true" style="border-top-color:#fff"></span>Signing in…` : "Sign in"}</button>
        ${guestCheckoutAllowed()
          ? `<div class="or-rule">or</div><button class="btn btn-outline" type="button" data-details="guest">Continue as guest</button>`
          : `<p style="margin:0;font-size:14px" class="muted">New to Ivy? An account is needed to order. <button class="link-btn" type="button" data-create style="min-height:32px;padding:0">Create one</button> in under a minute.</p>`}
        ${errors.auth ? `<p class="field-error" role="alert" style="margin:0">${esc(errors.auth)}</p>` : ""}
      </form></div>`;
  };

  const addressSection = (): string => {
    const context = getContext();
    const when = whenLabel();
    const whenRow = `<div class="when-row"><span><span class="muted">${esc(when.kicker)}:</span> <strong>${esc(when.label)}</strong></span><button class="link-btn" type="button" data-when>Change</button></div>`;
    if (context.mode === "pickup") {
      const kitchen = findKitchen(activeKitchenId());
      return `<div class="panel co-section"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px"><h2 style="margin:0">2 · Pickup</h2><button class="link-btn" type="button" data-area>Change</button></div>
        <div style="display:grid;gap:4px;font-size:15px"><strong>${esc(kitchen?.name ?? "")}</strong><span class="muted">${esc(kitchen?.address ?? "")}</span><span class="muted">Ready in about ${esc(pickupReadyText(kitchen?.id))}. Show your order number at the counter.</span></div>
        ${signedIn() ? `<div style="margin-top:14px">${phoneField("pickupPhone", "Phone", errors.pickupPhone, "We call this number if there's a problem with your order.")}</div>` : ""}
        ${whenRow}</div>`;
    }
    const area = findArea(context.areaId);
    const savedList = savedAddresses.length && signedIn()
      ? `<div role="radiogroup" aria-label="Delivery address" style="display:grid;gap:8px;margin-bottom:${addressChoice === "new" ? "14px" : "0"}">
          ${savedAddresses.map((address) => `<button class="radio-card" type="button" role="radio" aria-checked="${addressChoice === address.id}" data-address="${esc(address.id)}">
            <span class="radio-dot" aria-hidden="true"></span>
            <span class="grow"><b>${esc(address.label)}</b><span>${esc(address.address)}${address.landmark ? ` · ${esc(address.landmark)}` : ""}</span></span></button>`).join("")}
          <button class="radio-card" type="button" role="radio" aria-checked="${addressChoice === "new"}" data-address="new"><span class="radio-dot" aria-hidden="true"></span><span class="grow"><b>Use a new address</b></span></button>
        </div>`
      : "";
    const newForm = addressChoice === "new" || !signedIn()
      ? `<div class="form-grid">
          ${signedIn() ? `${field("recipientName", "Recipient name", { error: errors.recipientName, autocomplete: "name" })}
          ${phoneField("phone", "Phone", errors.phone, "The rider calls this number if they can't find you.")}` : ""}
          ${field("street", "Street address", { error: errors.street, autocomplete: "address-line1", placeholder: "e.g. 14 Kumasi Crescent" })}
          <div class="form-2">
            ${field("flat", "Flat or house no.", { optional: true, autocomplete: "address-line2" })}
            <div class="field"><label for="co-area">Area</label><input id="co-area" value="${esc(area?.name ?? "")}" readonly placeholder="Choose your area" ${errors.area ? `aria-invalid="true"` : ""} /></div>
          </div>
          ${errors.area ? `<p class="field-error" role="alert" style="margin:0">${esc(errors.area)} <button class="link-btn" type="button" data-area style="min-height:32px">Choose area</button></p>` : ""}
          ${field("landmark", "Nearest landmark", { error: errors.landmark, placeholder: "e.g. Opposite Banex Plaza", hint: "Riders in Abuja find you by landmark." })}
          ${field("instructions", "Notes for the rider", { optional: true, textarea: true, placeholder: "Gate colour, which floor, call on arrival…" })}
          ${signedIn() ? `<label class="check-line"><input type="checkbox" data-save-address ${form.saveAddress ? "checked" : ""} /> Save this address to my account</label>
            ${form.saveAddress ? field("addressLabel", "Address label", { error: errors.addressLabel, placeholder: "Home" }) : ""}` : ""}
        </div>`
      : "";
    return `<div class="panel co-section"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px"><h2 style="margin:0">2 · Delivery address</h2><button class="link-btn" type="button" data-area>Change area</button></div>
      ${savedList}${newForm}${whenRow}</div>`;
  };

  const paymentSection = (): string => {
    const delivery = getContext().mode === "delivery";
    const options: Array<{ id: PaymentMethod; label: string; sub: string; note: string }> = [
      { id: "on_delivery", label: delivery ? "Pay on delivery" : "Pay at the counter", sub: delivery ? "Cash or card by POS" : "Cash or card when you collect",
        note: delivery ? "Pay the rider with cash or card. Please have the exact amount ready if paying cash." : "Pay with cash or card when you collect." },
      ...(payments().transfer ? [{ id: "transfer" as const, label: "Bank transfer", sub: "Pay from your banking app", note: "We'll show our account details after you place the order. Transfer within 30 minutes and we start cooking once it lands." }] : []),
    ];
    const chosen = options.find((option) => option.id === paymentMethod) ?? options[0]!;
    return `<div class="panel co-section"><h2>3 · Payment</h2>
      <div role="radiogroup" aria-label="Payment method" style="display:grid;gap:8px">
        ${options.map((option) => `<button class="radio-card" type="button" role="radio" aria-checked="${option.id === chosen.id}" data-pay="${option.id}"><span class="radio-dot" aria-hidden="true"></span><span class="grow"><b>${esc(option.label)}</b><span>${esc(option.sub)}</span></span></button>`).join("")}
      </div>
      <p class="muted" style="margin:14px 0 0;font-size:14px;line-height:1.6">${esc(chosen.note)}</p>
      <p class="muted" style="margin:8px 0 0;font-size:13px">Card payments are coming soon.</p>
    </div>`;
  };

  const summarySection = (): string => {
    const quote = latestQuote();
    const blocked = blockers();
    const closed = !canOrderNow();
    return `<div class="panel sticky" style="display:grid;gap:14px">
      <h2 style="font-size:22px">Order summary</h2>
      <div class="summary-lines">${basketLines().map((line, index) => {
        const item = findItem(line.menuItemId);
        const quoted = quote?.lines[index];
        const total = quoted && quoted.menuItemId === line.menuItemId && quoted.quantity === line.quantity ? quoted.lineTotalMinor : item ? unitPriceMinor(item, line) * line.quantity : 0;
        const options = item ? describeBasketLine(item, line) : "";
        return `<div class="summary-line"><span><strong>${line.quantity} × ${esc(item?.name ?? "Item")}</strong>${options ? `<small>${esc(options)}</small>` : ""}</span><span>${esc(money(total))}</span></div>`;
      }).join("")}</div>
      <div class="divider">${summaryMarkup()}</div>
      ${topError ? `<div class="notice error" role="alert">${topError}</div>` : ""}
      ${blocked ? `<p class="notice warn" role="status" style="margin:0">${esc(blocked)}</p>` : ""}
      ${!blocked && closed ? `<div class="notice warn" role="status">We're closed right now. <button class="link-btn" type="button" data-when style="min-height:32px;padding:0;color:var(--warn-ink)">Choose a later time</button> to pre-order.</div>` : ""}
      <button class="btn btn-gold" type="button" data-place style="min-height:56px;font-size:16px" ${placing || blocked || closed ? "disabled" : ""} aria-busy="${placing}">
        ${placing ? `<span class="spinner" aria-hidden="true"></span>Placing order…` : `Place order${quote ? ` · ${esc(money(quote.totalMinor, quote.currency))}` : ""}`}
      </button>
      <p class="legal">By placing this order you agree to our terms. Allergen information is on the menu.</p>
    </div>`;
  };

  const render = (): void => {
    if (!basketLines().length && !placing) {
      navigate("/basket", { replace: true });
      return;
    }
    const focused = document.activeElement as HTMLElement | null;
    const focusedField = focused?.dataset?.field;
    const focusedId = focused?.id;
    const profile = currentProfile();
    if (!form.recipientName && profile) form.recipientName = profile.displayName;
    view.innerHTML = `
      <section class="wrap checkout-page ${view.dataset.rendered ? "" : "view"}">
        <a class="back-link" href="/basket">← Basket</a>
        <h1 class="page-title" tabindex="-1" data-page-heading style="margin:8px 0 24px">Checkout</h1>
        <div class="co-grid">
          <div class="stack" style="gap:18px">${detailsSection()}${addressSection()}${paymentSection()}</div>
          ${summarySection()}
        </div>
      </section>`;
    view.dataset.rendered = "1";
    const email = view.querySelector<HTMLInputElement>("#si-email");
    const password = view.querySelector<HTMLInputElement>("#si-pw");
    if (email && password) {
      email.value = signInDraft.email;
      password.value = signInDraft.password;
    }
    if (focusedField) view.querySelector<HTMLElement>(`[data-field="${focusedField}"]`)?.focus();
    else if (focusedId === "si-email" || focusedId === "si-pw") view.querySelector<HTMLElement>(`#${focusedId}`)?.focus();
    void loadAddresses();
  };

  const validate = (): boolean => {
    errors = {};
    const context = getContext();
    if (!signedIn() && !asGuest()) errors.auth = guestCheckoutAllowed() ? "Sign in or continue as a guest to place your order." : "Sign in to place your order.";
    if (asGuest()) {
      if (!form.guestName.trim()) errors.guestName = "Enter your name.";
      if (nationalDigits(form.guestPhone).length !== 10) errors.guestPhone = phoneError;
      if (form.guestEmail.trim() && !/^\S+@\S+\.\S+$/.test(form.guestEmail.trim())) errors.guestEmail = "Check your email address.";
    }
    if (context.mode === "pickup" && signedIn() && nationalDigits(form.pickupPhone).length !== 10) errors.pickupPhone = phoneError;
    if (context.mode === "delivery") {
      if (!isLocated()) errors.area = "Choose your delivery area.";
      if (addressChoice === "new" || !signedIn()) {
        if (signedIn()) {
          if (!form.recipientName.trim()) errors.recipientName = "Enter the name of the person receiving the order.";
          if (nationalDigits(form.phone).length !== 10) errors.phone = phoneError;
        }
        if (!form.street.trim()) errors.street = "Enter a street address so the rider can find you.";
        if (!form.landmark.trim()) errors.landmark = "Add a nearby landmark, e.g. a plaza, church or school.";
        if (form.saveAddress && !form.addressLabel.trim()) errors.addressLabel = "Give this address a short label, like Home.";
      }
    }
    return Object.keys(errors).length === 0;
  };

  const placeOrder = async (): Promise<void> => {
    if (placing || blockers() || !canOrderNow()) return;
    topError = "";
    if (!validate()) {
      render();
      view.querySelector<HTMLElement>("[aria-invalid='true'], #co-details input")?.focus();
      return;
    }
    const context = getContext();
    const area = findArea(context.areaId);
    const kitchen = findKitchen(activeKitchenId());
    const saved = signedIn() ? savedAddresses.find((address) => address.id === addressChoice) : undefined;
    const guestContact = asGuest() ? { name: form.guestName.trim(), phone: `+234 ${nationalDigits(form.guestPhone)}`, email: form.guestEmail.trim() || undefined } : undefined;
    const delivery = context.mode !== "delivery" ? undefined : saved
      ? { recipientName: saved.recipientName, phone: saved.phone, address: saved.address, landmark: saved.landmark ?? "", instructions: saved.instructions ?? "" }
      : {
          recipientName: guestContact?.name ?? form.recipientName.trim(),
          phone: guestContact?.phone ?? `+234 ${nationalDigits(form.phone)}`,
          address: [form.flat.trim(), form.street.trim(), area?.name, "Abuja"].filter(Boolean).join(", "),
          landmark: form.landmark.trim(),
          instructions: form.instructions.trim(),
        };
    const contact = guestContact ?? (context.mode === "pickup" ? { name: currentProfile()?.displayName, phone: `+234 ${nationalDigits(form.pickupPhone)}` } : undefined);
    const lines = [...basketLines()];
    const quote = latestQuote();
    const when = context.when;
    placing = true;
    render();
    try {
      const response = await fetch(apiUrl("/api/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          idempotencyKey: checkoutKey(),
          items: lines,
          ...pricingContext(),
          scheduledFor: when === "now" ? undefined : when.at,
          paymentMethod,
          delivery,
          contact,
          saveAddress: !!delivery && !saved && form.saveAddress,
          addressLabel: form.addressLabel.trim() || "Home",
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        orderNumber?: string; error?: string; existingOrderNumber?: string; guestToken?: string; totalMinor?: number; currency?: string;
        transfer?: PlacedOrder["transfer"];
      };
      if (response.status === 401) {
        placing = false;
        errors = { auth: "Your session expired. Sign in again to place this order." };
        render();
        return;
      }
      if (!response.ok || !result.orderNumber) {
        if (response.status === 409 && /slot/i.test(result.error ?? "")) {
          // The slot filled up: refresh the slots and ask for a new time.
          setContext({ when: "now" });
          void loadConfig();
        }
        const existing = result.existingOrderNumber
          ? ` <a href="/track/${encodeURIComponent(result.existingOrderNumber)}">Track order ${esc(result.existingOrderNumber)}</a>.`
          : "";
        throw Object.assign(new Error(result.error ?? "We couldn't place your order."), { html: existing });
      }
      if (result.guestToken) saveOrderToken(result.orderNumber, result.guestToken);
      const firstName = (delivery?.recipientName ?? contact?.name ?? "").split(/\s+/)[0] ?? "";
      const order: PlacedOrder = {
        orderNumber: result.orderNumber,
        firstName: firstName.slice(0, 40),
        lines: lines.map((line, index) => {
          const item = findItem(line.menuItemId);
          const quoted = quote?.lines[index];
          return {
            name: `${line.quantity} × ${item?.name ?? quoted?.name ?? "Item"}`,
            options: item ? describeBasketLine(item, line) : quoted?.summary ?? "",
            totalMinor: quoted?.lineTotalMinor ?? (item ? unitPriceMinor(item, line) * line.quantity : 0),
          };
        }),
        totalMinor: result.totalMinor ?? quote?.totalMinor ?? 0,
        currency: result.currency ?? quote?.currency ?? "NGN",
        destination: delivery ? `Delivering to ${delivery.address}` : `Collect from ${kitchen?.name ?? "the kitchen"}, ${kitchen?.address ?? ""}`,
        eta: delivery ? area?.eta ?? "" : pickupReadyText(kitchen?.id).replace(" min", ""),
        delivery: !!delivery,
        placedAt: new Date().toISOString(),
        paymentMethod,
        scheduledLabel: when === "now" ? null : when.label,
        transfer: result.transfer ?? null,
      };
      saveLastOrder(order);
      clearBasket();
      setContext({ when: "now" });
      navigate(`/order/${encodeURIComponent(order.orderNumber)}`, { replace: true });
    } catch (error) {
      placing = false;
      topError = error instanceof TypeError
        ? "We couldn't reach the kitchen. Check your connection and try again. You won't be charged twice."
        : `${esc(error instanceof Error ? error.message : "We couldn't place your order.")}${(error as { html?: string }).html ?? ""}`;
      render();
    }
  };

  const onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.id === "si-email") signInDraft.email = target.value;
    if (target.id === "si-pw") signInDraft.password = target.value;
    const name = target.dataset.field as FieldName | undefined;
    if (name) {
      form[name] = target.value;
      if (errors[name]) {
        delete errors[name];
        target.removeAttribute("aria-invalid");
        target.closest(".field")?.querySelector(".field-error")?.remove();
      }
    }
    if (target.matches("[data-save-address]") && event.type === "change") {
      form.saveAddress = target.checked;
      render();
    }
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-place]")) return void placeOrder();
    if (target.closest("[data-area]")) return openAreaSheet();
    if (target.closest("[data-when]")) return openScheduleSheet();
    if (target.closest("[data-create]")) return openAccount("signup");
    if (target.closest("[data-requote]")) return refreshQuote();
    if (target.closest("[data-sign-out]")) return void ivyAuth.auth.signOut();
    const details = target.closest<HTMLElement>("[data-details]")?.dataset.details;
    if (details === "guest" || details === "signin") {
      detailsMode = details;
      errors = {};
      render();
      view.querySelector<HTMLElement>(details === "guest" ? "#co-guestName" : "#si-email")?.focus();
      return;
    }
    const pay = target.closest<HTMLElement>("[data-pay]")?.dataset.pay;
    if (pay === "on_delivery" || pay === "transfer") {
      paymentMethod = pay;
      render();
      view.querySelector<HTMLElement>(`[data-pay="${pay}"]`)?.focus();
      return;
    }
    const address = target.closest<HTMLElement>("[data-address]")?.dataset.address;
    if (address) {
      addressChoice = address;
      render();
      view.querySelector<HTMLElement>(`[data-address="${CSS.escape(address)}"]`)?.focus();
    }
  };

  const onSubmit = async (event: Event): Promise<void> => {
    const signInForm = (event.target as HTMLElement).closest<HTMLFormElement>("[data-signin]");
    if (!signInForm) return;
    event.preventDefault();
    if (!signInDraft.email.trim() || !signInDraft.password) {
      signInError = "Enter your email and password.";
      render();
      return;
    }
    signingIn = true;
    signInError = "";
    render();
    const failure = await signIn(signInDraft.email.trim(), signInDraft.password);
    signingIn = false;
    signInError = failure ?? "";
    signInDraft.password = "";
    if (!failure) errors = {};
    render();
  };

  delete view.dataset.rendered;
  render();
  view.addEventListener("input", onInput);
  view.addEventListener("change", onInput);
  view.addEventListener("click", onClick);
  view.addEventListener("submit", onSubmit);
  const rerender = (): void => {
    if (!placing) render();
  };
  const stops = [onBasketChange(rerender), onMenuChange(rerender), onContextChange(rerender), onConfigChange(rerender), onAccountChange(() => {
    if (!currentSession()) {
      savedAddresses = [];
      addressesFor = null;
      addressChoice = "new";
    }
    rerender();
  })];
  return () => {
    stops.forEach((stop) => stop());
    view.removeEventListener("input", onInput);
    view.removeEventListener("change", onInput);
    view.removeEventListener("click", onClick);
    view.removeEventListener("submit", onSubmit);
    delete view.dataset.rendered;
  };
}
