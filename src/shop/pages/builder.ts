import { addLine, basketLines, replaceLine, type BasketLine } from "../basket.js";
import { builtPizzaArt, itemArt, sauceColour, toppingColour } from "../art.js";
import { esc, money } from "../format.js";
import { announceAdded } from "../feedback.js";
import {
  defaultOption, describeBasketLine, effectiveToppings, findItem, getMenu, isOrderable, itemKind, linePriceBreakdown,
  onMenuChange, optionsOf, sizeParts, type MenuItem, type MenuOption,
} from "../menu-data.js";
import { navigate } from "../router.js";
import { openItemSheet } from "../sheets.js";
import { showToast } from "../toast.js";
import { canOrderNow } from "../order-context.js";
import {
  amountLabel, baseMultiplierBp, extraCheeseMinor, maxInstructionsLength, maxToppings, toppingCostMinor,
  type Amount, type CheeseAmount, type LineTopping, type Side,
} from "../../../shared/pizza-rules.js";

const maxQuantity = 10;

function sizeScale(index: number, count: number): string {
  if (count <= 1 || index <= 0) return "74%";
  return index >= count - 1 ? "100%" : "87%";
}

/** A segmented control. `key` identifies what it sets: "sauce", "cheese", or "side:<optionId>" / "amount:<optionId>". */
const seg = <T extends string>(name: string, key: string, values: readonly T[], current: T | null, label: (value: T) => string, extra = ""): string =>
  `<div class="amt-group ${extra}" role="group" aria-label="${esc(name)}">${values.map((value) =>
    `<button type="button" aria-pressed="${value === current}" data-seg="${esc(key)}" data-value="${esc(value)}" data-focus-key="${esc(key)}-${esc(value)}">${esc(label(value))}</button>`).join("")}</div>`;

