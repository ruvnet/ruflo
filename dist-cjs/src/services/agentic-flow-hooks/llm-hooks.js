import { agenticHookManager } from './hook-manager.js';
export const preLLMCallHook = {
    id: 'agentic-pre-llm-call',
    type: 'pre-llm-call',
    priority: 100,
    handler: async (payload, context)=>{
        const { provider, model, operation: operation1, request } = payload;
        const cacheKey = generateCacheKey(provider, model, request);
        const cached = await checkMemoryCache(cacheKey, context);
        if (cached) {
            return {
                continue: false,
                modified: true,
                payload: {
                    ...payload,
                    response: cached.response,
                    metrics: {
                        ...cached.metrics,
                        cacheHit: true
                    }
                },
                sideEffects: [
                    {
                        type: 'metric',
                        action: 'increment',
                        data: {
                            name: 'llm.cache.hits'
                        }
                    }
                ]
            };
        }
        const optimizations = await loadProviderOptimizations(provider, context);
        const optimizedRequest = applyRequestOptimizations(request, optimizations, context);
        const sideEffects = [
            {
                type: 'metric',
                action: 'increment',
                data: {
                    name: `llm.calls.${provider}.${model}`
                }
            },
            {
                type: 'memory',
                action: 'store',
                data: {
                    key: `llm:request:${context.correlationId}`,
                    value: {
                        provider,
                        model,
                        operation: operation1,
                        request: optimizedRequest,
                        timestamp: Date.now()
                    },
                    ttl: 3600
                }
            }
        ];
        return {
            continue: true,
            modified: true,
            payload: {
                ...payload,
                request: optimizedRequest
            },
            sideEffects
        };
    }
};
export const postLLMCallHook = {
    id: 'agentic-post-llm-call',
    type: 'post-llm-call',
    priority: 100,
    handler: async (payload, context)=>{
        const { provider, model, request, response, metrics } = payload;
        if (!response || !metrics) {
            return {
                continue: true
            };
        }
        const sideEffects = [];
        const cacheKey = generateCacheKey(provider, model, request);
        sideEffects.push({
            type: 'memory',
            action: 'store',
            data: {
                key: `llm:cache:${cacheKey}`,
                value: {
                    response,
                    metrics,
                    timestamp: Date.now()
                },
                ttl: determineCacheTTL(operation, response)
            }
        });
        const patterns = extractResponsePatterns(request, response, metrics);
        if (patterns.length > 0) {
            sideEffects.push({
                type: 'neural',
                action: 'train',
                data: {
                    patterns,
                    modelId: `llm-optimizer-${provider}`
                }
            });
        }
        sideEffects.push({
            type: 'metric',
            action: 'update',
            data: {
                name: `llm.latency.${provider}.${model}`,
                value: metrics.latency
            }
        }, {
            type: 'metric',
            action: 'update',
            data: {
                name: `llm.tokens.${provider}.${model}`,
                value: response.usage.totalTokens
            }
        }, {
            type: 'metric',
            action: 'update',
            data: {
                name: `llm.cost.${provider}.${model}`,
                value: metrics.costEstimate
            }
        });
        if (metrics.latency > getLatencyThreshold(provider, model)) {
            sideEffects.push({
                type: 'notification',
                action: 'send',
                data: {
                    level: 'warning',
                    message: `High latency detected for ${provider}/${model}: ${metrics.latency}ms`
                }
            });
        }
        await updateProviderHealth(provider, metrics.providerHealth, context);
        return {
            continue: true,
            sideEffects
        };
    }
};
export const llmErrorHook = {
    id: 'agentic-llm-error',
    type: 'llm-error',
    priority: 100,
    handler: async (payload, context)=>{
        const { provider, model, error } = payload;
        if (!error) {
            return {
                continue: true
            };
        }
        const sideEffects = [];
        sideEffects.push({
            type: 'log',
            action: 'write',
            data: {
                level: 'error',
                message: `LLM error from ${provider}/${model}`,
                data: {
                    error: error.message,
                    stack: error.stack,
                    request: payload.request
                }
            }
        });
        sideEffects.push({
            type: 'metric',
            action: 'increment',
            data: {
                name: `llm.errors.${provider}.${model}`
            }
        });
        const fallbackProvider = await selectFallbackProvider(provider, model, error, context);
        if (fallbackProvider) {
            return {
                continue: false,
                modified: true,
                payload: {
                    ...payload,
                    provider: fallbackProvider.provider,
                    model: fallbackProvider.model,
                    error: undefined
                },
                sideEffects: [
                    ...sideEffects,
                    {
                        type: 'notification',
                        action: 'send',
                        data: {
                            level: 'info',
                            message: `Falling back from ${provider}/${model} to ${fallbackProvider.provider}/${fallbackProvider.model}`
                        }
                    }
                ]
            };
        }
        return {
            continue: true,
            sideEffects
        };
    }
};
export const llmRetryHook = {
    id: 'agentic-llm-retry',
    type: 'llm-retry',
    priority: 90,
    handler: async (payload, context)=>{
        const { provider, model, metrics } = payload;
        const retryCount = metrics?.retryCount || 0;
        const adjustedRequest = adjustRequestForRetry(payload.request, retryCount);
        const sideEffects = [
            {
                type: 'metric',
                action: 'increment',
                data: {
                    name: `llm.retries.${provider}.${model}`
                }
            }
        ];
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise((resolve)=>setTimeout(resolve, backoffMs));
        return {
            continue: true,
            modified: true,
            payload: {
                ...payload,
                request: adjustedRequest,
                metrics: {
                    ...metrics,
                    retryCount: retryCount + 1
                }
            },
            sideEffects
        };
    }
};
function generateCacheKey(provider, model, request) {
    const normalized = {
        provider,
        model,
        messages: request.messages?.map((m)=>({
                role: m.role,
                content: m.content.substring(0, 100)
            })),
        temperature: request.temperature,
        maxTokens: request.maxTokens
    };
    return Buffer.from(JSON.stringify(normalized)).toString('base64');
}
async function checkMemoryCache(cacheKey, context) {
    return null;
}
async function loadProviderOptimizations(provider, context) {
    return {
        maxRetries: 3,
        timeout: 30000,
        rateLimit: 100
    };
}
function applyRequestOptimizations(request, optimizations, context) {
    const optimized = {
        ...request
    };
    if (optimized.maxTokens && optimized.maxTokens > 4000) {
        optimized.maxTokens = 4000;
    }
    if (optimized.temperature === undefined) {
        optimized.temperature = 0.7;
    }
    if (!optimized.stopSequences && optimized.messages) {
        optimized.stopSequences = [
            '\n\nHuman:',
            '\n\nAssistant:'
        ];
    }
    return optimized;
}
function determineCacheTTL(operation1, response) {
    switch(operation1){
        case 'embedding':
            return 86400;
        case 'completion':
            return response?.usage?.totalTokens && response.usage.totalTokens > 1000 ? 1800 : 3600;
        default:
            return 3600;
    }
}
function extractResponsePatterns(request, response, metrics) {
    const patterns = [];
    if (metrics.latency > 1000) {
        patterns.push({
            id: `perf_${Date.now()}`,
            type: 'optimization',
            confidence: 0.8,
            occurrences: 1,
            context: {
                provider: metrics.providerHealth < 0.8 ? 'unhealthy' : 'healthy',
                requestSize: JSON.stringify(request).length,
                responseTokens: response?.usage?.totalTokens || 0,
                latency: metrics.latency
            }
        });
    }
    if (response?.choices?.[0]?.finishReason === 'stop') {
        patterns.push({
            id: `success_${Date.now()}`,
            type: 'success',
            confidence: 0.9,
            occurrences: 1,
            context: {
                temperature: request.temperature,
                maxTokens: request.maxTokens,
                actualTokens: response.usage?.totalTokens || 0
            }
        });
    }
    return patterns;
}
function getLatencyThreshold(provider, model) {
    const thresholds = {
        'openai:gpt-4': 5000,
        'openai:gpt-3.5-turbo': 2000,
        'anthropic:claude-3': 4000,
        'anthropic:claude-instant': 1500
    };
    return thresholds[`${provider}:${model}`] || 3000;
}
async function updateProviderHealth(provider, health, context) {
    const healthKey = `provider:health:${provider}`;
    const currentHealth = await context.memory.cache.get(healthKey) || [];
    currentHealth.push({
        timestamp: Date.now(),
        health
    });
    if (currentHealth.length > 100) {
        currentHealth.shift();
    }
    await context.memory.cache.set(healthKey, currentHealth);
}
async function selectFallbackProvider(provider, model, error, context) {
    const fallbacks = {
        'openai': [
            {
                provider: 'anthropic',
                model: 'claude-3'
            },
            {
                provider: 'cohere',
                model: 'command'
            }
        ],
        'anthropic': [
            {
                provider: 'openai',
                model: 'gpt-4'
            },
            {
                provider: 'cohere',
                model: 'command'
            }
        ]
    };
    const candidates = fallbacks[provider] || [];
    for (const candidate of candidates){
        const healthKey = `provider:health:${candidate.provider}`;
        const healthData = await context.memory.cache.get(healthKey) || [];
        if (healthData.length > 0) {
            const avgHealth = healthData.reduce((sum, h)=>sum + h.health, 0) / healthData.length;
            if (avgHealth > 0.7) {
                return candidate;
            }
        }
    }
    return null;
}
function adjustRequestForRetry(request, retryCount) {
    const adjusted = {
        ...request
    };
    if (adjusted.temperature !== undefined) {
        adjusted.temperature = Math.min(adjusted.temperature + 0.1 * retryCount, 1.0);
    }
    if (adjusted.maxTokens !== undefined) {
        adjusted.maxTokens = Math.floor(adjusted.maxTokens * Math.pow(0.9, retryCount));
    }
    return adjusted;
}
export function registerLLMHooks() {
    agenticHookManager.register(preLLMCallHook);
    agenticHookManager.register(postLLMCallHook);
    agenticHookManager.register(llmErrorHook);
    agenticHookManager.register(llmRetryHook);
}

//# sourceMappingURL=llm-hooks.js.map