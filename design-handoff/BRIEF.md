# The Ivy Pizza — design brief: redesign as a motion site

## The ask
Redesign the public website for **The Ivy Pizza**, a new premium fast-food restaurant in **Abuja, Nigeria** (pizza, flame-grilled burgers, eat-in, pickup and delivery). Keep the brand, push the craft: turn the current static page into a **scroll-driven motion site** that feels premium, appetising and fast, without getting in the way of ordering.

`current-site.html` is a static snapshot of the live design (open it next to the `assets/` folder). The photos in `assets/` are the real venue.

## Brand (keep)
- Name lockup: **THE IVY** in white/green + **PIZZA** in gold, serif, letter-spaced.
- Palette: deep ivy green `#103c2a` (darker `#071b12`, `#102d20`), gold `#d5a543`, warm cream `#f7f3ea`, ink `#122019`.
- Voice: confident, warm, short lines. Current hero line: "Abuja's new pizza ritual."
- Type today is Georgia + Arial, which is a placeholder. Propose a proper serif display + clean sans pairing.
- Currency is Naira (₦).

## Page structure (content to keep, order can change)
1. **Nav**: logo, Menu / Experience / Visit us, "My account" button (opens a sign-in / create-account dialog).
2. **Hero**: exterior photo, eyebrow "Pizza • Burgers • Fast delivery", headline, two CTAs (Explore the menu, Find The Ivy Pizza).
3. **Value strip**: Freshly prepared · Quick pickup · Delivery ready · Made for Abuja.
4. **Experience**: "Fast food, beautifully done." with dining room and pickup counter photos.
5. **Menu and basket** (the core of the page): category filter (All / Pizzas / Burgers); item cards with name, description, "From ₦X"; pizza size picker (Regular 10" / Large 13" / Family 15"); collapsible extras; quantity; Add to basket. The basket shows line items with options, quantity, remove and subtotal, plus a disabled "Checkout · coming soon" button.
6. **Visit / Order your way**: open-kitchen photo, eat in / pick up / delivery, Contact us.
7. **Footer**.

Menu items: Ivy Signature Chicken, Ivy Signature Beef, Ivy Suya Pizza, Ivy Pepperoni, Ivy Margarita (pizzas, ₦7,500 to ₦9,500); Ivy Classic Burger, Ivy Double Classic, Chicken Burger & Wrap (₦5,000 to ₦7,000). Prices are development samples.

## Motion direction
- Hero: a cinematic entrance (staggered headline reveal, slow parallax or zoom on the exterior photo).
- Scroll-linked storytelling through Experience (pinned or parallax photography, text reveals).
- Menu: lively but fast. Cards animate in, the filter change animates the layout, adding to the basket gives clear feedback (fly-to-basket or count bump, subtotal tick-up).
- Consider a sticky or floating basket summary on scroll, plus a slide-in basket drawer on mobile.
- Micro-interactions on buttons, size chips and the extras disclosure.
- **Must respect `prefers-reduced-motion`.** All content must be readable and orderable with motion off.
- Performance matters: many visitors will be on mobile data in Abuja. Prefer CSS / transform / opacity motion and lightweight libraries (e.g. GSAP or Motion One), and keep photos compressed.

## Constraints from the codebase
- The site is plain TypeScript + Vite (no React). The final design will be rebuilt into `src/main.ts` / `src/menu.ts` / `src/style.css`.
- Menu cards and basket lines are rendered from the database at runtime, so design them as **repeatable components** with states: loading, empty category, unavailable item, error message, basket empty / filled / calculating subtotal.
- Account dialog states: sign in, create account (adds Full name), signed-in profile, error/status message.
- Mobile-first: it must work well at 375px wide.
- Accessibility: keyboard reachable, visible focus, AA contrast (especially gold on cream).

## Out of scope
Staff screens (`/kitchen`, `/hr`) are internal tools; leave them for now. Checkout and payment are not built yet.

## Deliverables wanted
- Desktop and mobile designs for the full public page, including the menu card, basket and account dialog states.
- A motion spec: what animates, triggers, durations and easing, and reduced-motion fallbacks.
- Design tokens (colour, type scale, spacing, radius, shadows).
