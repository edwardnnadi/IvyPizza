/**
 * Pizza and basket pricing rules shared by the API (which charges) and the storefront (which displays).
 * All amounts are in kobo. Keep this file free of server-only and browser-only imports.
 */

export type Side = "left" | "whole" | "right";
export type Amount = "light" | "normal" | "extra";
export type CheeseAmount = "none" | "light" | "normal" | "extra";

export const sides: readonly Side[] = ["left", "whole", "right"];
export const amounts: readonly Amount[] = ["light", "normal", "extra"];
export const cheeseAmounts: readonly CheeseAmount[] = ["none", "light", "normal", "extra"];

export const maxToppings = 8;
export const maxInstructionsLength = 140;
/** Extra cheese on a Regular pizza, scaled by the size multiplier like toppings. */
export const extraCheeseBaseMinor = 100_000;
/** Size multipliers are basis points: Regular 10000, Large 12500, Family 15000. */
export const baseMultiplierBp = 10_000;

export interface LineTopping {
  optionId: string;
  side: Side;
  amount: Amount;
}

/** One basket line as the storefront sends it and the API accepts it. */
export interface BasketLineInput {
  menuItemId: string;
  quantity: number;
  /** Size, crust, sauce and extras. Toppings may also appear here (whole, normal) for older baskets. */
  optionIds: string[];
  /** Every topping on the pizza, recipe ones included. Omit to keep the recipe as it is. */
  toppings?: LineTopping[];
  cheese?: CheeseAmount;
  sauceAmount?: Amount;
  instructions?: string;
}

/** Rounds to the nearest ₦50, the smallest step on the menu. */
export function roundToFiftyNaira(amountMinor: number): number {
  return Math.round(amountMinor / 5_000) * 5_000;
}

/**
 * A topping's cost on top of the pizza price.
 * Recipe toppings are included; asking for Extra adds one portion. Added toppings cost one portion,
 * or two for Extra. Half placement halves the cost. Larger sizes scale by their multiplier.
 */
export function toppingCostMinor(input: { unitMinor: number; multiplierBp: number; inRecipe: boolean; side: Side; amount: Amount }): number {
  const portions = input.inRecipe ? (input.amount === "extra" ? 1 : 0) : (input.amount === "extra" ? 2 : 1);
  if (!portions) return 0;
  const half = input.side === "whole" ? 1 : 0.5;
  return roundToFiftyNaira((input.unitMinor * input.multiplierBp / baseMultiplierBp) * half * portions);
}

export function extraCheeseMinor(multiplierBp: number): number {
  return roundToFiftyNaira(extraCheeseBaseMinor * multiplierBp / baseMultiplierBp);
}

export function sideLabel(side: Side): string {
  return side === "left" ? "left half" : side === "right" ? "right half" : "whole";
}

export function amountLabel(amount: Amount | CheeseAmount): string {
  return amount.charAt(0).toUpperCase() + amount.slice(1);
}