export function renderBuilder(view: HTMLElement, slug: string, editIndex: number | null): () => void {
  let item: MenuItem | undefined;
  let sizeId: string | null = null;
  let crustId: string | null = null;
  let sauceId: string | null = null;
  let sauceAmount: Amount = "normal";
  let cheese: CheeseAmount = "normal";
  let toppings: LineTopping[] = [];
  let quantity = 1;
  let note = "";
  let limitHit = false;
  let editing = false;
  let initialised = false;

  const initialise = (): void => {
    item = findItem(slug);
    if (!item || initialised || itemKind(item) !== "pizza") return;
    initialised = true;
    const line = editIndex !== null ? basketLines()[editIndex] : undefined;
    editing = !!line && line.menuItemId === item.id;
    const pick = (type: "size" | "crust" | "sauce"): string | null =>
      (editing ? line!.optionIds.find((id) => item!.options.find((option) => option.id === id)?.type === type) : undefined)
      ?? defaultOption(item!, type)?.id
      ?? optionsOf(item!, type).find((option) => option.available)?.id ?? null;
    sizeId = pick("size");
    crustId = pick("crust");
    sauceId = pick("sauce");
    toppings = effectiveToppings(item, editing ? line! : { optionIds: [] }).map((topping) => ({ ...topping }));
    if (editing && line) {
      sauceAmount = line.sauceAmount ?? "normal";
      cheese = line.cheese ?? "normal";
      quantity = line.quantity;
      note = line.instructions ?? "";
    }
  };

  const currentLine = (): BasketLine => ({
    menuItemId: item!.id,
    quantity,
    optionIds: [sizeId, crustId, sauceId].filter((id): id is string => !!id),
    toppings,
    cheese,
    sauceAmount,
    instructions: note.trim() || undefined,
  });

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
      if (itemKind(target) === "configurable") openItemSheet(target, editIndex);
      return;
    }

    const current = item;
    const byId = new Map(current.options.map((option) => [option.id, option]));
    const sizes = optionsOf(current, "size");
    const crusts = optionsOf(current, "crust");
    const sauces = optionsOf(current, "sauce");
    const toppingOptions = optionsOf(current, "topping");
    const size = sizes.find((option) => option.id === sizeId);
    const sizeIndex = Math.max(0, sizes.findIndex((option) => option.id === sizeId));
    const multiplierBp = size?.multiplierBp ?? baseMultiplierBp;
    const crust = crusts.find((option) => option.id === crustId);
    const sauce = sauces.find((option) => option.id === sauceId);
    const line = currentLine();
    const { unitMinor, rows } = linePriceBreakdown(current, line);
    const toppingOn = (id: string) => toppings.find((topping) => topping.optionId === id);
    const blocked = [size, crust, sauce, ...toppings.map((topping) => byId.get(topping.optionId))].filter((option): option is MenuOption => !!option && !option.available);
    const crustInvalid = !!crust?.requiresLarge && multiplierBp <= baseMultiplierBp;
    const orderable = isOrderable(current) && !blocked.length && !crustInvalid;
    const halves = toppings.some((topping) => topping.side !== "whole");
    const halfList = (side: Side) => toppings.filter((topping) => topping.side === side || topping.side === "whole").map((topping) => byId.get(topping.optionId)?.name ?? "").filter(Boolean).join(", ") || "Cheese only";
    const summary = describeBasketLine(current, line);

    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
    view.innerHTML = `
      <section class="wrap builder ${view.dataset.rendered ? "" : "view"}">
        <a class="back-link" href="${editing ? "/basket" : "/menu"}">← ${editing ? "Basket" : "Menu"}</a>
        <div class="builder-grid">
          <div class="builder-vis">
            <p class="kicker">${size ? esc(`${sizeParts(size.name).label} · ${sizeParts(size.name).detail}`) : ""}</p>
            <h1 tabindex="-1" data-page-heading>${esc(current.name)}</h1>
            ${itemArt(current, "builder-product-photo")}
            <div class="builder-custom-preview">
              <p class="builder-preview-label">Live build preview</p>
              ${builtPizzaArt({
                toppings: toppings.map((topping) => ({ colour: toppingColour(byId.get(topping.optionId)?.code ?? null), side: topping.side, amount: topping.amount })),
                sauceColour: sauceColour(sauce?.code ?? null), sauceAmount, cheese, width: `min(100%, ${sizeScale(sizeIndex, sizes.length)})`,
              })}
            </div>
            ${halves ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;line-height:1.5">
              <div><strong style="display:block;color:var(--gold-hover);font-size:11px;letter-spacing:.14em;text-transform:uppercase">Left half</strong>${esc(halfList("left"))}</div>
              <div style="text-align:right"><strong style="display:block;color:var(--gold-hover);font-size:11px;letter-spacing:.14em;text-transform:uppercase">Right half</strong>${esc(halfList("right"))}</div>
            </div>` : ""}
            <p class="summary">${esc(current.description)}</p>
            ${summary ? `<p class="summary" style="margin-top:6px;color:var(--gold-hover);font-weight:700">${esc(summary)}</p>` : ""}
          </div>
          <div class="builder-opts">
            <div>
              <h2>Size</h2>
              <div class="opt-grid-3" role="group" aria-label="Size">
                ${sizes.map((option) => {
                  const parts = sizeParts(option.name);
                  return `<button class="opt" type="button" aria-pressed="${option.id === sizeId}" data-size="${esc(option.id)}" data-focus-key="size-${esc(option.id)}" ${option.available ? "" : "disabled"}>
                    <b>${esc(parts.label)}</b><span>${esc(parts.detail)}</span><span class="opt-price">${!option.available ? "Unavailable today" : option.priceDeltaMinor ? `+${esc(money(option.priceDeltaMinor))}` : "Base price"}</span>
                  </button>`;
                }).join("")}
              </div>
            </div>
            ${crusts.length ? `<div>
              <h2>Crust</h2>
              <div style="display:grid;gap:8px" role="group" aria-label="Crust">
                ${crusts.map((option) => {
                  const needsLarge = option.requiresLarge && multiplierBp <= baseMultiplierBp;
                  const disabled = !option.available || needsLarge;
                  const sub = !option.available ? "Unavailable today" : option.requiresLarge ? "Large or Family only" : option.code === "thin" ? "Light and crunchy" : "Soft, golden edge";
                  return `<button class="opt" type="button" aria-pressed="${option.id === crustId}" data-crust="${esc(option.id)}" data-focus-key="crust-${esc(option.id)}" ${disabled ? "disabled" : ""} style="display:flex;align-items:center;justify-content:space-between;min-height:54px">
                    <span style="display:grid"><b>${esc(option.name)}</b><span>${esc(sub)}</span></span><span class="opt-price">${option.priceDeltaMinor ? `+${esc(money(option.priceDeltaMinor))}` : "Included"}</span>
                  </button>`;
                }).join("")}
              </div>
              ${crustInvalid ? `<p class="field-error" role="alert" style="margin:8px 0 0">Cheese-stuffed crust needs a Large or Family pizza.</p>` : ""}
            </div>` : ""}
            ${sauces.length ? `<div>
              <h2>Sauce</h2>
              <div style="display:flex;flex-wrap:wrap;gap:8px" role="group" aria-label="Sauce">
                ${sauces.map((option) => `<button class="chip" type="button" aria-pressed="${option.id === sauceId}" data-sauce="${esc(option.id)}" data-focus-key="sauce-${esc(option.id)}" ${option.available ? "" : "disabled"} style="display:flex;align-items:center;gap:8px"><i style="width:12px;height:12px;border-radius:50%;background:${sauceColour(option.code)}"></i>${esc(option.name)}</button>`).join("")}
              </div>
              <div style="margin-top:10px">${seg("Sauce amount", "sauce", ["light", "normal", "extra"] as const, sauceAmount, amountLabel)}</div>
            </div>` : ""}
            <div>
              <h2>Cheese</h2>
              ${seg("Cheese", "cheese", ["none", "light", "normal", "extra"] as const, cheese, (value) => value === "extra" ? `Extra +${money(extraCheeseMinor(multiplierBp))}` : amountLabel(value))}
            </div>
            <div>
              <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px"><h2 style="margin:0">Toppings</h2><span class="muted" style="font-size:13px;font-weight:700">${toppings.length} of ${maxToppings}</span></div>
              <p class="muted" style="margin:0 0 8px;font-size:13px;line-height:1.5">Recipe toppings are included. Half toppings cost half. Extra doubles the portion.</p>
              ${limitHit ? `<p class="notice warn" role="alert" style="margin:0 0 8px">You've reached ${maxToppings} toppings. Remove one to add another.</p>` : ""}
              <div>
                ${toppingOptions.map((option) => {
                  const on = toppingOn(option.id);
                  const cost = on
                    ? toppingCostMinor({ unitMinor: option.priceDeltaMinor ?? 0, multiplierBp, inRecipe: option.isDefault, side: on.side, amount: on.amount })
                    : option.isDefault ? 0 : toppingCostMinor({ unitMinor: option.priceDeltaMinor ?? 0, multiplierBp, inRecipe: false, side: "whole", amount: "normal" });
                  const priceText = !option.available ? "Unavailable today" : cost ? `+${money(cost)}` : "Included";
                  return `<div class="topping-item ${on && !option.available ? "is-problem" : ""}">
                    <div class="topping-row" style="border:0;padding:0">
                      <span class="topping-name"><i style="background:${toppingColour(option.code)}"></i>${esc(option.name)}${option.isDefault ? `<span class="badge" style="background:var(--ok-bg);color:var(--green)">In recipe</span>` : ""}</span>
                      <span class="topping-act"><span>${esc(priceText)}</span>
                        <button class="toggle-btn" type="button" aria-pressed="${!!on}" data-topping="${esc(option.id)}" data-focus-key="top-${esc(option.id)}" aria-label="${on ? "Remove" : "Add"} ${esc(option.name)}" ${option.available || on ? "" : "disabled"}>${on ? "Remove" : "Add"}</button>
                      </span>
                    </div>
                    ${on ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 0 0 24px">
                      ${seg(`Placement of ${option.name}`, `side:${option.id}`, ["left", "whole", "right"] as const, on.side, (value) => value === "whole" ? "Whole" : value === "left" ? "Left half" : "Right half", "sm")}
                      ${seg(`Amount of ${option.name}`, `amount:${option.id}`, ["light", "normal", "extra"] as const, on.amount, amountLabel, "sm")}
                    </div>` : ""}
                  </div>`;
                }).join("")}
              </div>
            </div>
            <div class="field">
              <label for="pizza-note">Special instructions <span class="opt-tag">(optional)</span></label>
              <textarea id="pizza-note" data-note maxlength="${maxInstructionsLength}" placeholder="e.g. Well done, cut into squares">${esc(note)}</textarea>
              <span class="field-hint">${note.length}/${maxInstructionsLength}</span>
            </div>
            <div class="price-card" aria-live="polite">
              <h2>Price</h2>
              ${rows.map((row) => `<div class="price-row"><span>${esc(row.label)}</span><b>${row === rows[0] ? "" : "+"}${esc(money(row.amountMinor))}</b></div>`).join("")}
              ${quantity > 1 ? `<div class="price-row"><span>Quantity</span><b>× ${quantity}</b></div>` : ""}
            </div>
          </div>
        </div>
      </section>
      <div class="add-bar"><div class="wrap">
        ${!isOrderable(current) ? `<span class="add-note">Sold out today</span>`
          : blocked.length ? `<span class="add-note">Remove ${esc(blocked.map((option) => option.name).join(", "))}: unavailable today</span>`
          : !canOrderNow() ? `<span class="add-note">Closed now · you can order for later</span>` : ""}
        <div class="stepper" role="group" aria-label="Quantity">
          <button type="button" data-qty="-1" data-focus-key="qty-down" aria-label="Fewer" ${quantity <= 1 ? "disabled" : ""}>−</button>
          <output aria-live="polite">${quantity}</output>
          <button type="button" data-qty="1" data-focus-key="qty-up" aria-label="More" ${quantity >= maxQuantity ? "disabled" : ""}>+</button>
        </div>
        <button class="btn btn-gold" type="button" data-add-pizza data-focus-key="add" ${orderable ? "" : "disabled"}>${editing ? "Update basket" : "Add to basket"} · ${esc(money(unitMinor * quantity))}</button>
      </div></div>`;
    view.dataset.rendered = "1";
    if (focusKey) view.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]:not(:disabled)`)?.focus({ preventScroll: true });
  };

  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled || !item) return;
    if (button.dataset.size) {
      sizeId = button.dataset.size;
      // Dropping to Regular takes the stuffed crust back to the default.
      const crust = item.options.find((option) => option.id === crustId);
      const size = item.options.find((option) => option.id === sizeId);
      if (crust?.requiresLarge && (size?.multiplierBp ?? baseMultiplierBp) <= baseMultiplierBp) crustId = defaultOption(item, "crust")?.id ?? crustId;
      return render();
    }
    if (button.dataset.crust) { crustId = button.dataset.crust; return render(); }
    if (button.dataset.sauce) { sauceId = button.dataset.sauce; return render(); }
    if (button.dataset.seg) {
      const [key, optionId] = button.dataset.seg.split(":");
      const value = button.dataset.value!;
      if (key === "sauce") sauceAmount = value as Amount;
      else if (key === "cheese") cheese = value as CheeseAmount;
      else {
        const topping = toppings.find((candidate) => candidate.optionId === optionId);
        if (topping && key === "side") topping.side = value as Side;
        if (topping && key === "amount") topping.amount = value as Amount;
      }
      return render();
    }
    if (button.dataset.topping) {
      const id = button.dataset.topping;
      if (toppings.some((topping) => topping.optionId === id)) {
        toppings = toppings.filter((topping) => topping.optionId !== id);
        limitHit = false;
      } else if (toppings.length >= maxToppings) {
        limitHit = true;
      } else {
        toppings = [...toppings, { optionId: id, side: "whole", amount: "normal" }];
      }
      return render();
    }
    if (button.dataset.qty) {
      quantity = Math.max(1, Math.min(maxQuantity, quantity + Number(button.dataset.qty)));
      return render();
    }
    if (button.matches("[data-add-pizza]")) {
      const line = currentLine();
      if (editing && editIndex !== null) {
        replaceLine(editIndex, line);
        navigate("/basket");
        showToast({ text: `${item.name} updated` });
        return;
      }
      const result = addLine(line);
      if (!result.ok) return showToast({ text: result.reason });
      const added = item;
      navigate("/menu");
      announceAdded(added, quantity);
    }
  };

  const onInput = (event: Event): void => {
    const input = event.target as HTMLTextAreaElement;
    if (!input.matches("[data-note]")) return;
    note = input.value;
    const hint = input.parentElement?.querySelector(".field-hint");
    if (hint) hint.textContent = `${note.length}/${maxInstructionsLength}`;
  };

  delete view.dataset.rendered;
  render();
  view.addEventListener("click", onClick);
  view.addEventListener("input", onInput);
  const stopMenu = onMenuChange(render);
  return () => {
    stopMenu();
    view.removeEventListener("click", onClick);
    view.removeEventListener("input", onInput);
    delete view.dataset.rendered;
  };
}
