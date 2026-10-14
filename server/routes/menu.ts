import { Router } from "express";
import { database } from "../database.js";
import { calculateOrderTotals } from "../order-pricing.js";
import { calculateMenuQuote, MenuQuoteError, parseBasketInput } from "../menu-pricing.js";

const menu = Router();

menu.get("/", async (_request, response, next) => {
  try {
    const result = await database.query(
      `SELECT item.id, item.slug, item.name, item.category, item.description,
              item.price_minor AS "priceMinor", item.currency, item.available,
              item.display_order AS "displayOrder",
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', menu_option.id,
                    'name', menu_option.name,
                    'type', menu_option.option_type,
                    'priceDeltaMinor', menu_option.price_delta_minor,
                    'available', menu_option.available
                  ) ORDER BY menu_option.option_type, menu_option.display_order, menu_option.name
                ) FILTER (WHERE menu_option.id IS NOT NULL),
                '[]'::jsonb
              ) AS options
       FROM public.menu_items AS item
       LEFT JOIN public.menu_options AS menu_option ON menu_option.menu_item_id = item.id
       GROUP BY item.id
       ORDER BY item.display_order ASC, item.name ASC`,
    );
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
