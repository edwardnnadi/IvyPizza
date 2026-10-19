import { basketLines, getQuoteState, getVoucherCode, maxLineQuantity, onBasketChange, refreshQuote, removeLine, setQuantity, setVoucherCode } from "../basket.js";
import { itemArt } from "../art.js";
import { esc, money } from "../format.js";
import { quickAdd, upsellItems } from "../feedback.js";
import { describeBasketLine, findItem, getMenu, itemKind, linePriceBreakdown, onMenuChange, unitPriceMinor } from "../menu-data.js";
import { activeKitchenId, getContext, isLocated, onContextChange, whenLabel } from "../order-context.js";
import { latestQuote, minimumCheck, unavailableLineIndexes } from "../pricing.js";
import { navigate } from "../router.js";
import { openAreaSheet, openItemSheet } from "../sheets.js";
import { showToast } from "../toast.js";
import { findArea, findKitchen, onConfigChange } from "../zones.js";

export function orderContextLine(): string {
  const context = getContext();
  if (context.mode === "pickup") return `Pickup from ${findKitchen(activeKitchenId())?.name ?? "the kitchen"} · ${whenLabel().label}`;
  const area = findArea(context.areaId);
  return area ? `Delivery to ${area.name} · ${whenLabel().label}` : "Delivery · choose your area to see the fee and arrival time";
}

/** Totals block shared by the basket and checkout. */
export function summaryMarkup(): string {
  const state = getQuoteState();
  const quote = latestQuote();
  const calculating = state.status === "calculating";
  if (state.status === "error") {
    return `<div class="notice error" role="alert">${esc(state.message)} <button class="link-btn" type="button" data-requote>Try again</button></div>`;
  }
  const context = getContext();
  const area = findArea(context.areaId);
  const dash = "—";
  const deliveryValue = !quote ? dash : !area ? "Choose area" : quote.deliveryFeeMinor ? money(quote.deliveryFeeMinor, quote.currency) : "Free";
  return `
    <div class="sum ${calculating ? "is-calculating" : ""}" aria-busy="${calculating}">
      <div class="sum-row"><span>Subtotal</span><b>${quote ? esc(money(quote.subtotalMinor, quote.currency)) : dash}</b></div>
      ${quote?.discountMinor ? `<div class="sum-row discount"><span>${esc(quote.voucher?.code ?? "Discount")} · ${esc(quote.voucher?.description ?? "")}</span><b>−${esc(money(quote.discountMinor, quote.currency))}</b></div>` : ""}
      ${context.mode === "delivery"
        ? `<div class="sum-row ${quote?.voucher?.freeDelivery ? "discount" : ""}"><span>Delivery${area ? ` · ${esc(area.name)}` : ""}</span><b>${esc(deliveryValue)}</b></div>`
        : `<div class="sum-row"><span>Pickup</span><b>Free</b></div>`}
      ${quote && quote.taxMinor ? `<div class="sum-row"><span>VAT</span><b>${esc(money(quote.taxMinor, quote.currency))}</b></div>` : ""}
      <div class="sum-total"><span>Total</span><span>${quote ? esc(money(quote.totalMinor, quote.currency)) : dash}</span></div>
      ${calculating ? `<span class="visually-hidden" role="status">Updating prices…</span>` : ""}
    </div>`;
}

function voucherMarkup(draft: string): string {
  const code = getVoucherCode();
  const quote = latestQuote();
  const applied = code && quote?.voucher?.code === code;
  const error = code && quote?.voucherError ? quote.voucherError : "";
  if (applied) {
    return `<div><span class="field-label" style="display:block;margin-bottom:6px;font-size:13px;font-weight:800">Voucher code</span>
      <div class="notice ok" style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-weight:700">${esc(quote!.voucher!.code)} · ${esc(quote!.voucher!.description)}</span><button class="link-btn" type="button" data-voucher-remove>Remove</button></div></div>`;
  }
  return `<form data-voucher novalidate>
    <label for="voucher" style="display:block;margin-bottom:6px;font-size:13px;font-weight:800">Voucher code</label>
    <div style="display:flex;gap:8px">
      <input id="voucher" class="voucher-input" value="${esc(draft || code || "")}" placeholder="e.g. IVY10" autocomplete="off" autocapitalize="characters" ${error ? `aria-invalid="true" aria-describedby="voucher-err"` : ""} />
      <button class="btn btn-outline btn-sm" type="submit">Apply</button>
    </div>
    ${error ? `<p id="voucher-err" class="field-error" role="alert" style="margin:6px 0 0">${esc(error)}</p>` : ""}
  </form>`;
}

