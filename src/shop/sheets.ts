import { addLine, basketLines, replaceLine } from "./basket.js";
import { features } from "./features.js";
import { esc, money } from "./format.js";
import { itemArt } from "./art.js";
import { extraOptions, isOrderable, unitPriceMinor, type MenuItem } from "./menu-data.js";
import { getContext, isLocated, setContext, whenLabel, type OrderMode } from "./order-context.js";
import { subtotalMinor } from "./pricing.js";
import { areas, findArea, kitchenHours, kitchens, pickupReadyText } from "./zones.js";
import { showToast } from "./toast.js";
import { announceAdded } from "./feedback.js";

let dialog: HTMLDialogElement;
let onClose: (() => void) | null = null;

export function mountSheet(element: HTMLDialogElement): void {
  dialog = element;
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet();
  });
  dialog.addEventListener("close", () => {
    const callback = onClose;
    onClose = null;
    callback?.();
  });
}

export function closeSheet(): void {
  if (dialog.open) dialog.close();
}

function open(content: string, options: { label: string; wide?: boolean; alert?: boolean; onClosed?: () => void; keepScroll?: boolean }): void {
  const scroll = options.keepScroll && dialog.open ? dialog.scrollTop : 0;
  dialog.className = `sheet${options.wide ? " wide" : ""}`;
  dialog.setAttribute("aria-label", options.label);
  dialog.setAttribute("role", options.alert ? "alertdialog" : "dialog");
  dialog.innerHTML = content;
  onClose = options.onClosed ?? null;
  const wasOpen = dialog.open;
  if (!wasOpen) dialog.showModal();
  dialog.scrollTop = scroll;
  if (options.keepScroll && wasOpen) return;
  // Focus the first meaningful control rather than the close button.
  const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("button:not(.close-btn), input");
  first?.focus();
}

const closeButton = `<button class="close-btn" type="button" data-close aria-label="Close">×</button>`;

export function pickupComingSoon(): void {
  showToast({ text: "Pickup ordering opens soon. We deliver across Abuja today.", duration: 4500 });
}

// ---------- Area / kitchen ----------

interface AreaSheetOptions {
  mode?: OrderMode;
  /** Runs after a location has been chosen. */
  then?: () => void;
}

export function openAreaSheet(options: AreaSheetOptions = {}): void {
  let mode: OrderMode = options.mode === "pickup" && features.pickup ? "pickup" : options.mode ?? getContext().mode;
  if (mode === "pickup" && !features.pickup) mode = "delivery";
  let query = "";

  const listMarkup = (): string => {
    if (mode === "pickup") {
      const hours = kitchenHours();
      return `<div class="choice-list">${kitchens.map((kitchen) => {
        const on = getContext().mode === "pickup" && getContext().kitchenId === kitchen.id;
        return `<button class="choice" type="button" data-kitchen="${esc(kitchen.id)}" aria-pressed="${on}">
          <span class="choice-main"><b>${esc(kitchen.name)}</b><span>${esc(kitchen.address)}</span><span>${hours.open ? `Open until ${hours.closesAt} · ready in ${pickupReadyText}` : `Closed · opens ${hours.opensAt}`}</span></span>
          <span class="choice-side">${on ? "Selected" : ""}</span></button>`;
      }).join("")}</div>`;
    }
    const needle = query.trim().toLowerCase();
    const matches = areas.filter((area) => !needle || area.name.toLowerCase().includes(needle));
    const none = matches.length === 0
      ? `<div class="notice info" style="text-align:center;padding:22px;margin-bottom:8px">
          <p style="margin:0 0 6px;font-weight:800;color:var(--ink)">We don't deliver to “${esc(query.trim())}” yet</p>
          <p style="margin:0">${features.pickup ? "You can still order for pickup." : "We're adding more of Abuja soon. Check the list for the nearest area."}</p>
          ${features.pickup ? `<button class="btn btn-green btn-sm" type="button" data-mode-set="pickup" style="margin-top:14px">See pickup kitchens</button>` : ""}
        </div>`
      : "";
    return `${none}<div class="choice-list">${matches.map((area) => {
      const on = getContext().mode === "delivery" && getContext().areaId === area.id;
      const sub = area.outOfZone
        ? "Outside our delivery zone for now"
        : [features.zonePricing ? `${money(area.feeMinor)} delivery` : "", `${money(area.minimumMinor)} minimum`].filter(Boolean).join(" · ");
      return `<button class="choice" type="button" data-area="${esc(area.id)}" aria-pressed="${on}" ${area.outOfZone ? "disabled" : ""}>
        <span class="choice-main"><b>${esc(area.name)}</b><span>${esc(sub)}</span></span>
        <span class="choice-side">${area.outOfZone ? "" : on ? "Selected" : `${esc(area.eta)} min`}</span></button>`;
    }).join("")}</div>`;
  };

  const render = (): void => {
    const delivery = mode === "delivery";
    open(`
      <div class="sheet-head">
        <div class="sheet-title-row"><h2 id="sheet-title">${delivery ? "Where should we deliver?" : "Choose a kitchen"}</h2>${closeButton}</div>
        <div class="seg-light" role="group" aria-label="Order type">
          <button type="button" data-mode-set="delivery" aria-pressed="${delivery}">Delivery</button>
          <button type="button" data-mode-set="pickup" aria-pressed="${!delivery}" ${features.pickup ? "" : `aria-disabled="true"`}>Pickup${features.pickup ? "" : " · soon"}</button>
        </div>
        ${delivery ? `<input class="sheet-search" type="search" placeholder="Search your area, e.g. Maitama" aria-label="Search areas" value="${esc(query)}" data-area-search data-autofocus />` : ""}
      </div>
      <div class="sheet-body" data-area-list>${listMarkup()}</div>`, { label: delivery ? "Choose your delivery area" : "Choose a pickup kitchen" });
  };

  render();
  dialog.oninput = (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-area-search]")) return;
    query = input.value;
    dialog.querySelector("[data-area-list]")!.innerHTML = listMarkup();
  };
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return closeSheet();
    const modeButton = target.closest<HTMLElement>("[data-mode-set]");
    if (modeButton) {
      const next = modeButton.dataset.modeSet as OrderMode;
      if (next === "pickup" && !features.pickup) return pickupComingSoon();
      if (next !== mode) {
        mode = next;
        render();
      }
      return;
    }
    const areaButton = target.closest<HTMLButtonElement>("[data-area]");
    if (areaButton && !areaButton.disabled) return requestLocation({ mode: "delivery", areaId: areaButton.dataset.area! }, options.then);
    const kitchenButton = target.closest<HTMLButtonElement>("[data-kitchen]");
    if (kitchenButton) return requestLocation({ mode: "pickup", kitchenId: kitchenButton.dataset.kitchen! }, options.then);
  };
}

