import type { Queryable } from "./database.js";
import { MenuQuoteError } from "./menu-pricing.js";

export const businessTimeZone = process.env.BUSINESS_TIMEZONE?.trim() || "Africa/Lagos";
/** How far ahead a scheduled order must be, so the kitchen is never surprised. */
const scheduleLeadMinutes = 45;
const slotStepMinutes = 30;
/** Customers can schedule today and tomorrow. */
const scheduleDays = 2;
/** Unpaid bank transfers are cancelled after this long unless the customer reports paying. */
export const transferWindowMinutes = 30;

export type FulfilmentMode = "delivery" | "pickup";

// ---------- Business time ----------

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: businessTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function zonedParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second! };
}

/** The business-time calendar date ("2026-10-17") and minutes after midnight for an instant. */
export function businessClock(date: Date): { date: string; minutes: number } {
  const parts = zonedParts(date);
  return { date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`, minutes: parts.hour * 60 + parts.minute };
}

/** The instant at `minutes` after midnight on a business-time calendar date. */
export function businessTimeToUtc(date: string, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const parts = zonedParts(new Date(guess));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - guess;
  return new Date(guess - offset);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------- Kitchens and zones ----------

export interface Store {
  id: string;
  name: string;
  shortName: string;
  address: string;
  opensMinute: number;
  closesMinute: number;
  readyMinutesMin: number;
  readyMinutesMax: number;
  slotCapacity: number;
  acceptingOrders: boolean;
  pausedMessage: string | null;
}

export interface Zone {
  id: string;
  storeId: string;
  name: string;
  delivers: boolean;
  feeMinor: number | null;
  minimumMinor: number | null;
  etaMin: number | null;
  etaMax: number | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
}

export async function loadStores(client: Queryable): Promise<Store[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT id, name, short_name AS shortName, address, opens_minute AS opensMinute, closes_minute AS closesMinute,
            ready_minutes_min AS readyMinutesMin, ready_minutes_max AS readyMinutesMax, slot_capacity AS slotCapacity,
            accepting_orders AS acceptingOrders, paused_message AS pausedMessage
     FROM stores ORDER BY display_order, name`,
  );
  return rows as unknown as Store[];
}

export async function loadZones(client: Queryable): Promise<Zone[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT id, store_id AS storeId, name, delivers, fee_minor AS feeMinor, minimum_minor AS minimumMinor,
            eta_min AS etaMin, eta_max AS etaMax, center_lat AS centerLat, center_lng AS centerLng, radius_km AS radiusKm
     FROM delivery_zones ORDER BY display_order, name`,
  );
  // DECIMAL columns come back as strings.
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return rows.map((row) => ({ ...row, centerLat: number(row.centerLat), centerLng: number(row.centerLng), radiusKm: number(row.radiusKm) })) as unknown as Zone[];
}

export interface StoreHours {
  open: boolean;
  acceptingOrders: boolean;
  pausedMessage: string | null;
  opensAt: string;
  closesAt: string;
  /** When the kitchen next opens, if it is closed now. */
  opensDay: "today" | "tomorrow" | null;
}

export function storeHours(store: Store, now: Date): StoreHours {
  const { minutes } = businessClock(now);
  const open = minutes >= store.opensMinute && minutes < store.closesMinute;
  return {
    open,
    acceptingOrders: store.acceptingOrders,
    pausedMessage: store.acceptingOrders ? null : store.pausedMessage,
    opensAt: clockText(store.opensMinute),
    closesAt: clockText(store.closesMinute),
    opensDay: open ? null : minutes < store.opensMinute ? "today" : "tomorrow",
  };
}

// ---------- Scheduling ----------

export interface Slot {
  /** "19:30" business time. */
  time: string;
  /** ISO instant, sent back as `scheduledFor`. */
  at: string;
  available: boolean;
}

export interface SlotDay {
  date: string;
  label: string;
  slots: Slot[];
}

async function slotCounts(client: Queryable, storeId: string, from: Date, to: Date): Promise<Map<number, number>> {
  const { rows } = await client.query<{ scheduled_for: Date; count: number }>(
    `SELECT scheduled_for, COUNT(*) AS count FROM orders
     WHERE store_id = ? AND scheduled_for >= ? AND scheduled_for <= ? AND fulfillment_status NOT IN ('rejected', 'cancelled')
     GROUP BY scheduled_for`,
    [storeId, from, to],
  );
  return new Map(rows.map((row) => [new Date(row.scheduled_for).getTime(), Number(row.count)]));
}

/** Slots for today and tomorrow. Past slots are left out; slots at capacity are marked unavailable. */
export async function scheduleSlots(client: Queryable, store: Store, now: Date): Promise<SlotDay[]> {
  const today = businessClock(now).date;
  const days: SlotDay[] = [];
  const earliest = now.getTime() + scheduleLeadMinutes * 60_000;
  const first = businessTimeToUtc(today, 0);
  const last = businessTimeToUtc(addDays(today, scheduleDays), 0);
  const counts = await slotCounts(client, store.id, first, last);
  const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: businessTimeZone, weekday: "short", day: "numeric" });
  for (let offset = 0; offset < scheduleDays; offset += 1) {
    const date = addDays(today, offset);
    const slots: Slot[] = [];
    // The first slot leaves the kitchen time to get going after opening.
    const start = Math.ceil((store.opensMinute + store.readyMinutesMax) / slotStepMinutes) * slotStepMinutes;
    for (let minute = start; minute < store.closesMinute; minute += slotStepMinutes) {
      const at = businessTimeToUtc(date, minute);
      if (at.getTime() < earliest) continue;
      slots.push({ time: clockText(minute), at: at.toISOString(), available: (counts.get(at.getTime()) ?? 0) < store.slotCapacity });
    }
    days.push({ date, label: `${offset === 0 ? "Today" : "Tomorrow"}, ${dayFormat.format(businessTimeToUtc(date, 720))}`, slots });
  }
  return days;
}

/**
 * Checks when an order is for. ASAP orders need the kitchen open and accepting orders; scheduled orders
 * need a real, still-open slot. Capacity is checked again inside the order transaction.
 */
export async function validateSchedule(client: Queryable, store: Store, scheduledFor: Date | null, now: Date): Promise<void> {
  const hours = storeHours(store, now);
  if (!store.acceptingOrders) {
    throw new MenuQuoteError(409, store.pausedMessage ?? "We're not taking online orders right now. Please try again shortly.");
  }
  if (!scheduledFor) {
    if (!hours.open) {
      throw new MenuQuoteError(409, `We're closed right now and open at ${hours.opensAt}${hours.opensDay === "tomorrow" ? " tomorrow" : ""}. Choose a later time to pre-order.`);
    }
    return;
  }
  const days = await scheduleSlots(client, store, now);
  const slot = days.flatMap((day) => day.slots).find((candidate) => candidate.at === scheduledFor.toISOString());
  if (!slot) throw new MenuQuoteError(400, "That time is no longer available. Choose another slot.");
  if (!slot.available) throw new MenuQuoteError(409, "That time slot just filled up. Choose another slot.");
}

