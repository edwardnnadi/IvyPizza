import { apiUrl } from "../api.js";

export interface BasketLine {
  menuItemId: string;
  quantity: number;
  optionIds: string[];
}

export interface Quote {
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: Array<{ menuItemId: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
}

export type QuoteState =
  | { status: "empty" }
  | { status: "calculating"; previous: Quote | null }
  | { status: "ready"; quote: Quote }
  | { status: "error"; message: string };

const storageKey = "ivy-pizza-basket-v1";
const checkoutKeyStorageKey = "ivy-pizza-checkout-key-v1";
export const maxLineQuantity = 20;
export const maxBasketLines = 30;

const listeners = new Set<() => void>();
let lines: BasketLine[] = read();
let quoteState: QuoteState = lines.length ? { status: "calculating", previous: null } : { status: "empty" };
let quoteSequence = 0;
let quoteTimer: number | undefined;

function read(): BasketLine[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
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

function persist(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(lines));
    // Any change to the basket means a new checkout attempt.
    localStorage.removeItem(checkoutKeyStorageKey);
  } catch {
    // The basket still works for this visit when storage is unavailable.
  }
}

function changed(quoteDelay = 0): void {
  persist();
  for (const listener of listeners) listener();
  scheduleQuote(quoteDelay);
}

export function onBasketChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function basketLines(): readonly BasketLine[] {
  return lines;
}

export function itemCount(): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

export function lineKey(line: Pick<BasketLine, "menuItemId" | "optionIds">): string {
  return `${line.menuItemId}|${[...line.optionIds].sort().join("+")}`;
}

export type AddResult = { ok: true } | { ok: false; reason: string };

export function addLine(menuItemId: string, optionIds: string[], quantity: number): AddResult {
  const key = lineKey({ menuItemId, optionIds });
  const existing = lines.find((line) => lineKey(line) === key);
  if (existing) {
    if (existing.quantity + quantity > maxLineQuantity) return { ok: false, reason: `You can add up to ${maxLineQuantity} of the same item.` };
    existing.quantity += quantity;
  } else {
    if (lines.length >= maxBasketLines) return { ok: false, reason: `Your basket can hold ${maxBasketLines} different items.` };
    lines.push({ menuItemId, optionIds: [...optionIds], quantity });
  }
  changed();
  return { ok: true };
}

/** Replaces the line at `index` (edit in basket). Merges into an identical line if the edit makes one. */
export function replaceLine(index: number, menuItemId: string, optionIds: string[], quantity: number): void {
  if (!lines[index]) return;
  const key = lineKey({ menuItemId, optionIds });
  const duplicate = lines.findIndex((line, position) => position !== index && lineKey(line) === key);
  if (duplicate >= 0) {
    lines[duplicate]!.quantity = Math.min(maxLineQuantity, lines[duplicate]!.quantity + quantity);
    lines.splice(index, 1);
  } else {
    lines[index] = { menuItemId, optionIds: [...optionIds], quantity };
  }
  changed();
}

export function setQuantity(index: number, quantity: number): void {
  const line = lines[index];
  if (!line) return;
  line.quantity = Math.max(1, Math.min(maxLineQuantity, quantity));
  changed(250);
}

/** Removes a line and returns a function that puts it back where it was. */
export function removeLine(index: number): () => void {
  const [removed] = lines.splice(index, 1);
  changed();
  return () => {
    if (!removed) return;
    lines.splice(Math.min(index, lines.length), 0, removed);
    changed();
  };
}

export function clearBasket(): void {
  lines = [];
  changed();
}

// ---------- Server quote (the API prices everything; local prices are estimates) ----------

export function getQuoteState(): QuoteState {
  return quoteState;
}

function setQuoteState(next: QuoteState): void {
  quoteState = next;
  for (const listener of listeners) listener();
}

function scheduleQuote(delay: number): void {
  window.clearTimeout(quoteTimer);
  const sequence = ++quoteSequence;
  if (!lines.length) {
    if (quoteState.status !== "empty") setQuoteState({ status: "empty" });
    return;
  }
  const previous = quoteState.status === "ready" ? quoteState.quote : quoteState.status === "calculating" ? quoteState.previous : null;
  if (quoteState.status !== "calculating") setQuoteState({ status: "calculating", previous });
  quoteTimer = window.setTimeout(() => void fetchQuote(sequence), delay);
}

export function refreshQuote(): void {
  scheduleQuote(0);
}

async function fetchQuote(sequence: number): Promise<void> {
  try {
    const response = await fetch(apiUrl("/api/menu/quote"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: lines }),
    });
    const result = await response.json().catch(() => ({})) as Quote | { error?: string };
    if (sequence !== quoteSequence) return;
    if (!response.ok) throw new Error("error" in result && result.error ? result.error : "We couldn't check your basket prices.");
    setQuoteState({ status: "ready", quote: result as Quote });
  } catch (error) {
    if (sequence !== quoteSequence) return;
    const message = error instanceof TypeError
      ? "We couldn't reach the kitchen. Check your connection and try again."
      : error instanceof Error ? error.message : "We couldn't check your basket prices.";
    setQuoteState({ status: "error", message });
  }
}

/** One key per checkout attempt, so a retried submit never creates a second order. */
export function checkoutKey(): string {
  let key: string | null = null;
  try {
    key = localStorage.getItem(checkoutKeyStorageKey);
  } catch {
    // Fall through to a fresh key.
  }
  if (!key) {
    key = crypto.randomUUID();
    try {
      localStorage.setItem(checkoutKeyStorageKey, key);
    } catch {
      // A key that is not persisted still guards double clicks in this visit.
    }
  }
  return key;
}

if (lines.length) scheduleQuote(0);
