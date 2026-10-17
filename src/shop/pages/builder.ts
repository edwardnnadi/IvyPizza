import { addLine, basketLines, replaceLine } from "../basket.js";
import { extraColour, pizzaArt } from "../art.js";
import { esc, money } from "../format.js";
import { announceAdded } from "../feedback.js";
import { extraOptions, findItem, getMenu, isOrderable, itemKind, onMenuChange, sizeOptions, sizeParts, unitPriceMinor, type MenuItem } from "../menu-data.js";
import { navigate } from "../router.js";
import { openItemSheet } from "../sheets.js";
import { showToast } from "../toast.js";
import { kitchenHours } from "../zones.js";

const maxQuantity = 10;

function sizeScale(index: number, count: number): { width: string; size: "regular" | "large" | "family" } {
  if (count <= 1 || index <= 0) return { width: "74%", size: "regular" };
  if (index >= count - 1) return { width: "100%", size: "family" };
  return { width: "87%", size: "large" };
}

export function renderBuilder(view: HTMLElement, slug: string, editIndex: number | null): () => void {
  let item: MenuItem | undefined;
  let sizeId: string | null = null;
  const extras = new Set<string>();
  let quantity = 1;
  let editing = false;
  let initialised = false;

  const initialise = (): void => {
    item = findItem(slug);
    if (!item || initialised) return;
    initialised = true;
    const line = editIndex !== null ? basketLines()[editIndex] : undefined;
    editing = !!line && line.menuItemId === item.id;
    const sizes = sizeOptions(item);
    if (editing && line) {
      sizeId = line.optionIds.find((id) => sizes.some((option) => option.id === id)) ?? null;
      for (const id of line.optionIds) if (id !== sizeId) extras.add(id);
      quantity = line.quantity;
    }
    sizeId ??= sizes.find((option) => option.available)?.id ?? null;
  };

  const render = (): void => {
    const menu = getMenu();
    initialise();
    if (menu.status === "loading") {
      view.innerHTML = `<section class="wrap builder view" aria-busy="true"><div class="builder-grid"><div class="skeleton" style="height:480px"></div><div class="skeleton" style="height:480px"></div></div></section>`;
      return;
    }
    if (menu.status === "error" || !item) {
      view.innerHTML = `<section class="wrap builder view"><div class="state-box" role="alert"><h2 tabindex="-1" data-page-heading>${menu.status === "error" ? "We couldn't load this pizza" : "We couldn't find that dish"}</h2><p>${menu.status === "error" ? "Check your connection and try again." : "It may have come off the menu. Everything we're serving today is on the menu."}</p><a class="btn btn-green" href="/menu">See the menu</a></div></section>`;
      return;
    }
    if (itemKind(item) !== "pizza") {
      // Burgers and simple items use the options sheet on the menu page.
      const target = item;
      navigate("/menu", { replace: true });
      if (itemKind(target) === "configurable") openItemSheet(target, editing ? editIndex : null);
      return;
    }

    const current = item;
    const sizes = sizeOptions(current);
    const extraList = extraOptions(current);
    const sizeIndex = Math.max(0, sizes.findIndex((option) => option.id === sizeId));
    const size = sizes[sizeIndex];
    const scale = sizeScale(sizeIndex, sizes.length);
    const chosenExtras = extraList.filter((option) => extras.has(option.id));
    const optionIds = [...(sizeId ? [sizeId] : []), ...extras];
    const unit = unitPriceMinor(current, optionIds);
    const orderable = isOrderable(current) && (!size || size.available) && chosenExtras.every((option) => option.available);
    const sizeText = size ? `${sizeParts(size.name).label} · ${sizeParts(size.name).detail}` : "";
    const summary = [size ? `${sizeParts(size.name).label} ${sizeParts(size.name).detail}` : "", ...chosenExtras.map((option) => `+ ${option.name.toLowerCase()}`)].filter(Boolean).join(" · ");
    const hours = kitchenHours();

    const rows = [
      { k: `${current.name}${size ? `, ${sizeParts(size.name).label}` : ""}`, v: money((current.priceMinor ?? 0) + (size?.priceDeltaMinor ?? 0), current.currency) },
      ...chosenExtras.map((option) => ({ k: option.name, v: `+${money(option.priceDeltaMinor ?? 0, current.currency)}` })),
      ...(quantity > 1 ? [{ k: "Quantity", v: `× ${quantity}` }] : []),
    ];

    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
    view.innerHTML = `
      <section class="wrap builder ${initialised && view.dataset.rendered ? "" : "view"}">
        <a class="back-link" href="${editing ? "/basket" : "/menu"}">← ${editing ? "Basket" : "Menu"}</a>
        <div class="builder-grid">
          <div class="builder-vis">
            <p class="kicker">${esc(sizeText)}</p>
            <h1 tabindex="-1" data-page-heading>${esc(current.name)}</h1>
            ${pizzaArt(current, { extras: chosenExtras, width: `min(100%, ${scale.width})`, size: scale.size })}
            <p class="summary">${esc(current.description)}</p>
            ${summary ? `<p class="summary" style="margin-top:6px;color:var(--gold-hover);font-weight:700">${esc(summary)}</p>` : ""}
          </div>
          <div class="builder-opts">
            ${sizes.length ? `<div>
              <h2>Size</h2>
              <div class="opt-grid-3" role="group" aria-label="Size">
                ${sizes.map((option) => {
                  const parts = sizeParts(option.name);
                  return `<button class="opt" type="button" aria-pressed="${option.id === sizeId}" data-size="${esc(option.id)}" data-focus-key="size-${esc(option.id)}" ${option.available ? "" : "disabled"}>
                    <b>${esc(parts.label)}</b><span>${esc(parts.detail)}</span><span class="opt-price">${!option.available ? "Unavailable today" : option.priceDeltaMinor ? `+${esc(money(option.priceDeltaMinor, current.currency))}` : "Base price"}</span>
                  </button>`;
                }).join("")}
              </div>
            </div>` : ""}
            ${extraList.length ? `<div>
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px"><h2 style="margin:0">Extra toppings</h2><span class="muted" style="font-size:13px;font-weight:700">${chosenExtras.length ? `${chosenExtras.length} added` : "Optional"}</span></div>
              <p class="muted" style="margin:0 0 8px;font-size:13px;line-height:1.5">The recipe toppings are included. Add more if you like.</p>
              <div role="group" aria-label="Extra toppings">
                ${extraList.map((option) => {
                  const on = extras.has(option.id);
                  return `<div class="topping-row">
                    <span class="topping-name"><i style="background:${extraColour(option)}"></i>${esc(option.name)}</span>
                    <span class="topping-act"><span>${option.available ? `+${esc(money(option.priceDeltaMinor ?? 0, current.currency))}` : "Unavailable today"}</span>
                      <button class="toggle-btn" type="button" aria-pressed="${on}" data-extra="${esc(option.id)}" data-focus-key="extra-${esc(option.id)}" aria-label="${on ? "Remove" : "Add"} ${esc(option.name)}" ${option.available || on ? "" : "disabled"}>${on ? "Remove" : "Add"}</button>
                    </span>
                  </div>`;
                }).join("")}
              </div>
            </div>` : ""}
            <div class="price-card" aria-live="polite">
              <h2>Price</h2>
              ${rows.map((row) => `<div class="price-row"><span>${esc(row.k)}</span><b>${esc(row.v)}</b></div>`).join("")}
            </div>
          </div>
        </div>
      </section>
      <div class="add-bar"><div class="wrap">
        ${!hours.open ? `<span class="add-note">Closed now · opens ${esc(hours.opensAt)}</span>` : !orderable ? `<span class="add-note">${isOrderable(current) ? "Remove unavailable choices to continue" : "Sold out today"}</span>` : ""}
        <div class="stepper" role="group" aria-label="Quantity">
          <button type="button" data-qty="-1" data-focus-key="qty-down" aria-label="Fewer" ${quantity <= 1 ? "disabled" : ""}>−</button>
          <output aria-live="polite">${quantity}</output>
          <button type="button" data-qty="1" data-focus-key="qty-up" aria-label="More" ${quantity >= maxQuantity ? "disabled" : ""}>+</button>
        </div>
        <button class="btn btn-gold" type="button" data-add-pizza data-focus-key="add" ${orderable ? "" : "disabled"}>${editing ? "Update basket" : "Add to basket"} · ${esc(money(unit * quantity, current.currency))}</button>
      </div></div>`;
    view.dataset.rendered = "1";
    if (focusKey) view.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]:not(:disabled)`)?.focus();
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const size = target.closest<HTMLButtonElement>("[data-size]");
    if (size && !size.disabled) {
      sizeId = size.dataset.size!;
      return render();
    }
    const extra = target.closest<HTMLButtonElement>("[data-extra]");
    if (extra && !extra.disabled) {
      const id = extra.dataset.extra!;
      if (extras.has(id)) extras.delete(id);
      else extras.add(id);
      return render();
    }
    const qty = target.closest<HTMLButtonElement>("[data-qty]");
    if (qty && !qty.disabled) {
      quantity = Math.max(1, Math.min(maxQuantity, quantity + Number(qty.dataset.qty)));
      return render();
    }
    if (target.closest("[data-add-pizza]") && item) {
      const optionIds = [...(sizeId ? [sizeId] : []), ...extras];
      if (editing && editIndex !== null) {
        replaceLine(editIndex, item.id, optionIds, quantity);
        navigate("/basket");
        showToast({ text: `${item.name} updated` });
        return;
      }
      const result = addLine(item.id, optionIds, quantity);
      if (!result.ok) return showToast({ text: result.reason });
      const added = item;
      navigate("/menu");
      announceAdded(added, quantity);
    }
  };

  delete view.dataset.rendered;
  render();
  view.addEventListener("click", onClick);
  const stopMenu = onMenuChange(render);
  return () => {
    stopMenu();
    view.removeEventListener("click", onClick);
    delete view.dataset.rendered;
  };
}