type LocationChoice = { mode: "delivery"; areaId: string } | { mode: "pickup"; kitchenId: string };

/** Applies a location, asking first when a filled basket would see its fee, minimum or arrival change. */
function requestLocation(choice: LocationChoice, then?: () => void): void {
  const context = getContext();
  const same = choice.mode === context.mode && (choice.mode === "delivery" ? choice.areaId === context.areaId : choice.kitchenId === context.kitchenId);
  const apply = (): void => {
    setContext(choice.mode === "delivery" ? { mode: "delivery", areaId: choice.areaId } : { mode: "pickup", kitchenId: choice.kitchenId });
    closeSheet();
    then?.();
  };
  if (same || !isLocated() || basketLines().length === 0) return apply();

  const fromArea = findArea(context.areaId);
  const toArea = choice.mode === "delivery" ? findArea(choice.areaId) : undefined;
  const fromMinimum = context.mode === "delivery" && fromArea ? money(fromArea.minimumMinor) : "None";
  const rows = toArea
    ? [
        { k: "Minimum order", from: fromMinimum, to: money(toArea.minimumMinor) },
        { k: "Arrival", from: whenLabel().label, to: `Now · ${toArea.eta} min` },
      ]
    : [{ k: "Minimum order", from: fromMinimum, to: "None" }];
  const shortBy = toArea ? toArea.minimumMinor - subtotalMinor() : 0;
  open(`
    <div style="padding:24px">
      <h2 id="sheet-title">${toArea ? `Switch delivery to ${esc(toArea.name)}?` : "Switch to pickup?"}</h2>
      <p style="margin:10px 0 16px;font-size:15px;line-height:1.6;color:var(--muted)">Your basket stays the same. These details will change:</p>
      <div class="change-rows">${rows.map((row) => `<div><span class="muted">${esc(row.k)}</span><span><s>${esc(row.from)}</s> <strong>${esc(row.to)}</strong></span></div>`).join("")}</div>
      ${toArea && shortBy > 0 ? `<p class="notice warn" role="alert" style="margin:14px 0 0">Your basket is ${esc(money(shortBy))} below the minimum for ${esc(toArea.name)}. You can add more before checkout.</p>` : ""}
      <div class="sheet-actions">
        <button class="btn btn-green" type="button" data-confirm data-autofocus>${toArea ? `Switch to ${esc(toArea.name)}` : "Switch to pickup"}</button>
        <button class="btn btn-outline" type="button" data-close>Keep ${esc(context.mode === "delivery" ? fromArea?.name ?? "current" : "pickup")}</button>
      </div>
    </div>`, { label: "Confirm location change", alert: true });
  dialog.oninput = null;
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return closeSheet();
    if (target.closest("[data-confirm]")) apply();
  };
}

// ---------- Now / Later ----------

