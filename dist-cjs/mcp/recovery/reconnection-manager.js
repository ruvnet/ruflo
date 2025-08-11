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
var reconnection_manager_exports = {};
__export(reconnection_manager_exports, {
  ReconnectionManager: () => ReconnectionManager
});
module.exports = __toCommonJS(reconnection_manager_exports);
var import_node_events = require("node:events");
class ReconnectionManager extends import_node_events.EventEmitter {
  constructor(client, logger, config) {
    super();
    this.client = client;
    this.logger = logger;
    this.config = { ...this.defaultConfig, ...config };
    this.state = {
      attempts: 0,
      nextDelay: this.config.initialDelay,
      isReconnecting: false
    };
  }
  static {
    __name(this, "ReconnectionManager");
  }
  state;
  reconnectTimer;
  reconnectPromise;
  defaultConfig = {
    maxRetries: 10,
    initialDelay: 1e3,
    maxDelay: 3e4,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    resetAfterSuccess: true
  };
  config;
  /**
   * Attempt to reconnect
   */
  async attemptReconnection() {
    if (this.reconnectPromise) {
      this.logger.debug("Reconnection already in progress");
      return this.reconnectPromise;
    }
    if (this.state.attempts >= this.config.maxRetries) {
      this.logger.error("Max reconnection attempts exceeded");
      this.emit("maxRetriesExceeded", this.state);
      return false;
    }
    this.reconnectPromise = this.performReconnection();
    const result = await this.reconnectPromise;
    this.reconnectPromise = void 0;
    return result;
  }
  /**
   * Start automatic reconnection
   */
  startAutoReconnect() {
    if (this.state.isReconnecting) {
      this.logger.debug("Auto-reconnect already active");
      return;
    }
    this.logger.info("Starting automatic reconnection");
    this.state.isReconnecting = true;
    this.emit("reconnectStart");
    this.scheduleReconnect();
  }
  /**
   * Stop reconnection attempts
   */
  stopReconnection() {
    if (!this.state.isReconnecting) {
      return;
    }
    this.logger.info("Stopping reconnection attempts");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
    this.state.isReconnecting = false;
    this.emit("reconnectStop");
  }
  /**
   * Reset reconnection state
   */
  reset() {
    this.logger.debug("Resetting reconnection manager");
    this.stopReconnection();
    this.state = {
      attempts: 0,
      nextDelay: this.config.initialDelay,
      isReconnecting: false
    };
  }
  /**
   * Get current reconnection state
   */
  getState() {
    return { ...this.state };
  }
  /**
   * Calculate next retry delay
   */
  getNextDelay() {
    return this.state.nextDelay;
  }
  async performReconnection() {
    this.state.attempts++;
    this.state.lastAttempt = /* @__PURE__ */ new Date();
    this.logger.info("Attempting reconnection", {
      attempt: this.state.attempts,
      maxRetries: this.config.maxRetries,
      delay: this.state.nextDelay
    });
    this.emit("attemptStart", {
      attempt: this.state.attempts,
      delay: this.state.nextDelay
    });
    try {
      if (this.client.isConnected()) {
        await this.client.disconnect();
      }
      await this.client.connect();
      this.logger.info("Reconnection successful", {
        attempts: this.state.attempts
      });
      this.emit("success", {
        attempts: this.state.attempts,
        duration: Date.now() - this.state.lastAttempt.getTime()
      });
      if (this.config.resetAfterSuccess) {
        this.reset();
      }
      return true;
    } catch (error) {
      this.state.lastError = error;
      this.logger.error("Reconnection failed", {
        attempt: this.state.attempts,
        error: error.message
      });
      this.emit("attemptFailed", {
        attempt: this.state.attempts,
        error
      });
      this.calculateNextDelay();
      if (this.state.attempts < this.config.maxRetries && this.state.isReconnecting) {
        this.scheduleReconnect();
      } else if (this.state.attempts >= this.config.maxRetries) {
        this.logger.error("Max reconnection attempts reached");
        this.emit("maxRetriesExceeded", this.state);
        this.state.isReconnecting = false;
      }
      return false;
    }
  }
  scheduleReconnect() {
    if (!this.state.isReconnecting) {
      return;
    }
    const delay = this.addJitter(this.state.nextDelay);
    this.logger.debug("Scheduling next reconnection attempt", {
      delay,
      baseDelay: this.state.nextDelay
    });
    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnection().catch((error) => {
        this.logger.error("Scheduled reconnection error", error);
      });
    }, delay);
    this.emit("attemptScheduled", {
      attempt: this.state.attempts + 1,
      delay
    });
  }
  calculateNextDelay() {
    const nextDelay = Math.min(
      this.state.nextDelay * this.config.backoffMultiplier,
      this.config.maxDelay
    );
    this.state.nextDelay = nextDelay;
    this.logger.debug("Calculated next delay", {
      delay: nextDelay,
      multiplier: this.config.backoffMultiplier,
      maxDelay: this.config.maxDelay
    });
  }
  addJitter(delay) {
    const jitter = delay * this.config.jitterFactor;
    const randomJitter = (Math.random() - 0.5) * 2 * jitter;
    return Math.max(0, delay + randomJitter);
  }
  /**
   * Force immediate reconnection attempt
   */
  async forceReconnect() {
    this.logger.info("Forcing immediate reconnection");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
    const originalDelay = this.state.nextDelay;
    this.state.nextDelay = 0;
    const result = await this.attemptReconnection();
    if (!result) {
      this.state.nextDelay = originalDelay;
    }
    return result;
  }
  /**
   * Get estimated time until next reconnection attempt
   */
  getTimeUntilNextAttempt() {
    if (!this.state.isReconnecting || !this.reconnectTimer) {
      return null;
    }
    return this.state.nextDelay;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ReconnectionManager
});
//# sourceMappingURL=reconnection-manager.js.map
