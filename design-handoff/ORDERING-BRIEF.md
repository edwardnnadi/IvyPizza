# Prompt for Claude Design: The Ivy Pizza, every screen except the landing page

Copy everything below the line into Claude Design. Attach this zip (the Domino's reference screenshots plus `README - Dominos UK flow notes.md`). If you can, also attach `design-handoff/BRIEF.md`, `design-handoff/current-site.html` and the venue photos in `design-handoff/assets/` from the Ivy Pizza repo.

---

## Who we are
**The Ivy Pizza** is a new premium fast-food restaurant in **Abuja, Nigeria**: pizza and flame-grilled burgers, for eat-in, pickup and delivery. The public landing page is already being designed separately. **Do not design the landing page.** Design **every other customer screen, every staff screen, and all of their states.**

## Brand (keep)
- Logo lockup: **THE IVY** in white/green with **PIZZA** in gold, a letter-spaced serif.
- Colours: ivy green `#103c2a` (darker `#071b12`, `#102d20`), gold `#d5a543`, warm cream `#f7f3ea`, ink `#122019`. Gold text on cream must still meet WCAG AA, so adjust the shade where needed.
- Type: propose a serif display face and a clean sans for UI. The current Georgia/Arial is a placeholder.
- Voice: confident, warm, short lines. Currency is Naira, shown as **₦7,500** (no decimals).
- Feel: premium but fast. Ordering must never be slowed down by decoration.

## Reference material in the zip, and what to take from it
The screenshots are Domino's UK (files `01`–`32`) and Domino's US (files `US_*`), named in flow order. Read the README table first. **Use them for flow and states only. Do not copy Domino's visuals, layout or copy.** Patterns to adopt and adapt:
- The **location comes first**: one header pill holds the mode (Delivery/Pickup), the location and the ETA, and is visible on every page.
- **Now / Later** scheduling straight after choosing a location (US_04–05).
- A product builder with a **sticky section nav**, a sticky Add button with a **live price** (UK shows the price, US doesn't; we want it shown), options that can't be combined greyed out with a reason, and Light/Normal/Extra amounts.
- **Half & Half via per-topping placement** (left / whole / right), as in US_07_05–06, with a live summary ("Left half: Suya · Right half: Pepperoni").
- Basket: a progress stepper (Basket → Checkout → Confirmation), automatic best-deal application with the saving shown, editing an item *inside* the basket (US_11_05), an inline voucher error, a minimum-order warning with a "switch to pickup" link, and clear fee/total lines.
- Upsells: at most **one** gentle upsell moment. Domino's US stacks three; we don't want that.
- What Domino's gets wrong and we must fix: the **store-closed state** (27: buttons silently grey out with no message) and **basket wiped on store switch without warning** (24).

## Things specific to Abuja (important)
- There are **no reliable postcodes**. Replace "postcode first" with **area/district first** (e.g. Wuse 2, Maitama, Garki, Asokoro, Jabi, Gwarinpa, Utako, Lugbe), plus "Use my location" and a map pin. At checkout capture the street/house, a **landmark** (required, because that's how riders find places in Abuja), a contact phone and driver instructions.
- **Delivery zones** by area, each with its own **delivery fee** and **minimum order**. Out-of-zone gets a friendly "we don't deliver there yet" with a Pickup option.
- Phone numbers use the +234 format. Assume **many users are on mobile data**: mobile-first at 375px, light imagery, skeleton loading states, retry on network failure.
- Payment (to be finalised, so design it provider-agnostic): **card via a payment gateway** (Paystack/Flutterwave style redirect or popup), **bank transfer** (show account details and "I've paid"), and **pay on delivery** (cash or POS). Include payment pending, failed and retry states.
- Opening hours shown in WAT, plus a clear **closed / opening soon** state with pre-order for later.

## Data the app already has (design within this)
- **Menu items**: name, category (Pizzas, Burgers; more will come), description, price, available yes/no, display order. **Options** per item are `size` (Regular 10" / Large 13" / Family 15", each with a price) and `extra` (each with a price), and each option can be unavailable.
  - Design the builder so it also scales to toppings with half placement and Light/Normal/Extra amounts, plus a free-text "special instructions" field.
- **Order fulfilment statuses**: `awaiting_acceptance → accepted → preparing → ready_for_delivery → out_for_delivery → delivered`, plus the exits `rejected`, `cancelled` and `delivery_exception`.
- **Payment statuses**: `pending`, `paid`, `failed`, `refund_pending`, `partially_refunded`, `refunded`.
- **Customer addresses**: label (Home/Work), recipient name, phone, address, landmark, instructions.
- **Reviews**: a 1–5 rating plus text, allowed only after `delivered`.
- **Roles**: `customer`, `kitchen`, `manager`, `rider`, `hr`, `owner`. Staff roles require an active employment record, which HR assigns and ends.
- **Auth**: email and password with email verification (Better Auth). Guest browsing is allowed; an account is required to place an order (if you think guest checkout is better, say so and show it as an option).

## Screens to design (desktop 1440 and mobile 375 for each, with every state listed)

### A. Customer: getting started
1. **Order-mode and location sheet**: Delivery / Pickup toggle; area search with suggestions, "Use my location" (permission prompt, denied and failed states), and a map pin to confirm. States: in-zone (shows ETA, fee and minimum), out of zone, store closed (opens at…), loading.
2. **Now / Later**: a date and time-slot picker; slots unavailable; the earliest available slot.
3. **Header pill / persistent mode bar**: delivery vs pickup, location, ETA and an edit action, on every page.

### B. Customer: menu and building an order
4. **Full menu page**: sticky category tabs, search, dietary/spicy badges, sold-out items, "from ₦X" pricing. States: loading skeleton, empty category, error with retry, store closed banner with pre-order.
5. **Item detail / builder** (pizza): size → crust (future) → sauce → cheese → toppings with left/whole/right and Light/Normal/Extra → extras → special instructions → quantity. Sticky live price and Add. States:
   - Default.
   - An option unavailable, with the reason.
   - Required choice missing, with an inline error.
   - Half & Half summary.
   - Price updating.
   - Added confirmation.
6. **Item detail** (burger/simple item): fewer options, same component family.
7. **Allergen / nutrition** sheet for an item.
8. **Deals / combos** page and a **deal builder** with slots ("Choose your pizza", "Choose your side"), filled and unfilled slots, and the saving shown.
9. **Add-to-basket feedback**: toast, basket count bump, and the one allowed upsell.

### C. Customer: basket and checkout
10. **Basket** (a drawer on mobile, a page or drawer on desktop) with line items, options summary, a quantity stepper, edit-in-place (reopens the builder inside the basket) and remove (with undo). It also has the voucher field, delivery fee, service charge/VAT if applicable, and total. States:
    - Empty.
    - Filled.
    - Calculating.
    - Below minimum, with a "switch to pickup" link.
    - Voucher applied.
    - Voucher invalid or expired.
    - Item became unavailable.
    - Price changed since added.
11. **Change location/store confirmation**: a warning before anything that would clear or change the basket.
12. **Checkout** (one page with sections, sticky order summary):
    - Contact.
    - Address: saved-address picker or new address with landmark, plus driver instructions. For pickup, show the store card and a pickup time instead.
    - Delivery time (ASAP or scheduled).
    - Payment method.
    - Marketing opt-in, **unticked by default**.
    - Place order.

    States: validation errors, signed out (sign-in or create account inline), payment processing.
13. **Payment** sub-states: gateway redirect/popup, bank transfer instructions with an "I've paid" confirm and a pending-verification state, pay on delivery (cash/POS), payment failed with retry or switch method, and a duplicate-submission guard.
14. **Order confirmation**: order number, ETA, summary, "track your order", add to calendar (for scheduled orders).

### D. Customer: tracking and after the order
15. **Live order tracker**: a stage bar mapped to the statuses above. Show these states:
    - Awaiting acceptance.
    - Accepted.
    - Preparing.
    - Ready (pickup: "ready at the counter").
    - Out for delivery: the rider's name and a call button, without exposing the rider's personal number if a relay is used.
    - Delivered.

    Also design the exits: rejected (with refund info), cancelled, and delivery exception (with a "contact us" path). It should also be reachable by order number plus phone for guests.
16. **Rate your order** (after delivery): stars, text, thank-you state.
17. **Order history and reorder**: list, detail, "reorder" with a warning if items have changed.
18. **Refund status** view (refund pending, partially refunded, refunded).

### E. Customer: account
19. **Auth**: sign in, create account (name, email, phone, password with live rules), verify email (sent, resend, expired link), forgot password (request, code/link sent, set new), plus error and locked states.
20. **Account home**: profile, saved addresses (add, edit, set default, delete with confirm; the form includes landmark), saved preferences, marketing preferences, sign out.
21. **Help / contact**: order issue form linked to an order, FAQs, phone/WhatsApp.

### F. Staff (internal tools, desktop and tablet first; rider is mobile first)
22. **Staff sign-in and role switcher** (one person can hold several roles) and a "no access" state.
23. **Kitchen display (KDS)**: columns or lanes for New (awaiting acceptance), Accepted, Preparing and Ready. Each order ticket shows:
    - Order number.
    - Time since placed, with an SLA colour.
    - Delivery or pickup.
    - Items with half & half placement and extras rendered clearly for cooks.
    - Special instructions highlighted.

    Ticket actions: accept, reject (with a reason), start preparing, mark ready. Also include:
    - A sound or alert setting for new orders.
    - A large-touch-target tablet layout.
    - Item sold-out toggles ("86" an item).
    - States: empty queue, offline/reconnecting, and order cancelled while in prep.
24. **Manager / dispatch**: a live board of all orders by status, with filters, search and order detail including a status event timeline (who changed what, when). It also needs:
    - Assigning or reassigning a rider (one active rider per order).
    - Marking a delivery exception.
    - Cancelling or refunding (full or partial, with a reason).
    - Store controls: open/close or pause ordering with a message, delivery zones with fee and minimum per area, prep-time/ETA setting, menu availability and prices.
    - Today's summary (orders, revenue, average prep and delivery time, late orders).
25. **Rider app** (mobile): my assigned deliveries, order detail (customer first name, address and landmark, map link, call/relay, payment to collect if pay on delivery), and the actions picked up → out for delivery → delivered. It also covers:
    - Cash or POS collected confirmation.
    - Reporting a delivery exception (no answer, wrong address), with a reason.
    - States: no assignments, offline.
26. **HR**: staff list, staff detail, add or assign staff (creates the employment record, then grants roles), change roles, offboard (ends employment and removes roles, with a confirm), plus an audit trail.
27. **Owner**: reporting dashboard (sales by day/hour/item, delivery vs pickup mix, average order value, top areas, refunds, ratings), plus everything the manager can see.

### G. System screens
28. 404, 500, offline, maintenance / "ordering paused", session expired, and permission denied.
29. **Transactional emails** (customer: verify email, password reset, order confirmation, out for delivery, delivered + review ask, refund issued; staff: invite / role granted, offboarded). Keep them simple, brand-consistent and mobile-friendly.

## Cross-cutting requirements
- **Components and states**: build a component sheet covering buttons, chips, segmented controls, steppers, option cards (default / selected / disabled / unavailable), the half-placement control, price tag, toasts, banners (info/warn/error/closed), drawers, modals, skeletons, empty states, status badges for every order and payment status, and the stage bar.
- **Motion**: subtle, fast transitions. Specify durations and easing, and give a `prefers-reduced-motion` fallback for each.
- **Accessibility**: keyboard reachable everywhere, visible focus, AA contrast, labelled form fields, errors announced, touch targets ≥ 44px. The kitchen and rider screens need to be readable at arm's length and in sunlight.
- **Content**: realistic sample data. Use these menu items:
  - Pizzas: Ivy Signature Chicken, Ivy Signature Beef, Ivy Suya Pizza, Ivy Pepperoni, Ivy Margarita (₦7,500–₦9,500).
  - Burgers: Ivy Classic Burger, Ivy Double Classic, Chicken Burger & Wrap (₦5,000–₦7,000).

  Use Abuja areas and Nigerian names and phone formats.
- **Build constraints**: the front end is plain TypeScript + Vite with no framework, so designs should translate into plain HTML/CSS components. No heavy libraries.

## Deliverables
1. A **flow map** of all screens above and how they connect (customer, staff, system).
2. **High-fidelity screens**, desktop and mobile, for every numbered screen, with each listed state shown (state variants can sit side by side).
3. A **component library** sheet with states, and **design tokens** (colour, type scale, spacing, radius, shadow, motion).
4. Short **annotations** for any non-obvious behaviour: what triggers a state, validation rules, and what the user can do next.
5. A list of **open questions or assumptions** you made (e.g. payment provider, guest checkout, tax display).
