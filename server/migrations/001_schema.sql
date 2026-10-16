-- Ivy Pizza application schema for MariaDB 11.4 (WhoGoHost).
-- Timestamps are stored in UTC; the API sets the session time zone to +00:00.
-- Better Auth creates and owns its own user, session, account and verification tables.

CREATE TABLE IF NOT EXISTS users (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  better_auth_user_id VARCHAR(64) NULL UNIQUE,
  email VARCHAR(254) NULL UNIQUE,
  phone VARCHAR(40) NULL,
  display_name VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  name VARCHAR(20) NOT NULL UNIQUE,
  CONSTRAINT roles_name_check CHECK (name IN ('customer', 'kitchen', 'manager', 'rider', 'hr', 'owner'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  assigned_by UUID NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT user_roles_assigned_by_fk FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_employment (
  user_id UUID NOT NULL PRIMARY KEY,
  employment_status VARCHAR(20) NOT NULL DEFAULT 'employed',
  employee_number VARCHAR(60) NULL UNIQUE,
  employed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT staff_employment_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT staff_employment_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT staff_employment_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT staff_employment_status_check CHECK (employment_status IN ('employed', 'inactive')),
  CONSTRAINT staff_employment_end_check CHECK (
    (employment_status = 'employed' AND ended_at IS NULL)
    OR (employment_status = 'inactive' AND ended_at IS NOT NULL)
  ),
  INDEX staff_employment_status_updated_idx (employment_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  customer_id UUID NOT NULL,
  label VARCHAR(60) NOT NULL,
  recipient_name VARCHAR(100) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  address VARCHAR(500) NOT NULL,
  landmark VARCHAR(200) NULL,
  instructions VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id),
  INDEX customer_addresses_customer_id_idx (customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(60) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_minor INT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NGN',
  available BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  CONSTRAINT menu_items_price_check CHECK (price_minor IS NULL OR price_minor >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_options (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  menu_item_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  price_delta_minor INT NULL,
  option_type VARCHAR(20) NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  CONSTRAINT menu_options_item_fk FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
  CONSTRAINT menu_options_price_check CHECK (price_delta_minor IS NULL OR price_delta_minor >= 0),
  UNIQUE INDEX menu_options_item_type_name_idx (menu_item_id, option_type, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1 INCREMENT BY 1 NOCACHE;

CREATE TABLE IF NOT EXISTS orders (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  order_number VARCHAR(20) NOT NULL UNIQUE,
  customer_id UUID NOT NULL,
  fulfillment_status VARCHAR(30) NOT NULL,
  payment_status VARCHAR(30) NOT NULL,
  currency CHAR(3) NOT NULL,
  subtotal_minor INT NOT NULL,
  delivery_fee_minor INT NOT NULL,
  tax_minor INT NOT NULL,
  total_minor INT NOT NULL,
  delivery_snapshot JSON NOT NULL,
  -- NULL keys are distinct in a MariaDB unique index, so only keyed checkouts are deduplicated.
  idempotency_key UUID NULL,
  idempotency_fingerprint CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT orders_amounts_check CHECK (subtotal_minor >= 0 AND delivery_fee_minor >= 0 AND tax_minor >= 0 AND total_minor >= 0),
  CONSTRAINT orders_total_matches_components_check CHECK (total_minor = subtotal_minor + delivery_fee_minor + tax_minor),
  CONSTRAINT orders_fulfillment_status_check CHECK (fulfillment_status IN (
    'awaiting_acceptance', 'accepted', 'preparing', 'ready_for_delivery', 'out_for_delivery',
    'delivered', 'rejected', 'cancelled', 'delivery_exception'
  )),
  CONSTRAINT orders_payment_status_check CHECK (payment_status IN (
    'pending', 'paid', 'failed', 'refund_pending', 'partially_refunded', 'refunded'
  )),
  UNIQUE INDEX orders_customer_idempotency_key_idx (customer_id, idempotency_key),
  INDEX orders_customer_created_idx (customer_id, created_at),
  INDEX orders_fulfillment_status_created_idx (fulfillment_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  order_id UUID NOT NULL,
  item_snapshot JSON NOT NULL,
  quantity INT NOT NULL,
  unit_price_minor INT NOT NULL,
  line_total_minor INT NOT NULL,
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_items_amounts_check CHECK (quantity > 0 AND unit_price_minor >= 0 AND line_total_minor >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_records (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  order_id UUID NOT NULL,
  provider VARCHAR(40) NULL,
  provider_reference VARCHAR(200) NULL UNIQUE,
  amount_minor INT NOT NULL,
  currency CHAR(3) NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT payment_records_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT payment_records_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT payment_records_status_check CHECK (status IN (
    'pending', 'paid', 'failed', 'refund_pending', 'partially_refunded', 'refunded'
  )),
  INDEX payment_records_order_created_idx (order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refund_records (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  payment_id UUID NOT NULL,
  amount_minor INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT refund_records_payment_fk FOREIGN KEY (payment_id) REFERENCES payment_records(id),
  CONSTRAINT refund_records_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT refund_records_status_check CHECK (status IN ('pending', 'succeeded', 'failed')),
  INDEX refund_records_payment_created_idx (payment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rider_assignments (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  order_id UUID NOT NULL,
  rider_id UUID NOT NULL,
  assigned_by UUID NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  -- Set only while the assignment is active, so the unique index allows one active rider per order.
  active_order_id UUID AS (IF(ended_at IS NULL, order_id, NULL)) PERSISTENT,
  CONSTRAINT rider_assignments_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT rider_assignments_rider_fk FOREIGN KEY (rider_id) REFERENCES users(id),
  CONSTRAINT rider_assignments_assigned_by_fk FOREIGN KEY (assigned_by) REFERENCES users(id),
  UNIQUE INDEX rider_assignments_one_active_per_order_idx (active_order_id),
  INDEX rider_assignments_rider_active_idx (rider_id, ended_at, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_events (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  order_id UUID NOT NULL,
  actor_id UUID NULL,
  previous_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NOT NULL,
  reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT order_status_events_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT order_status_events_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX order_status_events_order_created_idx (order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE,
  customer_id UUID NOT NULL,
  rating INT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT reviews_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT reviews_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reviews are only allowed on the customer's own delivered order.
CREATE OR REPLACE TRIGGER reviews_require_delivered_order_insert
BEFORE INSERT ON reviews FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND customer_id = NEW.customer_id AND fulfillment_status = 'delivered'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reviews require the customer''s delivered order';
  END IF;
  SET NEW.updated_at = NOW(3);
END;

CREATE OR REPLACE TRIGGER reviews_require_delivered_order_update
BEFORE UPDATE ON reviews FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id AND customer_id = NEW.customer_id AND fulfillment_status = 'delivered'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reviews require the customer''s delivered order';
  END IF;
  SET NEW.updated_at = NOW(3);
END;

-- Order history is append-only.
CREATE OR REPLACE TRIGGER order_status_events_no_update
BEFORE UPDATE ON order_status_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order status events are append-only';

CREATE OR REPLACE TRIGGER order_status_events_no_delete
BEFORE DELETE ON order_status_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order status events are append-only';

-- HR can grant operational roles only after a staff member has an active employment record.
CREATE OR REPLACE TRIGGER user_roles_require_employment_insert
BEFORE INSERT ON user_roles FOR EACH ROW
BEGIN
  IF (SELECT name FROM roles WHERE id = NEW.role_id) IN ('kitchen', 'manager', 'rider', 'hr')
     AND NOT EXISTS (
       SELECT 1 FROM staff_employment WHERE user_id = NEW.user_id AND employment_status = 'employed'
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff roles require an active employment record';
  END IF;
END;

CREATE OR REPLACE TRIGGER user_roles_require_employment_update
BEFORE UPDATE ON user_roles FOR EACH ROW
BEGIN
  IF (SELECT name FROM roles WHERE id = NEW.role_id) IN ('kitchen', 'manager', 'rider', 'hr')
     AND NOT EXISTS (
       SELECT 1 FROM staff_employment WHERE user_id = NEW.user_id AND employment_status = 'employed'
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Staff roles require an active employment record';
  END IF;
END;

-- Ending employment removes operational roles in the same transaction.
CREATE OR REPLACE TRIGGER staff_employment_revoke_roles
AFTER UPDATE ON staff_employment FOR EACH ROW
BEGIN
  IF NEW.employment_status = 'inactive' AND OLD.employment_status <> 'inactive' THEN
    DELETE user_role FROM user_roles AS user_role
    JOIN roles AS role ON role.id = user_role.role_id
    WHERE user_role.user_id = NEW.user_id
      AND role.name IN ('kitchen', 'manager', 'rider', 'hr');
  END IF;
END;
