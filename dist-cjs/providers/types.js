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
var types_exports = {};
__export(types_exports, {
  AuthenticationError: () => AuthenticationError,
  LLMProviderError: () => LLMProviderError,
  ModelNotFoundError: () => ModelNotFoundError,
  ProviderUnavailableError: () => ProviderUnavailableError,
  RateLimitError: () => RateLimitError,
  isLLMProviderError: () => isLLMProviderError,
  isLLMResponse: () => isLLMResponse,
  isLLMStreamEvent: () => isLLMStreamEvent,
  isRateLimitError: () => isRateLimitError
});
module.exports = __toCommonJS(types_exports);
class LLMProviderError extends Error {
  constructor(message, code, provider, statusCode, retryable = true, details) {
    super(message);
    this.code = code;
    this.provider = provider;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
    this.name = "LLMProviderError";
  }
  static {
    __name(this, "LLMProviderError");
  }
}
class RateLimitError extends LLMProviderError {
  constructor(message, provider, retryAfter, details) {
    super(message, "RATE_LIMIT", provider, 429, true, details);
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
  static {
    __name(this, "RateLimitError");
  }
}
class AuthenticationError extends LLMProviderError {
  static {
    __name(this, "AuthenticationError");
  }
  constructor(message, provider, details) {
    super(message, "AUTHENTICATION", provider, 401, false, details);
    this.name = "AuthenticationError";
  }
}
class ModelNotFoundError extends LLMProviderError {
  static {
    __name(this, "ModelNotFoundError");
  }
  constructor(model, provider, details) {
    super(`Model ${model} not found`, "MODEL_NOT_FOUND", provider, 404, false, details);
    this.name = "ModelNotFoundError";
  }
}
class ProviderUnavailableError extends LLMProviderError {
  static {
    __name(this, "ProviderUnavailableError");
  }
  constructor(provider, details) {
    super(`Provider ${provider} is unavailable`, "PROVIDER_UNAVAILABLE", provider, 503, true, details);
    this.name = "ProviderUnavailableError";
  }
}
function isLLMResponse(obj) {
  return obj && typeof obj.id === "string" && typeof obj.content === "string";
}
__name(isLLMResponse, "isLLMResponse");
function isLLMStreamEvent(obj) {
  return obj && typeof obj.type === "string";
}
__name(isLLMStreamEvent, "isLLMStreamEvent");
function isLLMProviderError(error) {
  return error instanceof LLMProviderError;
}
__name(isLLMProviderError, "isLLMProviderError");
function isRateLimitError(error) {
  return error instanceof RateLimitError;
}
__name(isRateLimitError, "isRateLimitError");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthenticationError,
  LLMProviderError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  isLLMProviderError,
  isLLMResponse,
  isLLMStreamEvent,
  isRateLimitError
});
//# sourceMappingURL=types.js.map
