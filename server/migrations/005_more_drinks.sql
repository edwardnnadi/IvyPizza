-- Expanded drinks menu.
INSERT IGNORE INTO menu_items (slug, name, category, description, price_minor, currency, available, display_order)
VALUES
  ('fanta-50cl', 'Fanta Orange 50cl', 'Drinks', 'Chilled orange soft drink.', 80000, 'NGN', TRUE, 235),
  ('pepsi-50cl', 'Pepsi 50cl', 'Drinks', 'Chilled cola soft drink.', 80000, 'NGN', TRUE, 236),
  ('schweppes-bitter-lemon', 'Schweppes Bitter Lemon', 'Drinks', 'Chilled bitter lemon soft drink.', 100000, 'NGN', TRUE, 237),
  ('virgin-mojito', 'Virgin Mojito', 'Drinks', 'Fresh lime, mint, ice and sparkling soda.', 180000, 'NGN', TRUE, 238),
  ('sprite-50cl', 'Sprite 50cl', 'Drinks', 'Chilled lemon-lime soft drink.', 80000, 'NGN', TRUE, 239);

UPDATE menu_items
SET allergens = JSON_ARRAY()
WHERE slug IN ('fanta-50cl', 'pepsi-50cl', 'schweppes-bitter-lemon', 'virgin-mojito', 'sprite-50cl');
