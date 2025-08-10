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
var claude_api_errors_exports = {};
__export(claude_api_errors_exports, {
  ClaudeAPIError: () => ClaudeAPIError,
  ClaudeAuthenticationError: () => ClaudeAuthenticationError,
  ClaudeInternalServerError: () => ClaudeInternalServerError,
  ClaudeNetworkError: () => ClaudeNetworkError,
  ClaudeRateLimitError: () => ClaudeRateLimitError,
  ClaudeServiceUnavailableError: () => ClaudeServiceUnavailableError,
  ClaudeTimeoutError: () => ClaudeTimeoutError,
  ClaudeValidationError: () => ClaudeValidationError,
  ERROR_MESSAGES: () => ERROR_MESSAGES,
  getUserFriendlyError: () => getUserFriendlyError
});
module.exports = __toCommonJS(claude_api_errors_exports);
var import_errors = require("../utils/errors.js");
class ClaudeAPIError extends import_errors.ClaudeFlowError {
  constructor(message, statusCode, retryable = false, details) {
    super(message, "CLAUDE_API_ERROR", details);
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.name = "ClaudeAPIError";
  }
  static {
    __name(this, "ClaudeAPIError");
  }
}
class ClaudeInternalServerError extends ClaudeAPIError {
  static {
    __name(this, "ClaudeInternalServerError");
  }
  constructor(message, details) {
    super(
      message || "Claude API internal server error. The service may be temporarily unavailable.",
      500,
      true,
      // Retryable
      details
    );
    this.name = "ClaudeInternalServerError";
  }
}
class ClaudeServiceUnavailableError extends ClaudeAPIError {
  static {
    __name(this, "ClaudeServiceUnavailableError");
  }
  constructor(message, details) {
    super(
      message || "Claude API service is temporarily unavailable. Please try again later.",
      503,
      true,
      // Retryable
      details
    );
    this.name = "ClaudeServiceUnavailableError";
  }
}
class ClaudeRateLimitError extends ClaudeAPIError {
  constructor(message, retryAfter, details) {
    super(
      message || "Rate limit exceeded. Please wait before making more requests.",
      429,
      true,
      // Retryable
      details
    );
    this.retryAfter = retryAfter;
    this.name = "ClaudeRateLimitError";
  }
  static {
    __name(this, "ClaudeRateLimitError");
  }
}
class ClaudeTimeoutError extends ClaudeAPIError {
  constructor(message, timeout, details) {
    super(
      message || `Request timed out after ${timeout}ms. The API may be slow or unreachable.`,
      void 0,
      true,
      // Retryable
      details
    );
    this.timeout = timeout;
    this.name = "ClaudeTimeoutError";
  }
  static {
    __name(this, "ClaudeTimeoutError");
  }
}
class ClaudeNetworkError extends ClaudeAPIError {
  static {
    __name(this, "ClaudeNetworkError");
  }
  constructor(message, details) {
    super(
      message || "Network error occurred. Please check your internet connection.",
      void 0,
      true,
      // Retryable
      details
    );
    this.name = "ClaudeNetworkError";
  }
}
class ClaudeAuthenticationError extends ClaudeAPIError {
  static {
    __name(this, "ClaudeAuthenticationError");
  }
  constructor(message, details) {
    super(
      message || "Authentication failed. Please check your API key.",
      401,
      false,
      // Not retryable
      details
    );
    this.name = "ClaudeAuthenticationError";
  }
}
class ClaudeValidationError extends ClaudeAPIError {
  static {
    __name(this, "ClaudeValidationError");
  }
  constructor(message, details) {
    super(
      message || "Invalid request. Please check your parameters.",
      400,
      false,
      // Not retryable
      details
    );
    this.name = "ClaudeValidationError";
  }
}
const ERROR_MESSAGES = {
  INTERNAL_SERVER_ERROR: {
    title: "Claude API Service Error",
    message: "The Claude API is experiencing technical difficulties.",
    suggestions: [
      "Wait a few minutes and try again",
      "Check the Anthropic status page for service updates",
      "Consider using a fallback AI service if available",
      "Cache previous responses for offline usage"
    ]
  },
  SERVICE_UNAVAILABLE: {
    title: "Service Temporarily Unavailable",
    message: "Claude API is temporarily unavailable or undergoing maintenance.",
    suggestions: [
      "Try again in 5-10 minutes",
      "Check if there's scheduled maintenance",
      "Use cached responses if available",
      "Consider implementing a queue for requests"
    ]
  },
  RATE_LIMIT: {
    title: "Rate Limit Exceeded",
    message: "You've made too many requests to the Claude API.",
    suggestions: [
      "Implement request throttling",
      "Batch multiple requests together",
      "Consider upgrading your API plan",
      "Use exponential backoff for retries"
    ]
  },
  TIMEOUT: {
    title: "Request Timeout",
    message: "The request took too long to complete.",
    suggestions: [
      "Check your internet connection",
      "Try a simpler request",
      "Increase the timeout duration",
      "Break large requests into smaller ones"
    ]
  },
  NETWORK_ERROR: {
    title: "Network Connection Error",
    message: "Unable to connect to the Claude API.",
    suggestions: [
      "Check your internet connection",
      "Verify firewall/proxy settings",
      "Try using a different network",
      "Check if the API endpoint is correct"
    ]
  },
  AUTHENTICATION: {
    title: "Authentication Failed",
    message: "Unable to authenticate with the Claude API.",
    suggestions: [
      "Verify your API key is correct",
      "Check if your API key has expired",
      "Ensure the API key has proper permissions",
      "Generate a new API key if needed"
    ]
  },
  VALIDATION: {
    title: "Invalid Request",
    message: "The request contains invalid parameters.",
    suggestions: [
      "Check the request parameters",
      "Verify the model name is correct",
      "Ensure message format is valid",
      "Review the API documentation"
    ]
  }
};
function getUserFriendlyError(error) {
  let errorInfo = ERROR_MESSAGES.INTERNAL_SERVER_ERROR;
  if (error instanceof ClaudeInternalServerError) {
    errorInfo = ERROR_MESSAGES.INTERNAL_SERVER_ERROR;
  } else if (error instanceof ClaudeServiceUnavailableError) {
    errorInfo = ERROR_MESSAGES.SERVICE_UNAVAILABLE;
  } else if (error instanceof ClaudeRateLimitError) {
    errorInfo = ERROR_MESSAGES.RATE_LIMIT;
  } else if (error instanceof ClaudeTimeoutError) {
    errorInfo = ERROR_MESSAGES.TIMEOUT;
  } else if (error instanceof ClaudeNetworkError) {
    errorInfo = ERROR_MESSAGES.NETWORK_ERROR;
  } else if (error instanceof ClaudeAuthenticationError) {
    errorInfo = ERROR_MESSAGES.AUTHENTICATION;
  } else if (error instanceof ClaudeValidationError) {
    errorInfo = ERROR_MESSAGES.VALIDATION;
  }
  return {
    ...errorInfo,
    retryable: error.retryable
  };
}
__name(getUserFriendlyError, "getUserFriendlyError");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ClaudeAPIError,
  ClaudeAuthenticationError,
  ClaudeInternalServerError,
  ClaudeNetworkError,
  ClaudeRateLimitError,
  ClaudeServiceUnavailableError,
  ClaudeTimeoutError,
  ClaudeValidationError,
  ERROR_MESSAGES,
  getUserFriendlyError
});
//# sourceMappingURL=claude-api-errors.js.map
