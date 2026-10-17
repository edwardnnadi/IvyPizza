import { configState, findArea, findKitchen, kitchenHours, onConfigChange, pickupReadyText, slotDays } from "./zones.js";

export type OrderMode = "delivery" | "pickup";

/** A chosen time slot: the instant the API expects, and how to show it ("Tomorrow, 19:30"). */
export interface ScheduledSlot {
  at: string;
  label: string;
}

export interface OrderContext {
  mode: OrderMode;
  areaId: string | null;
  kitchenId: string | null;
  when: "now" | ScheduledSlot;
}

const storageKey = "ivy-pizza-order-context-v2";
const listeners = new Set<() => void>();

function read(): OrderContext {
  const fallback: OrderContext = { mode: "delivery", areaId: null, kitchenId: null, when: "now" };
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<OrderContext> | null;
    if (!value || typeof value !== "object") return fallback;
    const when = value.when && value.when !== "now" && typeof value.when.at === "string" && typeof value.when.label === "string" ? value.when : "now";
    return {
      mode: value.mode === "pickup" ? "pickup" : "delivery",
      areaId: typeof value.areaId === "string" ? value.areaId : null,
      kitchenId: typeof value.kitchenId === "string" ? value.kitchenId : null,
      when,
    };
  } catch {
    return fallback;
  }
}

let context = read();

function persist(): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(context));
  } catch {
    // The choice still holds for this visit when storage is unavailable.
  }
}

export function getContext(): OrderContext {
  return context;
}

export function setContext(patch: Partial<OrderContext>): void {
  context = { ...context, ...patch };
  persist();
  for (const listener of listeners) listener();
}

export function onContextChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Once the config arrives: drop areas that no longer deliver and slots that are gone or full. */
onConfigChange(() => {
  if (configState().status !== "live") return;
  const patch: Partial<OrderContext> = {};
  const area = findArea(context.areaId);
  if (context.areaId && (!area || area.outOfZone)) patch.areaId = null;
  if (!findKitchen(context.kitchenId) || context.kitchenId === null) patch.kitchenId = (area ? findKitchen(area.storeId) : findKitchen(null))?.id ?? null;
  if (context.when !== "now") {
    const at = context.when.at;
    const slot = slotDays(patch.kitchenId ?? context.kitchenId).flatMap((day) => day.slots).find((candidate) => candidate.at === at);
    if (!slot || !slot.available) patch.when = "now";
  }
  if (Object.keys(patch).length) setContext(patch);
  else for (const listener of listeners) listener();
});

/** The kitchen that will make the order: the chosen pickup kitchen, or the one serving the delivery area. */
export function activeKitchenId(): string | null {
  if (context.mode === "delivery") {
    const area = findArea(context.areaId);
    if (area) return area.storeId;
  }
  return findKitchen(context.kitchenId)?.id ?? null;
}

/** True once the customer has told us where the order goes. */
export function isLocated(): boolean {
  return context.mode === "pickup" || context.areaId !== null;
}

export function areaLabel(): { kicker: string; label: string } {
  if (context.mode === "pickup") return { kicker: "Collect from", label: findKitchen(context.kitchenId)?.short ?? "Choose a kitchen" };
  return { kicker: "Delivering to", label: findArea(context.areaId)?.name ?? "Choose your area" };
}

export function whenLabel(): { kicker: string; label: string } {
  const delivery = context.mode === "delivery";
  const kicker = delivery ? "Arrival" : "Ready";
  if (context.when !== "now") return { kicker, label: context.when.label };
  const hours = kitchenHours(activeKitchenId());
  if (hours.paused) return { kicker, label: "Paused · order for later" };
  if (!hours.open) return { kicker, label: `Closed · opens ${hours.opensAt}` };
  if (!delivery) return { kicker, label: `Now · ready in ${pickupReadyText(context.kitchenId)}` };
  const area = findArea(context.areaId);
  return { kicker, label: area ? `Now · ${area.eta} min` : "As soon as possible" };
}

/** ASAP orders need the kitchen open; scheduled ones don't. */
export function canOrderNow(): boolean {
  return context.when !== "now" || kitchenHours(activeKitchenId()).open;
}
