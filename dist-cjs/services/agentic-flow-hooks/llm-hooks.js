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
var llm_hooks_exports = {};
__export(llm_hooks_exports, {
  llmErrorHook: () => llmErrorHook,
  llmRetryHook: () => llmRetryHook,
  postLLMCallHook: () => postLLMCallHook,
  preLLMCallHook: () => preLLMCallHook,
  registerLLMHooks: () => registerLLMHooks
});
module.exports = __toCommonJS(llm_hooks_exports);
var import_hook_manager = require("./hook-manager.js");
const preLLMCallHook = {
  id: "agentic-pre-llm-call",
  type: "pre-llm-call",
  priority: 100,
  handler: async (payload, context) => {
    const { provider, model, operation: operation2, request } = payload;
    const cacheKey = generateCacheKey(provider, model, request);
    const cached = await checkMemoryCache(cacheKey, context);
    if (cached) {
      return {
        continue: false,
        // Skip LLM call
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
            type: "metric",
            action: "increment",
            data: { name: "llm.cache.hits" }
          }
        ]
      };
    }
    const optimizations = await loadProviderOptimizations(provider, context);
    const optimizedRequest = applyRequestOptimizations(
      request,
      optimizations,
      context
    );
    const sideEffects = [
      {
        type: "metric",
        action: "increment",
        data: { name: `llm.calls.${provider}.${model}` }
      },
      {
        type: "memory",
        action: "store",
        data: {
          key: `llm:request:${context.correlationId}`,
          value: {
            provider,
            model,
            operation: operation2,
            request: optimizedRequest,
            timestamp: Date.now()
          },
          ttl: 3600
          // 1 hour
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
const postLLMCallHook = {
  id: "agentic-post-llm-call",
  type: "post-llm-call",
  priority: 100,
  handler: async (payload, context) => {
    const { provider, model, request, response, metrics } = payload;
    if (!response || !metrics) {
      return { continue: true };
    }
    const sideEffects = [];
    const cacheKey = generateCacheKey(provider, model, request);
    sideEffects.push({
      type: "memory",
      action: "store",
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
        type: "neural",
        action: "train",
        data: {
          patterns,
          modelId: `llm-optimizer-${provider}`
        }
      });
    }
    sideEffects.push(
      {
        type: "metric",
        action: "update",
        data: {
          name: `llm.latency.${provider}.${model}`,
          value: metrics.latency
        }
      },
      {
        type: "metric",
        action: "update",
        data: {
          name: `llm.tokens.${provider}.${model}`,
          value: response.usage.totalTokens
        }
      },
      {
        type: "metric",
        action: "update",
        data: {
          name: `llm.cost.${provider}.${model}`,
          value: metrics.costEstimate
        }
      }
    );
    if (metrics.latency > getLatencyThreshold(provider, model)) {
      sideEffects.push({
        type: "notification",
        action: "send",
        data: {
          level: "warning",
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
const llmErrorHook = {
  id: "agentic-llm-error",
  type: "llm-error",
  priority: 100,
  handler: async (payload, context) => {
    const { provider, model, error } = payload;
    if (!error) {
      return { continue: true };
    }
    const sideEffects = [];
    sideEffects.push({
      type: "log",
      action: "write",
      data: {
        level: "error",
        message: `LLM error from ${provider}/${model}`,
        data: {
          error: error.message,
          stack: error.stack,
          request: payload.request
        }
      }
    });
    sideEffects.push({
      type: "metric",
      action: "increment",
      data: { name: `llm.errors.${provider}.${model}` }
    });
    const fallbackProvider = await selectFallbackProvider(
      provider,
      model,
      error,
      context
    );
    if (fallbackProvider) {
      return {
        continue: false,
        // Don't propagate error
        modified: true,
        payload: {
          ...payload,
          provider: fallbackProvider.provider,
          model: fallbackProvider.model,
          error: void 0
          // Clear error for retry
        },
        sideEffects: [
          ...sideEffects,
          {
            type: "notification",
            action: "send",
            data: {
              level: "info",
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
const llmRetryHook = {
  id: "agentic-llm-retry",
  type: "llm-retry",
  priority: 90,
  handler: async (payload, context) => {
    const { provider, model, metrics } = payload;
    const retryCount = metrics?.retryCount || 0;
    const adjustedRequest = adjustRequestForRetry(
      payload.request,
      retryCount
    );
    const sideEffects = [
      {
        type: "metric",
        action: "increment",
        data: { name: `llm.retries.${provider}.${model}` }
      }
    ];
    const backoffMs = Math.min(1e3 * Math.pow(2, retryCount), 1e4);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
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
    messages: request.messages?.map((m) => ({
      role: m.role,
      content: m.content.substring(0, 100)
      // First 100 chars
    })),
    temperature: request.temperature,
    maxTokens: request.maxTokens
  };
  return Buffer.from(JSON.stringify(normalized)).toString("base64");
}
__name(generateCacheKey, "generateCacheKey");
async function checkMemoryCache(cacheKey, context) {
  return null;
}
__name(checkMemoryCache, "checkMemoryCache");
async function loadProviderOptimizations(provider, context) {
  return {
    maxRetries: 3,
    timeout: 3e4,
    rateLimit: 100
  };
}
__name(loadProviderOptimizations, "loadProviderOptimizations");
function applyRequestOptimizations(request, optimizations, context) {
  const optimized = { ...request };
  if (optimized.maxTokens && optimized.maxTokens > 4e3) {
    optimized.maxTokens = 4e3;
  }
  if (optimized.temperature === void 0) {
    optimized.temperature = 0.7;
  }
  if (!optimized.stopSequences && optimized.messages) {
    optimized.stopSequences = ["\n\nHuman:", "\n\nAssistant:"];
  }
  return optimized;
}
__name(applyRequestOptimizations, "applyRequestOptimizations");
function determineCacheTTL(operation2, response) {
  switch (operation2) {
    case "embedding":
      return 86400;
    case "completion":
      return response?.usage?.totalTokens && response.usage.totalTokens > 1e3 ? 1800 : 3600;
    default:
      return 3600;
  }
}
__name(determineCacheTTL, "determineCacheTTL");
function extractResponsePatterns(request, response, metrics) {
  const patterns = [];
  if (metrics.latency > 1e3) {
    patterns.push({
      id: `perf_${Date.now()}`,
      type: "optimization",
      confidence: 0.8,
      occurrences: 1,
      context: {
        provider: metrics.providerHealth < 0.8 ? "unhealthy" : "healthy",
        requestSize: JSON.stringify(request).length,
        responseTokens: response?.usage?.totalTokens || 0,
        latency: metrics.latency
      }
    });
  }
  if (response?.choices?.[0]?.finishReason === "stop") {
    patterns.push({
      id: `success_${Date.now()}`,
      type: "success",
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
__name(extractResponsePatterns, "extractResponsePatterns");
function getLatencyThreshold(provider, model) {
  const thresholds = {
    "openai:gpt-4": 5e3,
    "openai:gpt-3.5-turbo": 2e3,
    "anthropic:claude-3": 4e3,
    "anthropic:claude-instant": 1500
  };
  return thresholds[`${provider}:${model}`] || 3e3;
}
__name(getLatencyThreshold, "getLatencyThreshold");
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
__name(updateProviderHealth, "updateProviderHealth");
async function selectFallbackProvider(provider, model, error, context) {
  const fallbacks = {
    "openai": [
      { provider: "anthropic", model: "claude-3" },
      { provider: "cohere", model: "command" }
    ],
    "anthropic": [
      { provider: "openai", model: "gpt-4" },
      { provider: "cohere", model: "command" }
    ]
  };
  const candidates = fallbacks[provider] || [];
  for (const candidate of candidates) {
    const healthKey = `provider:health:${candidate.provider}`;
    const healthData = await context.memory.cache.get(healthKey) || [];
    if (healthData.length > 0) {
      const avgHealth = healthData.reduce(
        (sum, h) => sum + h.health,
        0
      ) / healthData.length;
      if (avgHealth > 0.7) {
        return candidate;
      }
    }
  }
  return null;
}
__name(selectFallbackProvider, "selectFallbackProvider");
function adjustRequestForRetry(request, retryCount) {
  const adjusted = { ...request };
  if (adjusted.temperature !== void 0) {
    adjusted.temperature = Math.min(
      adjusted.temperature + 0.1 * retryCount,
      1
    );
  }
  if (adjusted.maxTokens !== void 0) {
    adjusted.maxTokens = Math.floor(
      adjusted.maxTokens * Math.pow(0.9, retryCount)
    );
  }
  return adjusted;
}
__name(adjustRequestForRetry, "adjustRequestForRetry");
function registerLLMHooks() {
  import_hook_manager.agenticHookManager.register(preLLMCallHook);
  import_hook_manager.agenticHookManager.register(postLLMCallHook);
  import_hook_manager.agenticHookManager.register(llmErrorHook);
  import_hook_manager.agenticHookManager.register(llmRetryHook);
}
__name(registerLLMHooks, "registerLLMHooks");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  llmErrorHook,
  llmRetryHook,
  postLLMCallHook,
  preLLMCallHook,
  registerLLMHooks
});
//# sourceMappingURL=llm-hooks.js.map
