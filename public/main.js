"use strict";

/* ════════════════════════════════════════════════════════════════════
   Payment Sandbox — frontend
   External script (CSP-safe): no inline handlers, all wiring via delegation.
   State lives in memory + a single anonymous visitor id in localStorage.
════════════════════════════════════════════════════════════════════ */

// ── Anonymous visitor id (scopes THIS browser's history; not personal data) ──
const VISITOR_KEY = "ps_visitor_id";
function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function getVisitorId() {
  let id = null;
  try {
    id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = makeId();
      localStorage.setItem(VISITOR_KEY, id);
    }
  } catch {
    id = id || makeId(); // localStorage blocked — fall back to a session-only id
  }
  return id;
}
const VISITOR_ID = getVisitorId();

// ── State ──
let teamId = null;
let appId = null;
let evervaultSDK = null;
let currentSessionId = null;
let captureOnAuth = false;
let currentPaymentId = null;
let currentTransactionId = null;
let currentCurrency = null;
let logCount = 0;
let historyItems = [];

// ── Tiny helpers ──
const el = (id) => document.getElementById(id);
function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function money(minor, currency) {
  if (minor == null) return "—";
  const n = Number(minor) / 100;
  return `${esc(currency || "")} ${n.toFixed(2)}`.trim();
}
function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Render simple [label, value] pairs as the shared .result-row markup. */
function resultRows(pairs) {
  return pairs
    .map(([l, v]) => `<div class="result-row"><span class="rl">${esc(l)}</span><span class="rv">${esc(v)}</span></div>`)
    .join("");
}

/** fetch wrapper that always sends the visitor id. */
function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers, { "X-Visitor-Id": VISITOR_ID });
  if (opts.body) headers["Content-Type"] = "application/json";
  return fetch(path, Object.assign({}, opts, { headers }));
}

// ── UI primitives ──
function toggleAcc(header) {
  header.classList.toggle("open");
  header.nextElementSibling.classList.toggle("open");
}
function switchTab(tab) {
  ["flow", "activity", "history"].forEach((x) => {
    el(`tab-${x}`).classList.toggle("active", x === tab);
    el(`panel-${x}`).classList.toggle("active", x === tab);
  });
  if (tab === "history") loadHistory();
}
function setFlowStep(n) {
  for (let i = 1; i <= 5; i++) {
    const e = el(`step-${i}`);
    e.classList.remove("done", "active");
    if (i < n) e.classList.add("done");
    if (i === n) e.classList.add("active");
  }
}
function setStatus(type, label) {
  const c = el("status-pill");
  c.className = `status-chip ${type}`;
  c.textContent = label;
}
function setCaptureMode(on) {
  captureOnAuth = on;
  el("mode-auth-capture").classList.toggle("active", on);
  el("mode-auth-only").classList.toggle("active", !on);
}

