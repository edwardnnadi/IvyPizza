-- Link application profiles to Supabase Auth. Privileged staff roles are never
-- taken from user-editable metadata; they are granted separately by an admin.
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE user_roles
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

INSERT INTO roles (name) VALUES
  ('customer'),
  ('kitchen'),
  ('manager'),
  ('rider'),
  ('owner')
ON CONFLICT (name) DO NOTHING;

DO $$ BEGIN
  ALTER TABLE roles ADD CONSTRAINT roles_name_check CHECK (name IN ('customer', 'kitchen', 'manager', 'rider', 'owner')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  profile_id UUID;
BEGIN
  INSERT INTO public.users (id, auth_user_id, email, phone, display_name)
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    NEW.phone,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''), NULLIF(NEW.email, ''), NULLIF(NEW.phone, ''), 'Customer')
  )
  ON CONFLICT (auth_user_id) DO UPDATE
    SET email = EXCLUDED.email, phone = EXCLUDED.phone
  RETURNING id INTO profile_id;

  INSERT INTO public.user_roles (user_id, role_id)
  SELECT profile_id, id FROM public.roles WHERE name = 'customer'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_profile_created ON auth.users;
CREATE TRIGGER on_auth_user_profile_created
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_profile();

-- Profiles created before this trigger are linked as well.
INSERT INTO public.users (id, auth_user_id, email, phone, display_name)
SELECT
  auth_user.id,
  auth_user.id,
  auth_user.email,
  auth_user.phone,
  COALESCE(NULLIF(auth_user.raw_user_meta_data ->> 'display_name', ''), NULLIF(auth_user.email, ''), NULLIF(auth_user.phone, ''), 'Customer')
FROM auth.users AS auth_user
ON CONFLICT (auth_user_id) DO UPDATE
  SET email = EXCLUDED.email, phone = EXCLUDED.phone;

INSERT INTO public.user_roles (user_id, role_id)
SELECT app_user.id, role.id
FROM public.users AS app_user
CROSS JOIN public.roles AS role
WHERE app_user.auth_user_id IS NOT NULL AND role.name = 'customer'
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS users_auth_user_id_idx ON users(auth_user_id);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_id_idx ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_fulfillment_status_created_idx ON orders(fulfillment_status, created_at);
CREATE INDEX IF NOT EXISTS rider_assignments_rider_active_idx ON rider_assignments(rider_id, order_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rider_assignments_one_active_per_order_idx ON rider_assignments(order_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS order_status_events_order_created_idx ON order_status_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS payment_records_order_created_idx ON payment_records(order_id, created_at);
CREATE INDEX IF NOT EXISTS refund_records_payment_created_idx ON refund_records(payment_id, created_at);

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_status_check CHECK (
    fulfillment_status IN ('awaiting_acceptance', 'accepted', 'preparing', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'rejected', 'cancelled', 'delivery_exception')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (
    payment_status IN ('pending', 'paid', 'failed', 'refund_pending', 'partially_refunded', 'refunded')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_total_matches_components_check CHECK (
    total_minor = subtotal_minor + delivery_fee_minor + tax_minor
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE payment_records ADD CONSTRAINT payment_records_status_check CHECK (
    status IN ('pending', 'paid', 'failed', 'refund_pending', 'partially_refunded', 'refunded')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE refund_records ADD CONSTRAINT refund_records_status_check CHECK (
    status IN ('pending', 'succeeded', 'failed')
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE roles VALIDATE CONSTRAINT roles_name_check;
ALTER TABLE orders VALIDATE CONSTRAINT orders_fulfillment_status_check;
ALTER TABLE orders VALIDATE CONSTRAINT orders_payment_status_check;
ALTER TABLE orders VALIDATE CONSTRAINT orders_total_matches_components_check;
ALTER TABLE payment_records VALIDATE CONSTRAINT payment_records_status_check;
ALTER TABLE refund_records VALIDATE CONSTRAINT refund_records_status_check;

CREATE OR REPLACE FUNCTION public.validate_review_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = NEW.order_id
      AND customer_id = NEW.customer_id
      AND fulfillment_status = 'delivered'
  ) THEN
    RAISE EXCEPTION 'Reviews require the customer''s delivered order';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_require_delivered_order ON reviews;
CREATE TRIGGER reviews_require_delivered_order
BEFORE INSERT OR UPDATE OF order_id, customer_id, rating, body ON reviews
FOR EACH ROW EXECUTE FUNCTION public.validate_review_order();

CREATE OR REPLACE FUNCTION public.prevent_order_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Order status events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS order_status_events_append_only ON order_status_events;
CREATE TRIGGER order_status_events_append_only
BEFORE UPDATE OR DELETE ON order_status_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_event_mutation();

-- The Express API is the only application data access path. It verifies Supabase
-- JWTs and applies per-role and per-order rules. No client role can query these
-- tables directly through Supabase's Data API.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'roles', 'user_roles', 'customer_addresses', 'menu_items', 'menu_options',
    'orders', 'order_items', 'payment_records', 'refund_records', 'rider_assignments',
    'order_status_events', 'reviews', 'schema_migrations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
  END LOOP;
END $$;
