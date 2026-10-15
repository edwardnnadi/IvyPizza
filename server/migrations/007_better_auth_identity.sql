-- Keep stable application profile IDs while Better Auth owns credentials.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS better_auth_user_id TEXT UNIQUE;
