-- Schweppes variants and branded Coca-Cola asset/menu confirmation.
INSERT IGNORE INTO menu_items (slug, name, category, description, price_minor, currency, available, display_order)
VALUES
  ('schweppes-pineapple', 'Schweppes Pineapple', 'Drinks', 'Chilled pineapple soft drink.', 100000, 'NGN', TRUE, 241),
  ('schweppes-virgin-mojito', 'Schweppes Virgin Mojito', 'Drinks', 'Chilled mint and lime soft drink.', 100000, 'NGN', TRUE, 242),
  ('schweppes-chapman', 'Schweppes Chapman', 'Drinks', 'Chilled Chapman soft drink.', 100000, 'NGN', TRUE, 243);

UPDATE menu_items
SET allergens = JSON_ARRAY()
WHERE slug IN ('schweppes-pineapple', 'schweppes-virgin-mojito', 'schweppes-chapman', 'coca-cola-50cl');
