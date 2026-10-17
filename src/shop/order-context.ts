import { features } from "./features.js";
import { findArea, findKitchen, kitchenHours, pickupReadyText } from "./zones.js";

export type OrderMode = "delivery" | "pickup";

export interface OrderContext {
  mode: OrderMode;
  areaId: string | null;
  kitchenId: string;
  /** "now", or an ISO local slot once scheduling is live. */
  when: "now" | { day: number; slot: string };
}

const storageKey = "ivy-pizza-order-context-v1";
const listeners = new Set<() => void>();

function read(): OrderContext {
  const fallback: OrderContext = { mode: "delivery", areaId: null, kitchenId: findKitchen(null).id, when: "now" };
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<OrderContext> | null;
    if (!value || typeof value !== "object") return fallback;
    return {
      mode: value.mode === "pickup" && features.pickup ? "pickup" : "delivery",
      areaId: findArea(value.areaId) && !findArea(value.areaId)!.outOfZone ? value.areaId! : null,
      kitchenId: findKitchen(value.kitchenId).id,
      when: features.scheduling && value.when && value.when !== "now" ? value.when : "now",
    };
  } catch {
    return fallback;
  }
}

let context = read();

export function getContext(): OrderContext {
  return context;
}

export function setContext(patch: Partial<OrderContext>): void {
  context = { ...context, ...patch };
  try {
    localStorage.setItem(storageKey, JSON.stringify(context));
  } catch {
    // The choice still holds for this visit when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function onContextChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once the customer has told us where the order goes. */
export function isLocated(): boolean {
  return context.mode === "pickup" || context.areaId !== null;
}

export function areaLabel(): { kicker: string; label: string } {
  if (context.mode === "pickup") return { kicker: "Collect from", label: findKitchen(context.kitchenId).short };
  return { kicker: "Delivering to", label: findArea(context.areaId)?.name ?? "Choose your area" };
}

export function whenLabel(): { kicker: string; label: string } {
  const delivery = context.mode === "delivery";
  const kicker = delivery ? "Arrival" : "Ready";
  if (context.when !== "now") return { kicker, label: `${context.when.day === 0 ? "Today" : "Tomorrow"}, ${context.when.slot}` };
  const hours = kitchenHours();
  if (!hours.open) return { kicker, label: `Closed · opens ${hours.opensAt}` };
  if (!delivery) return { kicker, label: `Now · ready in ${pickupReadyText}` };
  const area = findArea(context.areaId);
  return { kicker, label: area ? `Now · ${area.eta} min` : "As soon as possible" };
}
