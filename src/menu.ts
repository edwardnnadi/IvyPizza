import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { apiUrl } from "./api.js";
import { EASE_OUT_EXPO, flipCards, flyToBasket, isNarrow, isPillVisible, prefersReducedMotion, revealCardsOnEnter } from "./motion.js";

interface MenuItem {
  id: string;
  slug?: string;
  name: string;
  category: string;
  description: string;
  priceMinor: number | null;
  currency: string;
  available: boolean;
  options: MenuOption[];
}

interface MenuOption {
  id: string;
  name: string;
  type: "size" | "extra";
  priceDeltaMinor: number | null;
  available: boolean;
}

interface BasketLine {
  menuItemId: string;
  quantity: number;
  optionIds: string[];
}

interface MenuQuote {
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    options: Array<{ id: string; name: string; type: string; priceDeltaMinor: number }>;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
}

interface SavedAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  landmark: string | null;
  instructions: string | null;
}

interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  fulfillmentStatus: string;
  paymentStatus: string;
  replayed?: boolean;
  existingOrderNumber?: string;
  error?: string;
}

/** Per-card choices, kept across filter changes so a half-built order survives re-rendering. */
interface CardConfig {
  sizeId: string | null;
  extraIds: Set<string>;
  quantity: number;
  extrasOpen: boolean;
}

const basketStorageKey = "ivy-pizza-basket-v1";
const checkoutKeyStorageKey = "ivy-pizza-checkout-key-v1";
const maxLineQuantity = 20;
const maxBasketLines = 30;

function $<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatMoney(amountMinor: number, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amountMinor / 100);
}

/** "Large · 13 inch" → { label: "Large", detail: '13"' } */
function sizeParts(name: string): { label: string; detail: string } {
  const [label, ...rest] = name.split("·").map((part) => part.trim());
  return { label: label ?? name, detail: rest.join(" ").replace(/(\d+)\s*inch(es)?/i, '$1"') };
}

function singular(category: string): string {
  return category.replace(/s$/i, "");
}

function lineKey(line: Pick<BasketLine, "menuItemId" | "optionIds">): string {
  return `${line.menuItemId}|${[...line.optionIds].sort().join("+")}`;
}

