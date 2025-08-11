"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var pool_exports = {};
__export(pool_exports, {
  TerminalPool: () => TerminalPool
});
module.exports = __toCommonJS(pool_exports);
var import_errors = require("../utils/errors.js");
var import_helpers = require("../utils/helpers.js");
class TerminalPool {
  constructor(maxSize, recycleAfter, adapter, logger) {
    this.maxSize = maxSize;
    this.recycleAfter = recycleAfter;
    this.adapter = adapter;
    this.logger = logger;
  }
  static {
    __name(this, "TerminalPool");
  }
  terminals = /* @__PURE__ */ new Map();
  availableQueue = [];
  initializationPromise;
  async initialize() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    this.initializationPromise = this.doInitialize();
    return this.initializationPromise;
  }
  async doInitialize() {
    this.logger.info("Initializing terminal pool", {
      maxSize: this.maxSize,
      recycleAfter: this.recycleAfter
    });
    const preCreateCount = Math.min(2, this.maxSize);
    const promises = [];
    for (let i = 0; i < preCreateCount; i++) {
      promises.push(this.createPooledTerminal());
    }
    await Promise.all(promises);
    this.logger.info("Terminal pool initialized", {
      created: preCreateCount
    });
  }
  async shutdown() {
    this.logger.info("Shutting down terminal pool");
    const terminals = Array.from(this.terminals.values());
    await Promise.all(terminals.map(({ terminal }) => this.adapter.destroyTerminal(terminal)));
    this.terminals.clear();
    this.availableQueue = [];
  }
  async acquire() {
    while (this.availableQueue.length > 0) {
      const terminalId = this.availableQueue.shift();
      const pooled = this.terminals.get(terminalId);
      if (pooled && pooled.terminal.isAlive()) {
        pooled.inUse = true;
        pooled.lastUsed = /* @__PURE__ */ new Date();
        this.logger.debug("Terminal acquired from pool", {
          terminalId,
          useCount: pooled.useCount
        });
        return pooled.terminal;
      }
      if (pooled) {
        this.terminals.delete(terminalId);
      }
    }
    if (this.terminals.size < this.maxSize) {
      await this.createPooledTerminal();
      return this.acquire();
    }
    this.logger.info("Terminal pool full, waiting for available terminal");
    const startTime = Date.now();
    const timeout = 3e4;
    while (Date.now() - startTime < timeout) {
      await (0, import_helpers.delay)(100);
      const available = Array.from(this.terminals.values()).find(
        (pooled) => !pooled.inUse && pooled.terminal.isAlive()
      );
      if (available) {
        available.inUse = true;
        available.lastUsed = /* @__PURE__ */ new Date();
        return available.terminal;
      }
    }
    throw new import_errors.TerminalError("No terminal available in pool (timeout)");
  }
  async release(terminal) {
    const pooled = this.terminals.get(terminal.id);
    if (!pooled) {
      this.logger.warn("Attempted to release unknown terminal", {
        terminalId: terminal.id
      });
      return;
    }
    pooled.useCount++;
    pooled.inUse = false;
    if (pooled.useCount >= this.recycleAfter || !terminal.isAlive()) {
      this.logger.info("Recycling terminal", {
        terminalId: terminal.id,
        useCount: pooled.useCount
      });
      this.terminals.delete(terminal.id);
      await this.adapter.destroyTerminal(terminal);
      if (this.terminals.size < this.maxSize) {
        await this.createPooledTerminal();
      }
    } else {
      this.availableQueue.push(terminal.id);
      this.logger.debug("Terminal returned to pool", {
        terminalId: terminal.id,
        useCount: pooled.useCount
      });
    }
  }
  async getHealthStatus() {
    const aliveTerminals = Array.from(this.terminals.values()).filter(
      (pooled) => pooled.terminal.isAlive()
    );
    const available = aliveTerminals.filter((pooled) => !pooled.inUse).length;
    const recycled = Array.from(this.terminals.values()).filter(
      (pooled) => pooled.useCount >= this.recycleAfter
    ).length;
    return {
      healthy: aliveTerminals.length > 0,
      size: this.terminals.size,
      available,
      recycled
    };
  }
  async performMaintenance() {
    this.logger.debug("Performing terminal pool maintenance");
    const deadTerminals = [];
    for (const [id, pooled] of this.terminals.entries()) {
      if (!pooled.terminal.isAlive()) {
        deadTerminals.push(id);
      }
    }
    for (const id of deadTerminals) {
      this.logger.warn("Removing dead terminal from pool", { terminalId: id });
      this.terminals.delete(id);
      const index = this.availableQueue.indexOf(id);
      if (index !== -1) {
        this.availableQueue.splice(index, 1);
      }
    }
    const currentSize = this.terminals.size;
    const minSize = Math.min(2, this.maxSize);
    if (currentSize < minSize) {
      const toCreate = minSize - currentSize;
      this.logger.info("Replenishing terminal pool", {
        currentSize,
        minSize,
        creating: toCreate
      });
      const promises = [];
      for (let i = 0; i < toCreate; i++) {
        promises.push(this.createPooledTerminal());
      }
      await Promise.all(promises);
    }
    const now = Date.now();
    const staleTimeout = 3e5;
    for (const [id, pooled] of this.terminals.entries()) {
      if (!pooled.inUse && pooled.terminal.isAlive()) {
        const idleTime = now - pooled.lastUsed.getTime();
        if (idleTime > staleTimeout) {
          this.logger.info("Recycling stale terminal", {
            terminalId: id,
            idleTime
          });
          pooled.useCount = this.recycleAfter;
        }
      }
    }
  }
  async createPooledTerminal() {
    try {
      const terminal = await this.adapter.createTerminal();
      const pooled = {
        terminal,
        useCount: 0,
        lastUsed: /* @__PURE__ */ new Date(),
        inUse: false
      };
      this.terminals.set(terminal.id, pooled);
      this.availableQueue.push(terminal.id);
      this.logger.debug("Created pooled terminal", { terminalId: terminal.id });
    } catch (error) {
      this.logger.error("Failed to create pooled terminal", error);
      throw error;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TerminalPool
});
//# sourceMappingURL=pool.js.map
