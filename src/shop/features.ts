/**
 * Storefront features that the design includes but the API does not support yet.
 * Each flag is switched on in the phase that adds the server side (see design-handoff/ORDERING-PLAN.md).
 * While a flag is off, the matching UI is hidden or shown as "coming soon" rather than faked.
 */
export const features = {
  /** Phase 2: orders carry a fulfilment mode and a store. */
  pickup: false,
  /** Phase 2: orders carry a scheduled time and slots are checked server-side. */
  scheduling: false,
  /** Phase 2: voucher codes are validated and priced server-side. */
  vouchers: false,
  /** Phase 2: menu items carry allergen data. */
  allergens: false,
  /** Phase 2: crust, sauce, cheese and toppings with half placement and amounts. */
  builderV2: false,
  /** Phase 2: delivery fee and minimum come from the chosen zone instead of one flat fee. */
  zonePricing: false,
  /** Phase 3: orders can be placed without an account. */
  guestCheckout: false,
  /** Phase 3: bank transfer with manual verification. */
  bankTransfer: false,
  /** Phase 4: card payments through a gateway. */
  cardPayments: false,
} as const;
