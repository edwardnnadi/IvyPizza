# Ivy Pizza ordering redesign: implementation plan

Source design: `design-handoff/source/Ivy Pizza Ordering Prototype.dc.html` (brief: `ORDERING-BRIEF.md`).
Decision taken: the prototype's "Start your order" landing **replaces** the current scroll-motion home page.

## 1. What the prototype contains

| Screen | States shown in the prototype |
|---|---|
| Header bar (every page) | Delivery/Pickup toggle, "Delivering to <area>" / "Collect from <kitchen>", arrival/ready time, basket count + subtotal |
| Landing | Hero ("Abuja's new pizza ritual."), Start your order (Delivery / Pickup), featured pizza, deals carousel (IVY10, FREEDEL, Classic meal, Half & half), category tiles with "From ₦X", Track my order |
| Area / kitchen sheet | Area list with fee, minimum and ETA; out-of-zone area (Lugbe); no match search; pickup kitchens (Wuse 2, Jabi) |
| Now / Later sheet | Today/Tomorrow, 30-minute slots 11:00–22:30, full slots, no slots left today, closed → pre-order |
| Change-location warning | Fee/minimum/arrival from → to, below-new-minimum warning, FREEDEL removed on pickup |
| Menu | Live, loading skeleton, error + retry, empty, closed banner ("Schedule" CTA), search + no results, allergen filter sheet with hidden-count notice. Categories: Pizzas, Burgers, Sides, Drinks |
| Pizza builder | Live pizza illustration; size; crust (stuffed needs Large/Family, greyed with reason); sauce + Light/Normal/Extra; cheese None/Light/Normal/Extra; 12 toppings with Left/Whole/Right and Light/Normal/Extra; 8-topping limit; half & half summary; price breakdown; sticky qty + "Add to basket · ₦X"; edit mode from basket ("Update basket") |
| Burger sheet | Extras (extra patty, extra cheese, make it a meal), removals (no onions/pickles/lettuce/tomato), qty |
| Add feedback | Toast "1 × X added" with the single upsell, basket count bump |
| Basket | Filled, empty, below minimum (progress bar, checkout disabled), voucher applied, voucher invalid/expired/pickup-only, edit line, qty stepper, sides/drinks upsell |
| Checkout | Signed out (sign in or continue as guest), guest form (name, +234 phone, email, street, flat, landmark), signed in (saved address), pickup (store card), missing-fields errors, card declined, placing-order guard; payment: Card / Bank transfer / Pay on delivery (Pay at counter for pickup) |
| Confirmation | Thank-you, order number, summary, destination; transfer variant with account number, copy button and 30-min countdown |
| Tracker | Received → Preparing → In the oven → Out for delivery / Ready for pickup → Delivered / Collected; rider card on "out for delivery" |

Not in the prototype (still in the wider brief, later phases): account pages, order history/reorder, ratings, refunds, staff screens, system pages, emails.

## 2. Gap against the current code

**Frontend** (`src/`): one long page (`site-markup.ts`) + menu/basket (`menu.ts`) + checkout dialog + motion (`motion.ts`); `/kitchen` and `/hr` by pathname. No client router, no persistent order context (mode/area/time), no builder, no tracker.

**Backend** (`server/`):

| Prototype needs | Today | Change |
|---|---|---|
| Sides, Drinks | Pizzas, Burgers only | Seed rows only (category is free text) |
| Crust, sauce, cheese, toppings with side + amount, removals, burger meal | `menu_options` with `size` / `extra` only | New option types + per-selection `side` and `amount`; pricing rules (half = half price, Extra = double, size multiplier, stuffed crust size rule, 8-topping cap) in `menu-pricing.ts` |
| Allergens | none | `allergens` column (JSON) on `menu_items` |
| Delivery zones (fee, minimum, ETA, out-of-zone) | one env-wide `CHECKOUT_DELIVERY_FEE_MINOR` | `delivery_zones` table; quote/order take `areaId`; minimum enforced server-side |
| Pickup kitchens | single kitchen implied | `stores` table (or a single row if there is only one kitchen; see question 2) |
| Fulfilment mode + scheduled time | delivery only, ASAP only | `orders.fulfilment_mode`, `orders.scheduled_for`, `orders.store_id`, `orders.zone_id`; slot capacity check |
| Vouchers | none | `vouchers` table (code, type, value, cap, mode restriction, expiry, one per order); `orders.discount_minor` + update the total CHECK constraint |
| Guest checkout | `/api/orders` requires a signed-in customer | `customer_id` nullable + `guest_contact` JSON; guest token for the tracker |
| Payment methods | `payment_records` exists, no flow | `payment_method` (card / transfer / on_delivery); card needs a gateway (see question 3) |
| Tracker | no customer status endpoint | `GET /api/orders/:number` (owner or guest token / number + phone); poll every 15–20 s |
| Store open/closed | none | opening hours per store (WAT) + manual pause flag |

## Status (2026-10-17)

