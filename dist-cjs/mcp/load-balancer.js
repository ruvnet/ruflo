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
var load_balancer_exports = {};
__export(load_balancer_exports, {
  LoadBalancer: () => LoadBalancer,
  RequestQueue: () => RequestQueue
});
module.exports = __toCommonJS(load_balancer_exports);
var import_errors = require("../utils/errors.js");
var CircuitBreakerState = /* @__PURE__ */ ((CircuitBreakerState2) => {
  CircuitBreakerState2["CLOSED"] = "closed";
  CircuitBreakerState2["OPEN"] = "open";
  CircuitBreakerState2["HALF_OPEN"] = "half_open";
  return CircuitBreakerState2;
})(CircuitBreakerState || {});
class RateLimiter {
  constructor(maxTokens, refillRate) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }
  static {
    __name(this, "RateLimiter");
  }
  tokens;
  lastRefill;
  tryConsume(tokens = 1) {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }
  refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1e3;
    const tokensToAdd = Math.floor(timePassed * this.refillRate);
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
  getTokens() {
    this.refill();
    return this.tokens;
  }
}
class CircuitBreaker {
  constructor(failureThreshold, recoveryTimeout, halfOpenMaxRequests = 3) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.halfOpenMaxRequests = halfOpenMaxRequests;
  }
  static {
    __name(this, "CircuitBreaker");
  }
  state = "closed" /* CLOSED */;
  failureCount = 0;
  lastFailureTime = 0;
  successCount = 0;
  canExecute() {
    const now = Date.now();
    switch (this.state) {
      case "closed" /* CLOSED */:
        return true;
      case "open" /* OPEN */:
        if (now - this.lastFailureTime >= this.recoveryTimeout) {
          this.state = "half_open" /* HALF_OPEN */;
          this.successCount = 0;
          return true;
        }
        return false;
      case "half_open" /* HALF_OPEN */:
        return this.successCount < this.halfOpenMaxRequests;
      default:
        return false;
    }
  }
  recordSuccess() {
    if (this.state === "half_open" /* HALF_OPEN */) {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxRequests) {
        this.state = "closed" /* CLOSED */;
        this.failureCount = 0;
      }
    } else if (this.state === "closed" /* CLOSED */) {
      this.failureCount = 0;
    }
  }
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "half_open" /* HALF_OPEN */) {
      this.state = "open" /* OPEN */;
    } else if (this.state === "closed" /* CLOSED */ && this.failureCount >= this.failureThreshold) {
      this.state = "open" /* OPEN */;
    }
  }
  getState() {
    return this.state;
  }
  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount
    };
  }
}
class LoadBalancer {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.rateLimiter = new RateLimiter(config.maxRequestsPerSecond, config.maxRequestsPerSecond);
    this.circuitBreaker = new CircuitBreaker(
      config.circuitBreakerThreshold,
      3e4
      // 30 second recovery timeout
    );
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
      circuitBreakerTrips: 0,
      lastReset: /* @__PURE__ */ new Date()
    };
    setInterval(() => {
      this.cleanupSessionRateLimiters();
    }, 3e5);
  }
  static {
    __name(this, "LoadBalancer");
  }
  rateLimiter;
  circuitBreaker;
  sessionRateLimiters = /* @__PURE__ */ new Map();
  metrics;
  requestTimes = [];
  requestsInLastSecond = 0;
  lastSecondTimestamp = 0;
  async shouldAllowRequest(session, request) {
    if (!this.config.enabled) {
      return true;
    }
    if (!this.circuitBreaker.canExecute()) {
      this.logger.warn("Request rejected by circuit breaker", {
        sessionId: session.id,
        method: request.method,
        circuitState: this.circuitBreaker.getState()
      });
      this.metrics.circuitBreakerTrips++;
      return false;
    }
    if (!this.rateLimiter.tryConsume()) {
      this.logger.warn("Request rejected by global rate limiter", {
        sessionId: session.id,
        method: request.method,
        remainingTokens: this.rateLimiter.getTokens()
      });
      this.metrics.rateLimitedRequests++;
      return false;
    }
    const sessionRateLimiter = this.getSessionRateLimiter(session.id);
    if (!sessionRateLimiter.tryConsume()) {
      this.logger.warn("Request rejected by session rate limiter", {
        sessionId: session.id,
        method: request.method,
        remainingTokens: sessionRateLimiter.getTokens()
      });
      this.metrics.rateLimitedRequests++;
      return false;
    }
    return true;
  }
  recordRequestStart(session, request) {
    const requestMetrics = {
      requestId: request.id.toString(),
      sessionId: session.id,
      method: request.method,
      startTime: Date.now()
    };
    this.metrics.totalRequests++;
    this.updateRequestsPerSecond();
    this.logger.debug("Request started", {
      requestId: requestMetrics.requestId,
      sessionId: session.id,
      method: request.method
    });
    return requestMetrics;
  }
  recordRequestEnd(metrics, response, error) {
    metrics.endTime = Date.now();
    const duration = metrics.endTime - metrics.startTime;
    this.requestTimes.push(duration);
    if (this.requestTimes.length > 1e3) {
      this.requestTimes.shift();
    }
    const success = !error && (!response || !response.error);
    metrics.success = success;
    const errorMessage = error?.message || response?.error?.message;
    if (errorMessage) {
      metrics.error = errorMessage;
    }
    if (success) {
      this.metrics.successfulRequests++;
      this.circuitBreaker.recordSuccess();
    } else {
      this.metrics.failedRequests++;
      this.circuitBreaker.recordFailure();
    }
    this.metrics.averageResponseTime = this.calculateAverageResponseTime();
    this.logger.debug("Request completed", {
      requestId: metrics.requestId,
      sessionId: metrics.sessionId,
      method: metrics.method,
      duration,
      success,
      error: metrics.error
    });
  }
  getMetrics() {
    return { ...this.metrics };
  }
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
      circuitBreakerTrips: 0,
      lastReset: /* @__PURE__ */ new Date()
    };
    this.requestTimes = [];
    this.logger.info("Load balancer metrics reset");
  }
  isCircuitBreakerOpen() {
    return this.circuitBreaker.getState() === "open" /* OPEN */;
  }
  getDetailedMetrics() {
    return {
      loadBalancer: this.getMetrics(),
      circuitBreaker: this.circuitBreaker.getMetrics(),
      rateLimiter: {
        tokens: this.rateLimiter.getTokens(),
        maxTokens: this.config.maxRequestsPerSecond
      },
      sessions: this.sessionRateLimiters.size
    };
  }
  getSessionRateLimiter(sessionId) {
    let rateLimiter = this.sessionRateLimiters.get(sessionId);
    if (!rateLimiter) {
      const sessionLimit = Math.max(1, Math.floor(this.config.maxRequestsPerSecond / 10));
      rateLimiter = new RateLimiter(sessionLimit, sessionLimit);
      this.sessionRateLimiters.set(sessionId, rateLimiter);
    }
    return rateLimiter;
  }
  calculateAverageResponseTime() {
    if (this.requestTimes.length === 0) {
      return 0;
    }
    const sum = this.requestTimes.reduce((acc, time) => acc + time, 0);
    return sum / this.requestTimes.length;
  }
  updateRequestsPerSecond() {
    const now = Math.floor(Date.now() / 1e3);
    if (now !== this.lastSecondTimestamp) {
      this.metrics.requestsPerSecond = this.requestsInLastSecond;
      this.requestsInLastSecond = 1;
      this.lastSecondTimestamp = now;
    } else {
      this.requestsInLastSecond++;
    }
  }
  cleanupSessionRateLimiters() {
    const cutoffTime = Date.now() - 3e5;
    let cleaned = 0;
    for (const [sessionId, rateLimiter] of this.sessionRateLimiters.entries()) {
      if (rateLimiter.getTokens() === this.config.maxRequestsPerSecond) {
        this.sessionRateLimiters.delete(sessionId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug("Cleaned up session rate limiters", { count: cleaned });
    }
  }
}
class RequestQueue {
  constructor(maxQueueSize = 1e3, requestTimeout = 3e4, logger) {
    this.logger = logger;
    this.maxQueueSize = maxQueueSize;
    this.requestTimeout = requestTimeout;
    setInterval(() => {
      this.cleanupExpiredRequests();
    }, 1e4);
  }
  static {
    __name(this, "RequestQueue");
  }
  queue = [];
  processing = false;
  maxQueueSize;
  requestTimeout;
  async enqueue(session, request, processor) {
    if (this.queue.length >= this.maxQueueSize) {
      throw new import_errors.MCPError("Request queue is full");
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        session,
        request,
        resolve,
        reject,
        timestamp: Date.now()
      });
      if (!this.processing) {
        this.processQueue(processor);
      }
    });
  }
  async processQueue(processor) {
    if (this.processing) {
      return;
    }
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (Date.now() - item.timestamp > this.requestTimeout) {
        item.reject(new import_errors.MCPError("Request timeout"));
        continue;
      }
      try {
        const result = await processor(item.session, item.request);
        item.resolve(result);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.processing = false;
  }
  cleanupExpiredRequests() {
    const now = Date.now();
    let cleaned = 0;
    this.queue = this.queue.filter((item) => {
      if (now - item.timestamp > this.requestTimeout) {
        item.reject(new import_errors.MCPError("Request timeout"));
        cleaned++;
        return false;
      }
      return true;
    });
    if (cleaned > 0) {
      this.logger.warn("Cleaned up expired requests from queue", { count: cleaned });
    }
  }
  getQueueSize() {
    return this.queue.length;
  }
  isProcessing() {
    return this.processing;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LoadBalancer,
  RequestQueue
});
//# sourceMappingURL=load-balancer.js.map
