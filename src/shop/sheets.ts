import { addLine, basketLines, replaceLine } from "./basket.js";
import { esc, money } from "./format.js";
import { itemArt } from "./art.js";
import { isOrderable, optionsOf, unitPriceMinor, type MenuItem } from "./menu-data.js";
import { activeKitchenId, getContext, isLocated, setContext, whenLabel, type OrderMode } from "./order-context.js";
import { subtotalMinor } from "./pricing.js";
import { areaForPoint, areas, configState, findArea, findKitchen, kitchenHours, kitchens, loadConfig, pickupReadyText, slotDays } from "./zones.js";
import { showToast } from "./toast.js";
import { announceAdded } from "./feedback.js";
import { maxInstructionsLength } from "../../shared/pizza-rules.js";

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
  const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("button:not(.close-btn):not(:disabled), input");
  first?.focus();
}

const closeButton = `<button class="close-btn" type="button" data-close aria-label="Close">×</button>`;

function configNotice(): string | null {
  const status = configState().status;
  if (status === "loading") return `<p class="notice info" aria-busy="true">Loading delivery areas…</p>`;
  if (status === "error") return `<div class="notice error" role="alert">We couldn't load delivery areas. <button class="link-btn" type="button" data-reload-config>Try again</button></div>`;
  return null;
}

// ---------- Area / kitchen ----------

interface AreaSheetOptions {
  mode?: OrderMode;
  /** Runs after a location has been chosen. */
  then?: () => void;
}

