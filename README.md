# Payment Sandbox — 3-D Secure + Checkout.com demo

A hosted, interactive **card-payment simulator**. It walks a card through a real
[Evervault](https://evervault.com) **3-D Secure** authentication and then a
[Checkout.com](https://www.checkout.com) **authorize → capture / void → refund**
lifecycle — entirely in each provider's **sandbox**.

> 🧪 **Sandbox only.** No real money ever moves. It uses test credentials and test
> cards. There are **no logins**, and **no card data is ever stored** — only safe,
> anonymised transaction *metadata* (masked last-4, brand, amount, status, 3DS
> result, timestamps).

It's built to be a clean, self-contained portfolio piece: a small but production-shaped
codebase (modular Express API, storage abstraction, CSP + rate limiting, Docker, a
one-command deploy) with a single-page dark "developer console" UI.

---

## What it does

- **Run a 3-D Secure flow** — encrypt a card with the Evervault browser SDK, create a
  3DS session, and complete frictionless or challenge authentication in a secure overlay.
- **Authorize with Checkout.com** — use the resulting ECI + cryptogram to authorize a
  payment, then **capture**, **void**, or **refund** it and watch the live balances.
- **Transaction history** — every attempt is saved as safe metadata and shown in a
  per-browser history view, with an expandable action timeline and CSV export.
- **Activity + raw responses** — a live log and a JSON viewer for every API call.

### Privacy model

History is **per visitor**: the browser generates a random, opaque id (stored in
`localStorage`) and sends it as an `X-Visitor-Id` header. The server scopes all history
reads and writes to that id. It is not an account and not personal data — it just lets a
browser see its own runs. The database columns are deliberately limited to non-sensitive
fields; there is **no column for the PAN, CVV, or cardholder name.**

---

## How it works

```
Browser (SPA)                    Express app (this repo)                 Sandboxes
─────────────                    ───────────────────────                 ─────────
Evervault SDK  ──encrypt card──▶  (card never hits our server raw)
     │                                                                  Evervault
     ├─ POST /api/3ds/sessions ─▶  proxy (adds API key) ───────────────▶  3DS API
     │                                                                       │
     └─ 3DS challenge overlay ◀───────────────────────────────────────── iframe
                                                                         Checkout.com
        POST /api/payment/... ──▶  read 3DS result, authorize ─────────▶  Payments API
                                   store SAFE metadata (masked)             (sandbox)
        GET  /api/transactions ─▶  per-visitor history (scoped by header)
```

The server is stateless (all persistence lives in the store), so it scales horizontally
behind a load balancer. Secrets (`EVERVAULT_API_KEY`, `CHECKOUT_SECRET_KEY`) stay
server-side; only the publishable Evervault app/team ids are sent to the browser.

**Tech:** Node.js + Express, vanilla HTML/CSS/JS (no build step), `helmet` (strict CSP),
`express-rate-limit`, optional `pg` for Postgres, Docker.

---

## Quick start (local)

**Prerequisites:** Node.js 18+ and sandbox accounts at Evervault and Checkout.com.

```bash
# 1. install
npm install

# 2. configure — copy the template and fill in your SANDBOX credentials
cp .env.example .env
#    then edit .env (see the table below)

# 3. run
npm start
#    → http://localhost:3000
```

Visit `/api/health` to confirm every credential is wired up. Storage defaults to
**in-memory** (zero config; history resets on restart).

### Where to get the credentials

| Credential | Where |
| --- | --- |
| `EVERVAULT_API_KEY`, `EVERVAULT_APP_ID`, `EVERVAULT_TEAM_ID` | Evervault dashboard → App settings. The API key needs the 3DS session create/retrieve permissions. |
| `CHECKOUT_SECRET_KEY` | Checkout.com **sandbox** dashboard → Channels → Secret key (`sk_sbox_…`). |
| `CHECKOUT_BASE_URL` | Checkout.com dashboard → Developers → Overview. Use your **unique prefixed** URL, e.g. `https://xxxxxxxx.api.sandbox.checkout.com` — the generic URL will not work. |

---

## Run with Docker

```bash
# app only (in-memory history)
docker compose up --build            # → http://localhost:3000

# with persistent Postgres history:
#   1) set DATABASE_URL=postgres://sandbox:sandbox@db:5432/sandbox in .env
#   2) docker compose --profile db up --build
```

Or build the image directly:

```bash
docker build -t payment-sandbox .
docker run --rm -p 3000:3000 --env-file .env payment-sandbox
```

---

## Deploy

The app is a single Docker image with a `/healthz` probe, so it runs anywhere that hosts
containers (Render, Railway, Fly.io, Cloud Run, an EC2 box, …). In every case: set the
environment variables from the table below, expose the port, and point health checks at
`/healthz`.

- **Render** — a [`render.yaml`](./render.yaml) blueprint is included. New → Blueprint →
  point at your repo, then paste the secrets (they're marked `sync: false`).
- **Railway / Fly.io / Cloud Run** — deploy from the `Dockerfile` and add the same env vars.

For durable history in production, set `DATABASE_URL` to a managed Postgres instance; the
schema in [`db/schema.sql`](./db/schema.sql) is applied automatically on boot.

### Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `EVERVAULT_API_KEY` | ✅ | — | Server-side only. |
| `EVERVAULT_APP_ID` | ✅ | — | Sent to the browser (safe). |
| `EVERVAULT_TEAM_ID` | ✅ | — | Sent to the browser (safe). |
| `CHECKOUT_SECRET_KEY` | ✅ | — | Sandbox key (`sk_sbox_…`); rejected if it isn't a sandbox key. |
| `CHECKOUT_BASE_URL` | ✅ | — | Your unique prefixed sandbox URL. |
| `CHECKOUT_PROCESSING_CHANNEL_ID` | — | — | Optional `pc_…`. |
| `DATABASE_URL` | — | *(empty)* | Blank → in-memory store. Set → Postgres. |
| `PORT` | — | `3000` | |
| `NODE_ENV` | — | `development` | Set `production` when deployed. |
| `ALLOWED_ORIGINS` | — | *(none)* | Comma-separated extra CORS origins. Same-origin always allowed. |
| `PAYMENT_RATE_LIMIT` | — | `30` | Requests/min/IP on the payment + session endpoints. |
| `UPSTREAM_TIMEOUT_MS` | — | `20000` | Timeout for calls to Evervault / Checkout.com. |
| `TRUST_PROXY` | — | `true` | Trust `X-Forwarded-*` behind a hosting proxy. |
| `DEBUG_ERRORS` | — | `false` | Include upstream error detail in API responses (local only). |

---

## Test cards

Any future expiry (e.g. `09/26`) and any CVV (e.g. `100`) work. The card you pick drives
the **3-D Secure** outcome; the authorization itself runs in the Checkout.com sandbox
(see their [test cards](https://www.checkout.com/docs/testing/test-cards)).

| Card number | Brand | 3DS outcome |
| --- | --- | --- |
| `4111 1101 1663 8870` | Visa | Frictionless — authenticates ✓ |
| `5555 5501 3065 9057` | Mastercard | Frictionless — authenticates ✓ |
| `4242 4242 4242 4242` | Visa | Challenge required |
| `5555 5555 5555 4444` | Mastercard | Challenge required |
| `4111 1117 3897 3695` | Visa | Authentication fails ✗ |
| `5555 5504 8784 7545` | Mastercard | Authentication fails ✗ |

---

## API reference

| Method + path | Purpose |
| --- | --- |
| `GET /api/config` | Publishable Evervault app/team ids for the browser SDK. |
| `GET /api/health` · `GET /api/ready` · `GET /healthz` | Config status / readiness / liveness. |
| `POST /api/3ds/sessions` · `GET /api/3ds/sessions/:id` | Create / read an Evervault 3DS session. |
| `POST /api/payment/authorize` | Authorize (optionally auth+capture) using the 3DS result. |
| `POST /api/payment/capture` · `/void` · `/refund` | Post-authorization actions. |
| `GET /api/payment/:id` | Live payment detail, balances and action history from Checkout.com. |
| `GET /api/transactions` · `GET /api/transactions/:id` | This visitor's saved history (scoped by `X-Visitor-Id`). |

---

## Project structure

```
payment-sandbox/
├─ src/
│  ├─ server.js            # bootstrap + graceful shutdown
│  ├─ app.js               # composition root: builds deps, injects into routes
│  ├─ config.js            # env loading + validation
│  ├─ logger.js            # structured logging with secret redaction
│  ├─ lib/httpJson.js      # shared upstream HTTP client (timeout + parsing)
│  ├─ domain/              # card helpers, typed errors, status/action constants
│  ├─ services/            # evervault + checkout clients, paymentService (orchestration), cryptogram
│  ├─ store/               # storage abstraction: memory (default) | postgres
│  ├─ middleware/          # security/CSP, CORS + visitor id, rate limit, validation, errors
│  └─ routes/              # config, health, 3ds, payments, transactions (DI factories)
├─ public/                 # single-page frontend (no build step)
│  ├─ index.html · styles.css · app.js · favicon.svg
├─ db/schema.sql           # Postgres schema (metadata only — no PII)
├─ scripts/smoke-test.js   # offline checks (no upstream calls)
├─ Dockerfile · docker-compose.yml · render.yaml
└─ .env.example
```

---

## Security & compliance notes

- **Sandbox only.** The app refuses a Checkout.com key that isn't a sandbox key, and is
  intended purely for demonstration. Do not point it at live credentials or enter real
  card details.
- **No cardholder data at rest.** The PAN is used transiently to authorize a sandbox
  payment and to derive a masked last-4; it is never persisted or logged. There are no
  database columns for PAN, CVV, or names.
- **Secrets stay server-side**; only publishable Evervault ids reach the browser.
- **Hardened by default:** strict Content-Security-Policy (no inline scripts), rate
  limiting on the payment endpoints, request-size limits, and a non-root Docker user.

---

## License

MIT — see `LICENSE` (add one if you publish this).
