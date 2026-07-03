"use strict";

const { config } = require("../config");
const { MemoryStore } = require("./memory.store");

/**
 * Returns a singleton store. Uses Postgres when DATABASE_URL is set,
 * otherwise the in-memory store. Callers must `await store.init()` once at boot.
 */
let instance = null;

function getStore() {
  if (instance) return instance;
  if (config.usePostgres) {
    // Require lazily so `pg` is only touched when actually used.
    const { PostgresStore } = require("./postgres.store");
    instance = new PostgresStore();
  } else {
    instance = new MemoryStore();
  }
  return instance;
}

module.exports = { getStore };
