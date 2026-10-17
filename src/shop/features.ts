/**
 * Storefront features and the phase that switched them on (see design-handoff/ORDERING-PLAN.md).
 * Guest checkout and bank transfer follow the API's settings at runtime (zones.ts: guestCheckoutAllowed, payments).
 */
export const features = {
  /** Phase 2: orders carry a fulfilment mode and a kitchen. */
  pickup: true,
  /** Phase 2: orders carry a scheduled slot, checked and capacity-limited by the API. */
  scheduling: true,
  /** Phase 2: voucher codes are validated and priced by the API. */
  vouchers: true,
  /** Phase 2: menu items carry allergen data. */
  allergens: true,
  /** Phase 2: crust, sauce, cheese and toppings with half placement and amounts. */
  builderV2: true,
  /** Phase 2: the delivery fee and minimum come from the chosen area. */
  zonePricing: true,
  /** Phase 4: card payments through a gateway. */
  cardPayments: false,
} as const;
