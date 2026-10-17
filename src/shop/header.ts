import { currentProfile, currentSession, openAccount } from "./account.js";
import { itemCount } from "./basket.js";
import { features } from "./features.js";
import { esc, money } from "./format.js";
import { areaLabel, getContext, isLocated, setContext, whenLabel } from "./order-context.js";
import { subtotalMinor } from "./pricing.js";
import { openAreaSheet, openScheduleSheet, pickupComingSoon } from "./sheets.js";
import { kitchenHours } from "./zones.js";

let root: HTMLElement;

export function mountHeader(element: HTMLElement): void {
  root = element;
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-hdr]")?.dataset.hdr;
    if (!action) return;
    if (action === "account") openAccount();
    if (action === "area") openAreaSheet();
    if (action === "when") openScheduleSheet();
    if (action === "delivery") {
      if (getContext().mode === "delivery") return;
      if (getContext().areaId) setContext({ mode: "delivery" });
      else openAreaSheet({ mode: "delivery" });
    }
    if (action === "pickup") {
      if (!features.pickup) return pickupComingSoon();
      if (getContext().mode !== "pickup") openAreaSheet({ mode: "pickup" });
    }
  });
  renderHeader();
}

export function renderHeader(): void {
  if (!root) return;
  const context = getContext();
  const delivery = context.mode === "delivery";
  const area = areaLabel();
  const when = whenLabel();
  const hours = kitchenHours();
  const count = itemCount();
  const profile = currentProfile();
  const accountLabel = currentSession() ? (profile ? `Hi, ${profile.displayName.split(/\s+/)[0]}` : "My account") : "Sign in";
  const focused = (document.activeElement as HTMLElement | null)?.closest?.("[data-hdr], .basket-btn, .brand");
  const focusKey = focused && root.contains(focused) ? (focused as HTMLElement).dataset.hdr ?? focused.className : null;
  root.innerHTML = `
    <div class="hdr-top"><div class="wrap">
      <a class="brand" href="/" aria-label="The Ivy Pizza, home">THE IVY <span>PIZZA</span></a>
      <div class="hdr-spacer"></div>
      <button class="account-btn" type="button" data-hdr="account">${esc(accountLabel)}</button>
      <a class="basket-btn" href="/basket" aria-label="Basket, ${count} ${count === 1 ? "item" : "items"}">
        <span class="basket-label">Basket</span>
        <span class="basket-count">${count ? `${count} · ${esc(money(subtotalMinor()))}` : "0"}</span>
      </a>
    </div></div>
    <div class="hdr-bar"><div class="wrap">
      <div class="seg" role="group" aria-label="Order type">
        <button type="button" data-hdr="delivery" aria-pressed="${delivery}">Delivery</button>
        <button type="button" data-hdr="pickup" aria-pressed="${!delivery}" ${features.pickup ? "" : `aria-disabled="true"`}>Pickup</button>
      </div>
      <button class="ctx-btn" type="button" data-hdr="area"><small>${esc(area.kicker)}</small><span>${esc(area.label)}</span></button>
      <button class="ctx-btn" type="button" data-hdr="when"><small>${esc(when.kicker)}</small><span>${esc(when.label)}</span></button>
    </div></div>
    ${hours.open ? "" : `<div class="closed-banner" role="status"><div class="wrap">
      <span>${delivery || !isLocated() ? "Our kitchen" : "This kitchen"} is closed right now. We open at ${esc(hours.opensAt)}${hours.opensDay === "tomorrow" ? " tomorrow" : ""}.</span>
      <span style="font-weight:600">You can still browse and fill your basket.</span>
    </div></div>`}`;
  if (focusKey) {
    const selector = /^[a-z]+$/.test(focusKey) ? `[data-hdr="${focusKey}"]` : `.${focusKey.split(" ")[0]}`;
    root.querySelector<HTMLElement>(selector)?.focus();
  }
}