export function renderBasket(view: HTMLElement): () => void {
  let voucherDraft = "";

  const render = (): void => {
    const lines = basketLines();
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused?.dataset?.focusKey ?? (focused?.id === "voucher" ? "voucher" : undefined);
    if (!lines.length) {
      view.innerHTML = `
        <section class="wrap basket-page view">
          <h1 class="page-title" tabindex="-1" data-page-heading style="margin-bottom:6px">Your basket</h1>
          <p class="muted" style="margin:0 0 24px;font-size:15px">${esc(orderContextLine())}</p>
          <div class="panel" style="max-width:520px">
            <h2 style="font-size:26px">Your basket is empty</h2>
            <p class="muted" style="margin:10px 0 20px;line-height:1.6">Start with a pizza and build it your way.</p>
            <a class="btn btn-gold" href="/menu">Browse the menu</a>
          </div>
        </section>`;
      return;
    }
    const quote = latestQuote();
    const minimum = minimumCheck();
    const belowMinimum = !!minimum && minimum.shortMinor > 0;
    const problems = unavailableLineIndexes();
    const quoteState = getQuoteState();
    const menuLive = getMenu().status === "live";
    const upsells = upsellItems(3);

    let checkout: { label: string; disabled: boolean; action: string };
    if (problems.length) checkout = { label: "Remove unavailable items to continue", disabled: true, action: "" };
    else if (belowMinimum) checkout = { label: "Minimum not reached", disabled: true, action: "" };
    else if (quoteState.status === "error") checkout = { label: "Prices unavailable", disabled: true, action: "" };
    else if (!isLocated()) checkout = { label: "Choose your area to continue", disabled: false, action: "area" };
    else checkout = { label: `Go to checkout${quote ? ` · ${money(quote.totalMinor, quote.currency)}` : ""}`, disabled: quoteState.status === "calculating" && !quote, action: "checkout" };

    view.innerHTML = `
      <section class="wrap basket-page ${view.dataset.rendered ? "" : "view"}">
        <h1 class="page-title" tabindex="-1" data-page-heading style="margin-bottom:6px">Your basket</h1>
        <p class="muted" style="margin:0 0 24px;font-size:15px">${esc(orderContextLine())} <button class="link-btn" type="button" data-area style="min-height:32px">Change</button></p>
        <div class="basket-grid">
          <div class="stack">
            ${belowMinimum ? `<div class="min-bar" role="status">
              <p>Add ${esc(money(minimum.shortMinor))} more to reach the ${esc(money(minimum.minimumMinor))} minimum for ${esc(minimum.areaName)}.</p>
              <div class="min-track"><i style="width:${minimum.percent}%"></i></div>
              <p style="margin:10px 0 0;font-weight:600;font-size:14px">Or <button class="link-btn" type="button" data-pickup style="min-height:32px;padding:0;color:var(--warn-ink)">switch to pickup</button>, which has no minimum.</p>
            </div>` : ""}
            ${problems.length ? `<p class="notice error" role="alert" style="margin:0">${problems.length === 1 ? "One item is" : `${problems.length} items are`} no longer available. Remove ${problems.length === 1 ? "it" : "them"} or choose something else.</p>` : ""}
            <div class="lines">
              ${lines.map((line, index) => {
                const item = findItem(line.menuItemId);
                const quoted = quote?.lines[index];
                const matches = quoted && quoted.menuItemId === line.menuItemId && quoted.quantity === line.quantity;
                const total = matches ? quoted.lineTotalMinor : item ? unitPriceMinor(item, line) * line.quantity : null;
                const unit = matches ? quoted.unitPriceMinor : item ? unitPriceMinor(item, line) : null;
                const priceRows = item ? linePriceBreakdown(item, line).rows : [];
                const problem = problems.includes(index);
                const name = item?.name ?? (menuLive ? "No longer on the menu" : "Loading…");
                const options = item ? describeBasketLine(item, line) : "";
                const editable = item && !problem && itemKind(item) !== "simple";
                return `<div class="bline ${problem ? "is-problem" : ""}">
                  ${item ? itemArt(item) : `<div class="art art-other"></div>`}
                  <div class="bline-main">
                    <div class="bline-top"><b>${esc(name)}</b><span>${total === null ? "—" : esc(money(total))}</span></div>
                    ${options ? `<span class="bline-opts">${esc(options)}</span>` : ""}
                    ${line.instructions ? `<span class="bline-opts" style="font-style:italic">“${esc(line.instructions)}”</span>` : ""}
                    ${unit !== null && total !== null ? `<div class="bline-unit-math"><span>${esc(money(unit))} each</span><span aria-hidden="true">×</span><span>${line.quantity}</span><span aria-hidden="true">=</span><b>${esc(money(total))} line total</b></div>` : ""}
                    ${unit !== null && priceRows.length ? `<details class="bline-price-details"><summary>Price breakdown <span>${esc(money(unit))} per pizza</span></summary><div class="bline-price-rows">${priceRows.map((row) => `<div><span>${esc(row.label)}</span><b>${esc(money(row.amountMinor))}</b></div>`).join("")}<div class="bline-price-unit"><span>Each pizza</span><b>${esc(money(unit))}</b></div><p>Each customized pizza × ${line.quantity} ${line.quantity === 1 ? "pizza" : "pizzas"} = ${esc(money(total!))}</p></div></details>` : ""}
                    ${problem ? `<span class="field-error">Unavailable right now</span>` : ""}
                    <div class="bline-acts">
                      <div class="stepper sm" role="group" aria-label="Quantity of ${esc(name)}">
                        <button type="button" data-dec="${index}" data-focus-key="dec-${index}" aria-label="${line.quantity === 1 ? `Remove ${esc(name)}` : `One fewer ${esc(name)}`}">−</button>
                        <output>${line.quantity}</output>
                        <button type="button" data-inc="${index}" data-focus-key="inc-${index}" aria-label="One more ${esc(name)}" ${line.quantity >= maxLineQuantity || problem ? "disabled" : ""}>+</button>
                      </div>
                      ${editable ? `<button class="link-btn" type="button" data-edit="${index}">Edit</button>` : ""}
                      <button class="link-btn danger" type="button" data-remove="${index}">Remove</button>
                    </div>
                  </div>
                </div>`;
              }).join("")}
            </div>
            ${upsells.length ? `<div>
              <h2 style="margin:0 0 12px;font-size:22px">Goes well with</h2>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr));gap:10px">
                ${upsells.map((item) => `<button class="choice" type="button" data-upsell="${esc(item.id)}" style="min-height:56px"><span class="choice-main"><b style="font-size:14px">${esc(item.name)}</b><span>${esc(money(item.priceMinor!, item.currency))}</span></span><span class="choice-side" style="font-size:20px" aria-hidden="true">+</span></button>`).join("")}
              </div>
            </div>` : ""}
          </div>
          <div class="panel sticky" style="display:grid;gap:16px">
            ${voucherMarkup(voucherDraft)}
            <div class="divider">${summaryMarkup()}</div>
            <button class="btn btn-gold" type="button" data-checkout="${checkout.action}" style="min-height:54px" ${checkout.disabled ? "disabled" : ""}>${esc(checkout.label)}</button>
            <a class="btn btn-sm" href="/menu" style="color:var(--green)">Keep ordering</a>
          </div>
        </div>
      </section>`;
    view.dataset.rendered = "1";
    if (focusKey === "voucher") {
      const input = view.querySelector<HTMLInputElement>("#voucher");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    } else if (focusKey) view.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]:not(:disabled)`)?.focus();
  };

  const remove = (index: number): void => {
    const item = findItem(basketLines()[index]?.menuItemId ?? "");
    const undo = removeLine(index);
    showToast({ text: `${item?.name ?? "Item"} removed`, actions: [{ label: "Undo", run: undo }], duration: 6000 });
    view.querySelector<HTMLElement>("[data-page-heading]")?.focus();
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const index = (name: string): number | null => {
      const value = target.closest<HTMLElement>(`[data-${name}]`)?.getAttribute(`data-${name}`);
      return value === undefined || value === null ? null : Number(value);
    };
    const dec = index("dec");
    if (dec !== null) {
      const line = basketLines()[dec];
      if (!line) return;
      if (line.quantity <= 1) remove(dec);
      else setQuantity(dec, line.quantity - 1);
      return;
    }
    const inc = index("inc");
    if (inc !== null) {
      const line = basketLines()[inc];
      if (line) setQuantity(inc, line.quantity + 1);
      return;
    }
    const removeIndex = index("remove");
    if (removeIndex !== null) return remove(removeIndex);
    const edit = index("edit");
    if (edit !== null) {
      const item = findItem(basketLines()[edit]?.menuItemId ?? "");
      if (!item) return;
      if (itemKind(item) === "pizza") navigate(`/menu/${item.slug}?edit=${edit}`);
      else openItemSheet(item, edit);
      return;
    }
    const upsell = target.closest<HTMLElement>("[data-upsell]")?.dataset.upsell;
    if (upsell) {
      const item = findItem(upsell);
      if (item) quickAdd(item);
      return;
    }
    if (target.closest("[data-voucher-remove]")) {
      voucherDraft = "";
      return setVoucherCode(null);
    }
    if (target.closest("[data-requote]")) return refreshQuote();
    if (target.closest("[data-area]")) return openAreaSheet();
    if (target.closest("[data-pickup]")) return openAreaSheet({ mode: "pickup" });
    const checkout = target.closest<HTMLButtonElement>("[data-checkout]");
    if (checkout && !checkout.disabled) {
      if (checkout.dataset.checkout === "area") openAreaSheet({ mode: "delivery" });
      else navigate("/checkout");
    }
  };

  const onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.id === "voucher") voucherDraft = input.value;
  };

  const onSubmit = (event: Event): void => {
    if (!(event.target as HTMLElement).matches("[data-voucher]")) return;
    event.preventDefault();
    const code = voucherDraft.trim() || getVoucherCode() || "";
    if (!code) {
      showToast({ text: "Enter a code first." });
      return;
    }
    setVoucherCode(code);
  };

  delete view.dataset.rendered;
  render();
  view.addEventListener("click", onClick);
  view.addEventListener("input", onInput);
  view.addEventListener("submit", onSubmit);
  const stops = [onBasketChange(render), onMenuChange(render), onContextChange(render), onConfigChange(render)];
  return () => {
    stops.forEach((stop) => stop());
    view.removeEventListener("click", onClick);
    view.removeEventListener("input", onInput);
    view.removeEventListener("submit", onSubmit);
    delete view.dataset.rendered;
  };
}
