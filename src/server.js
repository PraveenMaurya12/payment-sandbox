"use strict";

const { config, getConfigIssues } = require("./config");
const logger = require("./logger");
const { createApp } = require("./app");
const { getStore } = require("./store");

async function start() {
  const store = getStore();
  await store.init();

  const app = createApp({ store });
  const server = app.listen(config.port, () => {
    logger.info(`Payment Sandbox listening on http://localhost:${config.port}`, {
      env: config.env,
      store: config.usePostgres ? "postgres" : "memory",
    });
    const issues = getConfigIssues();
    if (issues.length) {
      logger.warn("Server started but configuration is incomplete", { issues });
      logger.warn("Visit /api/health for details. Payment calls will fail until fixed.");
    }
  });

  // Graceful shutdown so in-flight requests finish and connections close cleanly.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down…`);
    server.close(async () => {
      try {
        await store.close();
      } catch (err) {
        logger.error("Error closing store", { message: err.message });
      }
      process.exit(0);
    });
    // Force-exit if connections don't drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: String(reason) });
  });
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { message: err.message, stack: err.stack });
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error("Failed to start server", { message: err.message, stack: err.stack });
  process.exit(1);
});
