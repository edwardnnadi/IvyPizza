import { apiUrl } from "../api.js";
import { describeLine } from "../../shared/describe-line.js";
import { baseMultiplierBp, extraCheeseMinor, toppingCostMinor, type BasketLineInput, type LineTopping } from "../../shared/pizza-rules.js";

export type OptionType = "size" | "crust" | "sauce" | "topping" | "extra" | "removal";

export interface MenuOption {
  id: string;
  name: string;
  type: OptionType;
  priceDeltaMinor: number | null;
  available: boolean;
  code: string | null;
  isDefault: boolean;
  requiresLarge: boolean;
  multiplierBp: number | null;
}

export interface MenuItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  priceMinor: number | null;
  currency: string;
  available: boolean;
  allergens: string[];
  options: MenuOption[];
}

/** pizza → full builder page; configurable → options sheet; simple → added straight from the card. */
export type ItemKind = "pizza" | "configurable" | "simple";

export type MenuState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "live"; items: MenuItem[] };

let state: MenuState = { status: "loading" };
let request: Promise<MenuState> | null = null;
const listeners = new Set<() => void>();

export function getMenu(): MenuState {
  return state;
}

export function onMenuChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: MenuState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function loadMenu(force = false): Promise<MenuState> {
  if (request && !force) return request;
  if (force || state.status !== "live") setState({ status: "loading" });
  request = (async () => {
    try {
      const response = await fetch(apiUrl("/api/menu"), force ? { cache: "reload" } : undefined);
      if (!response.ok) throw new Error("Menu unavailable");
      const result = await response.json() as { items?: MenuItem[] };
      setState({ status: "live", items: (result.items ?? []).map((item) => ({ ...item, allergens: item.allergens ?? [] })) });
    } catch {
      setState({ status: "error" });
      request = null;
    }
    return state;
  })();
  return request;
}

export function menuItems(): MenuItem[] {
  return state.status === "live" ? state.items : [];
}

export function findItem(idOrSlug: string): MenuItem | undefined {
  return menuItems().find((item) => item.id === idOrSlug || item.slug === idOrSlug);
}

export function isOrderable(item: MenuItem): boolean {
  return item.available && item.priceMinor !== null;
}

const priced = (option: MenuOption): boolean => option.priceDeltaMinor !== null;

export function optionsOf(item: MenuItem, type: OptionType): MenuOption[] {
  return item.options.filter((option) => option.type === type && priced(option));
}

export const sizeOptions = (item: MenuItem): MenuOption[] => optionsOf(item, "size");
export const extraOptions = (item: MenuItem): MenuOption[] => optionsOf(item, "extra");

export function defaultOption(item: MenuItem, type: OptionType): MenuOption | undefined {
  return optionsOf(item, type).find((option) => option.isDefault && option.available);
}

export function recipeToppings(item: MenuItem): MenuOption[] {
  return optionsOf(item, "topping").filter((option) => option.isDefault);
}

export function itemKind(item: MenuItem): ItemKind {
  if (sizeOptions(item).some((option) => option.available)) return "pizza";
  if ([...optionsOf(item, "extra"), ...optionsOf(item, "removal")].some((option) => option.available)) return "configurable";
  return "simple";
}

/** Category order follows the first appearance in the menu, which the API sorts by display order. */
export function categories(): string[] {
  return [...new Set(menuItems().map((item) => item.category))];
}

/** "Large · 13 inch" → { label: "Large", detail: '13"' } */
export function sizeParts(name: string): { label: string; detail: string } {
  const [label, ...rest] = name.split("·").map((part) => part.trim());
  return { label: label ?? name, detail: rest.join(" ").replace(/(\d+)\s*inch(es)?/i, '$1"') };
}

/** The toppings actually on a pizza line: the given list, or the recipe plus legacy toppings in optionIds. */
export function effectiveToppings(item: MenuItem, line: Pick<BasketLineInput, "optionIds" | "toppings">): LineTopping[] {
  if (line.toppings) return line.toppings;
  const ids = [...new Set([...recipeToppings(item).map((option) => option.id), ...line.optionIds.filter((id) => item.options.find((option) => option.id === id)?.type === "topping")])];
  return ids.map((optionId) => ({ optionId, side: "whole", amount: "normal" }));
}

export interface PriceRow { label: string; amountMinor: number }

