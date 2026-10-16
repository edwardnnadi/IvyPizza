# Ivy Pizza

Ivy Pizza ordering and operations application. Everything runs on one WhoGoHost hosting account: the static website, the Node API (as a DirectAdmin Node.js app on `api.theivypizza.com`), the MariaDB database, and the mail server. Better Auth manages customer and staff sign-in through the API. Sample prices and settings are for development only.

## Requirements

- Node.js 22 or later
- npm 10 or later
- Docker, for the local MariaDB database and the tests

## Start local development

Start a local MariaDB 11.4 database (the same version as the WhoGoHost server) once:

```sh
docker run -d --name ivy-pizza-db -p 127.0.0.1:3306:3306 -e MARIADB_ROOT_PASSWORD=local-dev-only -e MARIADB_DATABASE=ivy -e MARIADB_USER=ivy -e MARIADB_PASSWORD=local-dev-only mariadb:11.4
```

Set `DATABASE_URL=mysql://ivy:local-dev-only@127.0.0.1:3306/ivy` in `.env.local`, then:

```sh
npm install
npm run dev
```

The Vite frontend runs at <http://127.0.0.1:5173> and proxies `/api` calls to the local API at <http://127.0.0.1:3001>. On startup, the API applies SQL migrations from `server/migrations/` and creates/updates the Better Auth schema. The sample environment file documents the settings; never commit `.env.local` or mailbox passwords.

`npm test` starts its own throwaway MariaDB container, so Docker must be running.

## Deploy to WhoGoHost

The API runs as a DirectAdmin Node.js app and connects to MariaDB on the same server through its local socket, so no database traffic leaves the server. Account confirmation and password reset emails go through the theivypizza.com mail server.

| Step | Where | What to do |
|---|---|---|
| 1 | DirectAdmin → Databases | Create the database and its user (`theivypi_zza`). Keep the password in a password manager. |
| 2 | DirectAdmin → Subdomain Management | Create `api.theivypizza.com` and make sure it has an SSL certificate. |
| 3 | DirectAdmin Terminal | Clone or upload this repository to a folder outside `public_html`, for example `~/ivy-pizza-api`. |
| 4 | DirectAdmin → Setup Node.js App | Create an app: Node.js **22**, mode **Production**, application root `ivy-pizza-api`, application URL `api.theivypizza.com`, startup file `app.cjs`. |
| 5 | Setup Node.js App → environment variables | Add the settings in the table below. |
| 6 | Setup Node.js App | Click **Run NPM Install**, then **Restart**. The first start creates the tables and menu. |
| 7 | Browser | Open `https://api.theivypizza.com/api/health`. It should show `"database":"connected"`. |

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://theivypi_zza:PASSWORD@localhost/theivypi_zza` (URL-encode special characters in the password) |
| `DATABASE_SOCKET_PATH` | `/var/lib/mysql/mysql.sock` |
| `BETTER_AUTH_URL` | `https://api.theivypizza.com` |
| `BETTER_AUTH_SECRET` | A random value of at least 32 characters, for example from `openssl rand -hex 32` |
| `AUTH_COOKIE_DOMAIN` | `.theivypizza.com` |
| `AUTH_TRUSTED_ORIGINS`, `CORS_ORIGINS` | `https://theivypizza.com,https://www.theivypizza.com` |
| `AUTH_FRONTEND_URL` | `https://theivypizza.com` |
| `EMAIL_PROVIDER` | `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | `mail.theivypizza.com`, `465`, `true` |
| `SMTP_USER`, `SMTP_PASSWORD` | The `orders@theivypizza.com` mailbox login |
| `SMTP_FROM` | `The Ivy Pizza <orders@theivypizza.com>` |

Build the frontend with `VITE_API_BASE_URL=https://api.theivypizza.com npm run build` and upload `dist/` to `public_html`. The browser uses secure, cross-subdomain cookies; `CORS_ORIGINS` and `AUTH_TRUSTED_ORIGINS` must list the exact public website origins. `src/public/.htaccess` redirects old `/api` links on the main site to `api.theivypizza.com`.

The Resend email option (`EMAIL_PROVIDER=resend` with `RESEND_API_KEY`) remains available if the mail server is ever unsuitable.

## Phase 2: identity and access foundation

