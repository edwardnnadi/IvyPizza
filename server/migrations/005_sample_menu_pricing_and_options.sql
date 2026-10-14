ALTER TABLE public.menu_options
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS menu_options_item_type_name_idx
  ON public.menu_options(menu_item_id, option_type, name);

UPDATE public.menu_items
SET price_minor = CASE slug
      WHEN 'ivy-signature-chicken' THEN 850000
      WHEN 'ivy-signature-beef' THEN 900000
      WHEN 'ivy-suya-pizza' THEN 950000
      WHEN 'ivy-pepperoni-pizza' THEN 900000
      WHEN 'ivy-margarita-pizza' THEN 750000
      WHEN 'ivy-classic-burger' THEN 500000
      WHEN 'ivy-double-classic' THEN 700000
      WHEN 'chicken-burger-wrap' THEN 550000
      ELSE price_minor
    END,
    available = TRUE
WHERE slug IN (
  'ivy-signature-chicken', 'ivy-signature-beef', 'ivy-suya-pizza',
  'ivy-pepperoni-pizza', 'ivy-margarita-pizza', 'ivy-classic-burger',
  'ivy-double-classic', 'chicken-burger-wrap'
);

INSERT INTO public.menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order)
SELECT item.id, option.name, option.price_delta_minor, 'size', TRUE, option.display_order
FROM public.menu_items AS item
CROSS JOIN (VALUES
  ('Regular · 10 inch', 0, 10),
  ('Large · 13 inch', 300000, 20),
  ('Family · 15 inch', 600000, 30)
) AS option(name, price_delta_minor, display_order)
WHERE item.category = 'Pizzas'
ON CONFLICT (menu_item_id, option_type, name) DO NOTHING;

INSERT INTO public.menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order)
SELECT item.id, option.name, option.price_delta_minor, 'extra', TRUE, option.display_order
FROM public.menu_items AS item
CROSS JOIN (VALUES
  ('Extra mozzarella', 100000, 10),
  ('Jalapeños', 50000, 20),
  ('Extra pepperoni', 150000, 30),
  ('Beef bacon', 150000, 40),
  ('Guacamole', 150000, 50),
  ('Extra chicken', 150000, 60)
) AS option(name, price_delta_minor, display_order)
WHERE item.category = 'Pizzas'
ON CONFLICT (menu_item_id, option_type, name) DO NOTHING;

INSERT INTO public.menu_options (menu_item_id, name, price_delta_minor, option_type, available, display_order)
SELECT item.id, option.name, option.price_delta_minor, 'extra', TRUE, option.display_order
FROM public.menu_items AS item
CROSS JOIN (VALUES
  ('American cheese', 80000, 10),
  ('Beef bacon', 150000, 20),
  ('Jalapeños', 50000, 30),
  ('Guacamole', 150000, 40),
  ('Extra patty', 200000, 50),
  ('Extra chicken', 150000, 60),
  ('Extra mozzarella', 100000, 70)
) AS option(name, price_delta_minor, display_order)
WHERE item.category = 'Burgers'
ON CONFLICT (menu_item_id, option_type, name) DO NOTHING;
