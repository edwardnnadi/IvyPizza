# Ivy Pizza

V1 ordering and operations application. The current implementation phase establishes the source project, local development workflow, API boundary, and persistent database foundation. Sample settings and data are for development only.

## Requirements

- Node.js 22 or later
- npm 10 or later

## Start local development

```sh
npm install
npm run dev
```

The Vite frontend runs at <http://127.0.0.1:5173> and proxies `/api` calls to the local API at <http://127.0.0.1:3001>. The API connects to Supabase Postgres using the private `DATABASE_URL` in `.env.local`. On startup, it applies unapplied SQL files from `server/migrations/` in numeric order and records them in `schema_migrations`.

## Deploy the API to Render

The API can run as a Render Node web service while the static frontend remains on WhoGoHost. `render.yaml` defines the API service, build/start commands, health check, and non-secret environment settings. Set these secrets in the Render service dashboard:

- `DATABASE_URL` — the Supabase PostgreSQL session pooler connection string (port 5432).
- `DATABASE_CA_CERT` — omit this variable to use the certificate bundled at `prod-ca-2021.crt`.
- `SUPABASE_URL` — the Supabase project URL used to validate login tokens (the app normalizes a `/rest/v1` suffix if present).
- `CORS_ORIGINS` — `https://theivypizza.com` (add any exact staff-screen origins if they differ).

After the API deploys, set `VITE_API_BASE_URL` to its Render service URL (without a trailing slash), build the frontend, and deploy the updated `dist/` directory to WhoGoHost. The frontend bundle contains only the Supabase URL and publishable key; database credentials stay on the API host. Keep migrations in the repo and apply them through the API deployment workflow.

## Phase 2: identity and access foundation

- Supabase Auth users are linked to application profiles by a database trigger. New accounts receive only the `customer` role by default.
- Staff roles (`kitchen`, `manager`, `rider`, `owner`) must be assigned separately by a trusted administrative process. Do not grant roles from user-editable signup metadata.
- HR is a staff role. HR can confirm employment for an existing account and assign `kitchen`, `manager`, or `rider`; only an owner can grant HR. The database requires an active employment record for HR and operational staff roles. Offboarding revokes those roles.
- `GET /api/me` verifies a Supabase access token and returns the linked profile and assigned roles.
- The public site has an account dialog for customer sign-up, sign-in, session restoration, and sign-out. It sends the access token to `GET /api/me`; the browser bundle receives only the Supabase URL and publishable key from `vite.config.ts`.
- `GET /api/kitchen/orders` returns the active kitchen queue with item details and no delivery address or customer contact data. Kitchen, manager, and owner roles can advance orders through the kitchen statuses with `PATCH /api/kitchen/orders/:orderId/status`; each successful transition writes an append-only status event.
- Staff can open `/kitchen` to sign in, view the live queue, and advance orders. The screen requires a `kitchen`, `manager`, or `owner` role and refreshes automatically every 15 seconds.
- HR and owners can open `/hr` to confirm employment, assign staff roles, review the staff directory, and offboard employees. A staff member must create an Ivy account first; HR then uses that account email and confirms employment while assigning an operational role.
- Application tables have RLS enabled and direct `anon`/`authenticated` table grants revoked. The Express API is the app data access path and must enforce role and record ownership checks before adding data endpoints.
- `server/auth.ts` provides role checks, order ownership/assignment checks, and a kitchen order projection that excludes delivery contact details.
- Database constraints and triggers enforce valid statuses, order totals, delivered-order reviews, and append-only order status events.

Phase 2 established the identity, access, kitchen, and HR foundations. Phase 3 now adds the customer menu and basket; checkout and payment processing remain future work.

### First owner setup

The first owner role must be granted through a trusted Supabase SQL session after the owner has created an Ivy account. Replace the email below with that account's email, then run it once in the Supabase SQL editor. The owner can grant HR access from `/hr`; HR cannot grant owner access.

```sql
DO $$
DECLARE
  owner_profile_id UUID;
BEGIN
  SELECT id INTO owner_profile_id
  FROM public.users
  WHERE lower(email) = lower('REPLACE_WITH_OWNER_EMAIL');

  IF owner_profile_id IS NULL THEN
    RAISE EXCEPTION 'Create the owner account before bootstrapping owner access';
  END IF;

  INSERT INTO public.staff_employment (user_id, employment_status, created_by, updated_by)
  VALUES (owner_profile_id, 'employed', owner_profile_id, owner_profile_id)
  ON CONFLICT (user_id) DO UPDATE
    SET employment_status = 'employed', ended_at = NULL, updated_by = EXCLUDED.updated_by, updated_at = NOW();

  INSERT INTO public.user_roles (user_id, role_id, assigned_by)
  SELECT owner_profile_id, id, owner_profile_id
  FROM public.roles
  WHERE name = 'owner'
  ON CONFLICT (user_id, role_id) DO NOTHING;
END;
$$;
```

To create a production-style frontend bundle, run `npm run build`. The API remains a separate Node process; `.openai/hosting.json` currently describes static hosting only and must be revisited before deploying the operational application.

## Project layout

- `src/` — customer-facing frontend source
- `server/` — API and persistence layer
- `.env.local` — local secrets and connection settings (ignored by Git)
- `dist/` — generated frontend bundle (ignored by Git)

No payment provider, production policy, or customer-facing sample prices are configured at this stage.

## Phase 3: customer menu foundation

- The public menu is loaded from the database through `GET /api/menu`, grouped by category, with pizza sizes and extras.
- Migration `004_customer_menu_catalog.sql` adds stable menu slugs and display order, then imports the current sample dishes. `005_sample_menu_pricing_and_options.sql` supplies clearly labeled development sample prices, size choices, and extras.
- Customers can filter menu categories, choose quantities and options, and edit a basket saved in their browser.
- `POST /api/menu/quote` validates item and option availability, requires a pizza size, and calculates each line and the subtotal from current database prices.
- Sample prices are for development and are not customer-facing launch prices. Payment integration remains deferred until the provider is chosen.

## Phase 4: accounts, addresses, and checkout

- Customers can browse and build a basket without signing in. Placing an order requires a customer account.
- Checkout accepts recipient name, phone, delivery address, landmark, and delivery instructions. Customers can select a saved address or save the address with the order.
- `POST /api/orders` reprices the basket against current available menu data inside a database transaction, stores immutable item and delivery snapshots, and returns a unique order number.
- A customer-scoped idempotency key and request fingerprint make retries safe and reject reusing a key with changed order details.
- `CHECKOUT_DELIVERY_FEE_MINOR` defaults to a development sample of NGN 1,500. `CHECKOUT_TAX_BASIS_POINTS` defaults to 0 and applies to the item subtotal. Confirm real fee and tax policy before launch.
- Orders begin in `awaiting_acceptance` with payment `pending`; this phase does not collect payment. The manager review queue is Phase 5.
- Migration `006_customer_checkout.sql` adds saved-address recipient fields, idempotency storage, and the order-number sequence.
