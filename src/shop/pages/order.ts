import { apiUrl } from "../../api.js";
import { currentSession, onAccountChange, openAccount, sessionRestored } from "../account.js";
import { esc, money } from "../format.js";
import { navigate } from "../router.js";
import { showToast } from "../toast.js";
import { abujaClock, arrivalWindow, kitchenPhone } from "../zones.js";
import { latestGuestOrderNumber, orderToken, readLastOrder } from "./order-store.js";

interface TransferInfo { bankName: string; accountNumber: string; accountName: string; dueAt: string | null; reportedAt?: string | null }

interface TrackingView {
  orderNumber: string;
  mode: "delivery" | "pickup";
  fulfillmentStatus: string;
  paymentStatus: string;
  paymentMethod: "on_delivery" | "transfer" | "card";
  createdAt: string;
  scheduledFor: string | null;
  statusReason: string | null;
  preparingSince: string | null;
  readyMinutes: { min: number; max: number } | null;
  eta: { min: number; max: number } | null;
  store: { name: string; address: string } | null;
  area: string | null;
  recipientFirstName: string | null;
  items: Array<{ name: string; summary: string; quantity: number; lineTotalMinor: number }>;
  currency: string;
  totalMinor: number;
  transfer: TransferInfo | null;
  rider: { firstName: string } | null;
  kitchenPhone: string | null;
}

function tokenHeaders(orderNumber: string): Record<string, string> {
  const token = orderToken(orderNumber);
  return token ? { "X-Order-Token": token } : {};
}

async function reportTransfer(orderNumber: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(apiUrl(`/api/orders/${encodeURIComponent(orderNumber)}/transfer-reported`), { method: "POST", credentials: "include", headers: tokenHeaders(orderNumber) });
    if (response.ok) return { ok: true };
    const result = await response.json().catch(() => ({})) as { error?: string };
    return { ok: false, message: result.error ?? "We couldn't record that. Please try again." };
  } catch {
    return { ok: false, message: "We couldn't reach the kitchen. Check your connection and try again." };
  }
}