export function initializePublicMenu(client: SupabaseClient | null, requireSignIn: () => void): void {
  let menuItems: MenuItem[] = [];
  let menuState: "loading" | "live" | "error" = "loading";
  let basket: BasketLine[] = readBasket();
  let activeCategory = "All";
  let quoteSequence = 0;
  let quoteDebounce: number | undefined;
  let quoteLines = new Map<string, number>();
  let shownSubtotalMinor = 0;
  let subtotalAnimation = 0;
  let currency = "NGN";
  let renderedLineKeys = new Set<string>();
  const cardConfigs = new Map<string, CardConfig>();
  const addedTimers = new Map<string, number>();

  const grid = $<HTMLDivElement>("#menu-items");
  const basketPanel = $<HTMLElement>("#basket");
  const basketScrim = $<HTMLDivElement>("#basket-scrim");
  const basketLines = $<HTMLUListElement>("#basket-lines");
  const basketEmpty = $<HTMLDivElement>("#basket-empty");
  const basketCount = $<HTMLSpanElement>("#basket-count");
  const basketSubtotal = $<HTMLElement>("#basket-subtotal");
  const basketUpdating = $<HTMLSpanElement>("#basket-updating");
  const basketStatus = $<HTMLParagraphElement>("#basket-status");
  const checkoutButton = $<HTMLButtonElement>("#basket-checkout");
  const pill = $<HTMLButtonElement>("#basket-pill");
  const pillText = $<HTMLSpanElement>("#basket-pill-text");
  const pillCta = $<HTMLSpanElement>("#basket-pill-cta");
  const filterIndicator = $<HTMLSpanElement>("#menu-filter-ind");
  const filterButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#menu-filters [data-category]"));

  function readBasket(): BasketLine[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(basketStorageKey) ?? "[]");
      if (!Array.isArray(value)) return [];
      return value.filter((line): line is BasketLine =>
        typeof line === "object" && line !== null &&
        typeof line.menuItemId === "string" &&
        Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= maxLineQuantity &&
        Array.isArray(line.optionIds) && line.optionIds.every((id: unknown) => typeof id === "string"),
      ).slice(0, maxBasketLines);
    } catch {
      return [];
    }
  }

  function persistBasket(): void {
    try {
      localStorage.setItem(basketStorageKey, JSON.stringify(basket));
      localStorage.removeItem(checkoutKeyStorageKey);
    } catch {
      // The basket still works for this visit when storage is unavailable.
    }
  }

  function setStatus(message: string, kind: "info" | "error" = "info"): void {
    basketStatus.textContent = message;
    basketStatus.dataset.kind = kind;
  }

  function orderable(item: MenuItem): boolean {
    return item.available && item.priceMinor !== null;
  }

  function sizeOptions(item: MenuItem): MenuOption[] {
    return item.options.filter((option) => option.type === "size" && option.available && option.priceDeltaMinor !== null);
  }

  function extraOptions(item: MenuItem): MenuOption[] {
    return item.options.filter((option) => option.type === "extra" && option.available && option.priceDeltaMinor !== null);
  }

  function configFor(item: MenuItem): CardConfig {
    let config = cardConfigs.get(item.id);
    if (!config) {
      config = { sizeId: sizeOptions(item)[0]?.id ?? null, extraIds: new Set(), quantity: 1, extrasOpen: false };
      cardConfigs.set(item.id, config);
    }
    return config;
  }

  function selectedOptionIds(item: MenuItem): string[] {
    const config = configFor(item);
    return [...(config.sizeId ? [config.sizeId] : []), ...config.extraIds];
  }

  function estimateUnitMinor(item: MenuItem, optionIds: string[]): number {
    return (item.priceMinor ?? 0) + item.options
      .filter((option) => optionIds.includes(option.id))
      .reduce((total, option) => total + (option.priceDeltaMinor ?? 0), 0);
  }

  function describeOptions(item: MenuItem | undefined, optionIds: string[]): string {
    if (!item) return menuState === "live" ? "No longer on the menu" : "";
    const chosen = item.options.filter((option) => optionIds.includes(option.id));
    const parts = chosen
      .sort((a, b) => (a.type === b.type ? 0 : a.type === "size" ? -1 : 1))
      .map((option) => {
        if (option.type !== "size") return option.name;
        const { label, detail } = sizeParts(option.name);
        return detail ? `${label} · ${detail}` : label;
      });
    return parts.length ? parts.join(" · ") : "Standard";
  }

  // ---------- Filters ----------

  function moveFilterIndicator(animate: boolean): void {
    const active = filterButtons.find((button) => button.dataset.category === activeCategory);
    if (!active) return;
    if (!animate) filterIndicator.style.transition = "none";
    filterIndicator.style.width = `${active.offsetWidth}px`;
    filterIndicator.style.transform = `translateX(${active.offsetLeft}px)`;
    if (!animate) requestAnimationFrame(() => (filterIndicator.style.transition = ""));
  }

  function updateFilterCounts(): void {
    for (const button of filterButtons) {
      const category = button.dataset.category ?? "All";
      const count = category === "All" ? menuItems.length : menuItems.filter((item) => item.category === category).length;
      button.querySelector(".menu-filter-count")!.textContent = menuState === "live" ? String(count) : "";
    }
    moveFilterIndicator(false);
  }

  function setCategory(category: string): void {
    if (category === activeCategory) return;
    const before = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-card-id]").forEach((card) => before.set(card.dataset.cardId ?? "", card.getBoundingClientRect()));
    activeCategory = category;
    for (const button of filterButtons) button.setAttribute("aria-pressed", String(button.dataset.category === category));
    moveFilterIndicator(true);
    renderMenu();
    flipCards(grid, before);
  }

  // ---------- Menu cards ----------

  function renderSkeletons(): void {
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren(...Array.from({ length: 6 }, (_, index) => {
      const skeleton = element("div", "menu-skeleton");
      skeleton.setAttribute("aria-hidden", "true");
      skeleton.style.animationDelay = `${index * 0.12}s`;
      for (let i = 0; i < 6; i += 1) skeleton.append(element("span"));
      return skeleton;
    }));
  }

  function renderMenu(): void {
    grid.setAttribute("aria-busy", String(menuState === "loading"));
    if (menuState === "loading") {
      renderSkeletons();
      return;
    }
    if (menuState === "error") {
      const box = element("div", "menu-state menu-error");
      box.setAttribute("role", "alert");
      const copy = element("div");
      copy.append(element("p", "menu-state-title", "We couldn't load the menu."), element("p", "menu-state-text", "Check your connection and try again."));
      const retry = element("button", undefined, "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => void loadMenu());
      box.append(copy, retry);
      grid.replaceChildren(box);
      return;
    }
    const visible = menuItems.filter((item) => activeCategory === "All" || item.category === activeCategory);
    if (visible.length === 0) {
      const box = element("div", "menu-state menu-empty");
      box.append(
        element("p", "menu-state-title", activeCategory === "All" ? "Nothing on the menu right now." : `No ${activeCategory.toLowerCase()} available right now.`),
        element("p", "menu-state-text", "Check back soon, or browse the full menu."),
      );
      if (activeCategory !== "All") {
        const showAll = element("button", undefined, "Show everything");
        showAll.type = "button";
        showAll.addEventListener("click", () => setCategory("All"));
        box.append(showAll);
      }
      grid.replaceChildren(box);
      return;
    }
    grid.replaceChildren(...visible.map(createCard));
  }

  function createCard(item: MenuItem): HTMLElement {
    const config = configFor(item);
    const canOrder = orderable(item);
    const card = element("article", "menu-card");
    card.dataset.cardId = item.id;
    card.setAttribute("aria-label", item.name);
    card.classList.toggle("is-unavailable", !canOrder);

    const top = element("div", "menu-card-top");
    top.append(element("span", "menu-card-cat", singular(item.category)));
    if (!canOrder) top.append(element("span", "menu-card-badge", item.priceMinor === null ? "Coming soon" : "Sold out today"));
    card.append(top, element("h3", undefined, item.name), element("p", "menu-card-desc", item.description));
    card.append(element("p", "menu-card-from", item.priceMinor === null ? "Price coming soon" : `From ${formatMoney(item.priceMinor, item.currency)}`));

    const addButton = element("button", "add-btn");
    addButton.type = "button";
    const refreshAddLabel = (): void => {
      if (!canOrder) {
        addButton.textContent = "Unavailable";
        return;
      }
      if (card.classList.contains("is-added")) {
        addButton.textContent = "Added ✓";
        return;
      }
      addButton.textContent = `Add · ${formatMoney(estimateUnitMinor(item, selectedOptionIds(item)) * config.quantity, item.currency)}`;
    };

    const sizes = sizeOptions(item);
    if (sizes.length) {
      const group = element("fieldset", "size-chips");
      const legend = element("legend", "visually-hidden", `Size for ${item.name}`);
      group.append(legend);
      for (const option of sizes) {
        const { label, detail } = sizeParts(option.name);
        const chip = element("label", "size-chip");
        const input = element("input");
        input.type = "radio";
        input.name = `size-${item.id}`;
        input.value = option.id;
        input.checked = config.sizeId === option.id;
        input.disabled = !canOrder;
        input.addEventListener("change", () => {
          config.sizeId = option.id;
          refreshAddLabel();
        });
        chip.append(
          input,
          element("span", "size-chip-name", detail ? `${label} ${detail}` : label),
          element("span", "size-chip-extra", option.priceDeltaMinor ? `+${formatMoney(option.priceDeltaMinor, item.currency)}` : "Base"),
        );
        group.append(chip);
      }
      card.append(group);
    }

    const extras = extraOptions(item);
    if (extras.length) {
      const wrapper = element("div", "extras");
      const toggle = element("button", "extras-toggle");
      toggle.type = "button";
      toggle.disabled = !canOrder;
      const toggleLabel = element("span");
      const plus = element("span", "extras-plus", "+");
      plus.setAttribute("aria-hidden", "true");
      toggle.append(toggleLabel, plus);
      const panelId = `extras-${item.id}`;
      toggle.setAttribute("aria-controls", panelId);
      const panel = element("div", "extras-panel");
      panel.id = panelId;
      const inner = element("div");
      const list = element("fieldset", "extras-list");
      list.append(element("legend", "visually-hidden", `Extras for ${item.name}`));
      const refreshExtras = (): void => {
        toggle.setAttribute("aria-expanded", String(config.extrasOpen));
        panel.classList.toggle("is-open", config.extrasOpen);
        toggleLabel.textContent = config.extraIds.size ? `Extras · ${config.extraIds.size} added` : `Add extras (${extras.length})`;
      };
      for (const option of extras) {
        const label = element("label");
        const input = element("input");
        input.type = "checkbox";
        input.value = option.id;
        input.checked = config.extraIds.has(option.id);
        input.disabled = !canOrder;
        input.addEventListener("change", () => {
          if (input.checked) config.extraIds.add(option.id);
          else config.extraIds.delete(option.id);
          refreshExtras();
          refreshAddLabel();
        });
        const text = element("span", undefined, `${option.name} `);
        text.append(element("span", "price", `+${formatMoney(option.priceDeltaMinor!, item.currency)}`));
        label.append(input, text);
        list.append(label);
      }
      toggle.addEventListener("click", () => {
        config.extrasOpen = !config.extrasOpen;
        refreshExtras();
      });
      inner.append(list);
      panel.append(inner);
      wrapper.append(toggle, panel);
      refreshExtras();
      card.append(wrapper);
    }

    const actions = element("div", "menu-card-actions");
    const stepper = element("div", "stepper");
    stepper.setAttribute("role", "group");
    stepper.setAttribute("aria-label", `Quantity for ${item.name}`);
    const decrease = element("button", undefined, "−");
    const increase = element("button", undefined, "+");
    const quantity = element("output");
    decrease.type = increase.type = "button";
    decrease.setAttribute("aria-label", `Decrease quantity of ${item.name}`);
    increase.setAttribute("aria-label", `Increase quantity of ${item.name}`);
    const refreshQuantity = (): void => {
      quantity.textContent = String(config.quantity);
      decrease.disabled = !canOrder || config.quantity <= 1;
      increase.disabled = !canOrder || config.quantity >= maxLineQuantity;
      refreshAddLabel();
    };
    decrease.addEventListener("click", () => {
      config.quantity = Math.max(1, config.quantity - 1);
      refreshQuantity();
    });
    increase.addEventListener("click", () => {
      config.quantity = Math.min(maxLineQuantity, config.quantity + 1);
      refreshQuantity();
    });
    stepper.append(decrease, quantity, increase);
    addButton.disabled = !canOrder;
    addButton.addEventListener("click", () => {
      if (!addToBasket(item, selectedOptionIds(item), config.quantity, addButton)) return;
      config.quantity = 1;
      card.classList.add("is-added");
      refreshQuantity();
      window.clearTimeout(addedTimers.get(item.id));
      addedTimers.set(item.id, window.setTimeout(() => {
        card.classList.remove("is-added");
        refreshAddLabel();
      }, 1600));
    });
    actions.append(stepper, addButton);
    card.append(actions);
    refreshQuantity();
    return card;
  }

  // ---------- Basket ----------

  function addToBasket(item: MenuItem, optionIds: string[], count: number, source: Element | null): boolean {
    if (!orderable(item)) return false;
    const key = lineKey({ menuItemId: item.id, optionIds });
    const existing = basket.find((line) => lineKey(line) === key);
    if (existing) {
      if (existing.quantity + count > maxLineQuantity) {
        setStatus(`A basket line can hold up to ${maxLineQuantity} of the same item.`, "error");
        return false;
      }
      existing.quantity += count;
    } else {
      if (basket.length >= maxBasketLines) {
        setStatus(`Your basket has reached its ${maxBasketLines} line limit.`, "error");
        return false;
      }
      basket.push({ menuItemId: item.id, quantity: count, optionIds });
    }
    persistBasket();
    renderBasket();
    const size = item.options.find((option) => option.type === "size" && optionIds.includes(option.id));
    setStatus(`Added ${count} × ${item.name}${size ? ` (${sizeParts(size.name).label})` : ""} to your basket.`);
    const target = isPillVisible() ? pillText : isNarrow() ? null : basketCount;
    flyToBasket(source, target);
    scheduleQuote(0);
    return true;
  }

  function changeLineQuantity(key: string, delta: number): void {
    const line = basket.find((candidate) => lineKey(candidate) === key);
    if (!line) return;
    line.quantity = Math.max(1, Math.min(maxLineQuantity, line.quantity + delta));
    persistBasket();
    setStatus("");
    renderBasket();
    scheduleQuote(250);
  }

  function removeLine(key: string, row: HTMLElement): void {
    const item = menuItems.find((candidate) => candidate.id === basket.find((line) => lineKey(line) === key)?.menuItemId);
    const finish = (): void => {
      basket = basket.filter((line) => lineKey(line) !== key);
      persistBasket();
      setStatus(item ? `Removed ${item.name}.` : "Removed.");
      renderBasket();
      scheduleQuote(0);
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    row.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-24px)" }], { duration: 260, easing: "ease-in", fill: "forwards" }).onfinish = finish;
  }

  function itemCount(): number {
    return basket.reduce((total, line) => total + line.quantity, 0);
  }

  function renderPill(): void {
    const count = itemCount();
    pillText.textContent = count === 0 ? "Start your order" : `${count === 1 ? "1 item" : `${count} items`} · ${formatMoney(shownSubtotalMinor, currency)}`;
    pillCta.textContent = count === 0 ? "Menu →" : "View basket";
  }

  function renderBasket(): void {
    const count = itemCount();
    basketCount.textContent = count === 1 ? "1 item" : `${count} items`;
    basketEmpty.hidden = basket.length > 0;
    checkoutButton.disabled = basket.length === 0;

    const nextKeys = new Set<string>();
    const rows = basket.map((line) => {
      const key = lineKey(line);
      nextKeys.add(key);
      const item = menuItems.find((candidate) => candidate.id === line.menuItemId);
      const row = element("li", "basket-line");
      row.dataset.lineId = key;
      const info = element("div");
      info.style.minWidth = "0";
      info.append(element("p", "basket-line-name", item?.name ?? (menuState === "loading" ? "Loading…" : "Menu item")), element("p", "basket-line-opts", describeOptions(item, line.optionIds)));
      const quoted = quoteLines.get(`${key}#${line.quantity}`);
      const estimate = item && orderable(item) ? estimateUnitMinor(item, line.optionIds) * line.quantity : null;
      const lineTotal = quoted ?? estimate;
      const total = element("p", "basket-line-total", lineTotal === null ? "—" : formatMoney(lineTotal, currency));

      const stepper = element("div", "stepper");
      stepper.setAttribute("role", "group");
      stepper.setAttribute("aria-label", `Quantity for ${item?.name ?? "menu item"}`);
      const decrease = element("button", undefined, "−");
      const increase = element("button", undefined, "+");
      decrease.type = increase.type = "button";
      decrease.setAttribute("aria-label", `Decrease quantity of ${item?.name ?? "menu item"}`);
      increase.setAttribute("aria-label", `Increase quantity of ${item?.name ?? "menu item"}`);
      decrease.disabled = line.quantity <= 1;
      increase.disabled = line.quantity >= maxLineQuantity;
      decrease.addEventListener("click", () => changeLineQuantity(key, -1));
      increase.addEventListener("click", () => changeLineQuantity(key, 1));
      stepper.append(decrease, element("output", undefined, String(line.quantity)), increase);

      const remove = element("button", "basket-remove", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${item?.name ?? "menu item"} from basket`);
      remove.addEventListener("click", () => removeLine(key, row));
      row.append(info, total, stepper, remove);
      return row;
    });
    const focusedKey = (document.activeElement?.closest("[data-line-id]") as HTMLElement | null)?.dataset.lineId;
    const focusedLabel = document.activeElement?.getAttribute("aria-label");
    basketLines.replaceChildren(...rows);
    if (focusedKey && focusedLabel) {
      basketLines.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(focusedKey)}"] [aria-label="${CSS.escape(focusedLabel)}"]`)?.focus();
    }
    if (!prefersReducedMotion()) {
      for (const row of rows) {
        if (renderedLineKeys.has(row.dataset.lineId ?? "")) continue;
        row.animate([{ opacity: 0, transform: "translateX(18px)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: EASE_OUT_EXPO });
      }
    }
    renderedLineKeys = nextKeys;
    if (basket.length === 0) {
      quoteSequence += 1;
      setCalculating(false);
      animateSubtotal(0);
    }
    renderPill();
  }

  function setCalculating(calculating: boolean): void {
    basketUpdating.hidden = !calculating;
    basketPanel.classList.toggle("is-calculating", calculating);
  }

  function animateSubtotal(targetMinor: number): void {
    cancelAnimationFrame(subtotalAnimation);
    const from = shownSubtotalMinor;
    const paint = (value: number): void => {
      shownSubtotalMinor = value;
      basketSubtotal.textContent = formatMoney(value, currency);
      renderPill();
    };
    if (prefersReducedMotion() || from === targetMinor) {
      paint(targetMinor);
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min((now - start) / 600, 1);
      const eased = 1 - (1 - progress) ** 3;
      paint(Math.round((from + (targetMinor - from) * eased) / 100) * 100);
      if (progress < 1) subtotalAnimation = requestAnimationFrame(step);
      else paint(targetMinor);
    };
    subtotalAnimation = requestAnimationFrame(step);
  }

  function scheduleQuote(delay: number): void {
    window.clearTimeout(quoteDebounce);
    if (basket.length === 0) return;
    setCalculating(true);
    quoteDebounce = window.setTimeout(() => void quoteBasket(), delay);
  }

  async function quoteBasket(): Promise<void> {
    const sequence = ++quoteSequence;
    if (basket.length === 0) return;
    setCalculating(true);
    try {
      const response = await fetch(apiUrl("/api/menu/quote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: basket }),
      });
      const result = await response.json() as MenuQuote | { error?: string };
      if (sequence !== quoteSequence) return;
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "We could not check the basket prices.");
      const quote = result as MenuQuote;
      currency = quote.currency;
      quoteLines = new Map(basket.map((line, index) => {
        const quoted = quote.lines[index];
        return [`${lineKey(line)}#${line.quantity}`, quoted && quoted.menuItemId === line.menuItemId ? quoted.lineTotalMinor : NaN] as const;
      }).filter(([, total]) => Number.isFinite(total)));
      setCalculating(false);
      renderBasket();
      animateSubtotal(quote.subtotalMinor);
    } catch (error) {
      if (sequence !== quoteSequence) return;
      setCalculating(false);
      basketSubtotal.textContent = "—";
      setStatus(error instanceof Error ? error.message : "We could not check the basket prices. Refresh the menu and try again.", "error");
    }
  }

  // ---------- Mobile basket sheet & floating bar ----------

  function openSheet(): void {
    basketPanel.classList.add("is-open");
    basketScrim.classList.add("is-open");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => $<HTMLButtonElement>("#basket-close").focus(), 60);
  }

  function closeSheet(returnFocus = true): void {
    if (!basketPanel.classList.contains("is-open")) return;
    basketPanel.classList.remove("is-open");
    basketScrim.classList.remove("is-open");
    document.body.style.overflow = "";
    if (returnFocus && pill.classList.contains("is-visible")) pill.focus();
  }

  function scrollToMenu(): void {
    const menu = $<HTMLElement>("#menu");
    window.scrollTo({ top: menu.getBoundingClientRect().top + window.scrollY - 70, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  pill.addEventListener("click", () => {
    if (basket.length === 0 || !isNarrow()) scrollToMenu();
    else openSheet();
  });
  basketScrim.addEventListener("click", () => closeSheet());
  $<HTMLButtonElement>("#basket-close").addEventListener("click", () => closeSheet());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) closeSheet();
  });
  window.matchMedia("(max-width: 759px)").addEventListener("change", () => {
    closeSheet(false);
    moveFilterIndicator(false);
  });
  window.addEventListener("resize", () => moveFilterIndicator(false));
  void document.fonts?.ready.then(() => moveFilterIndicator(false));
  for (const button of filterButtons) button.addEventListener("click", () => setCategory(button.dataset.category ?? "All"));

  // ---------- Hero quick add ----------

  function setupHeroChip(): void {
    const chip = $<HTMLDivElement>("#hero-chip");
    const featured = menuItems.find((item) => orderable(item) && (item.slug?.includes("suya") || /suya/i.test(item.name)))
      ?? menuItems.find(orderable);
    if (!featured) {
      chip.hidden = true;
      return;
    }
    $<HTMLSpanElement>("#hero-chip-name").textContent = featured.name;
    $<HTMLSpanElement>("#hero-chip-price").textContent = `From ${formatMoney(featured.priceMinor!, featured.currency)}`;
    const button = $<HTMLButtonElement>("#hero-chip-add");
    button.onclick = () => {
      const size = sizeOptions(featured)[0];
      addToBasket(featured, size ? [size.id] : [], 1, button);
    };
    chip.hidden = false;
    if (!prefersReducedMotion()) {
      chip.animate([{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], { duration: 900, easing: EASE_OUT_EXPO });
    }
  }

  // ---------- Loading ----------

  async function loadMenu(): Promise<void> {
    menuState = "loading";
    renderMenu();
    try {
      const response = await fetch(apiUrl("/api/menu"));
      if (!response.ok) throw new Error("Menu is temporarily unavailable.");
      const result = await response.json() as { items?: MenuItem[] };
      menuItems = result.items ?? [];
      currency = menuItems[0]?.currency ?? currency;
      menuState = "live";
      renderMenu();
      revealCardsOnEnter(grid);
      setupHeroChip();
      renderBasket();
      if (basket.length) scheduleQuote(0);
    } catch {
      menuState = "error";
      renderMenu();
      renderBasket();
    }
    updateFilterCounts();
  }

  // ---------- Checkout ----------

  const checkoutDialog = $<HTMLDialogElement>("#checkout-dialog");
  const checkoutForm = $<HTMLFormElement>("#checkout-form");
  const checkoutMessage = $<HTMLParagraphElement>("#checkout-message");
  const checkoutSuccess = $<HTMLElement>("#checkout-success");
  const savedAddressSelect = $<HTMLSelectElement>("#saved-address-select");
  const savedAddressField = $<HTMLLabelElement>("#saved-address-field");
  const savedAddressLabelField = $<HTMLLabelElement>("#saved-address-label-field");
  let savedAddresses: SavedAddress[] = [];

  function setCheckoutMessage(message: string, kind: "info" | "ok" | "error" = "info"): void {
    checkoutMessage.textContent = message;
    checkoutMessage.dataset.kind = kind;
  }

  function fillCheckoutField(name: string, value: string): void {
    const field = checkoutForm.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
  }

  async function loadSavedAddresses(session: Session): Promise<void> {
    savedAddresses = [];
    savedAddressSelect.replaceChildren(new Option("Enter a new delivery address", ""));
    savedAddressField.hidden = true;
    try {
      const response = await fetch(apiUrl("/api/customer/addresses"), { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!response.ok) return;
      const result = await response.json() as { addresses?: SavedAddress[] };
      savedAddresses = result.addresses ?? [];
      for (const address of savedAddresses) savedAddressSelect.add(new Option(`${address.label} · ${address.address}`, address.id));
      savedAddressField.hidden = savedAddresses.length === 0;
    } catch {
      // Checkout can continue with a new address when saved addresses are unavailable.
    }
  }

  async function populateCheckoutSummary(): Promise<void> {
    setCheckoutMessage("Checking the latest prices and delivery estimate…");
    try {
      const response = await fetch(apiUrl("/api/menu/quote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: basket }),
      });
      const result = await response.json() as MenuQuote | { error?: string };
      if (!response.ok) throw new Error("error" in result && result.error ? result.error : "Could not calculate the order total.");
      const quote = result as MenuQuote;
      $("#checkout-subtotal").textContent = formatMoney(quote.subtotalMinor, quote.currency);
      $("#checkout-delivery").textContent = formatMoney(quote.deliveryFeeMinor, quote.currency);
      $("#checkout-tax").textContent = formatMoney(quote.taxMinor, quote.currency);
      $("#checkout-total").textContent = formatMoney(quote.totalMinor, quote.currency);
      setCheckoutMessage("Totals are recalculated when the order is placed.");
    } catch (error) {
      setCheckoutMessage(error instanceof Error ? error.message : "Could not calculate the order total.", "error");
    }
  }

  async function openCheckout(): Promise<void> {
    if (!basket.length) return;
    closeSheet(false);
    if (!client) {
      setStatus("Sign in is required to place an order, and account access is not configured yet.", "error");
      requireSignIn();
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      setStatus("Sign in or create an account to continue to checkout.");
      requireSignIn();
      return;
    }
    checkoutForm.hidden = false;
    checkoutSuccess.hidden = true;
    setCheckoutMessage("");
    const nameInput = checkoutForm.elements.namedItem("recipientName");
    if (nameInput instanceof HTMLInputElement && !nameInput.value) {
      const displayName = data.session.user.user_metadata?.display_name;
      nameInput.value = typeof displayName === "string" ? displayName : "";
    }
    await loadSavedAddresses(data.session);
    checkoutDialog.showModal();
    void populateCheckoutSummary();
  }

  savedAddressSelect.addEventListener("change", () => {
    const address = savedAddresses.find((candidate) => candidate.id === savedAddressSelect.value);
    if (!address) return;
    fillCheckoutField("recipientName", address.recipientName);
    fillCheckoutField("phone", address.phone);
    fillCheckoutField("address", address.address);
    fillCheckoutField("landmark", address.landmark ?? "");
    fillCheckoutField("instructions", address.instructions ?? "");
  });

  checkoutForm.querySelector<HTMLInputElement>('[name="saveAddress"]')?.addEventListener("change", (event) => {
    const checkbox = event.currentTarget;
    if (checkbox instanceof HTMLInputElement) savedAddressLabelField.hidden = !checkbox.checked;
  });

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $<HTMLButtonElement>("#checkout-submit");
    if (!client) {
      setCheckoutMessage("Account access is not configured yet.", "error");
      return;
    }
    const { data } = await client.auth.getSession();
    if (!data.session) {
      setCheckoutMessage("Your session expired. Sign in again to place this order.", "error");
      checkoutDialog.close();
      requireSignIn();
      return;
    }
    submit.disabled = true;
    setCheckoutMessage("Submitting your order…");
    try {
      let idempotencyKey = localStorage.getItem(checkoutKeyStorageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        localStorage.setItem(checkoutKeyStorageKey, idempotencyKey);
      }
      const formData = new FormData(checkoutForm);
      const response = await fetch(apiUrl("/api/orders"), {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          items: basket,
          delivery: {
            recipientName: String(formData.get("recipientName") ?? ""),
            phone: String(formData.get("phone") ?? ""),
            address: String(formData.get("address") ?? ""),
            landmark: String(formData.get("landmark") ?? ""),
            instructions: String(formData.get("instructions") ?? ""),
          },
          saveAddress: formData.get("saveAddress") === "on",
          addressLabel: String(formData.get("addressLabel") ?? "Home"),
        }),
      });
      const result = await response.json() as CreatedOrder;
      if (!response.ok) {
        throw new Error(result.existingOrderNumber
          ? `${result.error ?? "This checkout was already used."} Earlier order: ${result.existingOrderNumber}.`
          : result.error ?? "Could not submit your order.");
      }
      $("#checkout-order-number").textContent = result.orderNumber;
      $("#checkout-order-status").textContent = result.paymentStatus === "pending"
        ? "Your order is awaiting staff review. Payment is pending; no payment has been collected."
        : "Your order has been received.";
      checkoutForm.hidden = true;
      checkoutSuccess.hidden = false;
      basket = [];
      persistBasket();
      setStatus("");
      renderBasket();
    } catch (error) {
      setCheckoutMessage(error instanceof Error ? error.message : "Could not submit your order. You can retry safely.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  checkoutButton.addEventListener("click", () => void openCheckout());
  $<HTMLButtonElement>("#checkout-close").addEventListener("click", () => checkoutDialog.close());
  $<HTMLButtonElement>("#checkout-done").addEventListener("click", () => checkoutDialog.close());
  checkoutDialog.addEventListener("click", (event) => {
    if (event.target === checkoutDialog) checkoutDialog.close();
  });

  renderBasket();
  void loadMenu();
}
