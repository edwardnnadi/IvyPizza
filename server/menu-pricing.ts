import type { Queryable } from "./database.js";
import { describeLine } from "../shared/describe-line.js";
import {
  amounts, baseMultiplierBp, cheeseAmounts, extraCheeseMinor, maxInstructionsLength, maxToppings, sides, toppingCostMinor,
  type Amount, type BasketLineInput, type CheeseAmount, type LineTopping,
} from "../shared/pizza-rules.js";

export type BasketInputLine = BasketLineInput;

/** One priced choice, as stored in the order snapshot and shown to the kitchen. */
export interface QuotedOption {
  id: string;
  name: string;
  type: string;
  priceDeltaMinor: number;
  side?: LineTopping["side"];
  amount?: Amount;
  inRecipe?: boolean;
}

export interface QuotedMenuLine {
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  options: QuotedOption[];
  /** Recipe toppings the customer removed. */
  removed: string[];
  cheese?: CheeseAmount;
  sauceAmount?: Amount;
  instructions?: string;
  summary: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export class MenuQuoteError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "MenuQuoteError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxIntegerMinor = 2_147_483_647;

function cleanInstructions(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new MenuQuoteError(400, "Special instructions are invalid");
  // Strip control characters; the kitchen sees this text verbatim.
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > maxInstructionsLength) throw new MenuQuoteError(400, `Special instructions must be ${maxInstructionsLength} characters or fewer`);
  return text || undefined;
}

export function parseBasketInput(input: unknown): BasketInputLine[] {
  const body = typeof input === "object" && input !== null ? input as Record<string, unknown> : null;
  const inputLines = body && Array.isArray(body.items) ? body.items : null;
  if (!inputLines || inputLines.length < 1 || inputLines.length > 30) {
    throw new MenuQuoteError(400, "Add between 1 and 30 menu items to the basket");
  }

  return inputLines.map((line) => {
    if (typeof line !== "object" || line === null) throw new MenuQuoteError(400, "Basket item is invalid");
    const candidate = line as Record<string, unknown>;
    if (typeof candidate.menuItemId !== "string" || !uuidPattern.test(candidate.menuItemId)) {
      throw new MenuQuoteError(400, "Basket contains an invalid menu item");
    }
    if (!Number.isInteger(candidate.quantity) || Number(candidate.quantity) < 1 || Number(candidate.quantity) > 20) {
      throw new MenuQuoteError(400, "Each quantity must be between 1 and 20");
    }
    const optionIds = candidate.optionIds === undefined ? [] : candidate.optionIds;
    if (!Array.isArray(optionIds) || optionIds.length > 20 || optionIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
      throw new MenuQuoteError(400, "Basket options are invalid");
    }
    if (new Set(optionIds).size !== optionIds.length) throw new MenuQuoteError(400, "The same option cannot be selected twice");

    const parsed: BasketInputLine = { menuItemId: candidate.menuItemId, quantity: Number(candidate.quantity), optionIds: optionIds as string[] };
    if (candidate.toppings !== undefined) {
      if (!Array.isArray(candidate.toppings) || candidate.toppings.length > maxToppings) {
        throw new MenuQuoteError(400, `A pizza can have up to ${maxToppings} toppings`);
      }
      parsed.toppings = candidate.toppings.map((topping) => {
        const value = typeof topping === "object" && topping !== null ? topping as Record<string, unknown> : {};
        if (typeof value.optionId !== "string" || !uuidPattern.test(value.optionId)
          || !sides.includes(value.side as never) || !amounts.includes(value.amount as never)) {
          throw new MenuQuoteError(400, "Topping choices are invalid");
        }
        return { optionId: value.optionId, side: value.side as LineTopping["side"], amount: value.amount as Amount };
      });
      if (new Set(parsed.toppings.map((topping) => topping.optionId)).size !== parsed.toppings.length) {
        throw new MenuQuoteError(400, "The same topping cannot be added twice");
      }
    }
    if (candidate.cheese !== undefined) {
      if (!cheeseAmounts.includes(candidate.cheese as never)) throw new MenuQuoteError(400, "Cheese choice is invalid");
      parsed.cheese = candidate.cheese as CheeseAmount;
    }
    if (candidate.sauceAmount !== undefined) {
      if (!amounts.includes(candidate.sauceAmount as never)) throw new MenuQuoteError(400, "Sauce choice is invalid");
      parsed.sauceAmount = candidate.sauceAmount as Amount;
    }
    const instructions = cleanInstructions(candidate.instructions);
    if (instructions) parsed.instructions = instructions;
    return parsed;
  });
}

