import type { PoolClient } from "pg";

export interface BasketInputLine {
  menuItemId: string;
  quantity: number;
  optionIds: string[];
}

export interface QuotedMenuLine {
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  options: Array<{ id: string; name: string; type: string; priceDeltaMinor: number }>;
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

export function parseBasketInput(input: unknown): BasketInputLine[] {
  const body = typeof input === "object" && input !== null ? input as Record<string, unknown> : null;
  const inputLines = body && Array.isArray(body.items) ? body.items : null;
  if (!inputLines || inputLines.length < 1 || inputLines.length > 30) {
    throw new MenuQuoteError(400, "Add between 1 and 30 menu items to the basket");
  }

  return inputLines.map((line) => {
    if (typeof line !== "object" || line === null) {
      throw new MenuQuoteError(400, "Basket item is invalid");
    }
    const candidate = line as Record<string, unknown>;
    if (typeof candidate.menuItemId !== "string" || !uuidPattern.test(candidate.menuItemId)) {
      throw new MenuQuoteError(400, "Basket contains an invalid menu item");
    }
    if (!Number.isInteger(candidate.quantity) || Number(candidate.quantity) < 1 || Number(candidate.quantity) > 20) {
      throw new MenuQuoteError(400, "Each quantity must be between 1 and 20");
    }
    const optionIds = candidate.optionIds === undefined ? [] : candidate.optionIds;
    if (!Array.isArray(optionIds) || optionIds.length > 12 || optionIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
      throw new MenuQuoteError(400, "Basket options are invalid");
    }
    if (new Set(optionIds).size !== optionIds.length) {
      throw new MenuQuoteError(400, "The same option cannot be selected twice");
    }
    return { menuItemId: candidate.menuItemId, quantity: Number(candidate.quantity), optionIds: optionIds as string[] };
  });
}

export async function calculateMenuQuote(
  databaseClient: Pick<PoolClient, "query">,
  lines: BasketInputLine[],
  lockForOrder = false,
): Promise<{ currency: string; subtotalMinor: number; lines: QuotedMenuLine[] }> {
  const menuItemIds = [...new Set(lines.map((line) => line.menuItemId))];
  const optionIds = [...new Set(lines.flatMap((line) => line.optionIds))];
  const lockClause = lockForOrder ? " FOR SHARE" : "";
  const itemResult = await databaseClient.query<{
    id: string;
    name: string;
    category: string;
    price_minor: number | null;
    currency: string;
    available: boolean;
  }>(
    `SELECT id, name, category, price_minor, currency, available
     FROM public.menu_items WHERE id = ANY($1::UUID[])${lockClause}`,
    [menuItemIds],
  );
  const optionResult = optionIds.length
    ? await databaseClient.query<{
      id: string;
      menu_item_id: string;
      name: string;
      option_type: string;
      price_delta_minor: number | null;
      available: boolean;
    }>(
      `SELECT id, menu_item_id, name, option_type, price_delta_minor, available
       FROM public.menu_options WHERE id = ANY($1::UUID[])${lockClause}`,
      [optionIds],
    )
    : { rows: [] };
  const itemsById = new Map(itemResult.rows.map((item) => [item.id, item]));
  const optionsById = new Map(optionResult.rows.map((option) => [option.id, option]));
  const quotedLines: QuotedMenuLine[] = [];
  let subtotalMinor = 0;
  let currency: string | null = null;

  for (const line of lines) {
    const item = itemsById.get(line.menuItemId);
    if (!item || !item.available || item.price_minor === null) {
      throw new MenuQuoteError(409, "A basket item is unavailable or no longer has a price. Refresh the menu and try again.");
    }
    if (currency !== null && item.currency !== currency) {
      throw new MenuQuoteError(409, "The basket contains items in different currencies");
    }
    currency = item.currency;

    const selectedOptions: QuotedMenuLine["options"] = [];
    let optionTotalMinor = 0;
    for (const optionId of line.optionIds) {
      const option = optionsById.get(optionId);
      if (!option || option.menu_item_id !== item.id || !option.available || option.price_delta_minor === null) {
        throw new MenuQuoteError(409, `An option for ${item.name} is unavailable. Refresh the menu and try again.`);
      }
      selectedOptions.push({ id: option.id, name: option.name, type: option.option_type, priceDeltaMinor: option.price_delta_minor });
      optionTotalMinor += option.price_delta_minor;
    }

    const sizeCount = selectedOptions.filter((option) => option.type === "size").length;
    if ((item.category === "Pizzas" && sizeCount !== 1) || (item.category !== "Pizzas" && sizeCount > 0)) {
      throw new MenuQuoteError(400, `Choose one size for ${item.name}`);
    }
    if (selectedOptions.filter((option) => option.type === "extra").length !== selectedOptions.length - sizeCount) {
      throw new MenuQuoteError(400, `An option for ${item.name} is not supported`);
    }

    const unitPriceMinor = item.price_minor + optionTotalMinor;
    const lineTotalMinor = unitPriceMinor * line.quantity;
    subtotalMinor += lineTotalMinor;
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor > maxIntegerMinor) {
      throw new MenuQuoteError(400, "Basket subtotal exceeds the supported amount");
    }
    quotedLines.push({
      menuItemId: item.id,
      name: item.name,
      category: item.category,
      quantity: line.quantity,
      options: selectedOptions,
      unitPriceMinor,
      lineTotalMinor,
    });
  }

  if (currency === null) throw new MenuQuoteError(400, "Basket is empty");
  return { currency, subtotalMinor, lines: quotedLines };
}
