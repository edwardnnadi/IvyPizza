import { features } from "./features.js";

export interface Deal {
  id: string;
  kicker: string;
  title: string;
  price: string;
  body: string;
  cta: string;
  href: string;
  fineLead: string;
  fine: string;
  /** The feature the deal depends on; a deal only shows once that feature is live. */
  requires: keyof typeof features;
}

/** Deals from the ordering prototype. None can be honoured yet, so none show until their feature ships. */
const deals: Deal[] = [
  { id: "ivy10", kicker: "Online only", title: "10% off", price: "up to ₦3,000", body: "Take 10% off any order with code IVY10. Applied to your basket automatically.", cta: "Use deal", href: "/menu?voucher=IVY10", fineLead: "Code IVY10.", fine: "One use per order. Cannot be combined with FREEDEL.", requires: "vouchers" },
  { id: "freedel", kicker: "Delivery", title: "Free delivery", price: "all weekend", body: "Skip the delivery fee on any order that meets your area minimum.", cta: "Use deal", href: "/menu?voucher=FREEDEL", fineLead: "Code FREEDEL.", fine: "Delivery orders only. Area minimum order still applies.", requires: "vouchers" },
  { id: "half", kicker: "Half & half", title: "Two pizzas", price: "in one", body: "Can’t decide? Put different toppings on each half of a Large or Family pizza.", cta: "Build yours", href: "/menu?category=Pizzas", fineLead: "Large and Family.", fine: "Half toppings are charged at half price.", requires: "builderV2" },
];

export function liveDeals(): Deal[] {
  return deals.filter((deal) => features[deal.requires]);
}
