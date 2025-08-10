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
var openai_provider_exports = {};
__export(openai_provider_exports, {
  OpenAIProvider: () => OpenAIProvider
});
module.exports = __toCommonJS(openai_provider_exports);
var import_base_provider = require("./base-provider.js");
var import_types = require("./types.js");
class OpenAIProvider extends import_base_provider.BaseProvider {
  static {
    __name(this, "OpenAIProvider");
  }
  name = "openai";
  capabilities = {
    supportedModels: [
      "gpt-4-turbo-preview",
      "gpt-4",
      "gpt-4-32k",
      "gpt-3.5-turbo",
      "gpt-3.5-turbo-16k"
    ],
    maxContextLength: {
      "gpt-4-turbo-preview": 128e3,
      "gpt-4": 8192,
      "gpt-4-32k": 32768,
      "gpt-3.5-turbo": 4096,
      "gpt-3.5-turbo-16k": 16384
    },
    maxOutputTokens: {
      "gpt-4-turbo-preview": 4096,
      "gpt-4": 4096,
      "gpt-4-32k": 4096,
      "gpt-3.5-turbo": 4096,
      "gpt-3.5-turbo-16k": 4096
    },
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    // GPT-4 with vision
    supportsAudio: false,
    supportsTools: true,
    supportsFineTuning: true,
    supportsEmbeddings: true,
    supportsLogprobs: true,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 3500,
      tokensPerMinute: 9e4,
      concurrentRequests: 100
    },
    pricing: {
      "gpt-4-turbo-preview": {
        promptCostPer1k: 0.01,
        completionCostPer1k: 0.03,
        currency: "USD"
      },
      "gpt-4": {
        promptCostPer1k: 0.03,
        completionCostPer1k: 0.06,
        currency: "USD"
      },
      "gpt-4-32k": {
        promptCostPer1k: 0.06,
        completionCostPer1k: 0.12,
        currency: "USD"
      },
      "gpt-3.5-turbo": {
        promptCostPer1k: 5e-4,
        completionCostPer1k: 15e-4,
        currency: "USD"
      },
      "gpt-3.5-turbo-16k": {
        promptCostPer1k: 3e-3,
        completionCostPer1k: 4e-3,
        currency: "USD"
      }
    }
  };
  baseUrl;
  headers;
  async doInitialize() {
    if (!this.config.apiKey) {
      throw new import_types.AuthenticationError("OpenAI API key is required", "openai");
    }
    this.baseUrl = this.config.apiUrl || "https://api.openai.com/v1";
    this.headers = {
      "Authorization": `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json"
    };
    if (this.config.providerOptions?.organization) {
      this.headers["OpenAI-Organization"] = this.config.providerOptions.organization;
    }
  }
  async doComplete(request) {
    const openAIRequest = {
      model: this.mapToOpenAIModel(request.model || this.config.model),
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...msg.name && { name: msg.name },
        ...msg.functionCall && { function_call: msg.functionCall }
      })),
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      top_p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop: request.stopSequences ?? this.config.stopSequences,
      stream: false
    };
    if (request.functions) {
      openAIRequest.functions = request.functions;
      openAIRequest.function_call = request.functionCall;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 6e4);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(openAIRequest),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }
      const data = await response.json();
      const choice = data.choices[0];
      const model = request.model || this.config.model;
      const pricing = this.capabilities.pricing[model];
      const promptCost = data.usage.prompt_tokens / 1e3 * pricing.promptCostPer1k;
      const completionCost = data.usage.completion_tokens / 1e3 * pricing.completionCostPer1k;
      return {
        id: data.id,
        model: this.mapFromOpenAIModel(data.model),
        provider: "openai",
        content: choice.message.content || "",
        functionCall: choice.message.function_call,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        },
        cost: {
          promptCost,
          completionCost,
          totalCost: promptCost + completionCost,
          currency: "USD"
        },
        finishReason: choice.finish_reason
      };
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }
  async *doStreamComplete(request) {
    const openAIRequest = {
      model: this.mapToOpenAIModel(request.model || this.config.model),
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...msg.name && { name: msg.name },
        ...msg.functionCall && { function_call: msg.functionCall }
      })),
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      top_p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop: request.stopSequences ?? this.config.stopSequences,
      stream: true
    };
    if (request.functions) {
      openAIRequest.functions = request.functions;
      openAIRequest.function_call = request.functionCall;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 6e4) * 2);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(openAIRequest),
        signal: controller.signal
      });
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]")
              continue;
            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices[0].delta;
              if (delta.content) {
                yield {
                  type: "content",
                  delta: { content: delta.content }
                };
              }
              if (delta.function_call) {
                yield {
                  type: "function_call",
                  delta: { functionCall: delta.function_call }
                };
              }
              if (chunk.choices[0].finish_reason) {
                const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
                const completionTokens = Math.max(totalCompletionTokens, 100);
                const model = request.model || this.config.model;
                const pricing = this.capabilities.pricing[model];
                const promptCost = promptTokens / 1e3 * pricing.promptCostPer1k;
                const completionCost = completionTokens / 1e3 * pricing.completionCostPer1k;
                yield {
                  type: "done",
                  usage: {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens
                  },
                  cost: {
                    promptCost,
                    completionCost,
                    totalCost: promptCost + completionCost,
                    currency: "USD"
                  }
                };
              }
            } catch (e) {
              this.logger.warn("Failed to parse OpenAI stream chunk", { data, error: e });
            }
          }
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  async listModels() {
    return this.capabilities.supportedModels;
  }
  async getModelInfo(model) {
    return {
      model,
      name: model,
      description: this.getModelDescription(model),
      contextLength: this.capabilities.maxContextLength[model] || 4096,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: [
        "chat",
        "completion",
        "function_calling",
        ...model.includes("gpt-4") ? ["vision"] : []
      ],
      pricing: this.capabilities.pricing[model]
    };
  }
  async doHealthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return {
        healthy: true,
        timestamp: /* @__PURE__ */ new Date()
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: /* @__PURE__ */ new Date()
      };
    }
  }
  mapToOpenAIModel(model) {
    const modelMap = {
      "gpt-4-turbo-preview": "gpt-4-turbo-preview",
      "gpt-4": "gpt-4",
      "gpt-4-32k": "gpt-4-32k",
      "gpt-3.5-turbo": "gpt-3.5-turbo",
      "gpt-3.5-turbo-16k": "gpt-3.5-turbo-16k"
    };
    return modelMap[model] || model;
  }
  mapFromOpenAIModel(model) {
    return this.capabilities.supportedModels.find((m) => m === model) || "gpt-3.5-turbo";
  }
  getModelDescription(model) {
    const descriptions = {
      "gpt-4-turbo-preview": "Latest GPT-4 Turbo model with improved performance",
      "gpt-4": "Most capable GPT-4 model for complex tasks",
      "gpt-4-32k": "GPT-4 with extended 32k context window",
      "gpt-3.5-turbo": "Fast and efficient model for most tasks",
      "gpt-3.5-turbo-16k": "GPT-3.5 Turbo with extended context"
    };
    return descriptions[model] || "OpenAI language model";
  }
  async handleErrorResponse(response) {
    const errorText = await response.text();
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: { message: errorText } };
    }
    const message = errorData.error?.message || "Unknown error";
    switch (response.status) {
      case 401:
        throw new import_types.AuthenticationError(message, "openai", errorData);
      case 429:
        const retryAfter = response.headers.get("retry-after");
        throw new import_types.RateLimitError(
          message,
          "openai",
          retryAfter ? parseInt(retryAfter) : void 0,
          errorData
        );
      case 404:
        throw new import_types.ModelNotFoundError(this.config.model, "openai", errorData);
      default:
        throw new import_types.LLMProviderError(
          message,
          `OPENAI_${response.status}`,
          "openai",
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OpenAIProvider
});
//# sourceMappingURL=openai-provider.js.map
