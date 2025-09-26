import { EventEmitter } from 'events';
import { circuitBreaker } from '../utils/helpers.js';
import { LLMProviderError, RateLimitError, ProviderUnavailableError } from './types.js';
export class BaseProvider extends EventEmitter {
    logger;
    circuitBreaker;
    healthCheckInterval;
    lastHealthCheck;
    requestCount = 0;
    errorCount = 0;
    totalTokens = 0;
    totalCost = 0;
    requestMetrics = new Map();
    config;
    constructor(options){
        super();
        this.logger = options.logger;
        this.config = options.config;
        this.circuitBreaker = circuitBreaker(`llm-${this.name}`, {
            threshold: options.circuitBreakerOptions?.threshold || 5,
            timeout: options.circuitBreakerOptions?.timeout || 60000,
            resetTimeout: options.circuitBreakerOptions?.resetTimeout || 300000
        });
        if (this.config.enableCaching) {
            this.startHealthChecks();
        }
    }
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
    validateConfig() {
        if (!this.config.model) {
            throw new Error(`Model is required for ${this.name} provider`);
        }
        if (!this.validateModel(this.config.model)) {
            throw new Error(`Model ${this.config.model} is not supported by ${this.name} provider`);
        }
        if (this.config.temperature !== undefined) {
            if (this.config.temperature < 0 || this.config.temperature > 2) {
                throw new Error('Temperature must be between 0 and 2');
            }
        }
        if (this.config.maxTokens !== undefined) {
            const maxAllowed = this.capabilities.maxOutputTokens[this.config.model] || 4096;
            if (this.config.maxTokens > maxAllowed) {
                throw new Error(`Max tokens exceeds limit of ${maxAllowed} for model ${this.config.model}`);
            }
        }
    }
    async complete(request) {
        const startTime = Date.now();
        try {
            const response = await this.circuitBreaker.execute(async ()=>{
                return await this.doComplete(request);
            });
            const latency = Date.now() - startTime;
            this.trackRequest(request, response, latency);
            this.emit('response', {
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
            this.emit('error', {
                provider: this.name,
                error: providerError,
                request
            });
            throw providerError;
        }
    }
    async *streamComplete(request) {
        const startTime = Date.now();
        let totalTokens = 0;
        let totalCost = 0;
        try {
            if (!this.capabilities.supportsStreaming) {
                throw new LLMProviderError('Streaming not supported', 'STREAMING_NOT_SUPPORTED', this.name, undefined, false);
            }
            const stream = await this.circuitBreaker.execute(async ()=>{
                return this.doStreamComplete(request);
            });
            for await (const event of stream){
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
                type: 'error',
                error: providerError
            };
            throw providerError;
        }
    }
    validateModel(model) {
        return this.capabilities.supportedModels.includes(model);
    }
    async healthCheck() {
        const startTime = Date.now();
        try {
            const result = await this.doHealthCheck();
            this.lastHealthCheck = {
                ...result,
                latency: Date.now() - startTime,
                timestamp: new Date()
            };
            this.emit('health_check', this.lastHealthCheck);
            return this.lastHealthCheck;
        } catch (error) {
            this.lastHealthCheck = {
                healthy: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                latency: Date.now() - startTime,
                timestamp: new Date()
            };
            this.emit('health_check', this.lastHealthCheck);
            return this.lastHealthCheck;
        }
    }
    getStatus() {
        const queueLength = this.requestMetrics.size;
        const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
        return {
            available: this.lastHealthCheck?.healthy ?? false,
            currentLoad: queueLength / 100,
            queueLength,
            activeRequests: queueLength,
            rateLimitRemaining: this.getRateLimitRemaining(),
            rateLimitReset: this.getRateLimitReset()
        };
    }
    getRateLimitRemaining() {
        return undefined;
    }
    getRateLimitReset() {
        return undefined;
    }
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
                    currency: 'USD'
                },
                confidence: 0
            };
        }
        const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
        const completionTokens = request.maxTokens || this.config.maxTokens || 1000;
        const promptCost = promptTokens / 1000 * pricing.promptCostPer1k;
        const completionCost = completionTokens / 1000 * pricing.completionCostPer1k;
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
        };
    }
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }
    async getUsage(period = 'day') {
        const now = new Date();
        const start = this.getStartDate(now, period);
        return {
            period: {
                start,
                end: now
            },
            requests: this.requestCount,
            tokens: {
                prompt: Math.floor(this.totalTokens * 0.7),
                completion: Math.floor(this.totalTokens * 0.3),
                total: this.totalTokens
            },
            cost: {
                prompt: this.totalCost * 0.7,
                completion: this.totalCost * 0.3,
                total: this.totalCost,
                currency: 'USD'
            },
            errors: this.errorCount,
            averageLatency: this.calculateAverageLatency(),
            modelBreakdown: {}
        };
    }
    getStartDate(end, period) {
        const start = new Date(end);
        switch(period){
            case 'hour':
                start.setHours(start.getHours() - 1);
                break;
            case 'day':
                start.setDate(start.getDate() - 1);
                break;
            case 'week':
                start.setDate(start.getDate() - 7);
                break;
            case 'month':
                start.setMonth(start.getMonth() - 1);
                break;
            case 'all':
                start.setFullYear(2020);
                break;
        }
        return start;
    }
    calculateAverageLatency() {
        if (this.requestMetrics.size === 0) return 0;
        let totalLatency = 0;
        let count = 0;
        this.requestMetrics.forEach((metrics)=>{
            if (metrics.latency) {
                totalLatency += metrics.latency;
                count++;
            }
        });
        return count > 0 ? totalLatency / count : 0;
    }
    trackRequest(request, response, latency) {
        this.requestCount++;
        this.totalTokens += response.usage.totalTokens;
        if (response.cost) {
            this.totalCost += response.cost.totalCost;
        }
        const requestId = response.id;
        this.requestMetrics.set(requestId, {
            timestamp: new Date(),
            model: response.model,
            tokens: response.usage.totalTokens,
            cost: response.cost?.totalCost,
            latency
        });
        if (this.requestMetrics.size > 1000) {
            const oldestKey = this.requestMetrics.keys().next().value;
            this.requestMetrics.delete(oldestKey);
        }
    }
    trackStreamRequest(request, totalTokens, totalCost, latency) {
        this.requestCount++;
        this.totalTokens += totalTokens;
        this.totalCost += totalCost;
        const requestId = `stream-${Date.now()}`;
        this.requestMetrics.set(requestId, {
            timestamp: new Date(),
            model: request.model || this.config.model,
            tokens: totalTokens,
            cost: totalCost,
            latency,
            stream: true
        });
    }
    transformError(error) {
        if (error instanceof LLMProviderError) {
            return error;
        }
        if (error instanceof Error) {
            if (error.message.includes('rate limit')) {
                return new RateLimitError(error.message, this.name);
            }
            if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
                return new LLMProviderError('Request timed out', 'TIMEOUT', this.name, undefined, true);
            }
            if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
                return new ProviderUnavailableError(this.name, {
                    originalError: error.message
                });
            }
        }
        return new LLMProviderError(error instanceof Error ? error.message : String(error), 'UNKNOWN', this.name, undefined, true);
    }
    startHealthChecks() {
        const interval = this.config.cacheTimeout || 300000;
        this.healthCheckInterval = setInterval(()=>{
            this.healthCheck().catch((error)=>{
                this.logger.error(`Health check failed for ${this.name}`, error);
            });
        }, interval);
    }
    destroy() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        this.requestMetrics.clear();
        this.removeAllListeners();
        this.logger.info(`${this.name} provider destroyed`);
    }
}

//# sourceMappingURL=base-provider.js.map