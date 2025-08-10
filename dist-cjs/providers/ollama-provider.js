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
var ollama_provider_exports = {};
__export(ollama_provider_exports, {
  OllamaProvider: () => OllamaProvider
});
module.exports = __toCommonJS(ollama_provider_exports);
var import_base_provider = require("./base-provider.js");
var import_types = require("./types.js");
class OllamaProvider extends import_base_provider.BaseProvider {
  static {
    __name(this, "OllamaProvider");
  }
  name = "ollama";
  capabilities = {
    supportedModels: [
      "llama-2-7b",
      "llama-2-13b",
      "llama-2-70b",
      "mistral-7b",
      "mixtral-8x7b",
      "custom-model"
    ],
    maxContextLength: {
      "llama-2-7b": 4096,
      "llama-2-13b": 4096,
      "llama-2-70b": 4096,
      "mistral-7b": 8192,
      "mixtral-8x7b": 32768,
      "custom-model": 4096
    },
    maxOutputTokens: {
      "llama-2-7b": 2048,
      "llama-2-13b": 2048,
      "llama-2-70b": 2048,
      "mistral-7b": 4096,
      "mixtral-8x7b": 4096,
      "custom-model": 2048
    },
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsTools: false,
    supportsFineTuning: false,
    supportsEmbeddings: true,
    supportsLogprobs: false,
    supportsBatching: false,
    pricing: {
      // Local models have no API cost
      "llama-2-7b": { promptCostPer1k: 0, completionCostPer1k: 0, currency: "USD" },
      "llama-2-13b": { promptCostPer1k: 0, completionCostPer1k: 0, currency: "USD" },
      "llama-2-70b": { promptCostPer1k: 0, completionCostPer1k: 0, currency: "USD" },
      "mistral-7b": { promptCostPer1k: 0, completionCostPer1k: 0, currency: "USD" },
      "mixtral-8x7b": { promptCostPer1k: 0, completionCostPer1k: 0, currency: "USD" },
      "custom-model": { promptCostPer1k: 0, completionCostPer1k: 0, currency: "USD" }
    }
  };
  baseUrl;
  availableModels = /* @__PURE__ */ new Set();
  async doInitialize() {
    this.baseUrl = this.config.apiUrl || "http://localhost:11434";
    try {
      await this.fetchAvailableModels();
    } catch (error) {
      this.logger.warn("Failed to fetch Ollama models, will retry on first request", error);
    }
  }
  async fetchAvailableModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      this.availableModels.clear();
      if (data.models && Array.isArray(data.models)) {
        data.models.forEach((model) => {
          this.availableModels.add(model.name);
          if (model.name.includes("llama2:7b")) {
            this.availableModels.add("llama-2-7b");
          } else if (model.name.includes("llama2:13b")) {
            this.availableModels.add("llama-2-13b");
          } else if (model.name.includes("llama2:70b")) {
            this.availableModels.add("llama-2-70b");
          } else if (model.name.includes("mistral")) {
            this.availableModels.add("mistral-7b");
          } else if (model.name.includes("mixtral")) {
            this.availableModels.add("mixtral-8x7b");
          }
        });
      }
    } catch (error) {
      throw new import_types.ProviderUnavailableError("ollama", {
        message: "Ollama service is not available",
        details: error
      });
    }
  }
  async doComplete(request) {
    const ollamaRequest = {
      model: this.mapToOllamaModel(request.model || this.config.model),
      messages: request.messages.map((msg) => ({
        role: msg.role === "system" ? "system" : msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? this.config.temperature,
        top_k: request.topK ?? this.config.topK,
        top_p: request.topP ?? this.config.topP,
        num_predict: request.maxTokens ?? this.config.maxTokens,
        stop: request.stopSequences ?? this.config.stopSequences
      }
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 12e4);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }
      const data = await response.json();
      const promptTokens = data.prompt_eval_count || this.estimateTokens(JSON.stringify(request.messages));
      const completionTokens = data.eval_count || this.estimateTokens(data.message?.content || "");
      const totalDuration = data.total_duration ? data.total_duration / 1e6 : 0;
      return {
        id: `ollama-${Date.now()}`,
        model: request.model || this.config.model,
        provider: "ollama",
        content: data.message?.content || "",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens
        },
        cost: {
          promptCost: 0,
          completionCost: 0,
          totalCost: 0,
          currency: "USD"
        },
        latency: totalDuration,
        finishReason: data.done ? "stop" : "length",
        metadata: {
          loadDuration: data.load_duration,
          promptEvalDuration: data.prompt_eval_duration,
          evalDuration: data.eval_duration
        }
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new import_types.ProviderUnavailableError("ollama", {
          message: "Cannot connect to Ollama. Make sure Ollama is running on " + this.baseUrl
        });
      }
      throw this.transformError(error);
    }
  }
  async *doStreamComplete(request) {
    const ollamaRequest = {
      model: this.mapToOllamaModel(request.model || this.config.model),
      messages: request.messages.map((msg) => ({
        role: msg.role === "system" ? "system" : msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      })),
      stream: true,
      options: {
        temperature: request.temperature ?? this.config.temperature,
        top_k: request.topK ?? this.config.topK,
        top_p: request.topP ?? this.config.topP,
        num_predict: request.maxTokens ?? this.config.maxTokens,
        stop: request.stopSequences ?? this.config.stopSequences
      }
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 12e4) * 2);
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal
      });
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let totalContent = "";
      let promptTokens = 0;
      let completionTokens = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim() === "")
            continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              totalContent += data.message.content;
              yield {
                type: "content",
                delta: { content: data.message.content }
              };
            }
            if (data.done) {
              promptTokens = data.prompt_eval_count || this.estimateTokens(JSON.stringify(request.messages));
              completionTokens = data.eval_count || this.estimateTokens(totalContent);
              yield {
                type: "done",
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens
                },
                cost: {
                  promptCost: 0,
                  completionCost: 0,
                  totalCost: 0,
                  currency: "USD"
                }
              };
            }
          } catch (e) {
            this.logger.warn("Failed to parse Ollama stream chunk", { line, error: e });
          }
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new import_types.ProviderUnavailableError("ollama", {
          message: "Cannot connect to Ollama. Make sure Ollama is running on " + this.baseUrl
        });
      }
      throw this.transformError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  async listModels() {
    await this.fetchAvailableModels();
    return this.capabilities.supportedModels.filter(
      (model) => this.availableModels.has(this.mapToOllamaModel(model))
    );
  }
  async getModelInfo(model) {
    const ollamaModel = this.mapToOllamaModel(model);
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: ollamaModel })
      });
      if (!response.ok) {
        throw new Error("Model not found");
      }
      const data = await response.json();
      return {
        model,
        name: data.name || model,
        description: data.description || this.getModelDescription(model),
        contextLength: this.capabilities.maxContextLength[model] || 4096,
        maxOutputTokens: this.capabilities.maxOutputTokens[model] || 2048,
        supportedFeatures: ["chat", "completion"],
        pricing: this.capabilities.pricing[model],
        metadata: {
          parameterSize: data.details?.parameter_size,
          quantization: data.details?.quantization_level,
          format: data.details?.format
        }
      };
    } catch (error) {
      return {
        model,
        name: model,
        description: this.getModelDescription(model),
        contextLength: this.capabilities.maxContextLength[model] || 4096,
        maxOutputTokens: this.capabilities.maxOutputTokens[model] || 2048,
        supportedFeatures: ["chat", "completion"],
        pricing: this.capabilities.pricing[model]
      };
    }
  }
  async doHealthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return {
        healthy: true,
        timestamp: /* @__PURE__ */ new Date(),
        details: {
          modelsAvailable: this.availableModels.size
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Cannot connect to Ollama",
        timestamp: /* @__PURE__ */ new Date()
      };
    }
  }
  mapToOllamaModel(model) {
    const modelMap = {
      "llama-2-7b": "llama2:7b",
      "llama-2-13b": "llama2:13b",
      "llama-2-70b": "llama2:70b",
      "mistral-7b": "mistral:7b",
      "mixtral-8x7b": "mixtral:8x7b",
      "custom-model": this.config.providerOptions?.customModel || "llama2:latest"
    };
    return modelMap[model] || model;
  }
  getModelDescription(model) {
    const descriptions = {
      "llama-2-7b": "Llama 2 7B - Efficient open-source model",
      "llama-2-13b": "Llama 2 13B - Balanced performance model",
      "llama-2-70b": "Llama 2 70B - Large open-source model",
      "mistral-7b": "Mistral 7B - Fast and efficient model",
      "mixtral-8x7b": "Mixtral 8x7B - Mixture of experts model",
      "custom-model": "Custom local model"
    };
    return descriptions[model] || "Local language model via Ollama";
  }
  async handleErrorResponse(response) {
    const errorText = await response.text();
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: errorText };
    }
    const message = errorData.error || "Unknown error";
    throw new import_types.LLMProviderError(
      message,
      `OLLAMA_${response.status}`,
      "ollama",
      response.status,
      response.status >= 500,
      errorData
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OllamaProvider
});
//# sourceMappingURL=ollama-provider.js.map
