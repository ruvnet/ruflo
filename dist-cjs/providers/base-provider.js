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
var base_provider_exports = {};
__export(base_provider_exports, {
  BaseProvider: () => BaseProvider
});
module.exports = __toCommonJS(base_provider_exports);
var import_events = require("events");
var import_helpers = require("../utils/helpers.js");
var import_types = require("./types.js");
class BaseProvider extends import_events.EventEmitter {
  static {
    __name(this, "BaseProvider");
  }
  logger;
  circuitBreaker;
  healthCheckInterval;
  lastHealthCheck;
  requestCount = 0;
  errorCount = 0;
  totalTokens = 0;
  totalCost = 0;
  requestMetrics = /* @__PURE__ */ new Map();
  config;
  constructor(options) {
    super();
    this.logger = options.logger;
    this.config = options.config;
    this.circuitBreaker = (0, import_helpers.circuitBreaker)(`llm-${this.name}`, {
      threshold: options.circuitBreakerOptions?.threshold || 5,
      timeout: options.circuitBreakerOptions?.timeout || 6e4,
      resetTimeout: options.circuitBreakerOptions?.resetTimeout || 3e5
    });
    if (this.config.enableCaching) {
      this.startHealthChecks();
    }
  }
  /**
   * Initialize the provider
   */
  async initialize() {
    this.logger.info(`Initializing ${this.name} provider`, {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens
    });
    this.validateConfig();
    await this.doInitialize();
    await this.healthCheck();
  }
  /**
   * Validate provider configuration
   */
  validateConfig() {
    if (!this.config.model) {
      throw new Error(`Model is required for ${this.name} provider`);
    }
    if (!this.validateModel(this.config.model)) {
      throw new Error(`Model ${this.config.model} is not supported by ${this.name} provider`);
    }
    if (this.config.temperature !== void 0) {
      if (this.config.temperature < 0 || this.config.temperature > 2) {
        throw new Error("Temperature must be between 0 and 2");
      }
    }
    if (this.config.maxTokens !== void 0) {
      const maxAllowed = this.capabilities.maxOutputTokens[this.config.model] || 4096;
      if (this.config.maxTokens > maxAllowed) {
        throw new Error(`Max tokens exceeds limit of ${maxAllowed} for model ${this.config.model}`);
      }
    }
  }
  /**
   * Complete a request
   */
  async complete(request) {
    const startTime = Date.now();
    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.doComplete(request);
      });
      const latency = Date.now() - startTime;
      this.trackRequest(request, response, latency);
      this.emit("response", {
        provider: this.name,
        model: response.model,
        latency,
        tokens: response.usage.totalTokens,
        cost: response.cost?.totalCost
      });
      return response;
    } catch (error) {
      this.errorCount++;
      const providerError = this.transformError(error);
      this.emit("error", {
        provider: this.name,
        error: providerError,
        request
      });
      throw providerError;
    }
  }
  /**
   * Stream complete a request
   */
  async *streamComplete(request) {
    const startTime = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    try {
      if (!this.capabilities.supportsStreaming) {
        throw new import_types.LLMProviderError(
          "Streaming not supported",
          "STREAMING_NOT_SUPPORTED",
          this.name,
          void 0,
          false
        );
      }
      const stream = await this.circuitBreaker.execute(async () => {
        return this.doStreamComplete(request);
      });
      for await (const event of stream) {
        if (event.usage) {
          totalTokens = event.usage.totalTokens;
        }
        if (event.cost) {
          totalCost = event.cost.totalCost;
        }
        yield event;
      }
      const latency = Date.now() - startTime;
      this.trackStreamRequest(request, totalTokens, totalCost, latency);
    } catch (error) {
      this.errorCount++;
      const providerError = this.transformError(error);
      yield {
        type: "error",
        error: providerError
      };
      throw providerError;
    }
  }
  /**
   * Validate if a model is supported
   */
  validateModel(model) {
    return this.capabilities.supportedModels.includes(model);
  }
  /**
   * Perform health check
   */
  async healthCheck() {
    const startTime = Date.now();
    try {
      const result = await this.doHealthCheck();
      this.lastHealthCheck = {
        ...result,
        latency: Date.now() - startTime,
        timestamp: /* @__PURE__ */ new Date()
      };
      this.emit("health_check", this.lastHealthCheck);
      return this.lastHealthCheck;
    } catch (error) {
      this.lastHealthCheck = {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
        latency: Date.now() - startTime,
        timestamp: /* @__PURE__ */ new Date()
      };
      this.emit("health_check", this.lastHealthCheck);
      return this.lastHealthCheck;
    }
  }
  /**
   * Get provider status
   */
  getStatus() {
    const queueLength = this.requestMetrics.size;
    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
    return {
      available: this.lastHealthCheck?.healthy ?? false,
      currentLoad: queueLength / 100,
      // Normalize to 0-1
      queueLength,
      activeRequests: queueLength,
      rateLimitRemaining: this.getRateLimitRemaining(),
      rateLimitReset: this.getRateLimitReset()
    };
  }
  /**
   * Get remaining rate limit (override in provider)
   */
  getRateLimitRemaining() {
    return void 0;
  }
  /**
   * Get rate limit reset time (override in provider)
   */
  getRateLimitReset() {
    return void 0;
  }
  /**
   * Estimate cost for a request
   */
  async estimateCost(request) {
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing?.[model];
    if (!pricing) {
      return {
        estimatedPromptTokens: 0,
        estimatedCompletionTokens: 0,
        estimatedTotalTokens: 0,
        estimatedCost: {
          prompt: 0,
          completion: 0,
          total: 0,
          currency: "USD"
        },
        confidence: 0
      };
    }
    const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
    const completionTokens = request.maxTokens || this.config.maxTokens || 1e3;
    const promptCost = promptTokens / 1e3 * pricing.promptCostPer1k;
    const completionCost = completionTokens / 1e3 * pricing.completionCostPer1k;
    return {
      estimatedPromptTokens: promptTokens,
      estimatedCompletionTokens: completionTokens,
      estimatedTotalTokens: promptTokens + completionTokens,
      estimatedCost: {
        prompt: promptCost,
        completion: completionCost,
        total: promptCost + completionCost,
        currency: pricing.currency
      },
      confidence: 0.7
      // 70% confidence in estimation
    };
  }
  /**
   * Simple token estimation (4 chars = 1 token approximation)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
  /**
   * Get usage statistics
   */
  async getUsage(period = "day") {
    const now = /* @__PURE__ */ new Date();
    const start = this.getStartDate(now, period);
    return {
      period: { start, end: now },
      requests: this.requestCount,
      tokens: {
        prompt: Math.floor(this.totalTokens * 0.7),
        // Estimate
        completion: Math.floor(this.totalTokens * 0.3),
        total: this.totalTokens
      },
      cost: {
        prompt: this.totalCost * 0.7,
        completion: this.totalCost * 0.3,
        total: this.totalCost,
        currency: "USD"
      },
      errors: this.errorCount,
      averageLatency: this.calculateAverageLatency(),
      modelBreakdown: {}
      // Would need to track per model
    };
  }
  /**
   * Get start date for period
   */
  getStartDate(end, period) {
    const start = new Date(end);
    switch (period) {
      case "hour":
        start.setHours(start.getHours() - 1);
        break;
      case "day":
        start.setDate(start.getDate() - 1);
        break;
      case "week":
        start.setDate(start.getDate() - 7);
        break;
      case "month":
        start.setMonth(start.getMonth() - 1);
        break;
      case "all":
        start.setFullYear(2020);
        break;
    }
    return start;
  }
  /**
   * Calculate average latency
   */
  calculateAverageLatency() {
    if (this.requestMetrics.size === 0)
      return 0;
    let totalLatency = 0;
    let count = 0;
    this.requestMetrics.forEach((metrics) => {
      if (metrics.latency) {
        totalLatency += metrics.latency;
        count++;
      }
    });
    return count > 0 ? totalLatency / count : 0;
  }
  /**
   * Track successful request
   */
  trackRequest(request, response, latency) {
    this.requestCount++;
    this.totalTokens += response.usage.totalTokens;
    if (response.cost) {
      this.totalCost += response.cost.totalCost;
    }
    const requestId = response.id;
    this.requestMetrics.set(requestId, {
      timestamp: /* @__PURE__ */ new Date(),
      model: response.model,
      tokens: response.usage.totalTokens,
      cost: response.cost?.totalCost,
      latency
    });
    if (this.requestMetrics.size > 1e3) {
      const oldestKey = this.requestMetrics.keys().next().value;
      this.requestMetrics.delete(oldestKey);
    }
  }
  /**
   * Track streaming request
   */
  trackStreamRequest(request, totalTokens, totalCost, latency) {
    this.requestCount++;
    this.totalTokens += totalTokens;
    this.totalCost += totalCost;
    const requestId = `stream-${Date.now()}`;
    this.requestMetrics.set(requestId, {
      timestamp: /* @__PURE__ */ new Date(),
      model: request.model || this.config.model,
      tokens: totalTokens,
      cost: totalCost,
      latency,
      stream: true
    });
  }
  /**
   * Transform errors to provider errors
   */
  transformError(error) {
    if (error instanceof import_types.LLMProviderError) {
      return error;
    }
    if (error instanceof Error) {
      if (error.message.includes("rate limit")) {
        return new import_types.RateLimitError(error.message, this.name);
      }
      if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
        return new import_types.LLMProviderError(
          "Request timed out",
          "TIMEOUT",
          this.name,
          void 0,
          true
        );
      }
      if (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed")) {
        return new import_types.ProviderUnavailableError(this.name, { originalError: error.message });
      }
    }
    return new import_types.LLMProviderError(
      error instanceof Error ? error.message : String(error),
      "UNKNOWN",
      this.name,
      void 0,
      true
    );
  }
  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    const interval = this.config.cacheTimeout || 3e5;
    this.healthCheckInterval = setInterval(() => {
      this.healthCheck().catch((error) => {
        this.logger.error(`Health check failed for ${this.name}`, error);
      });
    }, interval);
  }
  /**
   * Clean up resources
   */
  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.requestMetrics.clear();
    this.removeAllListeners();
    this.logger.info(`${this.name} provider destroyed`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BaseProvider
});
//# sourceMappingURL=base-provider.js.map