/** The same arithmetic as the API (server/menu-pricing.ts), for live prices while building. */
export function linePriceBreakdown(item: MenuItem, line: BasketLineInput): { unitMinor: number; rows: PriceRow[] } {
  const byId = new Map(item.options.map((option) => [option.id, option]));
  const chosen = line.optionIds.map((id) => byId.get(id)).filter((option): option is MenuOption => !!option);
  const size = chosen.find((option) => option.type === "size");
  const multiplierBp = size?.multiplierBp ?? baseMultiplierBp;
  const crust = chosen.find((option) => option.type === "crust") ?? defaultOption(item, "crust");
  const rows: PriceRow[] = [{ label: size ? `${item.name}, ${sizeParts(size.name).label}` : item.name, amountMinor: (item.priceMinor ?? 0) + (size?.priceDeltaMinor ?? 0) }];
  if (crust?.priceDeltaMinor) rows.push({ label: crust.name, amountMinor: crust.priceDeltaMinor });
  for (const topping of effectiveToppings(item, line)) {
    const option = byId.get(topping.optionId);
    if (!option) continue;
    const cost = toppingCostMinor({ unitMinor: option.priceDeltaMinor ?? 0, multiplierBp, inRecipe: option.isDefault, side: topping.side, amount: topping.amount });
    if (cost) rows.push({ label: `${topping.amount === "extra" ? "Extra " : ""}${topping.amount === "extra" ? option.name.toLowerCase() : option.name}${topping.side === "whole" ? "" : ` (${topping.side} half)`}`, amountMinor: cost });
  }
  if (sizeOptions(item).length && line.cheese === "extra") rows.push({ label: "Extra cheese", amountMinor: extraCheeseMinor(multiplierBp) });
  for (const option of chosen.filter((candidate) => candidate.type === "extra" || candidate.type === "removal")) {
    if (option.priceDeltaMinor) rows.push({ label: option.name, amountMinor: option.priceDeltaMinor });
  }
  return { unitMinor: rows.reduce((total, row) => total + row.amountMinor, 0), rows };
}

export function unitPriceMinor(item: MenuItem, line: BasketLineInput | readonly string[]): number {
  const full = Array.isArray(line) ? { menuItemId: item.id, quantity: 1, optionIds: [...line] } : line as BasketLineInput;
  return linePriceBreakdown(item, full).unitMinor;
}

/** "Large 13" · Thin & crispy · No red onions · + Jalapeños (left half)" — the API builds the same text. */
export function describeBasketLine(item: MenuItem, line: BasketLineInput): string {
  const byId = new Map(item.options.map((option) => [option.id, option]));
  const chosen = line.optionIds.map((id) => byId.get(id)).filter((option): option is MenuOption => !!option);
  const crust = chosen.find((option) => option.type === "crust") ?? defaultOption(item, "crust");
  const sauce = chosen.find((option) => option.type === "sauce") ?? defaultOption(item, "sauce");
  const toppings = effectiveToppings(item, line);
  const isPizza = sizeOptions(item).length > 0;
  return describeLine({
    size: chosen.find((option) => option.type === "size")?.name,
    crust: crust ? { name: crust.name, isDefault: crust.isDefault } : undefined,
    sauce: sauce ? { name: sauce.name, isDefault: sauce.isDefault } : undefined,
    sauceAmount: line.sauceAmount,
    cheese: isPizza ? line.cheese : undefined,
    removed: isPizza ? recipeToppings(item).filter((option) => !toppings.some((topping) => topping.optionId === option.id)).map((option) => option.name) : [],
    toppings: isPizza ? toppings.flatMap((topping) => {
      const option = byId.get(topping.optionId);
      return option ? [{ name: option.name, side: topping.side, amount: topping.amount, inRecipe: option.isDefault }] : [];
    }) : [],
    extras: chosen.filter((option) => option.type === "extra").map((option) => option.name),
    removals: chosen.filter((option) => option.type === "removal").map((option) => option.name),
  });
}

/** Every option on a line is still on the menu and available. */
export function lineAvailable(item: MenuItem, line: BasketLineInput): boolean {
  if (!isOrderable(item)) return false;
  const ok = (id: string): boolean => item.options.some((option) => option.id === id && option.available && priced(option));
  return line.optionIds.every(ok) && effectiveToppings(item, line).every((topping) => ok(topping.optionId));
}

export function lowestPriceMinor(category: string): number | null {
  const prices = menuItems().filter((item) => item.category === category && isOrderable(item)).map((item) => item.priceMinor!);
  return prices.length ? Math.min(...prices) : null;
}

export const allergenList = ["Gluten", "Milk", "Egg", "Peanut", "Sesame", "Mustard"] as const;