function addLog(msg, type = "default") {
  logCount++;
  el("log-count").textContent = logCount;
  const area = el("log-area");
  const empty = el("log-empty");
  if (empty) empty.remove();
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const div = document.createElement("div");
  div.className = `log-entry ${type}`;
  div.innerHTML = `<span class="log-time">${time}</span><div class="log-dot"></div><span class="log-msg">${esc(msg)}</span>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function renderJSON(data) {
  el("json-ts").textContent = new Date().toLocaleTimeString();
  el("json-area").innerHTML = `<div class="json-block">${syntaxHighlight(JSON.stringify(data, null, 2))}</div>`;
}
function syntaxHighlight(json) {
  return esc(json).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      if (/^"/.test(m)) return /:$/.test(m) ? `<span class="jk">${m}</span>` : `<span class="jv-str">${m}</span>`;
      if (/true|false/.test(m)) return `<span class="jv-bool">${m}</span>`;
      if (/null/.test(m)) return `<span class="jv-null">${m}</span>`;
      return `<span class="jv-num">${m}</span>`;
    }
  );
}

// ── Boot ──
async function init() {
  console.info("%c[payment-sandbox] UI build v7 (mobile-first)","color:#10b981");
  setFlowStep(1);
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (!res.ok || cfg.error) throw new Error(cfg.error || "Server not configured");
    teamId = cfg.teamId;
    appId = cfg.appId;
    el("server-dot").classList.add("live");
    el("server-label").textContent = "ready";
    addLog(`Connected · team ${teamId}`, "success");

    const s = document.createElement("script");
    s.src = "https://js.evervault.com/v2";
    s.onload = () => {
      try {
        evervaultSDK = new Evervault(teamId, appId);
        addLog("Evervault SDK loaded", "info");
      } catch (e) {
        addLog(`SDK init failed: ${e.message}`, "error");
      }
    };
    s.onerror = () => addLog("Could not load the Evervault SDK", "error");
    document.head.appendChild(s);
  } catch (err) {
    el("server-label").textContent = "error";
    addLog(`Config error: ${err.message}`, "error");
  }
  loadHistory();
}

// ── 3DS flow ──
async function runFlow() {
  resetAll(false);
  el("run-btn").disabled = true;
  setStatus("pending", "CREATING SESSION…");
  setFlowStep(2);
  el("auth-empty").style.display = "none";
  el("auth-result-area").style.display = "none";

  const cardRaw = el("card-number").value.replace(/\s/g, "");
  let encryptedNumber = cardRaw;
  if (evervaultSDK) {
    try {
      addLog("Encrypting card…", "info");
      encryptedNumber = await evervaultSDK.encrypt(cardRaw);
      addLog("Encrypted ✓", "success");
    } catch (err) {
      addLog(`Encryption failed: ${err.message}`, "warn");
    }
  } else {
    addLog("SDK not loaded — sending raw test card", "warn");
  }

  const body = {
    card: {
      number: encryptedNumber,
      expiry: { month: el("exp-month").value, year: el("exp-year").value },
    },
    merchant: {
      name: el("merchant-name").value,
      website: el("merchant-website").value,
      categoryCode: el("merchant-mcc").value,
      country: el("merchant-country").value,
    },
    payment: {
      type: "one-off",
      amount: parseInt(el("amount").value, 10),
      currency: el("currency").value.toUpperCase(),
    },
  };

  addLog("POST /api/3ds/sessions…", "info");
  let session;
  try {
    const res = await api("/api/3ds/sessions", { method: "POST", body: JSON.stringify(body) });
    session = await res.json();
    renderJSON(session);
    if (!res.ok) {
      addLog(`Session failed: ${session.hint || session.error || "error"}`, "error");
      setStatus("failed", "ERROR");
      el("run-btn").disabled = false;
      setFlowStep(1);
      return;
    }
  } catch (err) {
    addLog(`Network error: ${err.message}`, "error");
    setStatus("failed", "NETWORK ERROR");
    el("run-btn").disabled = false;
    setFlowStep(1);
    return;
  }
  currentSessionId = session.id;
  addLog(`Session ${session.id}`, "success");
  await runSDKStep(session.id);
}

// ── 3DS modal (contained overlay instead of the SDK's full-screen modal) ──
let currentTds = null;

/** Pick an issuer-supported iframe size that fits the current viewport. */
function tdsSize() {
  const w = window.innerWidth || 500;
  if (w >= 600) return { width: 500, height: 600 };
  if (w >= 380) return { width: 390, height: 400 };
  return { width: 250, height: 400 };
}

function openTdsModal(size) {
  const frame = el("tds-frame");
  frame.innerHTML = "";
  frame.style.minWidth = size.width + "px";
  frame.style.minHeight = size.height + "px";
  el("tds-loading").classList.remove("hidden");
  el("tds-modal").classList.add("open");
  document.body.classList.add("modal-open");
}

function closeTdsModal() {
  el("tds-modal").classList.remove("open");
  document.body.classList.remove("modal-open");
  try {
    currentTds?.unmount?.();
  } catch {
    /* already unmounted after success */
  }
  currentTds = null;
}

/** User dismissed the challenge before it finished. */
function cancelThreeDS() {
  if (!el("tds-modal").classList.contains("open")) return;
  addLog("3DS cancelled", "warn");
  closeTdsModal();
  setStatus("idle", "CANCELLED");
  el("run-btn").disabled = false;
}

async function runSDKStep(sessionId) {
  if (!evervaultSDK) {
    addLog("Evervault SDK not loaded", "error");
    setStatus("failed", "SDK NOT LOADED");
    el("run-btn").disabled = false;
    return;
  }
  addLog("Launching 3DS…", "info");
  setStatus("pending", "AUTHENTICATING");
  const size = tdsSize();
  openTdsModal(size);

  try {
    const tds = evervaultSDK.ui.threeDSecure(sessionId, { size });
    currentTds = tds;

    tds.on("ready", () => {
      el("tds-loading").classList.add("hidden");
      setStatus("challenge", "AUTHENTICATING");
      addLog("3DS ready", "info");
    });
    tds.on("success", async () => {
      addLog("3DS succeeded", "success");
      closeTdsModal();
      try {
        const r = await api(`/api/3ds/sessions/${sessionId}`);
        const d = await r.json();
        renderJSON(d);
        showFinalResult(d);
      } catch (e) {
        addLog(`Could not fetch result: ${e.message}`, "warn");
        setStatus("success", "AUTHENTICATED");
      }
      el("run-btn").disabled = false;
    });
    tds.on("failure", () => {
      addLog("3DS failed", "error");
      closeTdsModal();
      setStatus("failed", "FAILED");
      // Surface the failure reason in the flow panel (best-effort).
      api(`/api/3ds/sessions/${sessionId}`)
        .then((r) => r.json())
        .then((d) => {
          renderJSON(d);
          showFinalResult(d);
        })
        .catch(() => {});
      el("run-btn").disabled = false;
    });
    tds.on("error", (err) => {
      addLog(`SDK error: ${err?.message || JSON.stringify(err)}`, "error");
      closeTdsModal();
      setStatus("failed", "SDK ERROR");
      el("run-btn").disabled = false;
    });

    tds.mount("#tds-frame");
    addLog("Challenge frame mounted", "info");
  } catch (err) {
    addLog(`SDK error: ${err.message}`, "error");
    closeTdsModal();
    setStatus("failed", "SDK ERROR");
    el("run-btn").disabled = false;
  }
}

function showFinalResult(data) {
  const isOk = data.status === "success";
  setStatus(isOk ? "success" : "failed", isOk ? "AUTHENTICATED" : String(data.status || "").toUpperCase());
  setFlowStep(isOk ? 3 : 2);
  el("auth-empty").style.display = "none";
  el("auth-result-area").style.display = "";
  el("auth-result-icon").textContent = isOk ? "✅" : "❌";
  el("auth-result-icon").className = `auth-icon ${isOk ? "ok" : "fail"}`;
  el("auth-result-label").textContent = isOk ? "3DS authenticated" : "Authentication failed";
  el("auth-result-sub").textContent = isOk
    ? "ECI + cryptogram ready for authorization"
    : `Reason: ${data.failureReason || "unknown"}`;
  const badge = el("auth-stage-badge");
  badge.style.display = "";
  badge.className = `stage-badge ${isOk ? "ok" : "fail"}`;
  badge.textContent = isOk ? "SUCCESS" : "FAILED";
  el("stage-auth").className = `stage ${isOk ? "success-stage" : "failed-stage"}`;
  const eci = data.eci?.value || data.eci;
  const ls = data.eci?.liabilityShift;
  el("result-rows").innerHTML = resultRows([
    ["Status", data.status || "—"],
    ["ECI", eci || "—"],
    ["Liability shift", ls != null ? String(ls) : "—"],
    ["Cryptogram", data.cryptogram ? data.cryptogram.substring(0, 28) + "…" : "—"],
    ["Session id", data.id || "—"],
    ["3DS version", data.version || "—"],
  ]);
  if (isOk) el("authorize-btn").classList.add("visible");
}

// ── Authorize + actions ──
async function authorizePayment() {
  const btn = el("authorize-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Authorizing…";
  switchTab("activity");
  addLog("POST /api/payment/authorize…", "info");
  try {
    const res = await api("/api/payment/authorize", {
      method: "POST",
      body: JSON.stringify({
        sessionId: currentSessionId,
        cardNumber: el("card-number").value.replace(/\s/g, ""),
        expMonth: el("exp-month").value,
        expYear: el("exp-year").value,
        cvv: el("cvv").value,
        amount: parseInt(el("amount").value, 10) || 1000,
        currency: el("currency").value.toUpperCase() || "EUR",
        capture: captureOnAuth,
      }),
    });
    const data = await res.json();
    renderJSON(data);
    if (!res.ok) {
      addLog(`Authorization failed: ${data.error}`, "error");
      btn.textContent = "⚡ Retry authorization";
      btn.disabled = false;
      return;
    }
    addLog(
      data.approved ? `✓ Authorized — ${data.paymentId}` : `✗ Declined: ${data.responseSummary}`,
      data.approved ? "success" : "error"
    );
    showPaymentResult(data);
    btn.classList.remove("visible");
    currentTransactionId = data.transactionId || null;
    if (data.approved) {
      currentPaymentId = data.paymentId;
      currentCurrency = data.currency;
      if (!captureOnAuth) {
        el("stage-capture").style.display = "";
        setFlowStep(4);
      }
      if (captureOnAuth || data.status === "Captured") {
        el("stage-refund").style.display = "";
        setFlowStep(5);
      }
      fetchPaymentStatus();
      switchTab("flow");
    }
    setStatus(
      data.approved ? "success" : "failed",
      data.approved ? (captureOnAuth ? "CAPTURED" : "AUTHORIZED") : "DECLINED"
    );
    loadHistory();
  } catch (err) {
    addLog(`Network error: ${err.message}`, "error");
    btn.textContent = "⚡ Retry authorization";
    btn.disabled = false;
  }
}

function showPaymentResult(data) {
  el("stage-pay").style.display = "";
  const badge = el("payment-badge");
  const cls = data.approved ? (captureOnAuth ? "captured" : "authorized") : "declined";
  badge.className = `pay-badge ${cls}`;
  badge.textContent = data.approved ? (captureOnAuth ? "CAPTURED" : "AUTHORIZED") : "DECLINED";
  const ls = data.liabilityShift;
  el("payment-rows").innerHTML = [
    ["Payment id", data.paymentId],
    ["Status", data.status],
    ["Auth code", data.authCode],
    ["Reference", data.reference],
    ["Amount", data.amount != null ? money(data.amount, data.currency) : "—"],
    ["Response", data.responseSummary],
    ["divider", "── 3DS ──"],
    ["ECI", data.eci || "—"],
    ["Liability shift", ls ? "✓ issuer liable" : "✗ merchant liable"],
    ["3DS version", data.threeDs?.version || "—"],
    ["Challenged", data.threeDs?.challenged != null ? String(data.threeDs.challenged) : "—"],
  ]
    .map(([l, v]) => {
      if (l === "divider") return `<div class="result-divider">${esc(v)}</div>`;
      const c = l === "Liability shift" ? (ls ? "color:var(--accent)" : "color:var(--amber)") : "";
      return `<div class="result-row"><span class="rl">${esc(l)}</span><span class="rv" style="${c}">${esc(v || "—")}</span></div>`;
    })
    .join("");
}

async function capturePayment() {
  if (!currentPaymentId) return;
  const btn = el("capture-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Capturing…";
  const amt = el("capture-amount").value;
  addLog("POST /api/payment/capture…", "info");
  try {
    const res = await api("/api/payment/capture", {
      method: "POST",
      body: JSON.stringify({
        paymentId: currentPaymentId,
        transactionId: currentTransactionId,
        amount: amt ? parseInt(amt, 10) : undefined,
      }),
    });
    const data = await res.json();
    renderJSON(data);
    if (!res.ok) {
      addLog(`Capture failed: ${data.error}`, "error");
      btn.textContent = "↻ Retry";
      btn.disabled = false;
      return;
    }
    addLog(`✓ Capture accepted — action ${data.actionId}`, "success");
    showActionResult("capture-result", "capture-result-rows", true, {
      "Action id": data.actionId,
      Reference: data.reference,
      Note: "Async — confirmed via webhook in production",
    });
    el("void-btn").disabled = true;
    el("void-btn").textContent = "Void unavailable after capture";
    btn.textContent = "✓ Captured";
    el("payment-badge").className = "pay-badge captured";
    el("payment-badge").textContent = "CAPTURED";
    el("stage-refund").style.display = "";
    setFlowStep(5);
    fetchPaymentStatus();
    loadHistory();
  } catch (err) {
    addLog(`Error: ${err.message}`, "error");
    btn.textContent = "↻ Retry";
    btn.disabled = false;
  }
}

async function voidPayment() {
  if (!currentPaymentId) return;
  const btn = el("void-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Voiding…";
  addLog("POST /api/payment/void…", "info");
  try {
    const res = await api("/api/payment/void", {
      method: "POST",
      body: JSON.stringify({ paymentId: currentPaymentId, transactionId: currentTransactionId }),
    });
    const data = await res.json();
    renderJSON(data);
    if (!res.ok) {
      addLog(`Void failed: ${data.error}`, "error");
      btn.textContent = "↻ Retry";
      btn.disabled = false;
      return;
    }
    addLog(`✓ Void accepted — action ${data.actionId}`, "success");
    btn.textContent = "✓ Voided";
    el("capture-btn").disabled = true;
    el("capture-btn").textContent = "Capture unavailable after void";
    el("payment-badge").className = "pay-badge voided";
    el("payment-badge").textContent = "VOIDED";
    setStatus("failed", "VOIDED");
    fetchPaymentStatus();
    loadHistory();
  } catch (err) {
    addLog(`Error: ${err.message}`, "error");
    btn.textContent = "↻ Retry";
    btn.disabled = false;
  }
}

async function refundPayment() {
  if (!currentPaymentId) return;
  const btn = el("refund-btn");
  const amt = el("refund-amount").value;
  const reason = el("refund-reason").value || undefined;
  btn.disabled = true;
  btn.textContent = "⏳ Processing…";
  addLog("POST /api/payment/refund…", "info");
  try {
    const res = await api("/api/payment/refund", {
      method: "POST",
      body: JSON.stringify({
        paymentId: currentPaymentId,
        transactionId: currentTransactionId,
        amount: amt ? parseInt(amt, 10) : undefined,
        reason,
      }),
    });
    const data = await res.json();
    renderJSON(data);
    if (!res.ok) {
      addLog(`Refund failed: ${data.error}`, "error");
      btn.textContent = "↻ Retry";
      btn.disabled = false;
      return;
    }
    addLog(`✓ Refund accepted — action ${data.actionId}`, "success");
    btn.textContent = "✓ Refunded";
    el("payment-badge").className = "pay-badge refunded";
    el("payment-badge").textContent = "REFUNDED";
    showActionResult("refund-result", "refund-result-rows", true, {
      "Action id": data.actionId,
      Amount: data.amount != null ? `${data.amount} minor units` : "Full",
      Note: "Async — confirmed via webhook in production",
    });
    fetchPaymentStatus();
    loadHistory();
  } catch (err) {
    addLog(`Error: ${err.message}`, "error");
    btn.textContent = "↻ Retry";
    btn.disabled = false;
  }
}

function showActionResult(elId, rowsId, success, fields) {
  el(elId).className = `action-result visible${success ? "" : " fail"}`;
  el(rowsId).innerHTML = Object.entries(fields)
    .map(([l, v]) => `<div class="result-row"><span class="rl">${esc(l)}</span><span class="rv">${esc(v || "—")}</span></div>`)
    .join("");
}

async function fetchPaymentStatus() {
  if (!currentPaymentId) return;
  addLog(`GET /api/payment/${currentPaymentId}…`, "info");
  try {
    const res = await api(`/api/payment/${currentPaymentId}`);
    const data = await res.json();
    if (!res.ok) {
      addLog(`Status fetch failed: ${data.error}`, "error");
      return;
    }
    addLog(`Status: ${data.status}`, "info");
    const cur = data.currency || currentCurrency || "";
    const fmt = (v) => (v != null ? money(v, cur) : "—");
    el("balance-grid").innerHTML = [
      ["Authorized", data.balances.totalAuthorized, "var(--blue)"],
      ["Captured", data.balances.totalCaptured, "var(--accent)"],
      ["Refunded", data.balances.totalRefunded, "var(--red)"],
      ["Voided", data.balances.totalVoided, "var(--text3)"],
    ]
      .map(
        ([l, v, c]) =>
          `<div class="balance-cell"><div class="balance-lbl">${esc(l)}</div><div class="balance-val" style="color:${c}">${fmt(v)}</div></div>`
      )
      .join("");
    el("action-list").innerHTML = !data.actions?.length
      ? '<div style="color:var(--text3);font-size:11px;padding:6px 0">No actions yet.</div>'
      : data.actions
          .map((a) => {
            const ts = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : "—";
            const amt = a.amount != null ? money(a.amount, cur) : "—";
            return `<div class="timeline-item"><span class="timeline-type ${esc(a.type)}">${esc(a.type)}</span><span class="timeline-amount">${amt}</span><span class="timeline-time">${esc(ts)}</span></div>`;
          })
          .join("");
    el("stage-status").style.display = "";
  } catch (err) {
    addLog(`Status error: ${err.message}`, "error");
  }
}

function resetAll(resetBtn = true) {
  currentSessionId = null;
  currentPaymentId = null;
  currentTransactionId = null;
  currentCurrency = null;
  logCount = 0;
  setStatus("idle", "IDLE");
  setFlowStep(1);
  el("poll-spin").classList.remove("active");
  el("poll-label").textContent = "";
  el("log-area").innerHTML =
    '<div id="log-empty" style="text-align:center;padding:40px 20px;color:var(--text3)"><div style="font-size:24px;margin-bottom:8px;opacity:.4">◈</div>Activity will appear here when you run a flow.</div>';
  el("log-count").textContent = "0";
  el("json-area").innerHTML = '<div style="color:var(--text3);font-size:11px;padding:10px 0">No response yet.</div>';
  el("json-ts").textContent = "";
  el("stage-auth").className = "stage highlighted";
  el("auth-empty").style.display = "";
  el("auth-result-area").style.display = "none";
  el("sdk-modal-notice").classList.remove("visible");
  el("auth-stage-badge").style.display = "none";
  const ab = el("authorize-btn");
  ab.classList.remove("visible");
  ab.textContent = "⚡ Authorize payment";
  ab.disabled = false;
  el("stage-pay").style.display = "none";
  el("stage-capture").style.display = "none";
  el("capture-btn").disabled = false;
  el("capture-btn").textContent = "Capture payment";
  el("void-btn").disabled = false;
  el("void-btn").textContent = "✕ Void — cancel without charging";
  el("capture-amount").value = "";
  el("capture-result").className = "action-result";
  el("capture-result-rows").innerHTML = "";
  el("stage-refund").style.display = "none";
  el("refund-btn").disabled = false;
  el("refund-btn").textContent = "Issue refund";
  el("refund-amount").value = "";
  el("refund-reason").value = "";
  el("refund-result").className = "action-result";
  el("refund-result-rows").innerHTML = "";
  el("stage-status").style.display = "none";
  el("balance-grid").innerHTML = "";
  el("action-list").innerHTML = "";
  if (resetBtn) el("run-btn").disabled = false;
}

// ── Transaction history (per-visitor) ──
function statusClass(status, approved) {
  const known = ["authorized", "captured", "paid", "declined", "voided", "refunded"];
  const s = String(status || "").toLowerCase();
  if (known.includes(s)) return s;
  return approved === false ? "declined" : approved ? "authorized" : "unknown";
}

async function loadHistory() {
  const table = el("tx-table");
  const empty = el("history-empty");
  try {
    const res = await api("/api/transactions?limit=100");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load history");
    historyItems = data.items || [];
    renderHistory(historyItems);
  } catch (err) {
    historyItems = [];
    table.style.display = "none";
    empty.style.display = "";
    empty.innerHTML = `<div class="history-empty-icon">⚠</div><div class="history-empty-title">Couldn't load history</div><div class="history-empty-sub">${esc(err.message)}</div>`;
  }
}

