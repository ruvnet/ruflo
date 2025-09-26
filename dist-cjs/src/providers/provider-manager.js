import { EventEmitter } from 'events';
import { LLMProviderError, isRateLimitError } from './types.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GoogleProvider } from './google-provider.js';
import { CohereProvider } from './cohere-provider.js';
import { OllamaProvider } from './ollama-provider.js';
export class ProviderManager extends EventEmitter {
    providers = new Map();
    logger;
    config;
    requestCount = new Map();
    lastUsed = new Map();
    providerMetrics = new Map();
    cache = new Map();
    currentProviderIndex = 0;
    constructor(logger, configManager, config){
        super();
        this.logger = logger;
        this.config = config;
        this.initializeProviders();
        if (config.monitoring?.enabled) {
            this.startMonitoring();
        }
    }
    async initializeProviders() {
        for (const [providerName, providerConfig] of Object.entries(this.config.providers)){
            try {
                const provider = await this.createProvider(providerName, providerConfig);
                if (provider) {
                    this.providers.set(providerName, provider);
                    this.requestCount.set(providerName, 0);
                    this.logger.info(`Initialized ${providerName} provider`);
                }
            } catch (error) {
                this.logger.error(`Failed to initialize ${providerName} provider`, error);
            }
        }
        if (this.providers.size === 0) {
            throw new Error('No providers could be initialized');
        }
    }
    async createProvider(name, config) {
        const providerOptions = {
            logger: this.logger,
            config
        };
        try {
            let provider;
            switch(name){
                case 'anthropic':
                    provider = new AnthropicProvider(providerOptions);
                    break;
                case 'openai':
                    provider = new OpenAIProvider(providerOptions);
                    break;
                case 'google':
                    provider = new GoogleProvider(providerOptions);
                    break;
                case 'cohere':
                    provider = new CohereProvider(providerOptions);
                    break;
                case 'ollama':
                    provider = new OllamaProvider(providerOptions);
                    break;
                default:
                    this.logger.warn(`Unknown provider: ${name}`);
                    return null;
            }
            await provider.initialize();
            provider.on('response', (data)=>this.handleProviderResponse(name, data));
            provider.on('error', (error)=>this.handleProviderError(name, error));
            provider.on('health_check', (result)=>this.handleHealthCheck(name, result));
            return provider;
        } catch (error) {
            this.logger.error(`Failed to create ${name} provider`, error);
            return null;
        }
    }
    async complete(request) {
        if (this.config.caching?.enabled) {
            const cached = this.checkCache(request);
            if (cached) {
                this.logger.debug('Returning cached response');
                return cached;
            }
        }
        const provider = await this.selectProvider(request);
        try {
            const response = await provider.complete(request);
            if (this.config.caching?.enabled) {
                this.cacheResponse(request, response);
            }
            this.updateProviderMetrics(provider.name, {
                success: true,
                latency: response.latency || 0,
                cost: response.cost?.totalCost || 0
            });
            return response;
        } catch (error) {
            return this.handleRequestError(error, request, provider);
        }
    }
    async *streamComplete(request) {
        const provider = await this.selectProvider(request);
        try {
            yield* provider.streamComplete(request);
            this.updateProviderMetrics(provider.name, {
                success: true,
                latency: 0,
                cost: 0
            });
        } catch (error) {
            const fallbackProvider = await this.getFallbackProvider(error, provider);
            if (fallbackProvider) {
                this.logger.info(`Falling back to ${fallbackProvider.name} provider`);
                yield* fallbackProvider.streamComplete(request);
            } else {
                throw error;
            }
        }
    }
    async selectProvider(request) {
        if (request.providerOptions?.preferredProvider) {
            const provider = this.providers.get(request.providerOptions.preferredProvider);
            if (provider && this.isProviderAvailable(provider)) {
                return provider;
            }
        }
        if (this.config.costOptimization?.enabled && request.costConstraints) {
            const optimized = await this.selectOptimalProvider(request);
            if (optimized) {
                return optimized;
            }
        }
        if (this.config.loadBalancing?.enabled) {
            return this.selectLoadBalancedProvider();
        }
        const defaultProvider = this.providers.get(this.config.defaultProvider);
        if (defaultProvider && this.isProviderAvailable(defaultProvider)) {
            return defaultProvider;
        }
        for (const provider of this.providers.values()){
            if (this.isProviderAvailable(provider)) {
                return provider;
            }
        }
        throw new Error('No available providers');
    }
    async selectOptimalProvider(request) {
        let bestProvider = null;
        let bestCost = Infinity;
        for (const provider of this.providers.values()){
            if (!this.isProviderAvailable(provider)) continue;
            try {
                const estimate = await provider.estimateCost(request);
                if (estimate.estimatedCost.total < bestCost && (!request.costConstraints?.maxCostPerRequest || estimate.estimatedCost.total <= request.costConstraints.maxCostPerRequest)) {
                    bestCost = estimate.estimatedCost.total;
                    bestProvider = provider;
                }
            } catch (error) {
                this.logger.warn(`Failed to estimate cost for ${provider.name}`, error);
            }
        }
        return bestProvider;
    }
    selectLoadBalancedProvider() {
        const availableProviders = Array.from(this.providers.values()).filter((p)=>this.isProviderAvailable(p));
        if (availableProviders.length === 0) {
            throw new Error('No available providers');
        }
        switch(this.config.loadBalancing?.strategy){
            case 'round-robin':
                return this.roundRobinSelect(availableProviders);
            case 'least-loaded':
                return this.leastLoadedSelect(availableProviders);
            case 'latency-based':
                return this.latencyBasedSelect(availableProviders);
            case 'cost-based':
                return this.costBasedSelect(availableProviders);
            default:
                return availableProviders[0];
        }
    }
    roundRobinSelect(providers) {
        const provider = providers[this.currentProviderIndex % providers.length];
        this.currentProviderIndex++;
        return provider;
    }
    leastLoadedSelect(providers) {
        let minLoad = Infinity;
        let selectedProvider = providers[0];
        for (const provider of providers){
            const status = provider.getStatus();
            if (status.currentLoad < minLoad) {
                minLoad = status.currentLoad;
                selectedProvider = provider;
            }
        }
        return selectedProvider;
    }
    latencyBasedSelect(providers) {
        let minLatency = Infinity;
        let selectedProvider = providers[0];
        for (const provider of providers){
            const metrics = this.providerMetrics.get(provider.name);
            if (metrics && metrics.length > 0) {
                const avgLatency = metrics.reduce((sum, m)=>sum + m.latency, 0) / metrics.length;
                if (avgLatency < minLatency) {
                    minLatency = avgLatency;
                    selectedProvider = provider;
                }
            }
        }
        return selectedProvider;
    }
    costBasedSelect(providers) {
        let minCost = Infinity;
        let selectedProvider = providers[0];
        for (const provider of providers){
            const metrics = this.providerMetrics.get(provider.name);
            if (metrics && metrics.length > 0) {
                const avgCost = metrics.reduce((sum, m)=>sum + m.cost, 0) / metrics.length;
                if (avgCost < minCost) {
                    minCost = avgCost;
                    selectedProvider = provider;
                }
            }
        }
        return selectedProvider;
    }
    isProviderAvailable(provider) {
        const status = provider.getStatus();
        return status.available;
    }
    async handleRequestError(error, request, failedProvider) {
        this.logger.error(`Provider ${failedProvider.name} failed`, error);
        this.updateProviderMetrics(failedProvider.name, {
            success: false,
            latency: 0,
            cost: 0
        });
        const fallbackProvider = await this.getFallbackProvider(error, failedProvider);
        if (fallbackProvider) {
            this.logger.info(`Falling back to ${fallbackProvider.name} provider`);
            return fallbackProvider.complete(request);
        }
        throw error;
    }
    async getFallbackProvider(error, failedProvider) {
        if (!this.config.fallbackStrategy?.enabled) {
            return null;
        }
        const errorCondition = this.getErrorCondition(error);
        const fallbackRule = this.config.fallbackStrategy.rules.find((rule)=>rule.condition === errorCondition);
        if (!fallbackRule) {
            return null;
        }
        for (const providerName of fallbackRule.fallbackProviders){
            const provider = this.providers.get(providerName);
            if (provider && provider !== failedProvider && this.isProviderAvailable(provider)) {
                return provider;
            }
        }
        return null;
    }
    getErrorCondition(error) {
        if (isRateLimitError(error)) {
            return 'rate_limit';
        }
        if (error instanceof LLMProviderError) {
            if (error.statusCode === 503) {
                return 'unavailable';
            }
            if (error.code === 'TIMEOUT') {
                return 'timeout';
            }
        }
        return 'error';
    }
    checkCache(request) {
        const cacheKey = this.generateCacheKey(request);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            const age = Date.now() - cached.timestamp.getTime();
            if (age < (this.config.caching?.ttl || 3600) * 1000) {
                return cached.response;
            }
            this.cache.delete(cacheKey);
        }
        return null;
    }
    cacheResponse(request, response) {
        const cacheKey = this.generateCacheKey(request);
        this.cache.set(cacheKey, {
            response,
            timestamp: new Date()
        });
        if (this.cache.size > 1000) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    }
    generateCacheKey(request) {
        return JSON.stringify({
            model: request.model,
            messages: request.messages,
            temperature: request.temperature,
            maxTokens: request.maxTokens
        });
    }
    updateProviderMetrics(provider, metrics) {
        const count = this.requestCount.get(provider) || 0;
        this.requestCount.set(provider, count + 1);
        this.lastUsed.set(provider, new Date());
        const providerMetricsList = this.providerMetrics.get(provider) || [];
        const errorRate = metrics.success ? 0 : 1;
        const successRate = metrics.success ? 1 : 0;
        providerMetricsList.push({
            provider,
            timestamp: new Date(),
            latency: metrics.latency,
            errorRate,
            successRate,
            load: this.providers.get(provider)?.getStatus().currentLoad || 0,
            cost: metrics.cost,
            availability: this.providers.get(provider)?.getStatus().available ? 1 : 0
        });
        if (providerMetricsList.length > 100) {
            providerMetricsList.shift();
        }
        this.providerMetrics.set(provider, providerMetricsList);
    }
    handleProviderResponse(provider, data) {
        this.emit('provider_response', {
            provider,
            ...data
        });
    }
    handleProviderError(provider, error) {
        this.emit('provider_error', {
            provider,
            error
        });
    }
    handleHealthCheck(provider, result) {
        this.emit('health_check', {
            provider,
            result
        });
    }
    startMonitoring() {
        setInterval(()=>{
            this.emitMetrics();
        }, this.config.monitoring?.metricsInterval || 60000);
    }
    emitMetrics() {
        const metrics = {
            providers: {},
            totalRequests: 0,
            totalCost: 0,
            averageLatency: 0
        };
        for (const [provider, count] of this.requestCount.entries()){
            const providerMetricsList = this.providerMetrics.get(provider) || [];
            const avgLatency = providerMetricsList.length > 0 ? providerMetricsList.reduce((sum, m)=>sum + m.latency, 0) / providerMetricsList.length : 0;
            const totalCost = providerMetricsList.reduce((sum, m)=>sum + m.cost, 0);
            metrics.providers[provider] = {
                requests: count,
                averageLatency: avgLatency,
                totalCost,
                lastUsed: this.lastUsed.get(provider),
                available: this.providers.get(provider)?.getStatus().available
            };
            metrics.totalRequests += count;
            metrics.totalCost += totalCost;
        }
        if (metrics.totalRequests > 0) {
            let totalLatency = 0;
            let latencyCount = 0;
            for (const providerMetricsList of this.providerMetrics.values()){
                for (const metric of providerMetricsList){
                    totalLatency += metric.latency;
                    latencyCount++;
                }
            }
            metrics.averageLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
        }
        this.emit('metrics', metrics);
    }
    getAvailableProviders() {
        return Array.from(this.providers.keys()).filter((name)=>{
            const provider = this.providers.get(name);
            return provider && this.isProviderAvailable(provider);
        });
    }
    getProvider(name) {
        return this.providers.get(name);
    }
    getAllProviders() {
        return new Map(this.providers);
    }
    destroy() {
        for (const provider of this.providers.values()){
            provider.destroy();
        }
        this.providers.clear();
        this.cache.clear();
        this.providerMetrics.clear();
        this.removeAllListeners();
    }
}

//# sourceMappingURL=provider-manager.js.map