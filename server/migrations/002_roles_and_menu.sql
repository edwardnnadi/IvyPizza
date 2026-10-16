-- Roles and the development menu. Sample prices are not customer-facing launch prices.

INSERT IGNORE INTO roles (name) VALUES
  ('customer'), ('kitchen'), ('manager'), ('rider'), ('hr'), ('owner');

INSERT IGNORE INTO menu_items (slug, name, category, description, price_minor, currency, available, display_order)
VALUES
  ('ivy-signature-chicken', 'Ivy Signature Chicken', 'Pizzas', 'Ivy signature sauce, grilled chicken, mozzarella, sweetcorn, onions and Ivy herbs.', 850000, 'NGN', TRUE, 10),
  ('ivy-signature-beef', 'Ivy Signature Beef', 'Pizzas', 'Seasoned minced beef, Ivy signature sauce, mozzarella, onions, peppers and Ivy seasoning.', 900000, 'NGN', TRUE, 20),
  ('ivy-suya-pizza', 'Ivy Suya Pizza', 'Pizzas', 'Spiced suya beef, onions, peppers, mozzarella and a suya pepper finish.', 950000, 'NGN', TRUE, 30),
  ('ivy-pepperoni-pizza', 'Ivy Pepperoni Pizza', 'Pizzas', 'Tomato sauce, generous pepperoni, mozzarella and Italian herbs.', 900000, 'NGN', TRUE, 40),
  ('ivy-margarita-pizza', 'Ivy Margarita Pizza', 'Pizzas', 'Tomato sauce, mozzarella, fresh tomatoes, basil and olive oil.', 750000, 'NGN', TRUE, 50),
  ('ivy-classic-burger', 'Ivy Classic Burger', 'Burgers', 'Flame-grilled 4 oz beef patty, mayo, lettuce, tomato, pickles, ketchup and onions on a brioche bun.', 500000, 'NGN', TRUE, 60),
  ('ivy-double-classic', 'Ivy Double Classic', 'Burgers', 'Two flame-grilled 4 oz beef patties with classic toppings on toasted brioche.', 700000, 'NGN', TRUE, 70),
  ('chicken-burger-wrap', 'Chicken Burger & Wrap', 'Burgers', 'Choose a brioche chicken burger or a chicken wrap with fresh salad and Ivy sauce.', 550000, 'NGN', TRUE, 80);

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order)
SELECT item.id, choice.name, choice.price_delta_minor, 'size', TRUE, choice.display_order
FROM menu_items AS item
CROSS JOIN (
  SELECT 'Regular · 10 inch' AS name, 0 AS price_delta_minor, 10 AS display_order
  UNION ALL SELECT 'Large · 13 inch', 300000, 20
  UNION ALL SELECT 'Family · 15 inch', 600000, 30
) AS choice
WHERE item.category = 'Pizzas';

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order)
SELECT item.id, choice.name, choice.price_delta_minor, 'extra', TRUE, choice.display_order
FROM menu_items AS item
CROSS JOIN (
  SELECT 'Extra mozzarella' AS name, 100000 AS price_delta_minor, 10 AS display_order
  UNION ALL SELECT 'Jalapeños', 50000, 20
  UNION ALL SELECT 'Extra pepperoni', 150000, 30
  UNION ALL SELECT 'Beef bacon', 150000, 40
  UNION ALL SELECT 'Guacamole', 150000, 50
  UNION ALL SELECT 'Extra chicken', 150000, 60
) AS choice
WHERE item.category = 'Pizzas';

INSERT IGNORE INTO menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order)
SELECT item.id, choice.name, choice.price_delta_minor, 'extra', TRUE, choice.display_order
FROM menu_items AS item
CROSS JOIN (
  SELECT 'American cheese' AS name, 80000 AS price_delta_minor, 10 AS display_order
  UNION ALL SELECT 'Beef bacon', 150000, 20
  UNION ALL SELECT 'Jalapeños', 50000, 30
  UNION ALL SELECT 'Guacamole', 150000, 40
  UNION ALL SELECT 'Extra patty', 200000, 50
  UNION ALL SELECT 'Extra chicken', 150000, 60
  UNION ALL SELECT 'Extra mozzarella', 100000, 70
) AS choice
WHERE item.category = 'Burgers';
