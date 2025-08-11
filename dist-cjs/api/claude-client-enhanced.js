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
var claude_client_enhanced_exports = {};
__export(claude_client_enhanced_exports, {
  EnhancedClaudeAPIClient: () => EnhancedClaudeAPIClient
});
module.exports = __toCommonJS(claude_client_enhanced_exports);
var import_events = require("events");
var import_claude_api_errors = require("./claude-api-errors.js");
var import_helpers = require("../utils/helpers.js");
class EnhancedClaudeAPIClient extends import_events.EventEmitter {
  static {
    __name(this, "EnhancedClaudeAPIClient");
  }
  config;
  logger;
  configManager;
  circuitBreaker;
  lastHealthCheck;
  healthCheckTimer;
  constructor(logger, configManager, config) {
    super();
    this.logger = logger;
    this.configManager = configManager;
    this.config = this.loadConfiguration(config);
    this.circuitBreaker = (0, import_helpers.circuitBreaker)("claude-api", {
      threshold: this.config.circuitBreakerThreshold || 5,
      timeout: this.config.circuitBreakerTimeout || 6e4,
      resetTimeout: this.config.circuitBreakerResetTimeout || 3e5
    });
    if (this.config.enableHealthCheck) {
      this.startHealthCheck();
    }
  }
  /**
   * Load configuration with enhanced defaults
   */
  loadConfiguration(overrides) {
    const config = {
      apiKey: "",
      apiUrl: "https://api.anthropic.com/v1/messages",
      model: "claude-3-sonnet-20240229",
      temperature: 0.7,
      maxTokens: 4096,
      topP: 1,
      topK: void 0,
      systemPrompt: void 0,
      timeout: 6e4,
      retryAttempts: 3,
      retryDelay: 1e3,
      // Enhanced configurations
      enableHealthCheck: true,
      healthCheckInterval: 3e5,
      // 5 minutes
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 6e4,
      circuitBreakerResetTimeout: 3e5,
      maxRetries: 3,
      retryBaseDelay: 1e3,
      retryMaxDelay: 3e4,
      retryJitter: true
    };
    if (process.env.ANTHROPIC_API_KEY) {
      config.apiKey = process.env.ANTHROPIC_API_KEY;
    }
    const claudeConfig = this.configManager.get("claude");
    if (claudeConfig) {
      Object.assign(config, claudeConfig);
    }
    if (overrides) {
      Object.assign(config, overrides);
    }
    this.validateConfiguration(config);
    return config;
  }
  /**
   * Validate configuration
   */
  validateConfiguration(config) {
    if (!config.apiKey) {
      throw new import_claude_api_errors.ClaudeAuthenticationError("Claude API key is required. Set ANTHROPIC_API_KEY environment variable.");
    }
    if (config.temperature !== void 0 && (config.temperature < 0 || config.temperature > 1)) {
      throw new import_claude_api_errors.ClaudeValidationError("Temperature must be between 0 and 1");
    }
    if (config.maxTokens !== void 0 && (config.maxTokens < 1 || config.maxTokens > 1e5)) {
      throw new import_claude_api_errors.ClaudeValidationError("Max tokens must be between 1 and 100000");
    }
  }
  /**
   * Start periodic health checks
   */
  startHealthCheck() {
    this.performHealthCheck();
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      this.config.healthCheckInterval || 3e5
    );
  }
  /**
   * Perform a health check on the API
   */
  async performHealthCheck() {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1e4);
      const response = await fetch(this.config.apiUrl || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.config.apiKey
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      const healthy = response.ok || response.status === 429;
      this.lastHealthCheck = {
        healthy,
        latency,
        error: healthy ? void 0 : `Status: ${response.status}`,
        timestamp: /* @__PURE__ */ new Date()
      };
      this.logger.debug("Claude API health check completed", this.lastHealthCheck);
      this.emit("health_check", this.lastHealthCheck);
      return this.lastHealthCheck;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.lastHealthCheck = {
        healthy: false,
        latency,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: /* @__PURE__ */ new Date()
      };
      this.logger.warn("Claude API health check failed", this.lastHealthCheck);
      this.emit("health_check", this.lastHealthCheck);
      return this.lastHealthCheck;
    }
  }
  /**
   * Get last health check result
   */
  getHealthStatus() {
    return this.lastHealthCheck;
  }
  /**
   * Send a message with enhanced error handling
   */
  async sendMessage(messages, options) {
    const request = {
      model: options?.model || this.config.model || "claude-3-sonnet-20240229",
      messages,
      system: options?.systemPrompt || this.config.systemPrompt,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature,
      top_p: this.config.topP,
      top_k: this.config.topK,
      stream: options?.stream || false
    };
    this.logger.debug("Sending Claude API request", {
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.max_tokens,
      messageCount: messages.length,
      stream: request.stream
    });
    try {
      const result = await this.circuitBreaker.execute(async () => {
        if (request.stream) {
          return this.streamRequestWithRetry(request);
        } else {
          return this.sendRequestWithRetry(request);
        }
      });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Circuit breaker")) {
        const apiError = new import_claude_api_errors.ClaudeServiceUnavailableError(
          "Claude API is temporarily unavailable due to repeated failures. Please try again later."
        );
        this.handleError(apiError);
        throw apiError;
      }
      throw error;
    }
  }
  /**
   * Send request with retry logic and enhanced error handling
   */
  async sendRequestWithRetry(request) {
    let lastError;
    const maxRetries = this.config.maxRetries || 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.sendRequestOnce(request);
      } catch (error) {
        lastError = this.transformError(error);
        if (!lastError.retryable) {
          this.handleError(lastError);
          throw lastError;
        }
        this.logger.warn(
          `Claude API request failed (attempt ${attempt + 1}/${maxRetries})`,
          {
            error: lastError.message,
            statusCode: lastError.statusCode,
            retryable: lastError.retryable
          }
        );
        if (attempt < maxRetries - 1) {
          const delay = this.calculateRetryDelay(attempt, lastError);
          this.logger.info(`Retrying after ${delay}ms...`);
          await this.delay(delay);
        }
      }
    }
    this.handleError(lastError);
    throw lastError;
  }
  /**
   * Send a single request
   */
  async sendRequestOnce(request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 6e4);
    try {
      const response = await fetch(this.config.apiUrl || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.config.apiKey
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }
        throw this.createAPIError(response.status, errorData);
      }
      const data = await response.json();
      this.logger.info("Claude API response received", {
        model: data.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        stopReason: data.stop_reason
      });
      this.emit("response", data);
      return data;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") {
        throw new import_claude_api_errors.ClaudeTimeoutError(
          "Request timed out",
          this.config.timeout || 6e4
        );
      }
      throw error;
    }
  }
  /**
   * Stream request with retry logic
   */
  async *streamRequestWithRetry(request) {
    let lastError;
    const maxRetries = this.config.maxRetries || 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        yield* this.streamRequestOnce(request);
        return;
      } catch (error) {
        lastError = this.transformError(error);
        if (!lastError.retryable) {
          this.handleError(lastError);
          throw lastError;
        }
        this.logger.warn(
          `Claude API stream request failed (attempt ${attempt + 1}/${maxRetries})`,
          { error: lastError.message }
        );
        if (attempt < maxRetries - 1) {
          const delay = this.calculateRetryDelay(attempt, lastError);
          await this.delay(delay);
        }
      }
    }
    this.handleError(lastError);
    throw lastError;
  }
  /**
   * Send a single streaming request
   */
  async *streamRequestOnce(request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 6e4) * 2);
    try {
      const response = await fetch(this.config.apiUrl || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.config.apiKey
        },
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }
        throw this.createAPIError(response.status, errorData);
      }
      if (!response.body) {
        throw new import_claude_api_errors.ClaudeAPIError("Response body is null");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]")
              continue;
            try {
              const event = JSON.parse(data);
              this.emit("stream_event", event);
              yield event;
            } catch (e) {
              this.logger.warn("Failed to parse stream event", { data, error: e });
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  /**
   * Create appropriate error based on status code
   */
  createAPIError(statusCode, errorData) {
    const message = errorData.error?.message || errorData.message || "Unknown error";
    switch (statusCode) {
      case 400:
        return new import_claude_api_errors.ClaudeValidationError(message, errorData);
      case 401:
      case 403:
        return new import_claude_api_errors.ClaudeAuthenticationError(message, errorData);
      case 429:
        const retryAfter = errorData.error?.retry_after;
        return new import_claude_api_errors.ClaudeRateLimitError(message, retryAfter, errorData);
      case 500:
        return new import_claude_api_errors.ClaudeInternalServerError(message, errorData);
      case 503:
        return new import_claude_api_errors.ClaudeServiceUnavailableError(message, errorData);
      default:
        return new import_claude_api_errors.ClaudeAPIError(message, statusCode, statusCode >= 500, errorData);
    }
  }
  /**
   * Transform generic errors to Claude API errors
   */
  transformError(error) {
    if (error instanceof import_claude_api_errors.ClaudeAPIError) {
      return error;
    }
    if (error instanceof Error) {
      if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
        return new import_claude_api_errors.ClaudeNetworkError(error.message);
      }
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        return new import_claude_api_errors.ClaudeTimeoutError(error.message, this.config.timeout || 6e4);
      }
    }
    return new import_claude_api_errors.ClaudeAPIError(
      error instanceof Error ? error.message : String(error),
      void 0,
      true
      // Assume unknown errors are retryable
    );
  }
  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  calculateRetryDelay(attempt, error) {
    if (error instanceof import_claude_api_errors.ClaudeRateLimitError && error.retryAfter) {
      return error.retryAfter * 1e3;
    }
    const baseDelay = this.config.retryBaseDelay || 1e3;
    const maxDelay = this.config.retryMaxDelay || 3e4;
    let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    if (this.config.retryJitter) {
      const jitter = Math.random() * 0.3 * delay;
      delay = delay + jitter;
    }
    return Math.floor(delay);
  }
  /**
   * Handle errors with user-friendly messages and logging
   */
  handleError(error) {
    const errorInfo = (0, import_claude_api_errors.getUserFriendlyError)(error);
    this.logger.error(`${errorInfo.title}: ${errorInfo.message}`, {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      retryable: error.retryable,
      details: error.details
    });
    if (this.logger.level === "debug" && errorInfo.suggestions.length > 0) {
      this.logger.debug("Suggestions to resolve the issue:", errorInfo.suggestions);
    }
    this.emit("error", {
      error,
      userFriendly: errorInfo
    });
  }
  /**
   * Helper method for simple completions with error handling
   */
  async complete(prompt, options) {
    try {
      const messages = [{ role: "user", content: prompt }];
      const response = await this.sendMessage(messages, options);
      return response.content[0].text;
    } catch (error) {
      if (error instanceof import_claude_api_errors.ClaudeAPIError) {
        const errorInfo = (0, import_claude_api_errors.getUserFriendlyError)(error);
        throw new Error(`${errorInfo.title}: ${errorInfo.message}`);
      }
      throw error;
    }
  }
  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Clean up resources
   */
  destroy() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = void 0;
    }
    this.removeAllListeners();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EnhancedClaudeAPIClient
});
//# sourceMappingURL=claude-client-enhanced.js.map
