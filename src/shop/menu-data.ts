import { apiUrl } from "../api.js";

export interface MenuOption {
  id: string;
  name: string;
  type: "size" | "extra";
  priceDeltaMinor: number | null;
  available: boolean;
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
      const response = await fetch(apiUrl("/api/menu"));
      if (!response.ok) throw new Error("Menu unavailable");
      const result = await response.json() as { items?: MenuItem[] };
      setState({ status: "live", items: result.items ?? [] });
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

export function sizeOptions(item: MenuItem): MenuOption[] {
  return item.options.filter((option) => option.type === "size" && option.priceDeltaMinor !== null);
}

export function extraOptions(item: MenuItem): MenuOption[] {
  return item.options.filter((option) => option.type === "extra" && option.priceDeltaMinor !== null);
}

export function itemKind(item: MenuItem): ItemKind {
  if (sizeOptions(item).some((option) => option.available)) return "pizza";
  if (extraOptions(item).some((option) => option.available)) return "configurable";
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

export function unitPriceMinor(item: MenuItem, optionIds: readonly string[]): number {
  return (item.priceMinor ?? 0) + item.options
    .filter((option) => optionIds.includes(option.id))
    .reduce((total, option) => total + (option.priceDeltaMinor ?? 0), 0);
}

export function describeOptions(item: MenuItem, optionIds: readonly string[]): string {
  const chosen = item.options.filter((option) => optionIds.includes(option.id));
  return chosen
    .sort((a, b) => (a.type === b.type ? 0 : a.type === "size" ? -1 : 1))
    .map((option) => {
      if (option.type !== "size") return option.name;
      const { label, detail } = sizeParts(option.name);
      return detail ? `${label} ${detail}` : label;
    })
    .join(" · ");
}

export function lowestPriceMinor(category: string): number | null {
  const prices = menuItems().filter((item) => item.category === category && isOrderable(item)).map((item) => item.priceMinor!);
  return prices.length ? Math.min(...prices) : null;
}