function countdown(dueAt: string): string {
  const seconds = Math.max(0, Math.round((new Date(dueAt).getTime() - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function transferCard(total: string, transfer: TransferInfo, orderNumber: string): string {
  return `<div class="panel" style="margin-top:18px;border:1.5px solid var(--gold)" data-transfer>
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap"><h2 style="font-size:24px">Transfer ${esc(total)}</h2>${transfer.dueAt ? `<span style="font-weight:800;color:var(--gold-ink)" aria-live="off"><span data-countdown="${esc(transfer.dueAt)}">${esc(countdown(transfer.dueAt))}</span> left</span>` : ""}</div>
    <div style="display:grid;gap:8px;margin:16px 0;font-size:15px">
      <div class="sum-row"><span class="muted">Bank</span><strong>${esc(transfer.bankName)}</strong></div>
      <div class="sum-row"><span class="muted">Account number</span><strong style="letter-spacing:.06em">${esc(transfer.accountNumber)}</strong></div>
      <div class="sum-row"><span class="muted">Account name</span><strong>${esc(transfer.accountName)}</strong></div>
      <div class="sum-row"><span class="muted">Reference</span><strong>${esc(orderNumber)}</strong></div>
    </div>
    <p class="muted" style="margin:0 0 14px;font-size:13px">Use your order number as the reference. Orders not paid within 30 minutes are cancelled.</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      <button class="btn btn-outline" type="button" data-copy="${esc(transfer.accountNumber)}">Copy account number</button>
      <button class="btn btn-green" type="button" data-sent>I've sent it</button>
    </div>
  </div>`;
}

export function renderConfirmation(view: HTMLElement, orderNumber: string): () => void {
  const order = readLastOrder(orderNumber);
  const trackHref = `/track/${encodeURIComponent(orderNumber)}`;
  if (!order) {
    view.innerHTML = `
      <section class="narrow-page view">
        <div class="conf-hero"><p class="kicker">Order ${esc(orderNumber)}</p><h1 tabindex="-1" data-page-heading>Your order is in.</h1><p>You can follow it from the kitchen to your door.</p></div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:22px"><a class="btn btn-gold" href="${trackHref}" style="min-height:54px">Track order</a><a class="btn btn-outline" href="/menu" style="min-height:54px">Back to menu</a></div>
      </section>`;
    return () => undefined;
  }
  const transfer = order.paymentMethod === "transfer" && order.transfer ? order.transfer : null;
  const [low, high] = order.eta.split("–").map(Number);
  const window_ = low && high && !order.scheduledLabel ? arrivalWindow(new Date(order.placedAt), { min: low, max: high }) : null;
  const total = money(order.totalMinor, order.currency);
  const body = transfer
    ? `Transfer the total below and we start cooking as soon as it arrives.${order.scheduledLabel ? ` Your order is booked for ${order.scheduledLabel.toLowerCase()}.` : ""}`
    : order.scheduledLabel
      ? `Your order is booked for ${order.scheduledLabel.toLowerCase().startsWith("today") || order.scheduledLabel.toLowerCase().startsWith("tomorrow") ? order.scheduledLabel.toLowerCase() : order.scheduledLabel}.`
      : order.delivery
        ? `Your order is in. It should arrive in ${order.eta} minutes${window_ ? ` (around ${window_})` : ""}.`
        : `Your order is in. It will be ready to collect in about ${order.eta} minutes.`;
  view.innerHTML = `
    <section class="narrow-page view">
      <div class="conf-hero">
        <p class="kicker">Order ${esc(order.orderNumber)}</p>
        <h1 tabindex="-1" data-page-heading>${transfer ? "Almost there" : "Thank you"}${order.firstName ? `, ${esc(order.firstName)}` : ""}.</h1>
        <p>${esc(body)}</p>
      </div>
      ${transfer ? transferCard(total, transfer, order.orderNumber) : ""}
      <div class="panel" style="margin-top:18px;display:grid;gap:10px">
        ${order.lines.map((line) => `<div class="summary-line" style="font-size:15px"><span>${esc(line.name)}${line.options ? `<small>${esc(line.options)}</small>` : ""}</span><span>${esc(money(line.totalMinor, order.currency))}</span></div>`).join("")}
        <div class="sum-total"><span>${transfer ? "Total to transfer" : `Total to pay ${order.delivery ? "on delivery" : "at the counter"}`}</span><span>${esc(total)}</span></div>
        <p class="muted" style="margin:6px 0 0;font-size:14px">${esc(order.destination)}</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:22px">
        <a class="btn btn-gold" href="${trackHref}" style="min-height:54px;padding:0 28px">Track order</a>
        <a class="btn btn-outline" href="/menu" style="min-height:54px">Back to menu</a>
      </div>
    </section>`;

  const timer = window.setInterval(() => {
    view.querySelectorAll<HTMLElement>("[data-countdown]").forEach((element) => { element.textContent = countdown(element.dataset.countdown!); });
  }, 1000);
  const onClick = async (event: Event): Promise<void> => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>("[data-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy!);
        copy.textContent = "Copied";
      } catch {
        showToast({ text: `Account number: ${copy.dataset.copy}` });
      }
      return;
    }
    const sent = target.closest<HTMLButtonElement>("[data-sent]");
    if (sent) {
      sent.disabled = true;
      const result = await reportTransfer(orderNumber);
      if (result.ok) navigate(trackHref);
      else {
        sent.disabled = false;
        showToast({ text: result.message ?? "Please try again." });
      }
    }
  };
  view.addEventListener("click", onClick);
  return () => {
    window.clearInterval(timer);
    view.removeEventListener("click", onClick);
  };
}

function stepsFor(view: TrackingView): { steps: Array<{ label: string; desc: string }>; index: number } {
  const pickup = view.mode === "pickup";
  const steps = [
    { label: "Order received", desc: view.paymentMethod === "transfer" && view.paymentStatus === "pending" ? "We'll start as soon as your transfer arrives." : view.scheduledFor ? `Booked for ${abujaClock(new Date(view.scheduledFor))}.` : "Waiting for the kitchen to accept your order." },
    { label: "Preparing", desc: "Fresh dough is being stretched and topped." },
    { label: "In the oven", desc: pickup ? "About 7 minutes in our stone oven." : view.fulfillmentStatus === "ready_for_delivery" ? "Boxed and waiting for your rider." : "About 7 minutes in our stone oven." },
    pickup ? { label: "Ready for pickup", desc: "Head to the counter and give your order number." } : { label: "Out for delivery", desc: "Your rider has left the kitchen." },
    pickup ? { label: "Collected", desc: "Enjoy your meal." } : { label: "Delivered", desc: "Enjoy your meal." },
  ];
  let index = 0;
  switch (view.fulfillmentStatus) {
    case "preparing": {
      // The second half of the expected preparation time is shown as the oven stage.
      const since = view.preparingSince ? Date.now() - new Date(view.preparingSince).getTime() : 0;
      index = since > ((view.readyMinutes?.min ?? 15) / 2) * 60_000 ? 2 : 1;
      break;
    }
    case "ready_for_delivery": index = pickup ? 3 : 2; break;
    case "out_for_delivery": index = 3; break;
    case "delivered": index = 4; break;
  }
  return { steps, index };
}

const exits: Record<string, { title: string; body: string }> = {
  rejected: { title: "The kitchen couldn't take this order", body: "You haven't been charged. Please try again later, or choose different items." },
  cancelled: { title: "This order was cancelled", body: "You haven't been charged for this order." },
  delivery_exception: { title: "There's a problem with your delivery", body: "Our team will call you on the number you gave us." },
};

const terminal = new Set(["delivered", "rejected", "cancelled", "delivery_exception"]);

export function renderTracker(view: HTMLElement, initialNumber: string | null): () => void {
  let orderNumber = initialNumber ?? latestGuestOrderNumber();
  let order: TrackingView | null = null;
  let status: "loading" | "lookup" | "error" | "live" = orderNumber ? "loading" : "lookup";
  let lookupPhone = "";
  let lookupError = "";
  let errorMessage = "";
  let timer: number | undefined;
  let stopped = false;
  let countdownTimer: number | undefined;
  // Rating a delivered order (signed-in customers only; reviews belong to an account).
  let stars = 0;
  let ratingState: "idle" | "sending" | "sent" | "error" = "idle";
  let ratingError = "";

  const help = (): string => {
    const phone = order?.kitchenPhone ?? kitchenPhone();
    return phone ? `<p class="muted" style="margin:24px 0 0;font-size:14px">Problem with your order? Call the kitchen on <a href="tel:${esc(phone.replace(/\s/g, ""))}" style="font-weight:800">${esc(phone)}</a>.</p>` : "";
  };

  const render = (): void => {
    window.clearInterval(countdownTimer);
    const kicker = orderNumber ? `<p class="kicker">Order ${esc(orderNumber)}</p>` : `<p class="kicker">Track an order</p>`;
    if (status === "loading") {
      view.innerHTML = `<section class="narrow-page view" aria-busy="true">${kicker}<h1 class="tr-title" tabindex="-1" data-page-heading>Finding your order…</h1><div class="tr-bar"><i style="width:8%"></i></div></section>`;
      return;
    }
    if (status === "lookup") {
      view.innerHTML = `<section class="narrow-page view">${kicker}
        <h1 class="tr-title" tabindex="-1" data-page-heading>Find your order</h1>
        <p class="tr-eta">Enter the order number from your confirmation and the phone number you ordered with.</p>
        <form class="panel form-grid" data-lookup novalidate style="margin-top:22px">
          <div class="field"><label for="lk-number">Order number</label><input id="lk-number" name="orderNumber" value="${esc(orderNumber ?? "")}" placeholder="IVY-00000123" autocapitalize="characters" required /></div>
          <div class="field"><label for="lk-phone">Phone</label><div class="phone-input"><span aria-hidden="true">+234</span><input id="lk-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="803 123 4567" value="${esc(lookupPhone)}" required /></div></div>
          ${lookupError ? `<p class="notice error" role="alert" style="margin:0">${esc(lookupError)}</p>` : ""}
          <button class="btn btn-gold" type="submit">Find my order</button>
          ${currentSession() ? "" : `<p class="muted" style="margin:0;font-size:14px">Ordered with an account? <button class="link-btn" type="button" data-sign-in style="min-height:32px;padding:0">Sign in</button> to see all your orders.</p>`}
        </form></section>`;
      return;
    }
    if (status === "error") {
      view.innerHTML = `<section class="narrow-page view">${kicker}<h1 class="tr-title" tabindex="-1" data-page-heading>We couldn't load your order</h1><p class="tr-eta">${esc(errorMessage)}</p><div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:22px"><button class="btn btn-gold" type="button" data-retry>Try again</button><a class="btn btn-outline" href="/menu">Back to menu</a></div>${help()}</section>`;
      return;
    }
    const current = order!;
    const exit = exits[current.fulfillmentStatus];
    const { steps, index } = stepsFor(current);
    const created = new Date(current.createdAt);
    const eta = current.fulfillmentStatus === "delivered"
      ? current.mode === "pickup" ? "Collected. Enjoy your meal." : "Delivered. Enjoy your meal."
      : current.scheduledFor ? `Booked for ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long" }).format(new Date(current.scheduledFor))} at ${abujaClock(new Date(current.scheduledFor))}`
      : current.mode === "delivery" && current.eta ? `Estimated arrival ${arrivalWindow(created, current.eta)}`
      : current.readyMinutes ? `Ready around ${abujaClock(new Date(created.getTime() + current.readyMinutes.max * 60_000))}` : `Placed at ${abujaClock(created)}`;
    const transferPending = current.transfer && !current.transfer.reportedAt && current.fulfillmentStatus === "awaiting_acceptance";
    view.innerHTML = `
      <section class="narrow-page ${view.dataset.rendered ? "" : "view"}">
        ${kicker}
        <h1 class="tr-title" tabindex="-1" data-page-heading aria-live="polite">${esc(exit ? exit.title : transferPending ? "Waiting for your transfer" : steps[index]!.label)}</h1>
        <p class="tr-eta">${esc(exit ? (current.statusReason === "Bank transfer not received in time" ? "We didn't receive your transfer within 30 minutes, so the order was cancelled. You haven't been charged." : exit.body) : eta)}</p>
        ${transferPending ? transferCard(money(current.totalMinor, current.currency), current.transfer!, current.orderNumber) : ""}
        ${current.transfer?.reportedAt && current.paymentStatus === "pending" ? `<p class="notice info" style="margin:16px 0 0">Thanks. We're checking your transfer and will start cooking as soon as it's confirmed.</p>` : ""}
        ${exit ? "" : `
          <div class="tr-bar" role="progressbar" aria-label="Order progress" aria-valuemin="0" aria-valuemax="${steps.length - 1}" aria-valuenow="${index}"><i style="width:${Math.max(6, Math.round((index / (steps.length - 1)) * 100))}%"></i></div>
          <ol class="tr-steps">${steps.map((step, position) => `
            <li class="${position <= index ? "done" : ""} ${position === index ? "current" : ""}" ${position === index ? `aria-current="step"` : ""}>
              <div class="tr-rail" aria-hidden="true"><i></i><b></b></div>
              <div class="tr-step-text"><strong>${esc(step.label)}</strong>${position === index ? `<span>${esc(step.desc)}</span>` : ""}</div>
            </li>`).join("")}</ol>`}
        ${current.rider ? `<div class="panel" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;background:var(--green);color:var(--cream);border:0;animation:ivyUp .4s ease"><div style="display:grid;gap:2px"><strong>${esc(current.rider.firstName)} is on the way</strong><span style="font-size:14px;color:var(--on-dark)">Your Ivy rider will call when they arrive.</span></div></div>` : ""}
        <div class="panel" style="display:grid;gap:8px;margin-top:8px">
          ${current.items.map((item) => `<div class="summary-line"><span><strong>${item.quantity} × ${esc(item.name)}</strong>${item.summary ? `<small>${esc(item.summary)}</small>` : ""}</span><span>${esc(money(item.lineTotalMinor, current.currency))}</span></div>`).join("")}
          <div class="sum-total"><span>${current.paymentStatus === "paid" ? "Paid" : current.paymentMethod === "transfer" ? "Bank transfer" : current.mode === "pickup" ? "Pay at the counter" : "Pay on delivery"}</span><span>${esc(money(current.totalMinor, current.currency))}</span></div>
          <p class="muted" style="margin:0;font-size:14px">${current.mode === "pickup" ? `Collect from ${esc(current.store?.name ?? "the kitchen")}, ${esc(current.store?.address ?? "")}` : `Delivering to ${esc(current.area ?? "")}`}</p>
        </div>
        ${current.fulfillmentStatus === "delivered" && currentSession() && !orderToken(current.orderNumber) ? (ratingState === "sent"
          ? `<p class="notice ok" role="status" style="margin:16px 0 0">Thanks for rating your order. It helps the kitchen get every order right.</p>`
          : `<form class="panel acct-rating" data-rate-form novalidate style="margin-top:16px;border-top:1px solid var(--line)">
              <p style="margin:0 0 8px;font-weight:800">How was it?</p>
              <div class="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((value) => `<button type="button" role="radio" aria-checked="${value === stars}" aria-label="${value} star${value > 1 ? "s" : ""}" data-star="${value}" class="${value <= stars ? "on" : ""}">★</button>`).join("")}</div>
              <div class="field" style="margin-top:10px"><label for="tr-review">Anything to tell the kitchen? <span class="opt-tag">(optional)</span></label><textarea id="tr-review" name="body" maxlength="1000"></textarea></div>
              ${ratingError ? `<p class="field-error" role="alert">${esc(ratingError)}</p>` : ""}
              <button class="btn btn-gold btn-sm" type="submit" style="margin-top:10px" ${ratingState === "sending" ? "disabled" : ""}>Send rating</button>
            </form>`) : ""}
        ${terminal.has(current.fulfillmentStatus) ? "" : `<p class="muted" style="margin:16px 0 0;font-size:13px">This page updates by itself.</p>`}
        ${help()}
      </section>`;
    view.dataset.rendered = "1";
    countdownTimer = window.setInterval(() => {
      view.querySelectorAll<HTMLElement>("[data-countdown]").forEach((element) => { element.textContent = countdown(element.dataset.countdown!); });
    }, 1000);
  };

  const fetchView = async (): Promise<TrackingView | "notFound"> => {
    if (lookupPhone) {
      const response = await fetch(apiUrl("/api/orders/lookup"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumber, phone: lookupPhone }) });
      if (response.status === 404) return "notFound";
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Please try again.");
      return response.json() as Promise<TrackingView>;
    }
    const response = await fetch(apiUrl(`/api/orders/${encodeURIComponent(orderNumber!)}`), { credentials: "include", headers: tokenHeaders(orderNumber!) });
    if (response.status === 404 || response.status === 400) return "notFound";
    if (!response.ok) throw new Error("Please try again.");
    return response.json() as Promise<TrackingView>;
  };

  const poll = async (): Promise<void> => {
    window.clearTimeout(timer);
    if (stopped || !orderNumber || status === "lookup") return;
    // Wait for the session check so signed-in customers aren't sent to the lookup form.
    if (!sessionRestored() && !orderToken(orderNumber) && !lookupPhone) return;
    if (document.visibilityState === "visible" || status === "loading") {
      try {
        const result = await fetchView();
        if (stopped) return;
        if (result === "notFound") {
          if (status !== "live") {
            status = "lookup";
            lookupError = lookupPhone ? "We couldn't find an order with that number and phone. Check both and try again." : "";
          }
        } else {
          order = result;
          status = "live";
        }
      } catch (error) {
        if (stopped) return;
        if (status !== "live") {
          status = "error";
          errorMessage = error instanceof TypeError ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again.";
        }
      }
      render();
    }
    if (status === "live" && order && !terminal.has(order.fulfillmentStatus)) timer = window.setTimeout(() => void poll(), 15_000);
  };

  const onClick = async (event: Event): Promise<void> => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-sign-in]")) openAccount("signin", "Sign in to follow your order.");
    const star = target.closest<HTMLElement>("[data-star]");
    if (star) {
      const body = view.querySelector<HTMLTextAreaElement>("#tr-review")?.value ?? "";
      stars = Number(star.dataset.star);
      ratingError = "";
      render();
      const textarea = view.querySelector<HTMLTextAreaElement>("#tr-review");
      if (textarea) textarea.value = body;
      view.querySelector<HTMLElement>(`[data-star="${stars}"]`)?.focus();
      return;
    }
    if (target.closest("[data-retry]")) {
      status = "loading";
      render();
      void poll();
    }
    const copy = target.closest<HTMLButtonElement>("[data-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy!);
        copy.textContent = "Copied";
      } catch {
        showToast({ text: `Account number: ${copy.dataset.copy}` });
      }
    }
    const sent = target.closest<HTMLButtonElement>("[data-sent]");
    if (sent && orderNumber) {
      sent.disabled = true;
      const result = await reportTransfer(orderNumber);
      if (!result.ok) {
        sent.disabled = false;
        showToast({ text: result.message ?? "Please try again." });
      }
      void poll();
    }
  };

  const onSubmit = (event: Event): void => {
    const rateForm = (event.target as HTMLElement).closest<HTMLFormElement>("[data-rate-form]");
    if (rateForm && orderNumber) {
      event.preventDefault();
      if (!stars) {
        ratingError = "Choose from 1 to 5 stars.";
        return render();
      }
      ratingState = "sending";
      const body = String(new FormData(rateForm).get("body") ?? "");
      void fetch(apiUrl(`/api/customer/orders/${encodeURIComponent(orderNumber)}/review`), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: stars, body }) })
        .then(async (response) => {
          if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "We couldn't save your rating.");
          ratingState = "sent";
          ratingError = "";
        })
        .catch((error: unknown) => {
          ratingState = "error";
          ratingError = error instanceof Error ? error.message : "We couldn't save your rating.";
        })
        .finally(render);
      return;
    }
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-lookup]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const number = String(data.get("orderNumber") ?? "").trim().toUpperCase();
    const phone = String(data.get("phone") ?? "").trim();
    if (!/^IVY-\d{8}$/.test(number) || phone.replace(/\D/g, "").length < 10) {
      lookupError = "Enter your order number (like IVY-00000123) and the 10-digit phone number on the order.";
      lookupPhone = phone;
      render();
      return;
    }
    orderNumber = number;
    lookupPhone = phone;
    lookupError = "";
    window.history.replaceState({}, "", `/track/${encodeURIComponent(number)}`);
    status = "loading";
    render();
    void poll();
  };

  const onVisible = (): void => {
    if (document.visibilityState === "visible" && status === "live") void poll();
  };

  delete view.dataset.rendered;
  render();
  void poll();
  view.addEventListener("click", onClick);
  view.addEventListener("submit", onSubmit);
  document.addEventListener("visibilitychange", onVisible);
  const stopAccount = onAccountChange(() => {
    if (status === "lookup" && currentSession() && orderNumber) status = "loading";
    if (status === "loading") render();
    void poll();
  });
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearInterval(countdownTimer);
    stopAccount();
    view.removeEventListener("click", onClick);
    view.removeEventListener("submit", onSubmit);
    document.removeEventListener("visibilitychange", onVisible);
    delete view.dataset.rendered;
  };
}

export function renderNotFound(view: HTMLElement): void {
  view.innerHTML = `<section class="wrap view"><div class="state-box" style="margin-top:64px"><p class="kicker">404</p><h1 tabindex="-1" data-page-heading style="font-size:36px">This page isn't on the menu</h1><p>The link may be old, or the page has moved.</p><div class="state-actions"><a class="btn btn-gold" href="/menu">See the menu</a><a class="btn btn-outline" href="/">Home</a></div></div></section>`;
}
