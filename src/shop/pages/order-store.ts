/** What the confirmation page shows right after checkout. Kept in this tab only. */
export interface PlacedOrder {
  orderNumber: string;
  firstName: string;
  lines: Array<{ name: string; options: string; totalMinor: number }>;
  totalMinor: number;
  currency: string;
  destination: string;
  /** "25–35" for delivery, "15–20" for pickup. */
  eta: string;
  delivery: boolean;
  placedAt: string;
  paymentMethod: "on_delivery" | "transfer";
  scheduledLabel: string | null;
  transfer: { bankName: string; accountNumber: string; accountName: string; dueAt: string } | null;
}

const storageKey = "ivy-pizza-last-order-v2";
const tokenStorageKey = "ivy-pizza-order-tokens-v1";

export function saveLastOrder(order: PlacedOrder): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    // The confirmation falls back to the order number alone.
  }
}

export function readLastOrder(orderNumber: string): PlacedOrder | null {
  try {
    const order = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as PlacedOrder | null;
    return order && order.orderNumber === orderNumber ? order : null;
  } catch {
    return null;
  }
}

function readTokens(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(tokenStorageKey) ?? "{}") as unknown;
    return value && typeof value === "object" ? value as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** Guests follow their order with the token the API returned. The last ten are kept on this device. */
export function saveOrderToken(orderNumber: string, token: string): void {
  try {
    const tokens = Object.entries({ ...readTokens(), [orderNumber]: token }).slice(-10);
    localStorage.setItem(tokenStorageKey, JSON.stringify(Object.fromEntries(tokens)));
  } catch {
    // Without storage the guest can still look the order up by number and phone.
  }
}

export function orderToken(orderNumber: string): string | null {
  return readTokens()[orderNumber] ?? null;
}

/** The most recent order this device placed as a guest, for "Track my order". */
export function latestGuestOrderNumber(): string | null {
  const numbers = Object.keys(readTokens());
  return numbers.length ? numbers[numbers.length - 1]! : null;
}
