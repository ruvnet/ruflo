import { EventEmitter } from 'events';
import { ClaudeAPIError, ClaudeInternalServerError, ClaudeServiceUnavailableError, ClaudeRateLimitError, ClaudeTimeoutError, ClaudeNetworkError, ClaudeAuthenticationError, ClaudeValidationError, getUserFriendlyError } from './claude-api-errors.js';
import { circuitBreaker } from '../utils/helpers.js';
export class ClaudeAPIClient extends EventEmitter {
    config;
    logger;
    configManager;
    defaultModel = 'claude-3-sonnet-20240229';
    defaultTemperature = 0.7;
    defaultMaxTokens = 4096;
    circuitBreaker;
    lastHealthCheck;
    healthCheckTimer;
    constructor(logger, configManager, config){
        super();
        this.logger = logger;
        this.configManager = configManager;
        this.config = this.loadConfiguration(config);
        this.circuitBreaker = circuitBreaker('claude-api', {
            threshold: this.config.circuitBreakerThreshold || 5,
            timeout: this.config.circuitBreakerTimeout || 60000,
            resetTimeout: this.config.circuitBreakerResetTimeout || 300000
        });
        if (this.config.enableHealthCheck) {
            this.startHealthCheck();
        }
    }
    loadConfiguration(overrides) {
        const config = {
            apiKey: '',
            apiUrl: 'https://api.anthropic.com/v1/messages',
            model: this.defaultModel,
            temperature: this.defaultTemperature,
            maxTokens: this.defaultMaxTokens,
            topP: 1,
            topK: undefined,
            systemPrompt: undefined,
            timeout: 60000,
            retryAttempts: 3,
            retryDelay: 1000,
            enableHealthCheck: false,
            healthCheckInterval: 300000,
            circuitBreakerThreshold: 5,
            circuitBreakerTimeout: 60000,
            circuitBreakerResetTimeout: 300000,
            retryJitter: true
        };
        if (process.env.ANTHROPIC_API_KEY) {
            config.apiKey = process.env.ANTHROPIC_API_KEY;
        }
        if (process.env.CLAUDE_API_URL) {
            config.apiUrl = process.env.CLAUDE_API_URL;
        }
        if (process.env.CLAUDE_MODEL) {
            config.model = process.env.CLAUDE_MODEL;
        }
        if (process.env.CLAUDE_TEMPERATURE) {
            config.temperature = parseFloat(process.env.CLAUDE_TEMPERATURE);
        }
        if (process.env.CLAUDE_MAX_TOKENS) {
            config.maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS, 10);
        }
        const claudeConfig = this.configManager.get('claude');
        if (claudeConfig) {
            Object.assign(config, claudeConfig);
        }
        if (overrides) {
            Object.assign(config, overrides);
        }
        this.validateConfiguration(config);
        return config;
    }
    validateConfiguration(config) {
        if (!config.apiKey) {
            throw new ClaudeAuthenticationError('Claude API key is required. Set ANTHROPIC_API_KEY environment variable.');
        }
        if (config.temperature !== undefined) {
            if (config.temperature < 0 || config.temperature > 1) {
                throw new ClaudeValidationError('Temperature must be between 0 and 1');
            }
        }
        if (config.topP !== undefined) {
            if (config.topP < 0 || config.topP > 1) {
                throw new ClaudeValidationError('Top-p must be between 0 and 1');
            }
        }
        if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 100000)) {
            throw new ClaudeValidationError('Max tokens must be between 1 and 100000');
        }
    }
    updateConfig(updates) {
        this.config = {
            ...this.config,
            ...updates
        };
        this.validateConfiguration(this.config);
        this.logger.info('Claude API configuration updated', {
            model: this.config.model,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens
        });
    }
    getConfig() {
        return {
            ...this.config
        };
    }
    async sendMessage(messages, options) {
        const request = {
            model: options?.model || this.config.model || 'claude-3-opus-20240229',
            messages,
            system: options?.systemPrompt || this.config.systemPrompt,
            max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
            temperature: options?.temperature ?? this.config.temperature,
            top_p: this.config.topP,
            top_k: this.config.topK,
            stream: options?.stream || false
        };
        this.logger.debug('Sending Claude API request', {
            model: request.model,
            temperature: request.temperature,
            maxTokens: request.max_tokens,
            messageCount: messages.length,
            stream: request.stream
        });
        if (request.stream) {
            return this.streamRequest(request);
        } else {
            return this.sendRequest(request);
        }
    }
    async sendRequest(request) {
        let lastError;
        for(let attempt = 0; attempt < (this.config.retryAttempts || 3); attempt++){
            try {
                const controller = new AbortController();
                const timeout = setTimeout(()=>controller.abort(), this.config.timeout || 30000);
                const response = await fetch(this.config.apiUrl || 'https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01',
                        'x-api-key': this.config.apiKey
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
                    } catch  {
                        errorData = {
                            message: errorText
                        };
                    }
                    throw this.createAPIError(response.status, errorData);
                }
                const data = await response.json();
                this.logger.info('Claude API response received', {
                    model: data.model,
                    inputTokens: data.usage.input_tokens,
                    outputTokens: data.usage.output_tokens,
                    stopReason: data.stop_reason
                });
                this.emit('response', data);
                return data;
            } catch (error) {
                lastError = this.transformError(error);
                if (!lastError.retryable) {
                    this.handleError(lastError);
                    throw lastError;
                }
                this.logger.warn(`Claude API request failed (attempt ${attempt + 1}/${this.config.retryAttempts})`, {
                    error: lastError.message,
                    statusCode: lastError.statusCode,
                    retryable: lastError.retryable
                });
                if (attempt < (this.config.retryAttempts || 3) - 1) {
                    const delay = this.calculateRetryDelay(attempt, lastError);
                    await this.delay(delay);
                }
            }
        }
        this.handleError(lastError);
        throw lastError;
    }
    async *streamRequest(request) {
        const controller = new AbortController();
        const timeout = setTimeout(()=>controller.abort(), (this.config.timeout || 30000) * 2);
        try {
            const response = await fetch(this.config.apiUrl || 'https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01',
                    'x-api-key': this.config.apiKey
                },
                body: JSON.stringify({
                    ...request,
                    stream: true
                }),
                signal: controller.signal
            });
            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch  {
                    errorData = {
                        message: errorText
                    };
                }
                throw this.createAPIError(response.status, errorData);
            }
            if (!response.body) {
                throw new ClaudeAPIError('Response body is null');
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while(true){
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {
                    stream: true
                });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines){
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const event = JSON.parse(data);
                            this.emit('stream_event', event);
                            yield event;
                        } catch (e) {
                            this.logger.warn('Failed to parse stream event', {
                                data,
                                error: e
                            });
                        }
                    }
                }
            }
        } catch (error) {
            clearTimeout(timeout);
            if (error instanceof Error && error.name === 'AbortError') {
                throw new ClaudeTimeoutError('Request timed out', this.config.timeout || 60000);
            }
            throw error;
        } finally{
            clearTimeout(timeout);
        }
    }
    async complete(prompt, options) {
        const messages = [
            {
                role: 'user',
                content: prompt
            }
        ];
        const response = await this.sendMessage(messages, options);
        return response.content[0].text;
    }
    async *streamComplete(prompt, options) {
        const messages = [
            {
                role: 'user',
                content: prompt
            }
        ];
        const stream = await this.sendMessage(messages, {
            ...options,
            stream: true
        });
        for await (const event of stream){
            if (event.type === 'content_block_delta' && event.delta?.text) {
                yield event.delta.text;
            }
        }
    }
    getAvailableModels() {
        return [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-2.1',
            'claude-2.0',
            'claude-instant-1.2'
        ];
    }
    getModelInfo(model) {
        const modelInfo = {
            'claude-3-opus-20240229': {
                name: 'Claude 3 Opus',
                contextWindow: 200000,
                description: 'Most capable model, best for complex tasks'
            },
            'claude-3-sonnet-20240229': {
                name: 'Claude 3 Sonnet',
                contextWindow: 200000,
                description: 'Balanced performance and speed'
            },
            'claude-3-haiku-20240307': {
                name: 'Claude 3 Haiku',
                contextWindow: 200000,
                description: 'Fastest model, best for simple tasks'
            },
            'claude-2.1': {
                name: 'Claude 2.1',
                contextWindow: 200000,
                description: 'Previous generation, enhanced capabilities'
            },
            'claude-2.0': {
                name: 'Claude 2.0',
                contextWindow: 100000,
                description: 'Previous generation model'
            },
            'claude-instant-1.2': {
                name: 'Claude Instant 1.2',
                contextWindow: 100000,
                description: 'Fast, cost-effective model'
            }
        };
        return modelInfo[model] || {
            name: model,
            contextWindow: 100000,
            description: 'Unknown model'
        };
    }
    delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
    startHealthCheck() {
        this.performHealthCheck();
        this.healthCheckTimer = setInterval(()=>this.performHealthCheck(), this.config.healthCheckInterval || 300000);
    }
    async performHealthCheck() {
        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timeout = setTimeout(()=>controller.abort(), 10000);
            const response = await fetch(this.config.apiUrl || '', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01',
                    'x-api-key': this.config.apiKey
                },
                body: JSON.stringify({
                    model: this.config.model,
                    messages: [
                        {
                            role: 'user',
                            content: 'Hi'
                        }
                    ],
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
                error: healthy ? undefined : `Status: ${response.status}`,
                timestamp: new Date()
            };
            this.logger.debug('Claude API health check completed', this.lastHealthCheck);
            this.emit('health_check', this.lastHealthCheck);
            return this.lastHealthCheck;
        } catch (error) {
            const latency = Date.now() - startTime;
            this.lastHealthCheck = {
                healthy: false,
                latency,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            };
            this.logger.warn('Claude API health check failed', this.lastHealthCheck);
            this.emit('health_check', this.lastHealthCheck);
            return this.lastHealthCheck;
        }
    }
    getHealthStatus() {
        return this.lastHealthCheck;
    }
    createAPIError(statusCode, errorData) {
        const message = errorData.error?.message || errorData.message || 'Unknown error';
        switch(statusCode){
            case 400:
                return new ClaudeValidationError(message, errorData);
            case 401:
            case 403:
                return new ClaudeAuthenticationError(message, errorData);
            case 429:
                const retryAfter = errorData.error?.retry_after;
                return new ClaudeRateLimitError(message, retryAfter, errorData);
            case 500:
                return new ClaudeInternalServerError(message, errorData);
            case 503:
                return new ClaudeServiceUnavailableError(message, errorData);
            default:
                return new ClaudeAPIError(message, statusCode, statusCode >= 500, errorData);
        }
    }
    transformError(error) {
        if (error instanceof ClaudeAPIError) {
            return error;
        }
        if (error instanceof Error) {
            if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
                return new ClaudeNetworkError(error.message);
            }
            if (error.name === 'AbortError' || error.message.includes('timeout')) {
                return new ClaudeTimeoutError(error.message, this.config.timeout || 60000);
            }
        }
        return new ClaudeAPIError(error instanceof Error ? error.message : String(error), undefined, true);
    }
    calculateRetryDelay(attempt, error) {
        if (error instanceof ClaudeRateLimitError && error.retryAfter) {
            return error.retryAfter * 1000;
        }
        const baseDelay = this.config.retryDelay || 1000;
        const maxDelay = 30000;
        let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        if (this.config.retryJitter) {
            const jitter = Math.random() * 0.3 * delay;
            delay = delay + jitter;
        }
        return Math.floor(delay);
    }
    handleError(error) {
        const errorInfo = getUserFriendlyError(error);
        this.logger.error(`${errorInfo.title}: ${errorInfo.message}`, {
            error: error.message,
            code: error.code,
            statusCode: error.statusCode,
            retryable: error.retryable,
            details: error.details
        });
        if (this.logger.level === 'debug' && errorInfo.suggestions.length > 0) {
            this.logger.debug('Suggestions to resolve the issue:', errorInfo.suggestions);
        }
        this.emit('error', {
            error,
            userFriendly: errorInfo
        });
    }
    destroy() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
        this.removeAllListeners();
    }
}

//# sourceMappingURL=claude-client.js.map