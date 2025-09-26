export class LLMProviderError extends Error {
    code;
    provider;
    statusCode;
    retryable;
    details;
    constructor(message, code, provider, statusCode, retryable = true, details){
        super(message), this.code = code, this.provider = provider, this.statusCode = statusCode, this.retryable = retryable, this.details = details;
        this.name = 'LLMProviderError';
    }
}
export class RateLimitError extends LLMProviderError {
    retryAfter;
    constructor(message, provider, retryAfter, details){
        super(message, 'RATE_LIMIT', provider, 429, true, details), this.retryAfter = retryAfter;
        this.name = 'RateLimitError';
    }
}
export class AuthenticationError extends LLMProviderError {
    constructor(message, provider, details){
        super(message, 'AUTHENTICATION', provider, 401, false, details);
        this.name = 'AuthenticationError';
    }
}
export class ModelNotFoundError extends LLMProviderError {
    constructor(model, provider, details){
        super(`Model ${model} not found`, 'MODEL_NOT_FOUND', provider, 404, false, details);
        this.name = 'ModelNotFoundError';
    }
}
export class ProviderUnavailableError extends LLMProviderError {
    constructor(provider, details){
        super(`Provider ${provider} is unavailable`, 'PROVIDER_UNAVAILABLE', provider, 503, true, details);
        this.name = 'ProviderUnavailableError';
    }
}
export function isLLMResponse(obj) {
    return obj && typeof obj.id === 'string' && typeof obj.content === 'string';
}
export function isLLMStreamEvent(obj) {
    return obj && typeof obj.type === 'string';
}
export function isLLMProviderError(error) {
    return error instanceof LLMProviderError;
}
export function isRateLimitError(error) {
    return error instanceof RateLimitError;
}

//# sourceMappingURL=types.js.map