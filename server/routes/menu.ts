import { Router } from "express";
import { database } from "../database.js";
import { calculateOrderTotals } from "../order-pricing.js";
import { calculateMenuQuote, MenuQuoteError, parseBasketInput } from "../menu-pricing.js";

const menu = Router();

menu.get("/", async (_request, response, next) => {
  try {
    const [items, options] = await Promise.all([
      database.query<Record<string, unknown> & { id: string }>(
        `SELECT id, slug, name, category, description, price_minor AS priceMinor, currency, available,
                display_order AS displayOrder
         FROM menu_items
         ORDER BY display_order ASC, name ASC`,
      ),
      database.query<{ menuItemId: string; id: string; name: string; type: string; priceDeltaMinor: number | null; available: boolean }>(
        `SELECT menu_item_id AS menuItemId, id, name, option_type AS type,
                price_delta_minor AS priceDeltaMinor, available
         FROM menu_options
         ORDER BY option_type, display_order, name`,
      ),
    ]);
    const optionsByItem = new Map<string, Array<Omit<typeof options.rows[number], "menuItemId">>>();
    for (const { menuItemId, ...option } of options.rows) {
      optionsByItem.set(menuItemId, [...(optionsByItem.get(menuItemId) ?? []), option]);
    }
    const result = { rows: items.rows.map((item) => ({ ...item, options: optionsByItem.get(item.id) ?? [] })) };
    response.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    response.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

menu.post("/quote", async (request, response, next) => {
  try {
    const lines = parseBasketInput(request.body);
    const quote = await calculateMenuQuote(database, lines);
    response.set("Cache-Control", "no-store");
    response.json({ ...quote, ...calculateOrderTotals(quote.subtotalMinor) });
  } catch (error) {
    if (error instanceof MenuQuoteError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

export default menu;
