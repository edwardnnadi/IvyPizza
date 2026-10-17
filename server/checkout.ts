import type { Queryable } from "./database.js";
import { calculateMenuQuote, MenuQuoteError, type BasketInputLine, type QuotedMenuLine } from "./menu-pricing.js";
import { calculateOrderTotals, type OrderTotals } from "./order-pricing.js";
import { evaluateVoucher, loadStores, loadZones, type FulfilmentMode, type Store, type VoucherResult, type Zone } from "./ordering.js";

export interface CheckoutContext {
  mode: FulfilmentMode;
  storeId: string | null;
  zoneId: string | null;
  voucherCode: string | null;
}

const idPattern = /^[a-z0-9-]{1,40}$/;

export function parseCheckoutContext(body: Record<string, unknown>): CheckoutContext {
  const mode = body.mode === undefined ? "delivery" : body.mode;
  if (mode !== "delivery" && mode !== "pickup") throw new MenuQuoteError(400, "Choose delivery or pickup");
  const id = (value: unknown, label: string): string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !idPattern.test(value)) throw new MenuQuoteError(400, `${label} is invalid`);
    return value;
  };
  const voucherCode = body.voucherCode === undefined || body.voucherCode === null || body.voucherCode === ""
    ? null
    : typeof body.voucherCode === "string" && body.voucherCode.length <= 40 ? body.voucherCode : (() => { throw new MenuQuoteError(400, "Voucher code is invalid"); })();
  return { mode, storeId: id(body.storeId, "Kitchen"), zoneId: id(body.zoneId, "Delivery area"), voucherCode };
}

export interface PricedCheckout {
  currency: string;
  lines: QuotedMenuLine[];
  store: Store;
  zone: Zone | null;
  voucher: VoucherResult | null;
  /** Shown under the voucher field when a code was given but does not apply. Quotes only. */
  voucherError: string | null;
  totals: OrderTotals;
  minimumMinor: number;
  shortMinor: number;
}

/**
 * Prices a basket for a delivery area or a kitchen, with an optional voucher.
 * `forOrder` makes every problem an error (a bad voucher, a missing area); quotes stay lenient so the
 * basket can show what's wrong.
 */
export async function priceCheckout(
  client: Queryable,
  lines: BasketInputLine[],
  context: CheckoutContext,
  options: { forOrder: boolean; now: Date },
): Promise<PricedCheckout> {
  const stores = await loadStores(client);
  const store = context.storeId ? stores.find((candidate) => candidate.id === context.storeId) : stores[0];
  if (!store) throw new MenuQuoteError(400, "Choose a kitchen to order from");

  let zone: Zone | null = null;
  if (context.mode === "delivery") {
    if (context.zoneId) {
      zone = (await loadZones(client)).find((candidate) => candidate.id === context.zoneId) ?? null;
      if (!zone) throw new MenuQuoteError(400, "Choose a delivery area from the list");
      if (!zone.delivers) throw new MenuQuoteError(422, `We don't deliver to ${zone.name} yet. You can still order for pickup.`);
      if (zone.storeId !== store.id && context.storeId) throw new MenuQuoteError(400, "That area is served by a different kitchen");
    } else if (options.forOrder) {
      throw new MenuQuoteError(400, "Choose your delivery area");
    }
  }
  const deliveryStore = zone ? stores.find((candidate) => candidate.id === zone!.storeId) ?? store : store;

  const quote = await calculateMenuQuote(client, lines, options.forOrder);
  let voucher: VoucherResult | null = null;
  let voucherError: string | null = null;
  if (context.voucherCode) {
    try {
      voucher = await evaluateVoucher(client, context.voucherCode, { mode: context.mode, subtotalMinor: quote.subtotalMinor, now: options.now });
    } catch (error) {
      if (!(error instanceof MenuQuoteError) || options.forOrder) throw error;
      voucherError = error.message;
    }
  }
  const deliveryFeeMinor = zone && !voucher?.freeDelivery ? zone.feeMinor ?? 0 : 0;
  const totals = calculateOrderTotals({ subtotalMinor: quote.subtotalMinor, discountMinor: voucher?.discountMinor ?? 0, deliveryFeeMinor });
  const minimumMinor = zone?.minimumMinor ?? 0;
  return {
    currency: quote.currency,
    lines: quote.lines,
    store: deliveryStore,
    zone,
    voucher,
    voucherError,
    totals,
    minimumMinor,
    shortMinor: Math.max(0, minimumMinor - quote.subtotalMinor),
  };
}