export function openAreaSheet(options: AreaSheetOptions = {}): void {
  let mode: OrderMode = options.mode ?? getContext().mode;
  let query = "";
  let locate: { state: "idle" | "busy" | "done"; message: string } = { state: "idle", message: "" };

  const listMarkup = (): string => {
    const notice = configNotice();
    if (notice) return notice;
    if (mode === "pickup") {
      return `<div class="choice-list">${kitchens().map((kitchen) => {
        const hours = kitchenHours(kitchen.id);
        const on = getContext().mode === "pickup" && getContext().kitchenId === kitchen.id;
        const status = hours.paused ? (hours.pausedMessage ?? "Not taking orders right now") : hours.open ? `Open until ${hours.closesAt} · ready in ${pickupReadyText(kitchen.id)}` : `Closed · opens ${hours.opensAt}`;
        return `<button class="choice" type="button" data-kitchen="${esc(kitchen.id)}" aria-pressed="${on}">
          <span class="choice-main"><b>${esc(kitchen.name)}</b><span>${esc(kitchen.address)}</span><span>${esc(status)}</span></span>
          <span class="choice-side">${on ? "Selected" : ""}</span></button>`;
      }).join("")}</div>`;
    }
    const needle = query.trim().toLowerCase();
    const matches = areas().filter((area) => !needle || area.name.toLowerCase().includes(needle));
    const located = locate.message ? `<p class="notice ${locate.state === "busy" ? "info" : "warn"}" role="status" style="margin:0 0 10px">${esc(locate.message)}</p>` : "";
    const none = matches.length === 0
      ? `<div class="notice info" style="text-align:center;padding:22px;margin-bottom:8px">
          <p style="margin:0 0 6px;font-weight:800;color:var(--ink)">We don't deliver to “${esc(query.trim())}” yet</p>
          <p style="margin:0">You can still order for pickup from ${esc(kitchens().map((kitchen) => kitchen.short).join(" or "))}.</p>
          <button class="btn btn-green btn-sm" type="button" data-mode-set="pickup" style="margin-top:14px">See pickup kitchens</button>
        </div>`
      : "";
    return `${located}${none}<div class="choice-list">${matches.map((area) => {
      const on = getContext().mode === "delivery" && getContext().areaId === area.id;
      const sub = area.outOfZone ? "Outside our delivery zone for now" : `${money(area.feeMinor)} delivery · ${money(area.minimumMinor)} minimum`;
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
          <button type="button" data-mode-set="pickup" aria-pressed="${!delivery}">Pickup</button>
        </div>
        ${delivery ? `<input class="sheet-search" type="search" placeholder="Search your area, e.g. Maitama" aria-label="Search areas" value="${esc(query)}" data-area-search data-autofocus />` : ""}
        ${delivery && "geolocation" in navigator ? `<button class="locate-btn" type="button" data-locate ${locate.state === "busy" ? "disabled" : ""}>${locate.state === "busy" ? "Finding you…" : "Use my location"}</button>` : ""}
      </div>
      <div class="sheet-body" data-area-list aria-live="polite">${listMarkup()}</div>`, { label: delivery ? "Choose your delivery area" : "Choose a pickup kitchen" });
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
    if (target.closest("[data-locate]")) {
      locate = { state: "busy", message: "Finding your location…" };
      render();
      navigator.geolocation.getCurrentPosition((position) => {
        const match = areaForPoint(position.coords.latitude, position.coords.longitude);
        if (match && !match.area.outOfZone) {
          locate = { state: "done", message: "" };
          requestLocation({ mode: "delivery", areaId: match.area.id }, options.then);
          return;
        }
        locate = { state: "done", message: match ? `You look to be in ${match.area.name}, where we don't deliver yet. You can order for pickup instead.` : "You're outside our delivery areas for now. Pick the nearest area, or order for pickup." };
        if (dialog.open) render();
      }, (error) => {
        locate = { state: "done", message: error.code === error.PERMISSION_DENIED ? "Location is switched off for this site. Pick your area from the list instead." : "We couldn't find your location. Pick your area from the list instead." };
        if (dialog.open) render();
      }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
      return;
    }
    if (target.closest("[data-reload-config]")) {
      void loadConfig().then(() => dialog.open && render());
      return;
    }
    const modeButton = target.closest<HTMLElement>("[data-mode-set]");
    if (modeButton) {
      const next = modeButton.dataset.modeSet as OrderMode;
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
    const area = choice.mode === "delivery" ? findArea(choice.areaId) : undefined;
    const kitchenId = choice.mode === "pickup" ? choice.kitchenId : area?.storeId ?? context.kitchenId;
    // A slot belongs to one kitchen; switching kitchens means choosing the time again.
    const when = kitchenId !== activeKitchenId() ? "now" : context.when;
    setContext(choice.mode === "delivery" ? { mode: "delivery", areaId: choice.areaId, kitchenId, when } : { mode: "pickup", kitchenId, when });
    closeSheet();
    then?.();
  };
  if (same || !isLocated() || basketLines().length === 0) return apply();

  const fromArea = context.mode === "delivery" ? findArea(context.areaId) : undefined;
  const toArea = choice.mode === "delivery" ? findArea(choice.areaId) : undefined;
  const toKitchen = choice.mode === "pickup" ? findKitchen(choice.kitchenId) : undefined;
  const fee = (area: typeof fromArea): string => area ? money(area.feeMinor) : "None";
  const minimum = (area: typeof fromArea): string => area ? money(area.minimumMinor) : "None";
  const rows = [
    { k: "Delivery fee", from: fee(fromArea), to: fee(toArea) },
    { k: "Minimum order", from: minimum(fromArea), to: minimum(toArea) },
    toArea ? { k: "Arrival", from: whenLabel().label, to: `Now · ${toArea.eta} min` } : { k: "Collect from", from: fromArea ? "Delivery" : findKitchen(context.kitchenId)?.short ?? "", to: toKitchen?.short ?? "" },
  ].filter((row) => row.from !== row.to);
  const shortBy = toArea ? toArea.minimumMinor - subtotalMinor() : 0;
  open(`
    <div style="padding:24px">
      <h2 id="sheet-title">${toArea ? `Switch delivery to ${esc(toArea.name)}?` : `Switch to pickup from ${esc(toKitchen?.short ?? "the kitchen")}?`}</h2>
      <p style="margin:10px 0 16px;font-size:15px;line-height:1.6;color:var(--muted)">Your basket stays the same. These details will change:</p>
      <div class="change-rows">${rows.map((row) => `<div><span class="muted">${esc(row.k)}</span><span><s>${esc(row.from)}</s> <strong>${esc(row.to)}</strong></span></div>`).join("")}</div>
      ${toArea && shortBy > 0 ? `<p class="notice warn" role="alert" style="margin:14px 0 0">Your basket is ${esc(money(shortBy))} below the minimum for ${esc(toArea.name)}. You can add more before checkout.</p>` : ""}
      <div class="sheet-actions">
        <button class="btn btn-green" type="button" data-confirm data-autofocus>${toArea ? `Switch to ${esc(toArea.name)}` : "Switch to pickup"}</button>
        <button class="btn btn-outline" type="button" data-close>Keep ${esc(fromArea?.name ?? (context.mode === "pickup" ? "pickup" : "current"))}</button>
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
  const kitchenId = activeKitchenId();
  const hours = kitchenHours(kitchenId);
  const delivery = context.mode === "delivery";
  const area = findArea(context.areaId);
  const days = slotDays(kitchenId);
  let later = context.when !== "now" || !hours.open;
  let dayIndex = 0;
  let chosen: string | null = context.when !== "now" ? context.when.at : null;
  if (chosen) dayIndex = Math.max(0, days.findIndex((day) => day.slots.some((slot) => slot.at === chosen)));
  else if (days[0] && !days[0].slots.some((slot) => slot.available)) dayIndex = 1;
  const nowSub = hours.paused ? "Paused right now" : !hours.open ? "Kitchen closed" : delivery ? (area ? `${area.eta} min` : "As soon as possible") : `Ready in ${pickupReadyText(kitchenId)}`;

  const render = (keepScroll: boolean): void => {
    const day = days[dayIndex];
    const slot = day?.slots.find((candidate) => candidate.at === chosen);
    const confirmLabel = later ? (slot ? `Set for ${day!.label.split(",")[0]!.toLowerCase()}, ${slot.time}` : "Choose a time") : "Order now";
    open(`
      <div style="padding:22px">
        <div class="sheet-title-row" style="margin-bottom:16px"><h2 id="sheet-title">${delivery ? "When should it arrive?" : "When will you collect?"}</h2>${closeButton}</div>
        ${hours.paused && hours.pausedMessage ? `<p class="notice warn" style="margin:0 0 14px">${esc(hours.pausedMessage)}</p>` : ""}
        <div role="radiogroup" aria-label="Order time" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button class="opt" type="button" role="radio" aria-checked="${!later}" aria-pressed="${!later}" data-now ${hours.open ? "" : "disabled"}><b>Now</b><span>${esc(nowSub)}</span></button>
          <button class="opt" type="button" role="radio" aria-checked="${later}" aria-pressed="${later}" data-later><b>Later</b><span>Choose a time slot</span></button>
        </div>
        ${later ? `
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 12px" role="group" aria-label="Day">
            ${days.map((candidate, index) => `<button class="chip" type="button" aria-pressed="${index === dayIndex}" data-day="${index}">${esc(candidate.label)}</button>`).join("")}
          </div>
          ${day && day.slots.length === 0 ? `<p class="notice info" style="margin:0">${dayIndex === 0 ? "No more slots today. Choose tomorrow." : "No slots on this day."}</p>` : ""}
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px" role="radiogroup" aria-label="Time">
            ${(day?.slots ?? []).map((candidate) => `<button class="opt" type="button" role="radio" aria-checked="${candidate.at === chosen}" aria-pressed="${candidate.at === chosen}" data-slot="${esc(candidate.at)}" ${candidate.available ? "" : "disabled"} style="min-height:48px;place-items:center;text-align:center;padding:4px"><b style="font-size:14px">${esc(candidate.time)}</b>${candidate.available ? "" : `<span style="font-size:11px">Full</span>`}</button>`).join("")}
          </div>` : ""}
        <p class="notice info" style="margin:16px 0 0">Open every day, ${esc(hours.opensAt)}–${esc(hours.closesAt)} (Abuja time).</p>
        <button class="btn btn-gold btn-block" type="button" data-confirm style="margin-top:20px;min-height:52px" ${later && !slot ? "disabled" : ""}>${esc(confirmLabel)}</button>
      </div>`, { label: "Choose when", keepScroll });
  };
  render(false);
  dialog.oninput = null;
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return closeSheet();
    const button = target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-now]")) { later = false; render(true); return; }
    if (button.matches("[data-later]")) { later = true; render(true); return; }
    if (button.matches("[data-day]")) { dayIndex = Number(button.dataset.day); chosen = null; render(true); return; }
    if (button.matches("[data-slot]")) {
      chosen = button.dataset.slot!;
      render(true);
      dialog.querySelector<HTMLElement>(`[data-slot="${CSS.escape(chosen)}"]`)?.focus();
      return;
    }
    if (button.matches("[data-confirm]")) {
      if (!later) setContext({ when: "now" });
      else {
        const day = days[dayIndex];
        const slot = day?.slots.find((candidate) => candidate.at === chosen);
        if (!day || !slot) return;
        setContext({ when: { at: slot.at, label: `${day.label.split(",")[0]}, ${slot.time}` } });
      }
      closeSheet();
    }
  };
}

// ---------- Item options (burgers and other configurable items) ----------

export function openItemSheet(item: MenuItem, editIndex: number | null = null): void {
  const existing = editIndex !== null ? basketLines()[editIndex] : undefined;
  const chosen = new Set<string>(existing?.optionIds ?? []);
  let quantity = existing?.quantity ?? 1;
  let note = existing?.instructions ?? "";
  const extras = optionsOf(item, "extra");
  const removals = optionsOf(item, "removal");
  const orderable = isOrderable(item);
  const line = () => ({ menuItemId: item.id, quantity, optionIds: [...chosen], instructions: note.trim() || undefined });

  const render = (keepScroll: boolean): void => {
    const label = `${existing ? "Update" : "Add"} · ${money(unitPriceMinor(item, line()) * quantity, item.currency)}`;
    open(`
      ${itemArt(item, "sheet-art")}
      <div style="padding:22px;display:grid;gap:18px">
        <div class="sheet-title-row" style="align-items:flex-start">
          <div><h2 id="sheet-title">${esc(item.name)}</h2><p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:var(--muted)">${esc(item.description)}</p>
          ${item.allergens.length ? `<p style="margin:6px 0 0;font-size:12px;font-weight:700;color:var(--gold-ink)">Contains ${esc(item.allergens.join(", ").toLowerCase())}</p>` : ""}</div>
          ${closeButton}
        </div>
        ${extras.length ? `<fieldset style="border:0;margin:0;padding:0;display:grid;gap:8px">
          <legend style="margin:0 0 8px;padding:0;font-size:13px;font-weight:800">Extras</legend>
          ${extras.map((option) => `<button class="check-opt" type="button" role="checkbox" aria-checked="${chosen.has(option.id)}" data-extra="${esc(option.id)}" ${option.available ? "" : "disabled"}>
            <span class="check-box" aria-hidden="true">${chosen.has(option.id) ? "✓" : ""}</span>
            <span class="grow"><b>${esc(option.name)}</b><span>${option.available ? `+${esc(money(option.priceDeltaMinor ?? 0, item.currency))}` : "Unavailable today"}</span></span>
          </button>`).join("")}
        </fieldset>` : ""}
        ${removals.length ? `<div><p style="margin:0 0 8px;font-size:13px;font-weight:800">Leave out</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px" role="group" aria-label="Leave out">${removals.map((option) => `<button class="chip" type="button" aria-pressed="${chosen.has(option.id)}" data-extra="${esc(option.id)}" ${option.available ? "" : "disabled"}>${esc(option.name)}</button>`).join("")}</div>
        </div>` : ""}
        <div class="field"><label for="item-note">Note for the kitchen <span class="opt-tag">(optional)</span></label><input id="item-note" data-note maxlength="${maxInstructionsLength}" value="${esc(note)}" placeholder="e.g. Well done, sauce on the side" /></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="stepper" role="group" aria-label="Quantity">
            <button type="button" data-qty="-1" aria-label="Fewer" ${quantity <= 1 ? "disabled" : ""}>−</button>
            <output aria-live="polite">${quantity}</output>
            <button type="button" data-qty="1" aria-label="More" ${quantity >= 10 ? "disabled" : ""}>+</button>
          </div>
          <button class="btn btn-gold" type="button" data-add style="flex:1;min-height:52px" ${orderable ? "" : "disabled"}>${orderable ? esc(label) : "Unavailable"}</button>
        </div>
      </div>`, { label: item.name, keepScroll });
  };
  render(false);
  dialog.oninput = (event) => {
    const input = event.target as HTMLInputElement;
    if (input.matches("[data-note]")) note = input.value;
  };
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return closeSheet();
    const extra = target.closest<HTMLButtonElement>("[data-extra]");
    if (extra && !extra.disabled) {
      const id = extra.dataset.extra!;
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      render(true);
      dialog.querySelector<HTMLElement>(`[data-extra="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    const qty = target.closest<HTMLButtonElement>("[data-qty]");
    if (qty && !qty.disabled) {
      quantity = Math.max(1, Math.min(10, quantity + Number(qty.dataset.qty)));
      render(true);
      dialog.querySelector<HTMLElement>(`[data-qty="${qty.dataset.qty}"]:not(:disabled)`)?.focus();
      return;
    }
    if (target.closest("[data-add]") && orderable) {
      if (existing && editIndex !== null) {
        replaceLine(editIndex, line());
        closeSheet();
        showToast({ text: `${item.name} updated` });
        return;
      }
      const result = addLine(line());
      if (!result.ok) return showToast({ text: result.reason });
      closeSheet();
      announceAdded(item, quantity);
    }
  };
}

// ---------- Allergens ----------

/** Lets customers hide dishes containing allergens; `onChange` gets the new set after each toggle. */
export function openAllergenSheet(items: MenuItem[], hidden: ReadonlySet<string>, allergens: readonly string[], onChange: (next: Set<string>) => void): void {
  const selected = new Set(hidden);
  const render = (keepScroll: boolean): void => {
    open(`
      <div style="padding:22px">
        <div class="sheet-title-row"><h2 id="sheet-title">Allergens</h2>${closeButton}</div>
        <p style="margin:8px 0 14px;font-size:14px;line-height:1.6;color:var(--muted)">Hide dishes that contain:</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px" role="group" aria-label="Hide dishes containing">
          ${allergens.map((allergen) => `<button class="chip" type="button" aria-pressed="${selected.has(allergen)}" data-allergen="${esc(allergen)}">${esc(allergen)}</button>`).join("")}
        </div>
        <div class="change-rows" style="margin-top:18px">
          ${items.map((item) => `<div><span style="font-weight:700">${esc(item.name)}</span><span class="muted" style="text-align:right">${esc(item.allergens.length ? item.allergens.join(", ") : "None of these")}</span></div>`).join("")}
        </div>
        <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:var(--muted)">Our kitchen handles all 14 major allergens, so we can't rule out traces. Ask the team if you have a severe allergy.</p>
        <button class="btn btn-green btn-block" type="button" data-close style="margin-top:16px">Show menu</button>
      </div>`, { label: "Allergens", wide: true, keepScroll });
  };
  render(false);
  dialog.oninput = null;
  dialog.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) return closeSheet();
    const chip = target.closest<HTMLElement>("[data-allergen]");
    if (!chip) return;
    const allergen = chip.dataset.allergen!;
    if (selected.has(allergen)) selected.delete(allergen);
    else selected.add(allergen);
    onChange(new Set(selected));
    render(true);
    dialog.querySelector<HTMLElement>(`[data-allergen="${CSS.escape(allergen)}"]`)?.focus();
  };
}
