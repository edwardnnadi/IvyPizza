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

Phase 2 establishes the identity, access, kitchen, and HR foundations. Customer ordering and payment processing are still future work.

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