function renderHistory(items) {
  const table = el("tx-table");
  const tbody = el("tx-tbody");
  const empty = el("history-empty");

  const count = items.length;
  const approved = items.filter((t) => t.approved).length;
  el("hm-count").textContent = String(count);
  el("hm-approved").textContent = String(approved);
  el("tab-history-badge").textContent = count ? String(count) : "";

  // Volume: total of approved amounts, grouped by currency; show the largest group.
  const byCur = {};
  items.filter((t) => t.approved).forEach((t) => {
    byCur[t.currency] = (byCur[t.currency] || 0) + (t.amountMinor || 0);
  });
  const curs = Object.keys(byCur);
  if (!curs.length) el("hm-volume").textContent = "—";
  else {
    const top = curs.sort((a, b) => byCur[b] - byCur[a])[0];
    el("hm-volume").textContent = money(byCur[top], top) + (curs.length > 1 ? " +" : "");
  }

  if (!count) {
    table.style.display = "none";
    empty.style.display = "";
    empty.innerHTML =
      '<div class="history-empty-icon">◈</div><div class="history-empty-title">No transactions yet</div><div class="history-empty-sub">Run a 3DS flow and authorize a payment —<br>it shows up here, visible only in this browser.</div>';
    return;
  }

  empty.style.display = "none";
  table.style.display = "";
  tbody.innerHTML = items
    .map((t) => {
      const cls = statusClass(t.status, t.approved);
      const ls = t.liabilityShift
        ? '<span class="ls-yes">✓ shift</span>'
        : '<span class="ls-no">merchant</span>';
      return `<tr class="tx-row" data-id="${esc(t.id)}">
        <td><span class="tx-card"><span class="tx-brand">${esc(t.cardBrand || "card")}</span>•• ${esc(t.cardLast4 || "····")}</span></td>
        <td class="tx-amount">${money(t.amountMinor, t.currency)}</td>
        <td><span class="st-badge ${cls}">${esc(t.status || "—")}</span></td>
        <td>${ls}</td>
        <td class="right">${esc(relTime(t.createdAt))}</td>
      </tr>`;
    })
    .join("");
}

