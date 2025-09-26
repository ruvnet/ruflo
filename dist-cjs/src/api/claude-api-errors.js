import { ClaudeFlowError } from '../utils/errors.js';
export class ClaudeAPIError extends ClaudeFlowError {
    statusCode;
    retryable;
    constructor(message, statusCode, retryable = false, details){
        super(message, 'CLAUDE_API_ERROR', details), this.statusCode = statusCode, this.retryable = retryable;
        this.name = 'ClaudeAPIError';
    }
}
export class ClaudeInternalServerError extends ClaudeAPIError {
    constructor(message, details){
        super(message || 'Claude API internal server error. The service may be temporarily unavailable.', 500, true, details);
        this.name = 'ClaudeInternalServerError';
    }
}
export class ClaudeServiceUnavailableError extends ClaudeAPIError {
    constructor(message, details){
        super(message || 'Claude API service is temporarily unavailable. Please try again later.', 503, true, details);
        this.name = 'ClaudeServiceUnavailableError';
    }
}
export class ClaudeRateLimitError extends ClaudeAPIError {
    retryAfter;
    constructor(message, retryAfter, details){
        super(message || 'Rate limit exceeded. Please wait before making more requests.', 429, true, details), this.retryAfter = retryAfter;
        this.name = 'ClaudeRateLimitError';
    }
}
export class ClaudeTimeoutError extends ClaudeAPIError {
    timeout;
    constructor(message, timeout, details){
        super(message || `Request timed out after ${timeout}ms. The API may be slow or unreachable.`, undefined, true, details), this.timeout = timeout;
        this.name = 'ClaudeTimeoutError';
    }
}
export class ClaudeNetworkError extends ClaudeAPIError {
    constructor(message, details){
        super(message || 'Network error occurred. Please check your internet connection.', undefined, true, details);
        this.name = 'ClaudeNetworkError';
    }
}
export class ClaudeAuthenticationError extends ClaudeAPIError {
    constructor(message, details){
        super(message || 'Authentication failed. Please check your API key.', 401, false, details);
        this.name = 'ClaudeAuthenticationError';
    }
}
export class ClaudeValidationError extends ClaudeAPIError {
    constructor(message, details){
        super(message || 'Invalid request. Please check your parameters.', 400, false, details);
        this.name = 'ClaudeValidationError';
    }
}
export const ERROR_MESSAGES = {
    INTERNAL_SERVER_ERROR: {
        title: 'Claude API Service Error',
        message: 'The Claude API is experiencing technical difficulties.',
        suggestions: [
            'Wait a few minutes and try again',
            'Check the Anthropic status page for service updates',
            'Consider using a fallback AI service if available',
            'Cache previous responses for offline usage'
        ]
    },
    SERVICE_UNAVAILABLE: {
        title: 'Service Temporarily Unavailable',
        message: 'Claude API is temporarily unavailable or undergoing maintenance.',
        suggestions: [
            'Try again in 5-10 minutes',
            'Check if there\'s scheduled maintenance',
            'Use cached responses if available',
            'Consider implementing a queue for requests'
        ]
    },
    RATE_LIMIT: {
        title: 'Rate Limit Exceeded',
        message: 'You\'ve made too many requests to the Claude API.',
        suggestions: [
            'Implement request throttling',
            'Batch multiple requests together',
            'Consider upgrading your API plan',
            'Use exponential backoff for retries'
        ]
    },
    TIMEOUT: {
        title: 'Request Timeout',
        message: 'The request took too long to complete.',
        suggestions: [
            'Check your internet connection',
            'Try a simpler request',
            'Increase the timeout duration',
            'Break large requests into smaller ones'
        ]
    },
    NETWORK_ERROR: {
        title: 'Network Connection Error',
        message: 'Unable to connect to the Claude API.',
        suggestions: [
            'Check your internet connection',
            'Verify firewall/proxy settings',
            'Try using a different network',
            'Check if the API endpoint is correct'
        ]
    },
    AUTHENTICATION: {
        title: 'Authentication Failed',
        message: 'Unable to authenticate with the Claude API.',
        suggestions: [
            'Verify your API key is correct',
            'Check if your API key has expired',
            'Ensure the API key has proper permissions',
            'Generate a new API key if needed'
        ]
    },
    VALIDATION: {
        title: 'Invalid Request',
        message: 'The request contains invalid parameters.',
        suggestions: [
            'Check the request parameters',
            'Verify the model name is correct',
            'Ensure message format is valid',
            'Review the API documentation'
        ]
    }
};
export function getUserFriendlyError(error) {
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

//# sourceMappingURL=claude-api-errors.js.map