export async function slotIsFull(client: Queryable, store: Store, scheduledFor: Date): Promise<boolean> {
  const counts = await slotCounts(client, store.id, scheduledFor, scheduledFor);
  return (counts.get(scheduledFor.getTime()) ?? 0) >= store.slotCapacity;
}

// ---------- Vouchers ----------

export interface VoucherResult {
  code: string;
  description: string;
  discountMinor: number;
  freeDelivery: boolean;
}

const expiryFormat = new Intl.DateTimeFormat("en-GB", { timeZone: businessTimeZone, day: "numeric", month: "long" });

/** Returns the voucher's effect, or throws a MenuQuoteError whose message is shown under the voucher field. */
export async function evaluateVoucher(client: Queryable, rawCode: string, context: { mode: FulfilmentMode; subtotalMinor: number; now: Date }): Promise<VoucherResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,30}$/.test(code)) throw new MenuQuoteError(422, "We don't recognise that code. Check the spelling and try again.");
  const { rows: [voucher] } = await client.query<{
    code: string; description: string; discount_type: string; percent_bp: number | null; amount_minor: number | null;
    cap_minor: number | null; mode_restriction: FulfilmentMode | null; starts_at: Date | null; expires_at: Date | null; active: boolean;
  }>("SELECT * FROM vouchers WHERE code = ?", [code]);
  if (!voucher || !voucher.active) throw new MenuQuoteError(422, "We don't recognise that code. Check the spelling and try again.");
  if (voucher.expires_at && new Date(voucher.expires_at) < context.now) {
    throw new MenuQuoteError(422, `This code expired on ${expiryFormat.format(new Date(voucher.expires_at))}.`);
  }
  if (voucher.starts_at && new Date(voucher.starts_at) > context.now) throw new MenuQuoteError(422, "This code isn't active yet.");
  if (voucher.mode_restriction && voucher.mode_restriction !== context.mode) {
    throw new MenuQuoteError(422, `${code} only works on ${voucher.mode_restriction} orders.`);
  }
  let discountMinor = 0;
  if (voucher.discount_type === "percent") discountMinor = Math.round((context.subtotalMinor * voucher.percent_bp!) / 10_000);
  if (voucher.discount_type === "fixed") discountMinor = voucher.amount_minor!;
  if (voucher.cap_minor !== null) discountMinor = Math.min(discountMinor, voucher.cap_minor);
  // Discounts are whole naira on the menu's ₦50 steps.
  discountMinor = Math.min(context.subtotalMinor, Math.round(discountMinor / 5_000) * 5_000);
  return { code, description: voucher.description, discountMinor, freeDelivery: voucher.discount_type === "free_delivery" };
}
