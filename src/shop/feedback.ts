import { addLine, basketLines } from "./basket.js";
import { esc, money } from "./format.js";
import { findItem, isOrderable, itemKind, menuItems, type MenuItem } from "./menu-data.js";
import { showToast } from "./toast.js";

/** Simple, ready-to-add items from the sides and drinks ranges that are not already in the basket. */
export function upsellItems(limit: number, pattern = /drink|side/i): MenuItem[] {
  const inBasket = new Set(basketLines().map((line) => line.menuItemId));
  return menuItems()
    .filter((item) => pattern.test(item.category) && isOrderable(item) && itemKind(item) === "simple" && !inBasket.has(item.id))
    .slice(0, limit);
}

export function bumpBasketCount(): void {
  const badge = document.querySelector<HTMLElement>(".basket-count");
  if (!badge) return;
  badge.classList.remove("bump");
  void badge.offsetWidth;
  badge.classList.add("bump");
}

/** The add-to-basket moment: count bump, toast, and the single gentle upsell (a drink) when one exists. */
export function announceAdded(item: MenuItem, quantity: number, allowUpsell = true): void {
  bumpBasketCount();
  const drinks = allowUpsell && !/drink/i.test(item.category) ? upsellItems(2, /drink/i) : [];
  showToast({
    text: `${quantity} × ${item.name} added`,
    actions: [{ label: "View basket", href: "/basket" }],
    extra: drinks.length
      ? `<p style="margin:12px 0 8px;font-size:13px;color:var(--on-dark)">Add a drink?</p>
         <div style="display:flex;flex-wrap:wrap;gap:8px">${drinks.map((drink) => `<button class="btn btn-sm toast-ghost" type="button" data-upsell="${esc(drink.id)}">${esc(drink.name)} · ${esc(money(drink.priceMinor!, drink.currency))}</button>`).join("")}</div>`
      : undefined,
    onExtraClick: (target) => {
      const id = target.closest<HTMLElement>("[data-upsell]")?.dataset.upsell;
      const drink = id ? findItem(id) : undefined;
      if (!drink) return;
      const result = addLine(drink.id, [], 1);
      if (result.ok) announceAdded(drink, 1, false);
      else showToast({ text: result.reason });
    },
  });
}

/** Adds an item that needs no choices straight from a card or upsell button. */
export function quickAdd(item: MenuItem): void {
  const result = addLine(item.id, [], 1);
  if (result.ok) announceAdded(item, 1);
  else showToast({ text: result.reason });
}
