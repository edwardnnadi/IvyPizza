import type { Amount, CheeseAmount, Side } from "./pizza-rules.js";

/** The resolved choices on one basket line, named, so every screen describes them the same way. */
export interface LineChoices {
  size?: string;
  /** Shown only when it differs from the default crust. */
  crust?: { name: string; isDefault: boolean };
  sauce?: { name: string; isDefault: boolean };
  sauceAmount?: Amount;
  cheese?: CheeseAmount;
  /** Recipe toppings the customer took off. */
  removed?: string[];
  toppings?: Array<{ name: string; side: Side; amount: Amount; inRecipe: boolean }>;
  extras?: string[];
  /** Burger "No onions" style choices. */
  removals?: string[];
}

function sizeText(name: string): string {
  const [label, ...rest] = name.split("·").map((part) => part.trim());
  const detail = rest.join(" ").replace(/(\d+)\s*inch(es)?/i, '$1"');
  return detail ? `${label} ${detail}` : label ?? name;
}

const sideSuffix = (side: Side): string => side === "left" ? " (left half)" : side === "right" ? " (right half)" : "";

/** "Large 13" · Thin & crispy · No red onions · + Jalapeños (left half) · Extra cheese" */
export function describeLine(choices: LineChoices): string {
  const parts: string[] = [];
  if (choices.size) parts.push(sizeText(choices.size));
  if (choices.crust && !choices.crust.isDefault) parts.push(choices.crust.name);
  if (choices.sauce && !choices.sauce.isDefault) parts.push(`${choices.sauce.name} sauce`);
  if (choices.sauceAmount && choices.sauceAmount !== "normal") parts.push(`${choices.sauceAmount === "light" ? "Light" : "Extra"} sauce`);
  if (choices.cheese && choices.cheese !== "normal") parts.push(choices.cheese === "none" ? "No cheese" : `${choices.cheese === "light" ? "Light" : "Extra"} cheese`);
  for (const name of choices.removed ?? []) parts.push(`No ${name.toLowerCase()}`);
  for (const topping of choices.toppings ?? []) {
    if (topping.inRecipe && topping.side === "whole" && topping.amount === "normal") continue;
    const amount = topping.amount === "normal" ? "" : `${topping.amount === "light" ? "Light" : "Extra"} `;
    parts.push(`${topping.inRecipe ? "" : "+ "}${amount}${amount ? topping.name.toLowerCase() : topping.name}${sideSuffix(topping.side)}`);
  }
  parts.push(...(choices.extras ?? []), ...(choices.removals ?? []));
  return parts.join(" · ");
}
