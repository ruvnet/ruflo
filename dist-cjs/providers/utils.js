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
var utils_exports = {};
__export(utils_exports, {
  createProviderManager: () => createProviderManager,
  estimateMonthlyCost: () => estimateMonthlyCost,
  getDefaultProviderConfig: () => getDefaultProviderConfig,
  getModelRecommendations: () => getModelRecommendations,
  validateProviderConfig: () => validateProviderConfig
});
module.exports = __toCommonJS(utils_exports);
var import_provider_manager = require("./provider-manager.js");
function createProviderManager(logger, configManager, customConfig) {
  const defaultConfig = getDefaultProviderConfig();
  const config = { ...defaultConfig, ...customConfig };
  config.providers = loadProviderConfigs(config.providers);
  return new import_provider_manager.ProviderManager(logger, configManager, config);
}
__name(createProviderManager, "createProviderManager");
function getDefaultProviderConfig() {
  const defaultProvider = process.env.DEFAULT_LLM_PROVIDER || "anthropic";
  return {
    defaultProvider,
    providers: {
      anthropic: {
        provider: "anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: "claude-3-sonnet-20240229",
        temperature: 0.7,
        maxTokens: 4096,
        enableStreaming: true,
        enableCaching: true,
        timeout: 6e4,
        retryAttempts: 3
      },
      openai: {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: "gpt-4-turbo-preview",
        temperature: 0.7,
        maxTokens: 4096,
        enableStreaming: true,
        enableCaching: true,
        timeout: 6e4,
        retryAttempts: 3
      },
      google: {
        provider: "google",
        apiKey: process.env.GOOGLE_AI_API_KEY,
        model: "gemini-pro",
        temperature: 0.7,
        maxTokens: 2048,
        enableStreaming: true,
        enableCaching: true,
        timeout: 6e4,
        retryAttempts: 3
      },
      cohere: {
        provider: "cohere",
        apiKey: process.env.COHERE_API_KEY,
        model: "command",
        temperature: 0.7,
        maxTokens: 4096,
        enableStreaming: true,
        enableCaching: true,
        timeout: 6e4,
        retryAttempts: 3
      },
      ollama: {
        provider: "ollama",
        apiUrl: process.env.OLLAMA_API_URL || "http://localhost:11434",
        model: "llama-2-7b",
        temperature: 0.7,
        maxTokens: 2048,
        enableStreaming: true,
        enableCaching: false,
        timeout: 12e4,
        // Longer timeout for local models
        retryAttempts: 2
      }
    },
    fallbackStrategy: getDefaultFallbackStrategy(),
    loadBalancing: {
      enabled: false,
      strategy: "round-robin"
    },
    costOptimization: {
      enabled: true,
      maxCostPerRequest: 1,
      // $1 max per request
      preferredProviders: ["anthropic", "openai"]
    },
    caching: {
      enabled: true,
      ttl: 3600,
      // 1 hour
      maxSize: 100,
      // 100MB
      strategy: "lru"
    },
    monitoring: {
      enabled: true,
      metricsInterval: 6e4
      // 1 minute
    }
  };
}
__name(getDefaultProviderConfig, "getDefaultProviderConfig");
function getDefaultFallbackStrategy() {
  return {
    name: "default",
    enabled: true,
    maxAttempts: 3,
    rules: [
      {
        condition: "rate_limit",
        fallbackProviders: ["openai", "google", "cohere", "ollama"],
        retryOriginal: true,
        retryDelay: 6e4
        // 1 minute
      },
      {
        condition: "unavailable",
        fallbackProviders: ["openai", "google", "anthropic", "cohere"],
        retryOriginal: true,
        retryDelay: 3e4
        // 30 seconds
      },
      {
        condition: "timeout",
        fallbackProviders: ["anthropic", "openai", "cohere"],
        retryOriginal: false
      },
      {
        condition: "cost",
        fallbackProviders: ["ollama", "cohere", "google"],
        retryOriginal: false
      },
      {
        condition: "error",
        errorCodes: ["AUTHENTICATION", "MODEL_NOT_FOUND"],
        fallbackProviders: [],
        retryOriginal: false
        // Don't retry auth errors
      }
    ]
  };
}
__name(getDefaultFallbackStrategy, "getDefaultFallbackStrategy");
function loadProviderConfigs(configs) {
  const loaded = { ...configs };
  for (const [provider, config] of Object.entries(loaded)) {
    const envPrefix = `${provider.toUpperCase()}_`;
    if (process.env[`${envPrefix}MODEL`]) {
      config.model = process.env[`${envPrefix}MODEL`];
    }
    if (process.env[`${envPrefix}TEMPERATURE`]) {
      config.temperature = parseFloat(process.env[`${envPrefix}TEMPERATURE`]);
    }
    if (process.env[`${envPrefix}MAX_TOKENS`]) {
      config.maxTokens = parseInt(process.env[`${envPrefix}MAX_TOKENS`], 10);
    }
    if (process.env[`${envPrefix}API_URL`]) {
      config.apiUrl = process.env[`${envPrefix}API_URL`];
    }
  }
  return loaded;
}
__name(loadProviderConfigs, "loadProviderConfigs");
function validateProviderConfig(config) {
  const errors = [];
  if (!config.provider) {
    errors.push("Provider name is required");
  }
  if (!config.model) {
    errors.push("Model is required");
  }
  if (config.temperature !== void 0) {
    if (config.temperature < 0 || config.temperature > 2) {
      errors.push("Temperature must be between 0 and 2");
    }
  }
  if (config.maxTokens !== void 0) {
    if (config.maxTokens < 1 || config.maxTokens > 1e5) {
      errors.push("Max tokens must be between 1 and 100000");
    }
  }
  if (config.topP !== void 0) {
    if (config.topP < 0 || config.topP > 1) {
      errors.push("Top-p must be between 0 and 1");
    }
  }
  if (config.timeout !== void 0) {
    if (config.timeout < 1e3 || config.timeout > 6e5) {
      errors.push("Timeout must be between 1000ms and 600000ms");
    }
  }
  return errors;
}
__name(validateProviderConfig, "validateProviderConfig");
function getModelRecommendations(useCase) {
  const recommendations = {
    "code-generation": [
      {
        provider: "anthropic",
        model: "claude-3-opus-20240229",
        reasoning: "Best for complex code generation with high accuracy"
      },
      {
        provider: "openai",
        model: "gpt-4-turbo-preview",
        reasoning: "Excellent code generation with function calling support"
      }
    ],
    "chat": [
      {
        provider: "anthropic",
        model: "claude-3-sonnet-20240229",
        reasoning: "Balanced performance for conversational AI"
      },
      {
        provider: "openai",
        model: "gpt-3.5-turbo",
        reasoning: "Fast and cost-effective for chat applications"
      }
    ],
    "analysis": [
      {
        provider: "anthropic",
        model: "claude-3-opus-20240229",
        reasoning: "Excellent for deep analysis and reasoning"
      },
      {
        provider: "google",
        model: "gemini-pro",
        reasoning: "Good for data analysis with multimodal support"
      }
    ],
    "local": [
      {
        provider: "ollama",
        model: "llama-2-13b",
        reasoning: "Good balance of performance and resource usage for local deployment"
      },
      {
        provider: "ollama",
        model: "mistral-7b",
        reasoning: "Fast local model with good performance"
      }
    ],
    "budget": [
      {
        provider: "ollama",
        model: "llama-2-7b",
        reasoning: "Free local model with no API costs"
      },
      {
        provider: "google",
        model: "gemini-pro",
        reasoning: "Very cost-effective cloud model"
      }
    ]
  };
  return recommendations[useCase] || recommendations["chat"];
}
__name(getModelRecommendations, "getModelRecommendations");
function estimateMonthlyCost(provider, model, estimatedRequests, avgTokensPerRequest) {
  const pricing = getPricing(provider, model);
  if (!pricing) {
    return {
      promptCost: 0,
      completionCost: 0,
      totalCost: 0,
      currency: "USD"
    };
  }
  const promptTokens = avgTokensPerRequest * 0.7;
  const completionTokens = avgTokensPerRequest * 0.3;
  const promptCost = promptTokens * estimatedRequests / 1e3 * pricing.promptCostPer1k;
  const completionCost = completionTokens * estimatedRequests / 1e3 * pricing.completionCostPer1k;
  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    currency: pricing.currency
  };
}
__name(estimateMonthlyCost, "estimateMonthlyCost");
function getPricing(provider, model) {
  const pricingData = {
    "anthropic:claude-3-opus-20240229": {
      promptCostPer1k: 0.015,
      completionCostPer1k: 0.075,
      currency: "USD"
    },
    "openai:gpt-4-turbo-preview": {
      promptCostPer1k: 0.01,
      completionCostPer1k: 0.03,
      currency: "USD"
    },
    "google:gemini-pro": {
      promptCostPer1k: 25e-5,
      completionCostPer1k: 5e-4,
      currency: "USD"
    },
    "ollama:llama-2-7b": {
      promptCostPer1k: 0,
      completionCostPer1k: 0,
      currency: "USD"
    }
  };
  return pricingData[`${provider}:${model}`] || null;
}
__name(getPricing, "getPricing");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createProviderManager,
  estimateMonthlyCost,
  getDefaultProviderConfig,
  getModelRecommendations,
  validateProviderConfig
});
//# sourceMappingURL=utils.js.map
