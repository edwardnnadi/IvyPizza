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

export const deliveryFeeMinor = readNonnegativeInteger("CHECKOUT_DELIVERY_FEE_MINOR", 150_000);
export const taxBasisPoints = readNonnegativeInteger("CHECKOUT_TAX_BASIS_POINTS", 0, 100_000);

export interface OrderTotals {
  subtotalMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function calculateOrderTotals(subtotalMinor: number): OrderTotals {
  const taxMinor = Math.round((subtotalMinor * taxBasisPoints) / 10_000);
  const totalMinor = subtotalMinor + deliveryFeeMinor + taxMinor;
  if (!Number.isSafeInteger(totalMinor) || totalMinor > MAX_MINOR_UNITS) {
    throw new Error("Order total exceeds the supported amount");
  }
  return { subtotalMinor, deliveryFeeMinor, taxMinor, totalMinor };
}