async function toggleTxDetail(row) {
  const id = row.dataset.id;
  const next = row.nextElementSibling;
  if (next && next.classList.contains("tx-detail")) {
    next.remove();
    return;
  }
  document.querySelectorAll(".tx-detail").forEach((d) => d.remove());
  let txn;
  try {
    const res = await api(`/api/transactions/${id}`);
    txn = await res.json();
    if (!res.ok) return;
  } catch {
    return;
  }
  const fields = [
    ["Reference", txn.reference],
    ["Payment id", txn.paymentId],
    ["Session id", txn.sessionId],
    ["ECI", txn.eci],
    ["3DS version", txn.threeDsVersion],
    ["Liability shift", txn.liabilityShift ? "issuer liable" : "merchant liable"],
    ["Response", txn.responseSummary],
    ["Created", new Date(txn.createdAt).toLocaleString()],
  ];
  const grid = resultRows(fields.map(([l, v]) => [l, v || "—"]));
  const actions = (txn.actions || [])
    .map((a) => {
      const amt = a.amountMinor != null ? money(a.amountMinor, txn.currency) : "—";
      return `<div class="timeline-item"><span class="timeline-type ${esc(a.actionType)}">${esc(a.actionType)}</span><span class="timeline-amount">${amt}</span><span class="timeline-time">${esc(relTime(a.createdAt))}</span></div>`;
    })
    .join("");
  const detail = document.createElement("tr");
  detail.className = "tx-detail";
  detail.innerHTML = `<td colspan="5"><div class="tx-detail-inner">
      <div class="tx-detail-grid">${grid}</div>
      <div class="tx-actions-title">Actions</div>
      <div class="timeline">${actions || '<div style="color:var(--text3);font-size:11px">No actions.</div>'}</div>
    </div></td>`;
  row.after(detail);
}

