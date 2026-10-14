ALTER TABLE public.customer_addresses
  ADD COLUMN IF NOT EXISTS recipient_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_idempotency_key_idx
  ON public.orders(customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 1;

SELECT setval(
  'public.order_number_seq',
  GREATEST(COALESCE(MAX((substring(order_number FROM '^IVY-([0-9]+)$'))::BIGINT), 0) + 1, 1),
  FALSE
)
FROM public.orders;
