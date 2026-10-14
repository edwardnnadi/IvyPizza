ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

UPDATE public.menu_items
SET slug = 'legacy-' || id::TEXT
WHERE slug IS NULL;

ALTER TABLE public.menu_items
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS menu_items_slug_idx ON public.menu_items(slug);

INSERT INTO public.menu_items (slug, name, category, description, price_minor, currency, available, display_order)
VALUES
  ('ivy-signature-chicken', 'Ivy Signature Chicken', 'Pizzas', 'Ivy signature sauce, grilled chicken, mozzarella, sweetcorn, onions and Ivy herbs.', NULL, 'NGN', FALSE, 10),
  ('ivy-signature-beef', 'Ivy Signature Beef', 'Pizzas', 'Seasoned minced beef, Ivy signature sauce, mozzarella, onions, peppers and Ivy seasoning.', NULL, 'NGN', FALSE, 20),
  ('ivy-suya-pizza', 'Ivy Suya Pizza', 'Pizzas', 'Spiced suya beef, onions, peppers, mozzarella and a suya pepper finish.', NULL, 'NGN', FALSE, 30),
  ('ivy-pepperoni-pizza', 'Ivy Pepperoni Pizza', 'Pizzas', 'Tomato sauce, generous pepperoni, mozzarella and Italian herbs.', NULL, 'NGN', FALSE, 40),
  ('ivy-margarita-pizza', 'Ivy Margarita Pizza', 'Pizzas', 'Tomato sauce, mozzarella, fresh tomatoes, basil and olive oil.', NULL, 'NGN', FALSE, 50),
  ('ivy-classic-burger', 'Ivy Classic Burger', 'Burgers', 'Flame-grilled 4 oz beef patty, mayo, lettuce, tomato, pickles, ketchup and onions on a brioche bun.', NULL, 'NGN', FALSE, 60),
  ('ivy-double-classic', 'Ivy Double Classic', 'Burgers', 'Two flame-grilled 4 oz beef patties with classic toppings on toasted brioche.', NULL, 'NGN', FALSE, 70),
  ('chicken-burger-wrap', 'Chicken Burger & Wrap', 'Burgers', 'Choose a brioche chicken burger or a chicken wrap with fresh salad and Ivy sauce.', NULL, 'NGN', FALSE, 80)
ON CONFLICT (slug) DO NOTHING;
