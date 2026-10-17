import { apiUrl } from "../api.js";
import { amounts, cheeseAmounts, maxInstructionsLength, sides, type BasketLineInput } from "../../shared/pizza-rules.js";
import { activeKitchenId, getContext, onContextChange } from "./order-context.js";

export type BasketLine = BasketLineInput;

export interface QuoteLine {
  menuItemId: string;
  name: string;
  quantity: number;
  summary: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface Quote {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  minimumMinor: number;
  shortMinor: number;
  zoneId: string | null;
  mode: "delivery" | "pickup";
  voucher: { code: string; description: string; freeDelivery: boolean } | null;
  voucherError: string | null;
  lines: QuoteLine[];
}

export type QuoteState =
  | { status: "empty" }
  | { status: "calculating"; previous: Quote | null }
  | { status: "ready"; quote: Quote }
  | { status: "error"; message: string };

const storageKey = "ivy-pizza-basket-v1";
const voucherStorageKey = "ivy-pizza-voucher-v1";
const checkoutKeyStorageKey = "ivy-pizza-checkout-key-v1";
export const maxLineQuantity = 20;
export const maxBasketLines = 30;

const listeners = new Set<() => void>();
let lines: BasketLine[] = read();
let voucherCode: string | null = readVoucher();
let quoteState: QuoteState = lines.length ? { status: "calculating", previous: null } : { status: "empty" };
let quoteSequence = 0;
let quoteTimer: number | undefined;

function validLine(line: unknown): line is BasketLine {
  if (typeof line !== "object" || line === null) return false;
  const value = line as Record<string, unknown>;
  return typeof value.menuItemId === "string"
    && Number.isInteger(value.quantity) && Number(value.quantity) >= 1 && Number(value.quantity) <= maxLineQuantity
    && Array.isArray(value.optionIds) && value.optionIds.every((id) => typeof id === "string")
    && (value.toppings === undefined || (Array.isArray(value.toppings) && value.toppings.every((topping) =>
      typeof topping === "object" && topping !== null && typeof (topping as Record<string, unknown>).optionId === "string"
      && sides.includes((topping as Record<string, unknown>).side as never) && amounts.includes((topping as Record<string, unknown>).amount as never))))
    && (value.cheese === undefined || cheeseAmounts.includes(value.cheese as never))
    && (value.sauceAmount === undefined || amounts.includes(value.sauceAmount as never))
    && (value.instructions === undefined || (typeof value.instructions === "string" && value.instructions.length <= maxInstructionsLength));
}

function read(): BasketLine[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value.filter(validLine).slice(0, maxBasketLines) : [];
  } catch {
    return [];
  }
}

function readVoucher(): string | null {
  try {
    const value = localStorage.getItem(voucherStorageKey);
    return value && /^[A-Z0-9]{2,30}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(lines));
    if (voucherCode) localStorage.setItem(voucherStorageKey, voucherCode);
    else localStorage.removeItem(voucherStorageKey);
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

/** Lines with identical choices merge; anything different (a half topping, a note) stays separate. */
export function lineKey(line: Omit<BasketLine, "quantity">): string {
  return JSON.stringify([
    line.menuItemId,
    [...line.optionIds].sort(),
    line.toppings ? [...line.toppings].sort((a, b) => a.optionId.localeCompare(b.optionId)).map((topping) => `${topping.optionId}:${topping.side}:${topping.amount}`) : null,
    line.cheese ?? null,
    line.sauceAmount ?? null,
    line.instructions ?? null,
  ]);
}

export type AddResult = { ok: true } | { ok: false; reason: string };

function clean(line: BasketLine): BasketLine {
  const copy: BasketLine = { menuItemId: line.menuItemId, quantity: line.quantity, optionIds: [...line.optionIds] };
  if (line.toppings) copy.toppings = line.toppings.map((topping) => ({ ...topping }));
  if (line.cheese && line.cheese !== "normal") copy.cheese = line.cheese;
  if (line.sauceAmount && line.sauceAmount !== "normal") copy.sauceAmount = line.sauceAmount;
  const note = line.instructions?.trim();
  if (note) copy.instructions = note.slice(0, maxInstructionsLength);
  return copy;
}

export function addLine(input: BasketLine): AddResult {
  const line = clean(input);
  const key = lineKey(line);
  const existing = lines.find((candidate) => lineKey(candidate) === key);
  if (existing) {
    if (existing.quantity + line.quantity > maxLineQuantity) return { ok: false, reason: `You can add up to ${maxLineQuantity} of the same item.` };
    existing.quantity += line.quantity;
  } else {
    if (lines.length >= maxBasketLines) return { ok: false, reason: `Your basket can hold ${maxBasketLines} different items.` };
    lines.push(line);
  }
  changed();
  return { ok: true };
}

/** Replaces the line at `index` (edit in basket). Merges into an identical line if the edit makes one. */
export function replaceLine(index: number, input: BasketLine): void {
  if (!lines[index]) return;
  const line = clean(input);
  const key = lineKey(line);
  const duplicate = lines.findIndex((candidate, position) => position !== index && lineKey(candidate) === key);
  if (duplicate >= 0) {
    lines[duplicate]!.quantity = Math.min(maxLineQuantity, lines[duplicate]!.quantity + line.quantity);
    lines.splice(index, 1);
  } else {
    lines[index] = line;
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
  voucherCode = null;
  changed();
}

export function getVoucherCode(): string | null {
  return voucherCode;
}

/** Sets or clears the voucher; the next quote says whether it applies. */
export function setVoucherCode(code: string | null): void {
  voucherCode = code ? code.trim().toUpperCase() || null : null;
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

/** The body for /api/menu/quote and the context fields /api/orders also takes. */
export function pricingContext(): Record<string, unknown> {
  const context = getContext();
  return {
    mode: context.mode,
    storeId: activeKitchenId() ?? undefined,
    zoneId: context.mode === "delivery" ? context.areaId ?? undefined : undefined,
    voucherCode: voucherCode ?? undefined,
  };
}

async function fetchQuote(sequence: number): Promise<void> {
  try {
    const response = await fetch(apiUrl("/api/menu/quote"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: lines, ...pricingContext() }),
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

// Fee, minimum and voucher rules depend on where the order goes.
onContextChange(() => {
  if (lines.length) scheduleQuote(0);
});

if (lines.length) scheduleQuote(0);
