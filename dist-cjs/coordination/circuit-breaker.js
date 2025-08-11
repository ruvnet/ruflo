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
var circuit_breaker_exports = {};
__export(circuit_breaker_exports, {
  CircuitBreaker: () => CircuitBreaker,
  CircuitBreakerManager: () => CircuitBreakerManager,
  CircuitState: () => CircuitState
});
module.exports = __toCommonJS(circuit_breaker_exports);
var CircuitState = /* @__PURE__ */ ((CircuitState2) => {
  CircuitState2["CLOSED"] = "closed";
  CircuitState2["OPEN"] = "open";
  CircuitState2["HALF_OPEN"] = "half-open";
  return CircuitState2;
})(CircuitState || {});
class CircuitBreaker {
  constructor(name, config, logger, eventBus) {
    this.name = name;
    this.config = config;
    this.logger = logger;
    this.eventBus = eventBus;
  }
  static {
    __name(this, "CircuitBreaker");
  }
  state = "closed" /* CLOSED */;
  failures = 0;
  successes = 0;
  lastFailureTime;
  lastSuccessTime;
  nextAttempt;
  halfOpenRequests = 0;
  totalRequests = 0;
  rejectedRequests = 0;
  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn) {
    this.totalRequests++;
    if (!this.canExecute()) {
      this.rejectedRequests++;
      const error = new Error(`Circuit breaker '${this.name}' is OPEN`);
      this.logStateChange("Request rejected");
      throw error;
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  /**
   * Check if execution is allowed
   */
  canExecute() {
    switch (this.state) {
      case "closed" /* CLOSED */:
        return true;
      case "open" /* OPEN */:
        if (this.nextAttempt && /* @__PURE__ */ new Date() >= this.nextAttempt) {
          this.transitionTo("half-open" /* HALF_OPEN */);
          return true;
        }
        return false;
      case "half-open" /* HALF_OPEN */:
        return this.halfOpenRequests < this.config.halfOpenLimit;
      default:
        return false;
    }
  }
  /**
   * Handle successful execution
   */
  onSuccess() {
    this.lastSuccessTime = /* @__PURE__ */ new Date();
    switch (this.state) {
      case "closed" /* CLOSED */:
        this.failures = 0;
        break;
      case "half-open" /* HALF_OPEN */:
        this.successes++;
        this.halfOpenRequests++;
        if (this.successes >= this.config.successThreshold) {
          this.transitionTo("closed" /* CLOSED */);
        }
        break;
      case "open" /* OPEN */:
        this.transitionTo("half-open" /* HALF_OPEN */);
        break;
    }
  }
  /**
   * Handle failed execution
   */
  onFailure() {
    this.lastFailureTime = /* @__PURE__ */ new Date();
    switch (this.state) {
      case "closed" /* CLOSED */:
        this.failures++;
        if (this.failures >= this.config.failureThreshold) {
          this.transitionTo("open" /* OPEN */);
        }
        break;
      case "half-open" /* HALF_OPEN */:
        this.transitionTo("open" /* OPEN */);
        break;
      case "open" /* OPEN */:
        this.nextAttempt = new Date(Date.now() + this.config.timeout);
        break;
    }
  }
  /**
   * Transition to a new state
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.logger.info(`Circuit breaker '${this.name}' state change`, {
      from: oldState,
      to: newState,
      failures: this.failures,
      successes: this.successes
    });
    switch (newState) {
      case "closed" /* CLOSED */:
        this.failures = 0;
        this.successes = 0;
        this.halfOpenRequests = 0;
        delete this.nextAttempt;
        break;
      case "open" /* OPEN */:
        this.successes = 0;
        this.halfOpenRequests = 0;
        this.nextAttempt = new Date(Date.now() + this.config.timeout);
        break;
      case "half-open" /* HALF_OPEN */:
        this.successes = 0;
        this.failures = 0;
        this.halfOpenRequests = 0;
        break;
    }
    if (this.eventBus) {
      this.eventBus.emit("circuitbreaker:state-change", {
        name: this.name,
        from: oldState,
        to: newState,
        metrics: this.getMetrics()
      });
    }
  }
  /**
   * Force the circuit to a specific state
   */
  forceState(state) {
    this.logger.warn(`Forcing circuit breaker '${this.name}' to state`, { state });
    this.transitionTo(state);
  }
  /**
   * Get current state
   */
  getState() {
    return this.state;
  }
  /**
   * Get circuit breaker metrics
   */
  getMetrics() {
    const metrics = {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      halfOpenRequests: this.halfOpenRequests
    };
    if (this.lastFailureTime !== void 0) {
      metrics.lastFailureTime = this.lastFailureTime;
    }
    if (this.lastSuccessTime !== void 0) {
      metrics.lastSuccessTime = this.lastSuccessTime;
    }
    return metrics;
  }
  /**
   * Reset the circuit breaker
   */
  reset() {
    this.logger.info(`Resetting circuit breaker '${this.name}'`);
    this.state = "closed" /* CLOSED */;
    this.failures = 0;
    this.successes = 0;
    delete this.lastFailureTime;
    delete this.lastSuccessTime;
    delete this.nextAttempt;
    this.halfOpenRequests = 0;
    this.totalRequests = 0;
    this.rejectedRequests = 0;
  }
  /**
   * Log state change with consistent format
   */
  logStateChange(message) {
    this.logger.debug(`Circuit breaker '${this.name}': ${message}`, {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.nextAttempt
    });
  }
}
class CircuitBreakerManager {
  constructor(defaultConfig, logger, eventBus) {
    this.defaultConfig = defaultConfig;
    this.logger = logger;
    this.eventBus = eventBus;
  }
  static {
    __name(this, "CircuitBreakerManager");
  }
  breakers = /* @__PURE__ */ new Map();
  /**
   * Get or create a circuit breaker
   */
  getBreaker(name, config) {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      const finalConfig = { ...this.defaultConfig, ...config };
      breaker = new CircuitBreaker(name, finalConfig, this.logger, this.eventBus);
      this.breakers.set(name, breaker);
    }
    return breaker;
  }
  /**
   * Execute with circuit breaker
   */
  async execute(name, fn, config) {
    const breaker = this.getBreaker(name, config);
    return breaker.execute(fn);
  }
  /**
   * Get all circuit breakers
   */
  getAllBreakers() {
    return new Map(this.breakers);
  }
  /**
   * Get metrics for all breakers
   */
  getAllMetrics() {
    const metrics = {};
    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics();
    }
    return metrics;
  }
  /**
   * Reset a specific breaker
   */
  resetBreaker(name) {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }
  /**
   * Reset all breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
  /**
   * Force a breaker to a specific state
   */
  forceState(name, state) {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.forceState(state);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CircuitBreaker,
  CircuitBreakerManager,
  CircuitState
});
//# sourceMappingURL=circuit-breaker.js.map
