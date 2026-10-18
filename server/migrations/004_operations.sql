-- Operations: saved-address defaults, "use my location" for delivery areas, and customer help requests.
-- Coordinates are approximate district centres for development; refine them before launch.
-- Every statement is safe to re-run.

ALTER TABLE customer_addresses
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS center_lat DECIMAL(8, 5) NULL,
  ADD COLUMN IF NOT EXISTS center_lng DECIMAL(8, 5) NULL,
  ADD COLUMN IF NOT EXISTS radius_km DECIMAL(5, 2) NULL;

UPDATE delivery_zones SET center_lat = 9.07980, center_lng = 7.47240, radius_km = 2.5 WHERE id = 'wuse2' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 9.09390, center_lng = 7.49360, radius_km = 3.0 WHERE id = 'maitama' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 9.03410, center_lng = 7.48960, radius_km = 3.0 WHERE id = 'garki' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 9.04480, center_lng = 7.52770, radius_km = 3.0 WHERE id = 'asokoro' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 9.07120, center_lng = 7.42530, radius_km = 2.5 WHERE id = 'jabi' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 9.06880, center_lng = 7.44150, radius_km = 2.0 WHERE id = 'utako' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 9.10530, center_lng = 7.40660, radius_km = 4.0 WHERE id = 'gwarinpa' AND center_lat IS NULL;
UPDATE delivery_zones SET center_lat = 8.98360, center_lng = 7.37760, radius_km = 4.0 WHERE id = 'lugbe' AND center_lat IS NULL;

CREATE TABLE IF NOT EXISTS support_requests (
  id UUID NOT NULL DEFAULT UUID() PRIMARY KEY,
  customer_id UUID NULL,
  order_number VARCHAR(20) NULL,
  name VARCHAR(100) NOT NULL,
  contact VARCHAR(254) NOT NULL,
  topic VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT support_requests_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT support_requests_topic_check CHECK (topic IN ('order', 'payment', 'account', 'feedback', 'other')),
  CONSTRAINT support_requests_status_check CHECK (status IN ('open', 'closed')),
  INDEX support_requests_status_created_idx (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
