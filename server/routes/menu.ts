import { Router } from "express";
import { database, parseJson } from "../database.js";
import { MenuQuoteError, parseBasketInput } from "../menu-pricing.js";
import { parseCheckoutContext, priceCheckout } from "../checkout.js";

const menu = Router();

menu.get("/", async (_request, response, next) => {
  try {
    const [items, options] = await Promise.all([
      database.query<Record<string, unknown> & { id: string; allergens: unknown }>(
        `SELECT id, slug, name, category, description, price_minor AS priceMinor, currency, available,
                display_order AS displayOrder, allergens
         FROM menu_items
         ORDER BY display_order ASC, name ASC`,
      ),
      database.query<{ menuItemId: string; id: string; name: string; type: string; priceDeltaMinor: number | null; available: boolean }>(
        `SELECT menu_item_id AS menuItemId, id, name, option_type AS type, price_delta_minor AS priceDeltaMinor, available,
                code, is_default AS isDefault, requires_large AS requiresLarge, price_multiplier_bp AS multiplierBp
         FROM menu_options
         ORDER BY option_type, display_order, name`,
      ),
    ]);
    const optionsByItem = new Map<string, Array<Omit<typeof options.rows[number], "menuItemId">>>();
    for (const { menuItemId, ...option } of options.rows) {
      optionsByItem.set(menuItemId, [...(optionsByItem.get(menuItemId) ?? []), option]);
    }
    response.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    response.json({
      items: items.rows.map((item) => ({ ...item, allergens: parseJson<string[] | null>(item.allergens) ?? [], options: optionsByItem.get(item.id) ?? [] })),
    });
  } catch (error) {
    next(error);
  }
});

menu.post("/quote", async (request, response, next) => {
  try {
    const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};
    const lines = parseBasketInput(body);
    const context = parseCheckoutContext(body);
    const priced = await priceCheckout(database, lines, context, { forOrder: false, now: new Date() });
    response.set("Cache-Control", "no-store");
    response.json({
      currency: priced.currency,
      lines: priced.lines.map(({ options: _options, ...line }) => line),
      ...priced.totals,
      mode: context.mode,
      zoneId: priced.zone?.id ?? null,
      minimumMinor: priced.minimumMinor,
      shortMinor: priced.shortMinor,
      voucher: priced.voucher ? { code: priced.voucher.code, description: priced.voucher.description, freeDelivery: priced.voucher.freeDelivery } : null,
      voucherError: priced.voucherError,
    });
  } catch (error) {
    if (error instanceof MenuQuoteError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

export default menu;
