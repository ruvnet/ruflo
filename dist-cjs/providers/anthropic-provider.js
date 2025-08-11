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
var anthropic_provider_exports = {};
__export(anthropic_provider_exports, {
  AnthropicProvider: () => AnthropicProvider
});
module.exports = __toCommonJS(anthropic_provider_exports);
var import_base_provider = require("./base-provider.js");
var import_claude_client = require("../api/claude-client.js");
class AnthropicProvider extends import_base_provider.BaseProvider {
  static {
    __name(this, "AnthropicProvider");
  }
  name = "anthropic";
  capabilities = {
    supportedModels: [
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
      "claude-2.1",
      "claude-2.0",
      "claude-instant-1.2"
    ],
    maxContextLength: {
      "claude-3-opus-20240229": 2e5,
      "claude-3-sonnet-20240229": 2e5,
      "claude-3-haiku-20240307": 2e5,
      "claude-2.1": 2e5,
      "claude-2.0": 1e5,
      "claude-instant-1.2": 1e5
    },
    maxOutputTokens: {
      "claude-3-opus-20240229": 4096,
      "claude-3-sonnet-20240229": 4096,
      "claude-3-haiku-20240307": 4096,
      "claude-2.1": 4096,
      "claude-2.0": 4096,
      "claude-instant-1.2": 4096
    },
    supportsStreaming: true,
    supportsFunctionCalling: false,
    // Claude doesn't have native function calling yet
    supportsSystemMessages: true,
    supportsVision: true,
    // Claude 3 models support vision
    supportsAudio: false,
    supportsTools: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsLogprobs: false,
    supportsBatching: false,
    pricing: {
      "claude-3-opus-20240229": {
        promptCostPer1k: 0.015,
        completionCostPer1k: 0.075,
        currency: "USD"
      },
      "claude-3-sonnet-20240229": {
        promptCostPer1k: 3e-3,
        completionCostPer1k: 0.015,
        currency: "USD"
      },
      "claude-3-haiku-20240307": {
        promptCostPer1k: 25e-5,
        completionCostPer1k: 125e-5,
        currency: "USD"
      },
      "claude-2.1": {
        promptCostPer1k: 8e-3,
        completionCostPer1k: 0.024,
        currency: "USD"
      },
      "claude-2.0": {
        promptCostPer1k: 8e-3,
        completionCostPer1k: 0.024,
        currency: "USD"
      },
      "claude-instant-1.2": {
        promptCostPer1k: 8e-4,
        completionCostPer1k: 24e-4,
        currency: "USD"
      }
    }
  };
  claudeClient;
  async doInitialize() {
    this.claudeClient = new import_claude_client.ClaudeAPIClient(
      this.logger,
      { get: () => this.config },
      // Mock config manager
      {
        apiKey: this.config.apiKey,
        model: this.mapToAnthropicModel(this.config.model),
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
        topP: this.config.topP,
        topK: this.config.topK,
        timeout: this.config.timeout,
        retryAttempts: this.config.retryAttempts,
        retryDelay: this.config.retryDelay
      }
    );
  }
  async doComplete(request) {
    const claudeMessages = request.messages.map((msg) => ({
      role: msg.role === "system" ? "user" : msg.role,
      content: msg.role === "system" ? `System: ${msg.content}` : msg.content
    }));
    const systemMessage = request.messages.find((m) => m.role === "system");
    const response = await this.claudeClient.sendMessage(claudeMessages, {
      model: request.model ? this.mapToAnthropicModel(request.model) : void 0,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      systemPrompt: systemMessage?.content,
      stream: false
    });
    const pricing = this.capabilities.pricing[response.model];
    const promptCost = response.usage.input_tokens / 1e3 * pricing.promptCostPer1k;
    const completionCost = response.usage.output_tokens / 1e3 * pricing.completionCostPer1k;
    return {
      id: response.id,
      model: this.mapFromAnthropicModel(response.model),
      provider: "anthropic",
      content: response.content[0].text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: "USD"
      },
      finishReason: response.stop_reason === "end_turn" ? "stop" : "length"
    };
  }
  async *doStreamComplete(request) {
    const claudeMessages = request.messages.map((msg) => ({
      role: msg.role === "system" ? "user" : msg.role,
      content: msg.role === "system" ? `System: ${msg.content}` : msg.content
    }));
    const systemMessage = request.messages.find((m) => m.role === "system");
    const stream = await this.claudeClient.sendMessage(claudeMessages, {
      model: request.model ? this.mapToAnthropicModel(request.model) : void 0,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      systemPrompt: systemMessage?.content,
      stream: true
    });
    let accumulatedContent = "";
    let totalTokens = 0;
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.text) {
        accumulatedContent += event.delta.text;
        yield {
          type: "content",
          delta: {
            content: event.delta.text
          }
        };
      } else if (event.type === "message_delta" && event.usage) {
        totalTokens = event.usage.output_tokens;
      } else if (event.type === "message_stop") {
        const model = request.model || this.config.model;
        const pricing = this.capabilities.pricing[model];
        const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
        const completionTokens = totalTokens;
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
    }
  }
  async listModels() {
    return this.capabilities.supportedModels;
  }
  async getModelInfo(model) {
    const anthropicModel = this.mapToAnthropicModel(model);
    const info = this.claudeClient.getModelInfo(anthropicModel);
    return {
      model,
      name: info.name,
      description: info.description,
      contextLength: info.contextWindow,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: [
        "chat",
        "completion",
        ...model.startsWith("claude-3") ? ["vision"] : []
      ],
      pricing: this.capabilities.pricing[model]
    };
  }
  async doHealthCheck() {
    try {
      await this.claudeClient.complete("Hi", {
        maxTokens: 1
      });
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
  /**
   * Map unified model to Anthropic model
   */
  mapToAnthropicModel(model) {
    return model;
  }
  /**
   * Map Anthropic model to unified model
   */
  mapFromAnthropicModel(model) {
    return model;
  }
  destroy() {
    super.destroy();
    this.claudeClient?.destroy();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AnthropicProvider
});
//# sourceMappingURL=anthropic-provider.js.map
