import { currentSession, fetchDashboard, onAccountChange, openAccount, sessionRestored, type DashboardOrder } from "../account.js";
import { esc, money } from "../format.js";
import { kitchenPhone } from "../zones.js";
import { readLastOrder } from "./order-store.js";

function clock(date: Date): string {
  return new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "25–35" minutes after `placedAt` → "18:30–18:40" in Abuja time. */
function arrivalWindow(placedAt: string, eta: string): string | null {
  const [low, high] = eta.split(/[–-]/).map((part) => Number(part.trim()));
  const start = new Date(placedAt).getTime();
  if (!low || !high || Number.isNaN(start)) return null;
  return `${clock(new Date(start + low * 60_000))}–${clock(new Date(start + high * 60_000))}`;
}

export function renderConfirmation(view: HTMLElement, orderNumber: string): void {
  const order = readLastOrder(orderNumber);
  const trackHref = `/track/${encodeURIComponent(orderNumber)}`;
  if (!order) {
    view.innerHTML = `
      <section class="narrow-page view">
        <div class="conf-hero"><p class="kicker">Order ${esc(orderNumber)}</p><h1 tabindex="-1" data-page-heading>Your order is in.</h1><p>You can follow it from the kitchen to your door.</p></div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:22px"><a class="btn btn-gold" href="${trackHref}" style="min-height:54px">Track order</a><a class="btn btn-outline" href="/menu" style="min-height:54px">Back to menu</a></div>
      </section>`;
    return;
  }
  const window_ = order.delivery && order.eta ? arrivalWindow(order.placedAt, order.eta) : null;
  view.innerHTML = `
    <section class="narrow-page view">
      <div class="conf-hero">
        <p class="kicker">Order ${esc(order.orderNumber)}</p>
        <h1 tabindex="-1" data-page-heading>Thank you${order.firstName ? `, ${esc(order.firstName)}` : ""}.</h1>
        <p>${order.delivery
          ? `Your order is in. The kitchen will accept it shortly${order.eta ? ` and it should arrive in ${esc(order.eta)} minutes${window_ ? ` (around ${esc(window_)})` : ""}` : ""}.`
          : "Your order is in. It will be ready to collect in 15–20 minutes."}</p>
      </div>
      <div class="panel" style="margin-top:18px;display:grid;gap:10px">
        ${order.lines.map((line) => `<div class="summary-line" style="font-size:15px"><span>${esc(line.name)}${line.options ? `<small>${esc(line.options)}</small>` : ""}</span><span>${esc(money(line.totalMinor, order.currency))}</span></div>`).join("")}
        <div class="sum-total"><span>Total to pay ${order.delivery ? "on delivery" : "at the counter"}</span><span>${esc(money(order.totalMinor, order.currency))}</span></div>
        <p class="muted" style="margin:6px 0 0;font-size:14px">${esc(order.destination)}</p>
        <p class="muted" style="margin:0;font-size:14px">${order.delivery ? "Pay the rider with cash or card when your order arrives." : "Pay with cash or card when you collect."} We'll also show this order in your account.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:22px">
        <a class="btn btn-gold" href="${trackHref}" style="min-height:54px;padding:0 28px">Track order</a>
        <a class="btn btn-outline" href="/menu" style="min-height:54px">Back to menu</a>
      </div>
    </section>`;
}

const steps: Array<{ label: string; desc: string; statuses: string[] }> = [
  { label: "Order received", desc: "Waiting for the kitchen to accept your order.", statuses: ["awaiting_acceptance"] },
  { label: "Preparing", desc: "Fresh dough is being stretched and topped.", statuses: ["accepted", "preparing"] },
  { label: "Ready", desc: "Packed and waiting for your rider.", statuses: ["ready_for_delivery"] },
  { label: "Out for delivery", desc: "Your rider has left the kitchen.", statuses: ["out_for_delivery"] },
  { label: "Delivered", desc: "Enjoy your meal.", statuses: ["delivered"] },
];

const exits: Record<string, { title: string; body: string }> = {
  rejected: { title: "The kitchen couldn't take this order", body: "You haven't been charged. Please try again later, or choose different items." },
  cancelled: { title: "This order was cancelled", body: "You haven't been charged for this order." },
  delivery_exception: { title: "There's a problem with your delivery", body: "Our team will call you on the number you gave us." },
};

const terminal = new Set(["delivered", "rejected", "cancelled", "delivery_exception"]);

export function renderTracker(view: HTMLElement, orderNumber: string): () => void {
  let order: DashboardOrder | null = null;
  let status: "loading" | "signedOut" | "notFound" | "error" | "live" = "loading";
  let errorMessage = "";
  let timer: number | undefined;
  let stopped = false;
  const placed = readLastOrder(orderNumber);

  const render = (): void => {
    const kicker = `<p class="kicker">Order ${esc(orderNumber)}</p>`;
    const help = kitchenPhone ? `<p class="muted" style="margin:24px 0 0;font-size:14px">Problem with your order? Call the kitchen on <a href="tel:${esc(kitchenPhone.replace(/\s/g, ""))}" style="font-weight:800">${esc(kitchenPhone)}</a>.</p>` : "";
    if (status === "loading") {
      view.innerHTML = `<section class="narrow-page view" aria-busy="true">${kicker}<h1 class="tr-title" tabindex="-1" data-page-heading>Finding your order…</h1><div class="tr-bar"><i style="width:8%"></i></div></section>`;
      return;
    }
    if (status === "signedOut") {
      view.innerHTML = `<section class="narrow-page view">${kicker}<h1 class="tr-title" tabindex="-1" data-page-heading>Sign in to follow your order</h1><p class="tr-eta">Orders are linked to your Ivy account.</p><button class="btn btn-gold" type="button" data-sign-in style="margin-top:22px">Sign in</button></section>`;
      return;
    }
    if (status === "notFound" || status === "error") {
      view.innerHTML = `<section class="narrow-page view">${kicker}<h1 class="tr-title" tabindex="-1" data-page-heading>${status === "notFound" ? "We couldn't find this order" : "We couldn't load your order"}</h1><p class="tr-eta">${status === "notFound" ? "It isn't on the account you're signed in with." : esc(errorMessage)}</p><div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:22px">${status === "error" ? `<button class="btn btn-gold" type="button" data-retry>Try again</button>` : ""}<a class="btn btn-outline" href="/menu">Back to menu</a></div>${help}</section>`;
      return;
    }
    const current = order!;
    const exit = exits[current.fulfillmentStatus];
    const stepIndex = Math.max(0, steps.findIndex((step) => step.statuses.includes(current.fulfillmentStatus)));
    const createdAt = new Date(current.createdAt);
    const window_ = placed?.delivery && placed.eta ? arrivalWindow(placed.placedAt, placed.eta) : null;
    const eta = current.fulfillmentStatus === "delivered"
      ? "Delivered. Enjoy your meal."
      : window_ ? `Estimated arrival ${window_}` : `Placed at ${clock(createdAt)}`;
    view.innerHTML = `
      <section class="narrow-page ${view.dataset.rendered ? "" : "view"}">
        ${kicker}
        <h1 class="tr-title" tabindex="-1" data-page-heading aria-live="polite">${esc(exit ? exit.title : steps[stepIndex]!.label)}</h1>
        <p class="tr-eta">${esc(exit ? exit.body : eta)}</p>
        ${exit ? "" : `
          <div class="tr-bar" role="progressbar" aria-label="Order progress" aria-valuemin="0" aria-valuemax="${steps.length - 1}" aria-valuenow="${stepIndex}"><i style="width:${Math.max(6, Math.round((stepIndex / (steps.length - 1)) * 100))}%"></i></div>
          <ol class="tr-steps">${steps.map((step, index) => `
            <li class="${index <= stepIndex ? "done" : ""} ${index === stepIndex ? "current" : ""}" ${index === stepIndex ? `aria-current="step"` : ""}>
              <div class="tr-rail" aria-hidden="true"><i></i><b></b></div>
              <div class="tr-step-text"><strong>${esc(step.label)}</strong>${index === stepIndex ? `<span>${esc(step.desc)}</span>` : ""}</div>
            </li>`).join("")}</ol>`}
        <div class="panel" style="display:grid;gap:8px;margin-top:8px">
          <p style="margin:0;font-size:14px">${esc(current.items.map((item) => `${item.quantity}× ${item.name}`).join(", "))}</p>
          <p style="margin:0;font-weight:800">${esc(money(current.totalMinor, current.currency))} <span class="muted" style="font-weight:600">· ${current.paymentStatus === "paid" ? "Paid" : "Pay on delivery"}</span></p>
        </div>
        ${terminal.has(current.fulfillmentStatus) ? "" : `<p class="muted" style="margin:16px 0 0;font-size:13px">This page updates by itself.</p>`}
        ${help}
      </section>`;
    view.dataset.rendered = "1";
  };

  const poll = async (): Promise<void> => {
    window.clearTimeout(timer);
    if (stopped) return;
    if (!sessionRestored()) return;
    if (!currentSession()) {
      status = "signedOut";
      render();
      return;
    }
    if (document.visibilityState === "visible" || status === "loading") {
      try {
        const dashboard = await fetchDashboard();
        if (stopped) return;
        order = dashboard.orders.find((candidate) => candidate.orderNumber === orderNumber) ?? null;
        status = order ? "live" : "notFound";
      } catch (error) {
        if (stopped) return;
        if (status !== "live") {
          status = "error";
          errorMessage = error instanceof TypeError ? "Check your connection and try again." : error instanceof Error ? error.message : "Please try again.";
        }
      }
      render();
    }
    if (status === "live" && order && !terminal.has(order.fulfillmentStatus)) timer = window.setTimeout(() => void poll(), 20_000);
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-sign-in]")) openAccount("signin", "Sign in to follow your order.");
    if (target.closest("[data-retry]")) {
      status = "loading";
      render();
      void poll();
    }
  };
  const onVisible = (): void => {
    if (document.visibilityState === "visible" && status === "live") void poll();
  };

  delete view.dataset.rendered;
  render();
  void poll();
  view.addEventListener("click", onClick);
  document.addEventListener("visibilitychange", onVisible);
  const stopAccount = onAccountChange(() => {
    if (currentSession() && (status === "signedOut" || status === "loading")) {
      status = "loading";
      render();
    }
    void poll();
  });
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    stopAccount();
    view.removeEventListener("click", onClick);
    document.removeEventListener("visibilitychange", onVisible);
    delete view.dataset.rendered;
  };
}

export function renderNotFound(view: HTMLElement): void {
  view.innerHTML = `<section class="wrap view"><div class="state-box" style="margin-top:64px"><p class="kicker">404</p><h1 tabindex="-1" data-page-heading style="font-size:36px">This page isn't on the menu</h1><p>The link may be old, or the page has moved.</p><div class="state-actions"><a class="btn btn-gold" href="/menu">See the menu</a><a class="btn btn-outline" href="/">Home</a></div></div></section>`;
}
