"use strict";

/**
 * Local smoke test. Exercises everything that does NOT require a live Evervault
 * or Checkout.com call: config, health, validation, static serving, per-visitor
 * history scoping, rate limiting, and the pure helpers. Run with: npm run smoke
 */

// Set env BEFORE requiring the app (config reads process.env at load time).
Object.assign(process.env, {
  NODE_ENV: "development",
  EVERVAULT_API_KEY: "ev:key:smoke_test_key_value",
  EVERVAULT_APP_ID: "app_smoke",
  EVERVAULT_TEAM_ID: "team_smoke",
  CHECKOUT_SECRET_KEY: "sk_sbox_smoke_test_value",
  CHECKOUT_BASE_URL: "https://smoke123.api.sandbox.checkout.com",
  DATABASE_URL: "",
  PAYMENT_RATE_LIMIT: "3",
  TRUST_PROXY: "true",
});

const assert = require("assert");
const { createApp } = require("../src/app");
const { getStore } = require("../src/store");
const { luhnValid, detectBrand, last4 } = require("../src/domain/card");
const { normalizeCryptogram } = require("../src/services/cryptogram");

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function req(base, path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

async function main() {
  console.log("Unit checks");
  assert.strictEqual(luhnValid("4242424242424242"), true);
  assert.strictEqual(luhnValid("4242424242424241"), false);
  assert.strictEqual(luhnValid("1234"), false);
  ok("Luhn validation");

  assert.strictEqual(detectBrand("4111110116638870"), "Visa");
  assert.strictEqual(detectBrand("5555550130659057"), "Mastercard");
  assert.strictEqual(last4("4111110116638870"), "8870");
  ok("Brand detection + masking");

  // URL-safe → standard base64, padding restored.
  assert.strictEqual(normalizeCryptogram("abc-_A"), "abc+/A==");
  ok("Cryptogram normalisation");

  // Direct store scoping check.
  const store = getStore();
  await store.init();
  const a = await store.insertTransaction({ visitorId: "visA", reference: "r1", amountMinor: 1000, currency: "EUR", status: "Authorized", cardLast4: "8870", cardBrand: "Visa" });
  await store.insertTransaction({ visitorId: "visB", reference: "r2", amountMinor: 500, currency: "EUR", status: "Declined" });
  const listA = await store.listTransactions({ visitorId: "visA", limit: 25 });
  const listB = await store.listTransactions({ visitorId: "visB", limit: 25 });
  const listNone = await store.listTransactions({ visitorId: null, limit: 25 });
  assert.strictEqual(listA.length, 1);
  assert.strictEqual(listB.length, 1);
  assert.strictEqual(listNone.length, 0);
  assert.strictEqual((await store.getTransaction(a.id, "visB")), null); // cannot read another visitor's txn
  ok("Per-visitor history scoping");

  // New atomic + ownership-scoped store methods.
  const rec = await store.recordAuthorization(
    { visitorId: "visA", reference: "r3", amountMinor: 2000, currency: "EUR", status: "Authorized", approved: true, cardLast4: "4242", cardBrand: "Visa" },
    { actionType: "authorize", amountMinor: 2000, status: "Authorized", actionRef: "pay_1" }
  );
  const fetched = await store.getTransaction(rec.id, "visA");
  assert.strictEqual(fetched.actions.length, 1); // authorization persisted with its action atomically
  assert.strictEqual(await store.ownsTransaction(rec.id, "visA"), true);
  assert.strictEqual(await store.ownsTransaction(rec.id, "visB"), false);
  const wrongVisitor = await store.recordAction(rec.id, "visB", { actionType: "capture", status: "Captured" }, { status: "Captured" });
  assert.strictEqual(wrongVisitor, false); // no-op for a non-owner
  const okAction = await store.recordAction(rec.id, "visA", { actionType: "capture", amountMinor: 2000, status: "Captured", actionRef: "act_1" }, { status: "Captured" });
  assert.strictEqual(okAction, true);
  const afterCapture = await store.getTransaction(rec.id, "visA");
  assert.strictEqual(afterCapture.status, "Captured");
  assert.strictEqual(afterCapture.actions.length, 2);
  ok("Atomic recordAuthorization/recordAction + scoped ownsTransaction");

  console.log("\nHTTP checks");
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let r = await req(base, "/healthz");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.text, "ok");
    ok("GET /healthz");

    r = await req(base, "/api/health");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.store, "memory");
    ok("GET /api/health (configured)");

    r = await req(base, "/api/config");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.appId, "app_smoke");
    assert.ok(!("apiKey" in r.json), "secret key must not be exposed");
    ok("GET /api/config exposes only public ids");

    r = await req(base, "/api/transactions");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.count, 0);
    ok("GET /api/transactions empty without visitor id");

    r = await req(base, "/api/transactions", { headers: { "X-Visitor-Id": "browser-xyz-123456" } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.count, 0);
    ok("GET /api/transactions accepts a visitor id");

    r = await req(base, "/api/payment/authorize", { method: "POST", body: { amount: 1000 } });
    assert.strictEqual(r.status, 400);
    assert.ok(/Missing required/i.test(r.json.error));
    ok("POST /api/payment/authorize rejects incomplete body (400, no upstream call)");

    r = await req(base, "/api/payment/authorize", { method: "POST", body: { sessionId: "s", cardNumber: "1234", expMonth: "09", expYear: "26", amount: 1000, currency: "EUR" } });
    assert.strictEqual(r.status, 400);
    assert.ok(/sandbox test card/i.test(r.json.error));
    ok("POST /api/payment/authorize rejects invalid card (Luhn)");

    r = await req(base, "/api/payment/capture", { method: "POST", body: {} });
    assert.strictEqual(r.status, 400);
    ok("POST /api/payment/capture requires paymentId");

    r = await req(base, "/");
    assert.strictEqual(r.status, 200);
    assert.ok(/Payment Sandbox|Card Payment/i.test(r.text));
    ok("GET / serves the HTML shell");

    r = await req(base, "/api/does-not-exist");
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.error, "Not found.");
    ok("Unknown /api route returns JSON 404");

    // Rate limit: PAYMENT_RATE_LIMIT=3, so the 4th payment request should be 429.
    let sawLimit = false;
    for (let i = 0; i < 6; i++) {
      const rr = await req(base, "/api/payment/capture", { method: "POST", body: {} });
      if (rr.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, "expected a 429 after exceeding the payment rate limit");
    ok("Payment rate limiter returns 429 when exceeded");
  } finally {
    server.close();
    await store.close();
  }

  console.log(`\nAll ${passed} checks passed ✓`);
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err.message);
  process.exit(1);
});
