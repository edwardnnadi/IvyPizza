/**
 * Delivery areas, kitchens and opening hours.
 * Development samples from the ordering prototype: confirm real values before launch.
 * Phase 2 moves these into the database and serves them from the API.
 */

export interface DeliveryArea {
  id: string;
  name: string;
  /** Minimum basket subtotal for delivery, in kobo. Enforced in the basket until the API enforces it. */
  minimumMinor: number;
  eta: string;
  /** Shown only once zone pricing is live; until then the API's flat delivery fee applies. */
  feeMinor: number;
  outOfZone?: boolean;
}

export interface Kitchen {
  id: string;
  name: string;
  short: string;
  address: string;
}

export const areas: DeliveryArea[] = [
  { id: "wuse2", name: "Wuse 2", minimumMinor: 800_000, eta: "25–35", feeMinor: 100_000 },
  { id: "maitama", name: "Maitama", minimumMinor: 1_000_000, eta: "30–40", feeMinor: 150_000 },
  { id: "garki", name: "Garki", minimumMinor: 800_000, eta: "30–40", feeMinor: 120_000 },
  { id: "asokoro", name: "Asokoro", minimumMinor: 1_200_000, eta: "35–45", feeMinor: 200_000 },
  { id: "jabi", name: "Jabi", minimumMinor: 900_000, eta: "30–45", feeMinor: 150_000 },
  { id: "gwarinpa", name: "Gwarinpa", minimumMinor: 1_200_000, eta: "40–55", feeMinor: 250_000 },
  { id: "utako", name: "Utako", minimumMinor: 900_000, eta: "30–40", feeMinor: 150_000 },
  { id: "lugbe", name: "Lugbe", minimumMinor: 0, eta: "", feeMinor: 0, outOfZone: true },
];

export const kitchens: Kitchen[] = [
  { id: "wuse", name: "Ivy Pizza Wuse 2", short: "Wuse 2 kitchen", address: "Aminu Kano Crescent, Wuse 2" },
];

/** Kitchen phone shown on the tracker. Left empty until the real number is confirmed, which hides the line. */
export const kitchenPhone: string = "";

export const pickupReadyText = "15–20 min";

const opening = { open: 11 * 60, close: 23 * 60 };

export function findArea(id: string | null | undefined): DeliveryArea | undefined {
  return areas.find((area) => area.id === id);
}

export function findKitchen(id: string | null | undefined): Kitchen {
  return kitchens.find((kitchen) => kitchen.id === id) ?? kitchens[0]!;
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
  /** "11:00" */
  opensAt: string;
  closesAt: string;
  /** "today" or "tomorrow" — when the kitchen next opens while closed. */
  opensDay: "today" | "tomorrow";
}

export function kitchenHours(now = new Date()): KitchenHours {
  const minutes = minutesInAbuja(now);
  const open = minutes >= opening.open && minutes < opening.close;
  return { open, opensAt: clock(opening.open), closesAt: clock(opening.close), opensDay: minutes < opening.open ? "today" : "tomorrow" };
}