/** A stable form of a line for idempotency fingerprints: same choices, same text. */
export function canonicalLine(line: BasketInputLine): unknown {
  return {
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    optionIds: [...line.optionIds].sort(),
    toppings: line.toppings ? [...line.toppings].sort((a, b) => a.optionId.localeCompare(b.optionId)) : null,
    cheese: line.cheese ?? null,
    sauceAmount: line.sauceAmount ?? null,
    instructions: line.instructions ?? null,
  };
}

interface OptionRow {
  id: string;
  menu_item_id: string;
  name: string;
  option_type: string;
  price_delta_minor: number | null;
  available: boolean;
  is_default: boolean;
  requires_large: boolean;
  price_multiplier_bp: number | null;
}

export async function calculateMenuQuote(
  databaseClient: Queryable,
  lines: BasketInputLine[],
  lockForOrder = false,
): Promise<{ currency: string; subtotalMinor: number; lines: QuotedMenuLine[] }> {
  const menuItemIds = [...new Set(lines.map((line) => line.menuItemId))];
  const lockClause = lockForOrder ? " LOCK IN SHARE MODE" : "";
  const itemResult = await databaseClient.query<{ id: string; name: string; category: string; price_minor: number | null; currency: string; available: boolean }>(
    `SELECT id, name, category, price_minor, currency, available FROM menu_items WHERE id IN (?)${lockClause}`,
    [menuItemIds],
  );
  // Every option of the items in the basket: recipes (default sauce and toppings) matter even when not chosen.
  const optionResult = await databaseClient.query<OptionRow>(
    `SELECT id, menu_item_id, name, option_type, price_delta_minor, available, is_default, requires_large, price_multiplier_bp
     FROM menu_options WHERE menu_item_id IN (?) ORDER BY display_order, name${lockClause}`,
    [menuItemIds],
  );
  const itemsById = new Map(itemResult.rows.map((item) => [item.id, item]));
  const optionsByItem = new Map<string, OptionRow[]>();
  for (const option of optionResult.rows) optionsByItem.set(option.menu_item_id, [...(optionsByItem.get(option.menu_item_id) ?? []), option]);

  const quotedLines: QuotedMenuLine[] = [];
  let subtotalMinor = 0;
  let currency: string | null = null;

  for (const line of lines) {
    const item = itemsById.get(line.menuItemId);
    if (!item || !item.available || item.price_minor === null) {
      throw new MenuQuoteError(409, "A basket item is unavailable or no longer has a price. Refresh the menu and try again.");
    }
    if (currency !== null && item.currency !== currency) throw new MenuQuoteError(409, "The basket contains items in different currencies");
    currency = item.currency;

    const itemOptions = optionsByItem.get(item.id) ?? [];
    const byId = new Map(itemOptions.map((option) => [option.id, option]));
    const usable = (option: OptionRow | undefined): option is OptionRow => !!option && option.available && option.price_delta_minor !== null;
    const unavailable = (): never => { throw new MenuQuoteError(409, `An option for ${item.name} is unavailable. Refresh the menu and try again.`); };
    const ofType = (type: string): OptionRow[] => itemOptions.filter((option) => option.option_type === type);
    const isPizza = ofType("size").length > 0;

    const chosen = line.optionIds.map((id) => byId.get(id) ?? unavailable());
    if (!chosen.every(usable)) unavailable();
    const chosenOfType = (type: string): OptionRow[] => chosen.filter((option) => option.option_type === type);

    // Size: exactly one on pizzas, none elsewhere.
    const sizes = chosenOfType("size");
    if ((isPizza && sizes.length !== 1) || (!isPizza && sizes.length > 0)) throw new MenuQuoteError(400, `Choose one size for ${item.name}`);
    const size = sizes[0];
    const multiplierBp = size?.price_multiplier_bp ?? baseMultiplierBp;

    // Crust and sauce: at most one, otherwise the default (or the recipe's sauce).
    const pick = (type: string, label: string): OptionRow | undefined => {
      const picked = chosenOfType(type);
      if (picked.length > 1) throw new MenuQuoteError(400, `Choose one ${label} for ${item.name}`);
      return picked[0] ?? ofType(type).find((option) => option.is_default && usable(option));
    };
    const crust = pick("crust", "crust");
    if (crust?.requires_large && multiplierBp <= baseMultiplierBp) {
      throw new MenuQuoteError(400, `${crust.name} is only available on larger sizes`);
    }
    const sauce = pick("sauce", "sauce");

    // Toppings: the full list when given, otherwise the recipe plus any toppings in optionIds (older baskets).
    const recipe = ofType("topping").filter((option) => option.is_default);
    const toppingLines: LineTopping[] = line.toppings
      ?? [...new Map([...recipe.map((option) => option.id), ...chosenOfType("topping").map((option) => option.id)]
        .map((id) => [id, { optionId: id, side: "whole" as const, amount: "normal" as const }])).values()];
    if (!isPizza && (toppingLines.length || line.cheese || line.sauceAmount)) {
      throw new MenuQuoteError(400, `${item.name} does not take toppings`);
    }
    if (toppingLines.length > maxToppings) throw new MenuQuoteError(400, `A pizza can have up to ${maxToppings} toppings`);
    if (line.toppings && chosenOfType("topping").some((option) => !line.toppings!.some((topping) => topping.optionId === option.id))) {
      throw new MenuQuoteError(400, `Topping choices for ${item.name} do not match`);
    }

    const options: QuotedOption[] = [];
    let unitPriceMinor = item.price_minor;
    const add = (option: OptionRow, priceDeltaMinor: number, detail: Partial<QuotedOption> = {}): void => {
      options.push({ id: option.id, name: option.name, type: option.option_type, priceDeltaMinor, ...detail });
      unitPriceMinor += priceDeltaMinor;
    };
    if (size) add(size, size.price_delta_minor!);
    if (crust) add(crust, crust.price_delta_minor!);
    if (sauce) add(sauce, 0, line.sauceAmount && line.sauceAmount !== "normal" ? { amount: line.sauceAmount } : {});

    const toppings: NonNullable<Parameters<typeof describeLine>[0]["toppings"]> = [];
    for (const choice of toppingLines) {
      const option = byId.get(choice.optionId);
      if (!option || option.option_type !== "topping") throw new MenuQuoteError(400, `A topping for ${item.name} is not on the menu`);
      if (!usable(option)) unavailable();
      const inRecipe = option.is_default;
      const cost = toppingCostMinor({ unitMinor: option.price_delta_minor!, multiplierBp, inRecipe, side: choice.side, amount: choice.amount });
      add(option, cost, { side: choice.side, amount: choice.amount, inRecipe });
      toppings.push({ name: option.name, side: choice.side, amount: choice.amount, inRecipe });
    }
    const removed = recipe.filter((option) => !toppingLines.some((topping) => topping.optionId === option.id)).map((option) => option.name);

    const cheese = isPizza ? line.cheese ?? "normal" : undefined;
    if (cheese === "extra") unitPriceMinor += extraCheeseMinor(multiplierBp);

    const extras = chosenOfType("extra");
    const removals = chosenOfType("removal");
    for (const option of [...extras, ...removals]) add(option, option.price_delta_minor!);

    const lineTotalMinor = unitPriceMinor * line.quantity;
    subtotalMinor += lineTotalMinor;
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor > maxIntegerMinor) throw new MenuQuoteError(400, "Basket subtotal exceeds the supported amount");

    const summary = describeLine({
      size: size?.name,
      crust: crust ? { name: crust.name, isDefault: crust.is_default } : undefined,
      sauce: sauce ? { name: sauce.name, isDefault: sauce.is_default } : undefined,
      sauceAmount: line.sauceAmount,
      cheese,
      removed,
      toppings,
      extras: extras.map((option) => option.name),
      removals: removals.map((option) => option.name),
    });
    quotedLines.push({
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      quantity: line.quantity,
      options,
      removed,
      ...(cheese && cheese !== "normal" ? { cheese } : {}),
      ...(line.sauceAmount && line.sauceAmount !== "normal" ? { sauceAmount: line.sauceAmount } : {}),
      ...(line.instructions ? { instructions: line.instructions } : {}),
      summary,
      unitPriceMinor,
      lineTotalMinor,
    });
  }

  if (currency === null) throw new MenuQuoteError(400, "Basket is empty");
  return { currency, subtotalMinor, lines: quotedLines };
}