**Phases 0 and 1 are built** on branch `ordering-redesign` (`src/shop/`). Notes for the next phases:
- Unsupported features sit behind flags in `src/shop/features.ts` (pickup, scheduling, vouchers, allergens, builderV2, zonePricing, guestCheckout, bankTransfer, cardPayments). While off, the UI hides them or labels them "coming soon"; nothing is faked.
- Builder v1 uses the API's options (size + extras). Crust, sauce, cheese and toppings with half placement and amounts come in Phase 2 with their server pricing (`builderV2`).
- Areas, minimums, ETAs and opening hours are static samples in `src/shop/zones.ts`. The minimum is enforced in the basket and checkout only; the delivery fee is still the API's flat `CHECKOUT_DELIVERY_FEE_MINOR`.
- The tracker uses the real statuses (Received → Preparing → Ready → Out for delivery → Delivered) and reads `/api/customer/dashboard`. The prototype's time-based "In the oven" step is left for Phase 3.
- Landmark is required at checkout (brief), although the prototype marks it optional.
- Food photos: drawn pizzas and burgers stand in until real photography exists.

## 3. Phases

Each phase ships on its own and leaves the site working. Phases 1 and 2 can run side by side (frontend vs backend), both branch from `main`.

**Phase 0 — Foundations (½ day)**
- Port prototype tokens into `src/style.css` (palette, Roboto + Nunito Sans, radii, shadows, motion durations, reduced-motion).
- Tiny hash/history router in `src/router.ts` (`/`, `/menu`, `/menu/:slug`, `/basket`, `/checkout`, `/order/:number`); `/kitchen`, `/hr`, `/account` keep working.
- `src/order-context.ts`: mode, area, store, when; persisted in `localStorage`; emits change events.
- Compress `ivy-hero.png` (3 MB) to WebP at 1200/1920 widths.

**Phase 1 — Frontend on today's API (3–4 days)**
- Header bar component + area/kitchen sheet + Now/Later sheet + change-location warning (zones read from a static `zones.ts` until phase 2 serves them).
- New landing (replaces `site-markup.ts` hero/experience/menu sections; `motion.ts` reduced to small entrance animations).
- Menu page with all states, search, allergen sheet.
- Pizza builder and burger sheet UI. In this phase they only emit what the API already prices (size + extras); crust/sauce/toppings controls render behind a `builderV2` flag.
- Basket page (replaces the inline basket) with edit-in-basket, minimum-order bar, toast + one upsell.
- Checkout page replacing the dialog: signed-out / signed-in / pickup, validation, place-order guard. Payment: Pay on delivery only.
- Confirmation page; tracker page reading the order from the place-order response (static stage until phase 3).

**Phase 2 — Backend extensions (3–4 days)**
- Migration `003_ordering.sql`: `delivery_zones`, `stores` + hours, `vouchers`, menu option types, allergens, order columns (mode, store, zone, scheduled_for, discount, payment_method, guest contact), seed Sides/Drinks/toppings/zones.
- `GET /api/ordering/config` (zones, stores, hours, open/closed, slots).
- Extend `/api/menu` and `/api/menu/quote` for structured pizza/burger configs, zone fees, minimums and vouchers. The server re-prices everything; the client price is display-only.
- Extend `POST /api/orders` for mode, schedule, voucher, payment method; enforce minimum, zone, opening hours and slot.
- Kitchen screen shows half & half and removals clearly (the KDS redesign itself is a later phase).
- Turn on `builderV2` and vouchers in the frontend. Tests in `tests/` for pricing rules, zones, vouchers, scheduling.

**Phase 3 — Guest checkout, tracking, transfer (2–3 days)**
- Guest orders + `GET /api/orders/:number` (signed-in owner, or guest token, or number + phone).
- Live tracker polling, stage mapping (below), rider card when assigned.
- Bank transfer: account details from env, 30-min countdown, "I've paid" → `payment_status=pending` for manager verification; a transfer that's never paid auto-cancels.

**Phase 4 — Card payments (1–2 days once a provider is chosen)**
- Paystack or Flutterwave inline popup, server-side verify + webhook → `payment_records`, card-declined/retry state, idempotency already in place.

**Later (not in the prototype)**: account/addresses/history/reorder, ratings, refunds view, KDS/manager/rider/HR redesign, system pages, transactional emails.

Tracker stage mapping (proposed):

| Tracker step | `fulfillment_status` |
|---|---|
| Order received | `awaiting_acceptance`, `accepted` |
| Preparing | `preparing` (first half of prep time) |
| In the oven | `preparing` (second half, time-based) |
| Out for delivery / Ready for pickup | `out_for_delivery` / `ready_for_delivery` |
| Delivered / Collected | `delivered` |
| Exit banners | `rejected`, `cancelled`, `delivery_exception` |

## 4. Questions for you

1. **Guest checkout?** The prototype allows it; the backend requires an account today. Recommended: yes (phase 3), with tracking by order number + phone.
2. **How many kitchens?** The prototype shows Wuse 2 and Jabi. If there is only one, pickup becomes a single store card and `stores` is a single row.
3. **Payment provider:** Paystack or Flutterwave? Until it's chosen, launch with Pay on delivery (+ bank transfer from phase 3).
4. **Real data needed:** delivery areas with fee/minimum/ETA, Sides & Drinks items and prices, topping list and prices, opening hours, bank transfer account details, and whether IVY10 / FREEDEL are real promotions.
5. **Photos:** the landing has empty slots for the featured Suya pizza and four deal cards. Do you have food photography, or should we use the venue photos for now?
6. **The current motion home page** (scroll-pinned experience section, menu on the home page) goes away. OK to delete `motion.ts`'s scroll storytelling rather than keep it in a lower section?
</content>
</invoke>