function exportHistoryCsv() {
  if (!historyItems.length) {
    addLog("Nothing to export yet", "warn");
    return;
  }
  const cols = ["createdAt", "cardBrand", "cardLast4", "amountMinor", "currency", "status", "approved", "eci", "threeDsVersion", "liabilityShift", "reference", "paymentId"];
  const header = cols.join(",");
  const rows = historyItems.map((t) =>
    cols
      .map((c) => {
        const v = t[c];
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payment-sandbox-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Single delegated click handler (CSP-safe: no inline handlers) ──
document.addEventListener("click", (e) => {
  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    switch (action) {
      case "toggle-acc": return toggleAcc(actionEl);
      case "switch-tab": return switchTab(actionEl.dataset.tab);
      case "set-capture": return setCaptureMode(actionEl.dataset.mode === "capture");
      case "run-flow": return runFlow();
      case "authorize": return authorizePayment();
      case "capture": return capturePayment();
      case "void": return voidPayment();
      case "refund": return refundPayment();
      case "refresh-status": return fetchPaymentStatus();
      case "cancel-3ds": return cancelThreeDS();
      case "refresh-history": return loadHistory();
      case "export-history": return exportHistoryCsv();
      case "reset": return resetAll();
      default: return;
    }
  }
  const card = e.target.closest(".test-card");
  if (card) {
    document.querySelectorAll(".test-card").forEach((x) => x.classList.remove("selected"));
    card.classList.add("selected");
    el("card-number").value = card.dataset.number;
    return;
  }
  const row = e.target.closest(".tx-row");
  if (row) return toggleTxDetail(row);
});

// Keyboard: Escape closes the 3DS modal; Enter/Space activates focused controls
// (accordion headers, tabs and test cards are <div>s, so they need this to be
// operable without a mouse).
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return cancelThreeDS();
  if (e.key === "Enter" || e.key === " ") {
    const t = e.target;
    if (t && t.matches && (t.matches("[data-action]") || t.matches(".test-card") || t.matches(".tx-row"))) {
      e.preventDefault();
      t.click();
    }
  }
});

init();