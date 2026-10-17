import { basketLines, getQuoteState, type Quote } from "./basket.js";
import { findItem, getMenu, isOrderable, lineAvailable, unitPriceMinor } from "./menu-data.js";
import { getContext } from "./order-context.js";
import { findArea } from "./zones.js";

/** Local estimate of the basket subtotal; the server quote replaces it as soon as it arrives. */
export function estimatedSubtotalMinor(): number {
  return basketLines().reduce((total, line) => {
    const item = findItem(line.menuItemId);
    return total + (item && isOrderable(item) ? unitPriceMinor(item, line) * line.quantity : 0);
  }, 0);
}

export function latestQuote(): Quote | null {
  const state = getQuoteState();
  if (state.status === "ready") return state.quote;
  if (state.status === "calculating") return state.previous;
  return null;
}

export function subtotalMinor(): number {
  return latestQuote()?.subtotalMinor ?? estimatedSubtotalMinor();
}

export interface MinimumCheck {
  minimumMinor: number;
  shortMinor: number;
  percent: number;
  areaName: string;
}

/** Delivery minimum for the chosen area. Pickup and unchosen areas have none. */
export function minimumCheck(): MinimumCheck | null {
  const context = getContext();
  if (context.mode !== "delivery") return null;
  const area = findArea(context.areaId);
  if (!area || !area.minimumMinor) return null;
  const subtotal = subtotalMinor();
  return {
    minimumMinor: area.minimumMinor,
    shortMinor: Math.max(0, area.minimumMinor - subtotal),
    percent: Math.min(100, Math.round((subtotal / area.minimumMinor) * 100)),
    areaName: area.name,
  };
}

/** Lines that can no longer be ordered: removed from the menu, sold out, or an option became unavailable. */
export function unavailableLineIndexes(): number[] {
  if (getMenu().status !== "live") return [];
  return basketLines().flatMap((line, index) => {
    const item = findItem(line.menuItemId);
    return item && lineAvailable(item, line) ? [] : [index];
  });
}
