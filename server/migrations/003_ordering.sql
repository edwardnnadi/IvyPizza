-- Ordering: kitchens, delivery zones, vouchers, the pizza builder's options, scheduled and pickup orders,
-- guest checkout and payment methods. Sample prices, zones and vouchers are development values.
-- Every statement is safe to re-run, because MariaDB commits DDL immediately.

CREATE TABLE IF NOT EXISTS stores (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  short_name VARCHAR(60) NOT NULL,
  address VARCHAR(300) NOT NULL,
  -- Opening hours in minutes after midnight, business time (BUSINESS_TIMEZONE).
  opens_minute SMALLINT NOT NULL,
  closes_minute SMALLINT NOT NULL,
  ready_minutes_min SMALLINT NOT NULL,
  ready_minutes_max SMALLINT NOT NULL,
  slot_capacity SMALLINT NOT NULL DEFAULT 8,
  accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
  paused_message VARCHAR(200) NULL,
  display_order INT NOT NULL DEFAULT 0,
  CONSTRAINT stores_hours_check CHECK (opens_minute >= 0 AND closes_minute <= 1440 AND opens_minute < closes_minute),
  CONSTRAINT stores_ready_check CHECK (ready_minutes_min > 0 AND ready_minutes_max >= ready_minutes_min),
  CONSTRAINT stores_capacity_check CHECK (slot_capacity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_zones (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  store_id VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  -- A zone that does not deliver yet is listed so customers get a clear "not yet" instead of no match.
  delivers BOOLEAN NOT NULL DEFAULT TRUE,
  fee_minor INT NULL,
  minimum_minor INT NULL,
  eta_min SMALLINT NULL,
  eta_max SMALLINT NULL,
  display_order INT NOT NULL DEFAULT 0,
  CONSTRAINT delivery_zones_store_fk FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT delivery_zones_values_check CHECK (
    delivers = FALSE OR (fee_minor >= 0 AND minimum_minor >= 0 AND eta_min > 0 AND eta_max >= eta_min)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vouchers (
  code VARCHAR(30) NOT NULL PRIMARY KEY,
  description VARCHAR(200) NOT NULL,
  discount_type VARCHAR(20) NOT NULL,
  percent_bp INT NULL,
  amount_minor INT NULL,
  cap_minor INT NULL,
  -- NULL works for both delivery and pickup.
  mode_restriction VARCHAR(10) NULL,
  starts_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT vouchers_code_check CHECK (code = UPPER(code)),
  CONSTRAINT vouchers_type_check CHECK (
    (discount_type = 'percent' AND percent_bp BETWEEN 1 AND 10000)
    OR (discount_type = 'fixed' AND amount_minor > 0)
    OR discount_type = 'free_delivery'
  ),
  CONSTRAINT vouchers_mode_check CHECK (mode_restriction IS NULL OR mode_restriction IN ('delivery', 'pickup'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Menu ----------

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allergens JSON NULL;

ALTER TABLE menu_options
  ADD COLUMN IF NOT EXISTS code VARCHAR(40) NULL,
  -- Default size and crust, the recipe's sauce, and recipe toppings.
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  -- Only on Large and Family (cheese-stuffed crust).
  ADD COLUMN IF NOT EXISTS requires_large BOOLEAN NOT NULL DEFAULT FALSE,
  -- Size rows: how toppings and extra cheese scale, in basis points (Regular = 10000).
  ADD COLUMN IF NOT EXISTS price_multiplier_bp INT NULL;

ALTER TABLE menu_options DROP CONSTRAINT IF EXISTS menu_options_type_check;
ALTER TABLE menu_options ADD CONSTRAINT menu_options_type_check
  CHECK (option_type IN ('size', 'crust', 'sauce', 'topping', 'extra', 'removal'));

-- Sizes scale toppings; Regular is the default.
UPDATE menu_options SET code = 'regular', is_default = TRUE, price_multiplier_bp = 10000 WHERE option_type = 'size' AND name LIKE 'Regular%';
UPDATE menu_options SET code = 'large', price_multiplier_bp = 12500 WHERE option_type = 'size' AND name LIKE 'Large%';
UPDATE menu_options SET code = 'family', price_multiplier_bp = 15000 WHERE option_type = 'size' AND name LIKE 'Family%';

-- Pizza extras become toppings. Extra cheese is now the cheese amount, and guacamole leaves the pizza range.
UPDATE menu_options o JOIN menu_items i ON i.id = o.menu_item_id
SET o.option_type = 'topping', o.code = 'jalapenos'
WHERE i.category = 'Pizzas' AND o.option_type = 'extra' AND o.name = 'Jalapeños';
UPDATE menu_options o JOIN menu_items i ON i.id = o.menu_item_id
SET o.option_type = 'topping', o.code = 'bacon'
WHERE i.category = 'Pizzas' AND o.option_type = 'extra' AND o.name = 'Beef bacon';
UPDATE menu_options o JOIN menu_items i ON i.id = o.menu_item_id
SET o.option_type = 'topping', o.code = 'pepperoni', o.name = 'Beef pepperoni'
WHERE i.category = 'Pizzas' AND o.option_type = 'extra' AND o.name = 'Extra pepperoni';
UPDATE menu_options o JOIN menu_items i ON i.id = o.menu_item_id
SET o.option_type = 'topping', o.code = 'chicken', o.name = 'Grilled chicken'
WHERE i.category = 'Pizzas' AND o.option_type = 'extra' AND o.name = 'Extra chicken';
UPDATE menu_options o JOIN menu_items i ON i.id = o.menu_item_id
SET o.available = FALSE
WHERE i.category = 'Pizzas' AND o.option_type = 'extra' AND o.name IN ('Extra mozzarella', 'Guacamole');

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order, code, is_default, requires_large)
SELECT item.id, choice.name, choice.price, 'crust', TRUE, choice.display_order, choice.code, choice.is_default, choice.requires_large
FROM menu_items AS item
CROSS JOIN (
  SELECT 'Classic hand-tossed' AS name, 0 AS price, 10 AS display_order, 'classic' AS code, TRUE AS is_default, FALSE AS requires_large
  UNION ALL SELECT 'Thin & crispy', 0, 20, 'thin', FALSE, FALSE
  UNION ALL SELECT 'Cheese-stuffed crust', 150000, 30, 'stuffed', FALSE, TRUE
) AS choice
WHERE item.category = 'Pizzas';

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order, code)
SELECT item.id, choice.name, 0, 'sauce', TRUE, choice.display_order, choice.code
FROM menu_items AS item
CROSS JOIN (
  SELECT 'Tomato' AS name, 10 AS display_order, 'tomato' AS code
  UNION ALL SELECT 'Ivy signature', 20, 'ivy'
  UNION ALL SELECT 'Suya pepper', 30, 'suya'
  UNION ALL SELECT 'Smoky BBQ', 40, 'bbq'
) AS choice
WHERE item.category = 'Pizzas';

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order, code)
SELECT item.id, choice.name, choice.price, 'topping', TRUE, choice.display_order, choice.code
FROM menu_items AS item
CROSS JOIN (
  SELECT 'Grilled chicken' AS name, 150000 AS price, 10 AS display_order, 'chicken' AS code
  UNION ALL SELECT 'Suya beef', 150000, 20, 'suya'
  UNION ALL SELECT 'Beef pepperoni', 150000, 30, 'pepperoni'
  UNION ALL SELECT 'Minced beef', 150000, 40, 'mince'
  UNION ALL SELECT 'Beef bacon', 150000, 50, 'bacon'
  UNION ALL SELECT 'Mushrooms', 70000, 60, 'mushrooms'
  UNION ALL SELECT 'Red onions', 50000, 70, 'onions'
  UNION ALL SELECT 'Green peppers', 50000, 80, 'peppers'
  UNION ALL SELECT 'Sweetcorn', 50000, 90, 'sweetcorn'
  UNION ALL SELECT 'Jalapeños', 50000, 100, 'jalapenos'
  UNION ALL SELECT 'Fresh tomatoes', 50000, 110, 'tomatoes'
  UNION ALL SELECT 'Black olives', 70000, 120, 'olives'
) AS choice
WHERE item.category = 'Pizzas';

-- Converted toppings take their place in the catalogue order.
UPDATE menu_options SET display_order = 10 WHERE option_type = 'topping' AND code = 'chicken';
UPDATE menu_options SET display_order = 30 WHERE option_type = 'topping' AND code = 'pepperoni';
UPDATE menu_options SET display_order = 50 WHERE option_type = 'topping' AND code = 'bacon';
UPDATE menu_options SET display_order = 100 WHERE option_type = 'topping' AND code = 'jalapenos';

-- Each pizza's recipe: its sauce and toppings.
UPDATE menu_options o JOIN menu_items i ON i.id = o.menu_item_id
SET o.is_default = (
  (i.slug = 'ivy-signature-chicken' AND ((o.option_type = 'sauce' AND o.code = 'ivy') OR (o.option_type = 'topping' AND o.code IN ('chicken', 'sweetcorn', 'onions'))))
  OR (i.slug = 'ivy-signature-beef' AND ((o.option_type = 'sauce' AND o.code = 'ivy') OR (o.option_type = 'topping' AND o.code IN ('mince', 'onions', 'peppers'))))
  OR (i.slug = 'ivy-suya-pizza' AND ((o.option_type = 'sauce' AND o.code = 'suya') OR (o.option_type = 'topping' AND o.code IN ('suya', 'onions', 'peppers'))))
  OR (i.slug = 'ivy-pepperoni-pizza' AND ((o.option_type = 'sauce' AND o.code = 'tomato') OR (o.option_type = 'topping' AND o.code = 'pepperoni')))
  OR (i.slug = 'ivy-margarita-pizza' AND ((o.option_type = 'sauce' AND o.code = 'tomato') OR (o.option_type = 'topping' AND o.code = 'tomatoes')))
)
WHERE i.category = 'Pizzas' AND o.option_type IN ('sauce', 'topping');

-- Burgers: make it a meal, and leave out what you don't want.
INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order, code)
SELECT item.id, 'Make it a meal: seasoned fries and a Chapman', 250000, 'extra', TRUE, 5, 'meal'
FROM menu_items AS item WHERE item.category = 'Burgers';

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order, code)
SELECT item.id, choice.name, 0, 'removal', TRUE, choice.display_order, choice.code
FROM menu_items AS item
CROSS JOIN (
  SELECT 'No onions' AS name, 10 AS display_order, 'no-onions' AS code
  UNION ALL SELECT 'No pickles', 20, 'no-pickles'
  UNION ALL SELECT 'No lettuce', 30, 'no-lettuce'
  UNION ALL SELECT 'No tomato', 40, 'no-tomato'
) AS choice
WHERE item.category = 'Burgers';

-- Sides and drinks.
INSERT IGNORE INTO menu_items (slug, name, category, description, price_minor, currency, available, display_order)
VALUES
  ('plantain-bites', 'Plantain bites', 'Sides', 'Sweet fried plantain with a pinch of yaji.', 200000, 'NGN', TRUE, 110),
  ('seasoned-fries', 'Seasoned fries', 'Sides', 'Skin-on fries with Ivy seasoning.', 150000, 'NGN', TRUE, 120),
  ('chicken-wings', 'Chicken wings (6)', 'Sides', 'Grilled wings in a pepper glaze.', 450000, 'NGN', TRUE, 130),
  ('garlic-bread', 'Garlic bread', 'Sides', 'Toasted dough, garlic butter and parsley.', 200000, 'NGN', TRUE, 140),
  ('chapman', 'Chapman', 'Drinks', 'House Chapman with cucumber and orange.', 180000, 'NGN', TRUE, 210),
  ('zobo', 'Zobo', 'Drinks', 'Chilled hibiscus with ginger and pineapple.', 120000, 'NGN', TRUE, 220),
  ('coca-cola-50cl', 'Coca-Cola 50cl', 'Drinks', 'Ice cold.', 80000, 'NGN', TRUE, 230),
  ('still-water-75cl', 'Still water 75cl', 'Drinks', 'Still mineral water.', 50000, 'NGN', TRUE, 240);

-- Allergens (development values; confirm with the kitchen before launch).
UPDATE menu_items SET allergens = JSON_ARRAY('Gluten', 'Milk') WHERE category = 'Pizzas' AND allergens IS NULL;
UPDATE menu_items SET allergens = JSON_ARRAY('Gluten', 'Milk', 'Peanut') WHERE slug = 'ivy-suya-pizza';
UPDATE menu_items SET allergens = JSON_ARRAY('Gluten', 'Milk', 'Egg', 'Sesame') WHERE category = 'Burgers' AND allergens IS NULL;
UPDATE menu_items SET allergens = JSON_ARRAY('Gluten', 'Milk', 'Egg', 'Sesame', 'Mustard') WHERE slug = 'chicken-burger-wrap';
UPDATE menu_items SET allergens = JSON_ARRAY('Peanut') WHERE slug = 'plantain-bites';
UPDATE menu_items SET allergens = JSON_ARRAY() WHERE slug IN ('seasoned-fries', 'chapman', 'zobo', 'coca-cola-50cl', 'still-water-75cl');
UPDATE menu_items SET allergens = JSON_ARRAY('Mustard') WHERE slug = 'chicken-wings';
UPDATE menu_items SET allergens = JSON_ARRAY('Gluten', 'Milk') WHERE slug = 'garlic-bread';

-- ---------- Kitchens, zones and vouchers ----------

INSERT IGNORE INTO stores (id, name, short_name, address, opens_minute, closes_minute, ready_minutes_min, ready_minutes_max, slot_capacity, display_order)
VALUES ('wuse', 'Ivy Pizza Wuse 2', 'Wuse 2 kitchen', 'Aminu Kano Crescent, Wuse 2, Abuja', 660, 1380, 15, 20, 8, 10);

INSERT IGNORE INTO delivery_zones (id, store_id, name, delivers, fee_minor, minimum_minor, eta_min, eta_max, display_order)
VALUES
  ('wuse2', 'wuse', 'Wuse 2', TRUE, 100000, 800000, 25, 35, 10),
  ('maitama', 'wuse', 'Maitama', TRUE, 150000, 1000000, 30, 40, 20),
  ('garki', 'wuse', 'Garki', TRUE, 120000, 800000, 30, 40, 30),
  ('asokoro', 'wuse', 'Asokoro', TRUE, 200000, 1200000, 35, 45, 40),
  ('jabi', 'wuse', 'Jabi', TRUE, 150000, 900000, 30, 45, 50),
  ('utako', 'wuse', 'Utako', TRUE, 150000, 900000, 30, 40, 60),
  ('gwarinpa', 'wuse', 'Gwarinpa', TRUE, 250000, 1200000, 40, 55, 70),
  ('lugbe', 'wuse', 'Lugbe', FALSE, NULL, NULL, NULL, NULL, 80);

INSERT IGNORE INTO vouchers (code, description, discount_type, percent_bp, amount_minor, cap_minor, mode_restriction, expires_at)
VALUES
  ('IVY10', '10% off, up to ₦3,000', 'percent', 1000, NULL, 300000, NULL, NULL),
  ('FREEDEL', 'Free delivery', 'free_delivery', NULL, NULL, NULL, 'delivery', NULL),
  ('SUMMER25', '25% off summer treat', 'percent', 2500, NULL, 500000, NULL, '2026-09-30 22:59:59');

-- ---------- Orders ----------

ALTER TABLE orders
  MODIFY customer_id UUID NULL,
  ADD COLUMN IF NOT EXISTS fulfilment_mode VARCHAR(10) NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS store_id VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS zone_id VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS scheduled_for DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS discount_minor INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voucher_code VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'on_delivery',
  -- Unpaid bank transfers are cancelled after this time unless the customer reported paying.
  ADD COLUMN IF NOT EXISTS payment_due_at DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS transfer_reported_at DATETIME(3) NULL,
  -- Guest orders: contact details and a hash of the token that lets the guest follow the order.
  ADD COLUMN IF NOT EXISTS guest_contact JSON NULL,
  ADD COLUMN IF NOT EXISTS guest_token_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS guest_idempotency_key UUID AS (IF(customer_id IS NULL, idempotency_key, NULL)) PERSISTENT;

ALTER TABLE orders ADD UNIQUE INDEX IF NOT EXISTS orders_guest_idempotency_key_idx (guest_idempotency_key);
ALTER TABLE orders ADD INDEX IF NOT EXISTS orders_store_scheduled_idx (store_id, scheduled_for);
ALTER TABLE orders ADD INDEX IF NOT EXISTS orders_payment_due_idx (payment_method, payment_status, payment_due_at);

ALTER TABLE orders DROP FOREIGN KEY IF EXISTS orders_store_fk;
ALTER TABLE orders ADD CONSTRAINT orders_store_fk FOREIGN KEY (store_id) REFERENCES stores(id);
ALTER TABLE orders DROP FOREIGN KEY IF EXISTS orders_zone_fk;
ALTER TABLE orders ADD CONSTRAINT orders_zone_fk FOREIGN KEY (zone_id) REFERENCES delivery_zones(id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_amounts_check;
ALTER TABLE orders ADD CONSTRAINT orders_amounts_check
  CHECK (subtotal_minor >= 0 AND discount_minor >= 0 AND discount_minor <= subtotal_minor AND delivery_fee_minor >= 0 AND tax_minor >= 0 AND total_minor >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_matches_components_check;
ALTER TABLE orders ADD CONSTRAINT orders_total_matches_components_check
  CHECK (total_minor = subtotal_minor - discount_minor + delivery_fee_minor + tax_minor);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_mode_check;
ALTER TABLE orders ADD CONSTRAINT orders_mode_check CHECK (fulfilment_mode IN ('delivery', 'pickup'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('on_delivery', 'transfer', 'card'));
-- Every order has an owner: a customer account or guest contact details.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_owner_check;
ALTER TABLE orders ADD CONSTRAINT orders_owner_check
  CHECK (customer_id IS NOT NULL OR (guest_contact IS NOT NULL AND guest_token_hash IS NOT NULL));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_zone_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_zone_check
  CHECK (fulfilment_mode = 'pickup' OR zone_id IS NOT NULL OR store_id IS NULL);