export function openScheduleSheet(): void {
  const context = getContext();
  const hours = kitchenHours();
  const delivery = context.mode === "delivery";
  const area = findArea(context.areaId);
  const nowSub = !hours.open ? "Kitchen closed" : delivery ? (area ? `${area.eta} min` : "As soon as possible") : `Ready in ${pickupReadyText}`;
  open(`
    <div style="padding:22px">
      <div class="sheet-title-row" style="margin-bottom:16px"><h2 id="sheet-title">${delivery ? "When should it arrive?" : "When will you collect?"}</h2>${closeButton}</div>
      <div role="radiogroup" aria-label="Order time" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button class="opt" type="button" role="radio" aria-checked="${hours.open}" aria-pressed="${hours.open}" ${hours.open ? "" : "disabled"}><b>Now</b><span>${esc(nowSub)}</span></button>
        <button class="opt" type="button" role="radio" aria-checked="false" aria-pressed="false" disabled><b>Later</b><span>${features.scheduling ? "Choose a time slot" : "Scheduling opens soon"}</span></button>
      </div>
      <p class="notice info" style="margin:16px 0 0">We're open every day, ${esc(hours.opensAt)}–${esc(hours.closesAt)} (Abuja time).${hours.open ? "" : ` We open again ${hours.opensDay === "today" ? "at" : "tomorrow at"} ${esc(hours.opensAt)}.`}</p>
      <button class="btn btn-gold btn-block" type="button" data-close style="margin-top:20px;min-height:52px" data-autofocus>${hours.open ? "Order now" : "OK"}</button>
    </div>`, { label: "Choose when" });
  dialog.oninput = null;
  dialog.onclick = (event) => {
    if ((event.target as HTMLElement).closest("[data-close]")) closeSheet();
  };
}

// ---------- Item options (burgers and other configurable items) ----------

export function openItemSheet(item: MenuItem, editIndex: number | null = null): void {
  const existing = editIndex !== null ? basketLines()[editIndex] : undefined;
  const chosen = new Set<string>(existing?.optionIds ?? []);
  let quantity = existing?.quantity ?? 1;
  const extras = extraOptions(item);
  const orderable = isOrderable(item);
  const hours = kitchenHours();

  const priceLabel = (): string => `${existing ? "Update" : "Add"} · ${money(unitPriceMinor(item, [...chosen]) * quantity, item.currency)}`;
  const render = (): void => {
    open(`
      ${itemArt(item, "sheet-art")}
      <div style="padding:22px;display:grid;gap:18px">
        <div class="sheet-title-row" style="align-items:flex-start">
          <div><h2 id="sheet-title">${esc(item.name)}</h2><p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:var(--muted)">${esc(item.description)}</p></div>
          ${closeButton}
        </div>
        ${extras.length ? `<fieldset style="border:0;margin:0;padding:0;display:grid;gap:8px">
          <legend style="margin:0 0 8px;padding:0;font-size:13px;font-weight:800">Extras</legend>
          ${extras.map((option) => `<button class="check-opt" type="button" role="checkbox" aria-checked="${chosen.has(option.id)}" data-extra="${esc(option.id)}" ${option.available ? "" : "disabled"}>
            <span class="check-box" aria-hidden="true">${chosen.has(option.id) ? "✓" : ""}</span>
            <span class="grow"><b>${esc(option.name)}</b><span>${option.available ? `+${esc(money(option.priceDeltaMinor ?? 0, item.currency))}` : "Unavailable today"}</span></span>
          </button>`).join("")}
        </fieldset>` : ""}
        ${!hours.open ? `<p class="notice warn" style="margin:0">We're closed right now and open at ${esc(hours.opensAt)}. You can add this to your basket and order when we open.</p>` : ""}
        <div style="display:flex;align-items:center;gap:12px">
          <div class="stepper" role="group" aria-label="Quantity">
            <button type="button" data-qty="-1" aria-label="Fewer" ${quantity <= 1 ? "disabled" : ""}>−</button>
            <output aria-live="polite">${quantity}</output>
            <button type="button" data-qty="1" aria-label="More" ${quantity >= 10 ? "disabled" : ""}>+</button>
          </div>
          <button class="btn btn-gold" type="button" data-add style="flex:1;min-height:52px" ${orderable ? "" : "disabled"}>${orderable ? esc(priceLabel()) : "Unavailable"}</button>
        </div>
      </div>`, { label: item.name, keepScroll: rendered });
    rendered = true;
  };
  let rendered = false;
  render();
  dialog.oninput = null;
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return closeSheet();
    const extra = target.closest<HTMLButtonElement>("[data-extra]");
    if (extra && !extra.disabled) {
      const id = extra.dataset.extra!;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      render();
      dialog.querySelector<HTMLElement>(`[data-extra="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    const qty = target.closest<HTMLButtonElement>("[data-qty]");
    if (qty) {
      quantity = Math.max(1, Math.min(10, quantity + Number(qty.dataset.qty)));
      render();
      dialog.querySelector<HTMLElement>(`[data-qty="${qty.dataset.qty}"]:not(:disabled)`)?.focus();
      return;
    }
    if (target.closest("[data-add]") && orderable) {
      if (existing && editIndex !== null) {
        replaceLine(editIndex, item.id, [...chosen], quantity);
        closeSheet();
        showToast({ text: `${item.name} updated` });
        return;
      }
      const result = addLine(item.id, [...chosen], quantity);
      if (!result.ok) return showToast({ text: result.reason });
      closeSheet();
      announceAdded(item, quantity);
    }
  };
}
