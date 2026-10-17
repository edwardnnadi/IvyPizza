const MAX_MINOR_UNITS = 2_147_483_647;

function readNonnegativeInteger(name: string, fallback: number, maximum = MAX_MINOR_UNITS): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be a whole number between 0 and ${maximum}`);
  }
  return value;
}

export const taxBasisPoints = readNonnegativeInteger("CHECKOUT_TAX_BASIS_POINTS", 0, 100_000);

export interface OrderTotals {
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Tax applies to what the customer pays for food: the subtotal after any discount. */
export function calculateOrderTotals(input: { subtotalMinor: number; discountMinor?: number; deliveryFeeMinor: number }): OrderTotals {
  const discountMinor = Math.min(input.discountMinor ?? 0, input.subtotalMinor);
  const taxMinor = Math.round(((input.subtotalMinor - discountMinor) * taxBasisPoints) / 10_000);
  const totalMinor = input.subtotalMinor - discountMinor + input.deliveryFeeMinor + taxMinor;
  if (!Number.isSafeInteger(totalMinor) || totalMinor > MAX_MINOR_UNITS) {
    throw new Error("Order total exceeds the supported amount");
  }
  return { subtotalMinor: input.subtotalMinor, discountMinor, deliveryFeeMinor: input.deliveryFeeMinor, taxMinor, totalMinor };
}