- Better Auth stores credentials, sessions, and verification tokens in the MariaDB database. New accounts must confirm their email before sign-in and receive only the `customer` role by default.
- Staff roles (`kitchen`, `manager`, `rider`, `owner`) must be assigned separately by a trusted administrative process. Do not grant roles from user-editable signup metadata.
- HR is a staff role. HR can confirm employment for an existing account and assign `kitchen`, `manager`, or `rider`; only an owner can grant HR. The database requires an active employment record for HR and operational staff roles. Offboarding revokes those roles.
- `GET /api/me` verifies the Better Auth cookie session and links the confirmed account to a stable application profile, preserving existing orders and staff-role assignments.
- The public site has branded sign-up, sign-in, email confirmation, password reset, session restore, and sign-out flows. The browser never receives database or auth signing secrets.
- `GET /api/kitchen/orders` returns the active kitchen queue with item details and no delivery address or customer contact data. Kitchen, manager, and owner roles can advance orders through the kitchen statuses with `PATCH /api/kitchen/orders/:orderId/status`; each successful transition writes an append-only status event.
- Staff can open `/kitchen` to sign in, view the live queue, and advance orders. The screen requires a `kitchen`, `manager`, or `owner` role and refreshes automatically every 15 seconds.
- HR and owners can open `/hr` to confirm employment, assign staff roles, review the staff directory, and offboard employees. A staff member must create an Ivy account first; HR then uses that account email and confirms employment while assigning an operational role.
- Only the API can reach the database: MariaDB accepts local connections from the hosting account. The Express API is the app data access path and must enforce role and record ownership checks before adding data endpoints.
- `server/auth.ts` provides role checks, order ownership/assignment checks, and a kitchen order projection that excludes delivery contact details.
- Database constraints and triggers enforce valid statuses, order totals, delivered-order reviews, and append-only order status events.

The identity and access foundation is in place. Phases 3 and 4 now provide menu browsing, basket, checkout, and the initial customer dashboard. Payments and manager order acceptance remain future work.

### First owner setup

The first owner role must be granted directly in the database after the owner has created and confirmed an Ivy account. In DirectAdmin, open **Databases → phpMyAdmin**, select `theivypi_zza`, open the **SQL** tab, replace the email below, and run it once. The owner can grant HR access from `/hr`; HR cannot grant owner access.

```sql
SET @owner_id = (SELECT id FROM users WHERE lower(email) = lower('REPLACE_WITH_OWNER_EMAIL'));

INSERT INTO staff_employment (user_id, employment_status, created_by, updated_by)
VALUES (@owner_id, 'employed', @owner_id, @owner_id)
ON DUPLICATE KEY UPDATE employment_status = 'employed', ended_at = NULL, updated_by = VALUES(updated_by), updated_at = NOW(3);

INSERT IGNORE INTO user_roles (user_id, role_id, assigned_by)
SELECT @owner_id, id, @owner_id FROM roles WHERE name = 'owner';
```

If the first statement finds no account, the insert fails with a `user_id` error: create and confirm the owner account first.

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

- Customers can browse and build a basket without signing in. Placing an order requires a confirmed Better Auth customer account.
- Sign-up sends an email confirmation, sign-in creates an HTTP-only cookie session, and customers can request a password reset email. Mail can use configurable SMTP settings or the Resend HTTPS API.
- The signed-in account shows order count, active orders, recent order history, and available menu recommendations. `GET /api/customer/dashboard` only returns records belonging to the authenticated customer.
- Checkout accepts recipient name, phone, delivery address, landmark, and delivery instructions. Customers can select a saved address or save the address with the order.
- `POST /api/orders` reprices the basket against current available menu data inside a database transaction, stores immutable item and delivery snapshots, and returns a unique order number.
- A customer-scoped idempotency key and request fingerprint make retries safe and reject reusing a key with changed order details.
- `CHECKOUT_DELIVERY_FEE_MINOR` defaults to a development sample of NGN 1,500. `CHECKOUT_TAX_BASIS_POINTS` defaults to 0 and applies to the item subtotal. Confirm real fee and tax policy before launch.
- Orders begin in `awaiting_acceptance` with payment `pending`; this phase does not collect payment. The manager review queue is Phase 5.
- Migration `006_customer_checkout.sql` adds saved-address recipient fields, idempotency storage, and the order-number sequence.
- Migration `007_better_auth_identity.sql` links Better Auth users to the existing stable application profiles without changing historic order ownership or staff roles.
