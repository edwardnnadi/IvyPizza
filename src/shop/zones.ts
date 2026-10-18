import { apiUrl } from "../api.js";

/** Kitchens, delivery areas, opening hours, time slots and payment options, served by /api/ordering/config. */

export interface DeliveryArea {
  id: string;
  storeId: string;
  name: string;
  minimumMinor: number;
  feeMinor: number;
  /** "25–35" minutes */
  eta: string;
  outOfZone: boolean;
  center: { lat: number; lng: number; radiusKm: number } | null;
}

export interface Kitchen {
  id: string;
  name: string;
  short: string;
  address: string;
  opensMinute: number;
  closesMinute: number;
  readyMinutes: { min: number; max: number };
  acceptingOrders: boolean;
  pausedMessage: string | null;
}

export interface Slot { time: string; at: string; available: boolean }
export interface SlotDay { date: string; label: string; slots: Slot[] }

interface ConfigResponse {
  stores: Array<{ id: string; name: string; shortName: string; address: string; opensMinute: number; closesMinute: number; readyMinutes: { min: number; max: number }; acceptingOrders: boolean; pausedMessage: string | null }>;
  zones: Array<{ id: string; storeId: string; name: string; delivers: boolean; feeMinor: number | null; minimumMinor: number | null; eta: { min: number; max: number } | null; center: { lat: number; lng: number; radiusKm: number } | null }>;
  slots: Record<string, SlotDay[]>;
  payments: { onDelivery: boolean; transfer: boolean; card: boolean };
  guestCheckout: boolean;
  kitchenPhone: string | null;
}

export type ConfigState = { status: "loading" } | { status: "error" } | { status: "live"; config: ConfigResponse };

let state: ConfigState = { status: "loading" };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

export function configState(): ConfigState {
  return state;
}

export function onConfigChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadConfig(): Promise<void> {
  inFlight ??= (async () => {
    try {
      const response = await fetch(apiUrl("/api/ordering/config"), { cache: "no-store" });
      if (!response.ok) throw new Error("Config unavailable");
      state = { status: "live", config: await response.json() as ConfigResponse };
    } catch {
      // Keep the last good config if a refresh fails.
      if (state.status !== "live") state = { status: "error" };
    } finally {
      inFlight = null;
    }
    for (const listener of listeners) listener();
  })();
  return inFlight;
}

function config(): ConfigResponse | null {
  return state.status === "live" ? state.config : null;
}

export function areas(): DeliveryArea[] {
  return (config()?.zones ?? []).map((zone) => ({
    id: zone.id,
    storeId: zone.storeId,
    name: zone.name,
    minimumMinor: zone.minimumMinor ?? 0,
    feeMinor: zone.feeMinor ?? 0,
    eta: zone.eta ? `${zone.eta.min}–${zone.eta.max}` : "",
    outOfZone: !zone.delivers,
    center: zone.center,
  }));
}

/** The delivery area containing a point, using each area's centre and radius (development approximations). */
export function areaForPoint(lat: number, lng: number): { area: DeliveryArea; distanceKm: number } | null {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  let best: { area: DeliveryArea; distanceKm: number } | null = null;
  for (const area of areas()) {
    if (!area.center) continue;
    const dLat = toRadians(area.center.lat - lat);
    const dLng = toRadians(area.center.lng - lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat)) * Math.cos(toRadians(area.center.lat)) * Math.sin(dLng / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.asin(Math.sqrt(h));
    // A little slack, because the radius is approximate.
    if (distanceKm <= area.center.radiusKm * 1.3 && (!best || distanceKm < best.distanceKm)) best = { area, distanceKm };
  }
  return best;
}

export function kitchens(): Kitchen[] {
  return (config()?.stores ?? []).map((store) => ({ ...store, short: store.shortName }));
}

export function findArea(id: string | null | undefined): DeliveryArea | undefined {
  return areas().find((area) => area.id === id);
}

export function findKitchen(id: string | null | undefined): Kitchen | undefined {
  return kitchens().find((kitchen) => kitchen.id === id) ?? kitchens()[0];
}

export function slotDays(kitchenId: string | null | undefined): SlotDay[] {
  const kitchen = findKitchen(kitchenId);
  return kitchen ? config()?.slots[kitchen.id] ?? [] : [];
}

export function payments(): ConfigResponse["payments"] {
  return config()?.payments ?? { onDelivery: true, transfer: false, card: false };
}

export function guestCheckoutAllowed(): boolean {
  return config()?.guestCheckout ?? false;
}

export function kitchenPhone(): string {
  return config()?.kitchenPhone ?? "";
}

export function pickupReadyText(kitchenId?: string | null): string {
  const kitchen = findKitchen(kitchenId);
  return kitchen ? `${kitchen.readyMinutes.min}–${kitchen.readyMinutes.max} min` : "15–20 min";
}

/** Minutes since midnight in Abuja (WAT), whatever the visitor's own time zone. */
function minutesInAbuja(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface KitchenHours {
  open: boolean;
  /** Open by the clock but not taking online orders right now. */
  paused: boolean;
  pausedMessage: string | null;
  opensAt: string;
  closesAt: string;
  opensDay: "today" | "tomorrow";
}

/** Uses the kitchen's hours from the config and the live clock, so the closed state appears on time. */
export function kitchenHours(kitchenId?: string | null, now = new Date()): KitchenHours {
  const kitchen = findKitchen(kitchenId);
  const opensMinute = kitchen?.opensMinute ?? 660;
  const closesMinute = kitchen?.closesMinute ?? 1380;
  const minutes = minutesInAbuja(now);
  const withinHours = minutes >= opensMinute && minutes < closesMinute;
  const paused = !!kitchen && !kitchen.acceptingOrders;
  return {
    open: withinHours && !paused,
    paused,
    pausedMessage: kitchen?.pausedMessage ?? null,
    opensAt: clock(opensMinute),
    closesAt: clock(closesMinute),
    opensDay: minutes < opensMinute ? "today" : "tomorrow",
  };
}

/** "18:30–18:40" in Abuja time, `eta` minutes ("25–35") after `from`. */
export function arrivalWindow(from: Date, eta: { min: number; max: number }): string {
  const format = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${format.format(new Date(from.getTime() + eta.min * 60_000))}–${format.format(new Date(from.getTime() + eta.max * 60_000))}`;
}

export function abujaClock(date: Date): string {
  return new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
