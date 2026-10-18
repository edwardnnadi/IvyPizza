import { Router } from "express";
import { database } from "../database.js";
import { businessTimeZone, loadStores, loadZones, scheduleSlots, storeHours } from "../ordering.js";
import { guestCheckoutEnabled, kitchenPhone, transferDetails } from "../settings.js";

const ordering = Router();

/** Everything the storefront needs to place an order: kitchens and hours, delivery areas, time slots, payments. */
ordering.get("/config", async (_request, response, next) => {
  try {
    const now = new Date();
    const [stores, zones] = await Promise.all([loadStores(database), loadZones(database)]);
    const slots = Object.fromEntries(await Promise.all(stores.map(async (store) => [store.id, await scheduleSlots(database, store, now)] as const)));
    response.set("Cache-Control", "no-store");
    response.json({
      now: now.toISOString(),
      timeZone: businessTimeZone,
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        shortName: store.shortName,
        address: store.address,
        opensMinute: store.opensMinute,
        closesMinute: store.closesMinute,
        readyMinutes: { min: store.readyMinutesMin, max: store.readyMinutesMax },
        ...storeHours(store, now),
      })),
      zones: zones.map((zone) => ({
        id: zone.id,
        storeId: zone.storeId,
        name: zone.name,
        delivers: zone.delivers,
        feeMinor: zone.feeMinor,
        minimumMinor: zone.minimumMinor,
        eta: zone.etaMin && zone.etaMax ? { min: zone.etaMin, max: zone.etaMax } : null,
        center: zone.centerLat !== null && zone.centerLng !== null ? { lat: zone.centerLat, lng: zone.centerLng, radiusKm: zone.radiusKm ?? 3 } : null,
      })),
      slots,
      payments: { onDelivery: true, transfer: transferDetails() !== null, card: false },
      guestCheckout: guestCheckoutEnabled(),
      kitchenPhone: kitchenPhone(),
    });
  } catch (error) {
    next(error);
  }
});

export default ordering;
