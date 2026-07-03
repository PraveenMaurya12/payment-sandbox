"use strict";

const path = require("path");
const express = require("express");
const { config } = require("./config");

const { securityHeaders } = require("./middleware/security");
const { cors, requestContext, requestLogger } = require("./middleware/context");
const { generalLimiter, paymentLimiter } = require("./middleware/rateLimit");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const { getStore } = require("./store");
const evervault = require("./services/evervault");
const checkout = require("./services/checkout");
const { PaymentService } = require("./services/paymentService");

const configRoutes = require("./routes/config.routes");
const healthRoutes = require("./routes/health.routes");
const threedsRoutes = require("./routes/threeds.routes");
const paymentsRoutes = require("./routes/payments.routes");
const transactionsRoutes = require("./routes/transactions.routes");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

/**
 * Composition root. Builds the dependency graph once and injects it into the
 * route factories. Dependencies can be overridden (tests, alternative stores);
 * they default to the real singletons so existing callers work unchanged.
 */
function createApp(deps = {}) {
  const store = deps.store || getStore();
  const paymentService = deps.paymentService || new PaymentService({ store, evervault, checkout });

  const app = express();

  // Correct client IPs behind a hosting proxy/load balancer (for rate limiting).
  app.set("trust proxy", config.trustProxy ? 1 : false);
  app.disable("x-powered-by");

  app.use(securityHeaders());
  app.use(cors);
  app.use(requestContext);
  app.use(requestLogger);

  // Plain liveness probe + config health (never rate limited).
  app.get("/healthz", (_req, res) => res.type("text").send("ok"));
  app.use("/api", healthRoutes());

  // Everything past here parses JSON and is rate limited.
  app.use(express.json({ limit: "32kb" }));
  app.use(["/api/3ds/sessions", "/api/payment"], paymentLimiter);
  app.use("/api", generalLimiter);

  app.use("/api", configRoutes());
  app.use("/api", threedsRoutes({ evervault }));
  app.use("/api", paymentsRoutes({ paymentService }));
  app.use("/api", transactionsRoutes({ store }));

  // Unmatched API routes → JSON 404 (before static, so /api never serves HTML).
  app.use("/api", notFound);

  // Static frontend.
  app.use(
    express.static(PUBLIC_DIR, {
      index: "index.html",
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
        else res.setHeader("Cache-Control", "public, max-age=3600");
      },
    })
  );

  // Friendly fallback for any other GET (single-page app).
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp, PUBLIC_DIR };
