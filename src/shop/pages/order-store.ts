/** What the confirmation page shows right after checkout. Kept in this tab only. */
export interface PlacedOrder {
  orderNumber: string;
  firstName: string;
  lines: Array<{ name: string; options: string; totalMinor: number }>;
  totalMinor: number;
  currency: string;
  destination: string;
  eta: string;
  delivery: boolean;
  placedAt: string;
}

const storageKey = "ivy-pizza-last-order-v1";

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
