# Deploying Payment Sandbox to Render

A start-to-finish guide. Budget ~15–20 minutes. There are two deploy paths — the
**Blueprint** path (recommended, uses the `render.yaml` in this repo) and a
**manual** path. Do Part 0 and Part 1 either way, then pick one path in Part 2.

---

## Part 0 — Get your sandbox credentials first

You need five values before deploying. Grab them now and keep them handy.

**Evervault** (dashboard → https://app.evervault.com):
1. `EVERVAULT_TEAM_ID` — Team settings → General → **Team ID** (`team_…`).
2. `EVERVAULT_APP_ID` — App settings → General → **App ID** (`app_…`).
3. `EVERVAULT_API_KEY` — App settings → API Keys → create/copy a key (`ev:key:…`).
   It must be allowed to **create and retrieve 3DS sessions**.

**Checkout.com — SANDBOX** (dashboard → https://sandbox.checkout.com):
4. `CHECKOUT_SECRET_KEY` — Settings → Channels → **Secret key** (`sk_sbox_…`).
   Must be a sandbox key; the app refuses anything that isn't.
5. `CHECKOUT_BASE_URL` — Developers → **Overview**. Copy your **unique prefixed**
   URL, e.g. `https://abcd1234.api.sandbox.checkout.com`.
   ⚠️ The generic `api.sandbox.checkout.com` will **not** work.

> Tip: verify all five locally first — `cp .env.example .env`, paste the values,
> `npm install && npm start`, then open `http://localhost:3000/api/health`. If it
> returns `"ok": true`, your credentials are correct and deployment will be smooth.

---

## Part 1 — Put the code on GitHub

Render deploys from a Git repo, so the project needs to live on GitHub.

```bash
cd payment-sandbox
git init
git add .
git commit -m "Payment Sandbox — initial commit"
# create an EMPTY repo on github.com first (no README), then:
git remote add origin https://github.com/<you>/payment-sandbox.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `.env` and `node_modules`, so no secrets are pushed.
Double-check with `git status` that `.env` is **not** staged.

---

## Part 2 — Deploy

### Path A — Blueprint (recommended)

The repo ships a `render.yaml`, so Render can wire everything up for you.

1. Sign in at https://dashboard.render.com and connect your GitHub account
   (Account Settings → Git Deployment Credentials, if not already connected).
2. Click **New → Blueprint**.
3. Select your `payment-sandbox` repo. Render reads `render.yaml` and shows the
   service it will create (`payment-sandbox`, Docker, free plan, Singapore).
4. It prompts for each secret marked `sync: false`. Paste the five values from
   Part 0:
   - `EVERVAULT_API_KEY`, `EVERVAULT_APP_ID`, `EVERVAULT_TEAM_ID`
   - `CHECKOUT_SECRET_KEY`, `CHECKOUT_BASE_URL`
5. Click **Apply / Deploy Blueprint**. Render builds the Docker image and deploys.
6. Watch the **Logs / Events** tab. When it reads **Live**, open the service URL
   (`https://payment-sandbox-XXXX.onrender.com`).

> Note: Render prompts for `sync: false` values only on the **first** create. If
> you change a secret later, edit it under the service's **Environment** tab.

### Path B — Manual web service (if you'd rather click through the UI)

1. Dashboard → **New → Web Service**.
2. Connect the repo. Render detects the `Dockerfile` and sets **Runtime = Docker**.
3. Fill in:
   - **Name:** `payment-sandbox`
   - **Region:** Singapore (closest to India)
   - **Instance type:** Free
   - **Health Check Path** (under Advanced): `/healthz`
4. Under **Advanced → Environment Variables**, add:
   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `true` |
   | `EVERVAULT_API_KEY` | *(your key)* |
   | `EVERVAULT_APP_ID` | *(your app id)* |
   | `EVERVAULT_TEAM_ID` | *(your team id)* |
   | `CHECKOUT_SECRET_KEY` | *(your sandbox key)* |
   | `CHECKOUT_BASE_URL` | *(your prefixed URL)* |
5. Click **Create Web Service**. Wait for the build to reach **Live**.

You do **not** need to set `PORT` — Render provides it and the app binds to it
automatically (on `0.0.0.0`).

---

## Part 3 — Verify it works

1. **Health:** open `https://<your-app>.onrender.com/api/health`.
   Expect `"ok": true` and every credential shown as `"set"`. If not, the
   `issues` array tells you exactly what's wrong (fix it in the Environment tab).
2. **App:** open the root URL. The header dot should turn to **ready**.
3. **Run a payment:** pick a test card → **Run 3DS flow** → complete/observe the
   challenge → **Authorize** → try Capture / Void / Refund → check the **History**
   tab. Everything should behave exactly as it did locally.

---

## Part 4 — Common issues & fixes

- **First visit is slow (~30–60s), then fine.** Expected on the free plan: it
  spins down after ~15 minutes idle and cold-starts on the next request. For an
  always-on demo (e.g. a LinkedIn link), upgrade the service to **Starter**, or
  add an uptime pinger that hits `/healthz` every few minutes.
- **`/api/health` shows a credential as `missing`.** The env var name is wrong or
  empty. Fix it under the service's **Environment** tab; Render redeploys.
- **Authorize fails with a "non-JSON / wrong base URL" hint.** `CHECKOUT_BASE_URL`
  is the generic URL. Use your unique prefixed one from Developers → Overview.
- **Build fails.** Open the build logs. Confirm the `Dockerfile` is at the repo
  root and the push included it (`git ls-files | grep Dockerfile`).
- **Deploy goes unhealthy / restarts.** Render expects a `200` from
  `/healthz` shortly after boot; confirm the Health Check Path is exactly
  `/healthz`.
- **The 3DS overlay or card encryption is blocked in production.** If the browser
  console shows an origin/domain error from Evervault, add your Render URL
  (`https://<your-app>.onrender.com`) to the **allowed domains** for your app in
  the Evervault dashboard, then reload.

---

## Part 5 — Optional upgrades

- **Custom domain:** service → **Settings → Custom Domains**; add your domain and
  set the DNS record Render shows. HTTPS is automatic.
- **Persistent history (Postgres):** Dashboard → **New → Postgres** (free tier
  available), then add its **Internal Connection String** as a `DATABASE_URL` env
  var on the web service. The schema is applied automatically on boot; history
  then survives restarts.
- **Auto-deploy:** already on — every push to `main` redeploys.
