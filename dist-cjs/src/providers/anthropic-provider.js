import { BaseProvider } from './base-provider.js';
import { ClaudeAPIClient } from '../api/claude-client.js';
export class AnthropicProvider extends BaseProvider {
    name = 'anthropic';
    capabilities = {
        supportedModels: [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-2.1',
            'claude-2.0',
            'claude-instant-1.2'
        ],
        maxContextLength: {
            'claude-3-opus-20240229': 200000,
            'claude-3-sonnet-20240229': 200000,
            'claude-3-haiku-20240307': 200000,
            'claude-2.1': 200000,
            'claude-2.0': 100000,
            'claude-instant-1.2': 100000
        },
        maxOutputTokens: {
            'claude-3-opus-20240229': 4096,
            'claude-3-sonnet-20240229': 4096,
            'claude-3-haiku-20240307': 4096,
            'claude-2.1': 4096,
            'claude-2.0': 4096,
            'claude-instant-1.2': 4096
        },
        supportsStreaming: true,
        supportsFunctionCalling: false,
        supportsSystemMessages: true,
        supportsVision: true,
        supportsAudio: false,
        supportsTools: false,
        supportsFineTuning: false,
        supportsEmbeddings: false,
        supportsLogprobs: false,
        supportsBatching: false,
        pricing: {
            'claude-3-opus-20240229': {
                promptCostPer1k: 0.015,
                completionCostPer1k: 0.075,
                currency: 'USD'
            },
            'claude-3-sonnet-20240229': {
                promptCostPer1k: 0.003,
                completionCostPer1k: 0.015,
                currency: 'USD'
            },
            'claude-3-haiku-20240307': {
                promptCostPer1k: 0.00025,
                completionCostPer1k: 0.00125,
                currency: 'USD'
            },
            'claude-2.1': {
                promptCostPer1k: 0.008,
                completionCostPer1k: 0.024,
                currency: 'USD'
            },
            'claude-2.0': {
                promptCostPer1k: 0.008,
                completionCostPer1k: 0.024,
                currency: 'USD'
            },
            'claude-instant-1.2': {
                promptCostPer1k: 0.0008,
                completionCostPer1k: 0.0024,
                currency: 'USD'
            }
        }
    };
    claudeClient;
    async doInitialize() {
        this.claudeClient = new ClaudeAPIClient(this.logger, {
            get: ()=>this.config
        }, {
            apiKey: this.config.apiKey,
            model: this.mapToAnthropicModel(this.config.model),
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            topP: this.config.topP,
            topK: this.config.topK,
            timeout: this.config.timeout,
            retryAttempts: this.config.retryAttempts,
            retryDelay: this.config.retryDelay
        });
    }
    async doComplete(request) {
        const claudeMessages = request.messages.map((msg)=>({
                role: msg.role === 'system' ? 'user' : msg.role,
                content: msg.role === 'system' ? `System: ${msg.content}` : msg.content
            }));
        const systemMessage = request.messages.find((m)=>m.role === 'system');
        const response = await this.claudeClient.sendMessage(claudeMessages, {
            model: request.model ? this.mapToAnthropicModel(request.model) : undefined,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            systemPrompt: systemMessage?.content,
            stream: false
        });
        const pricing = this.capabilities.pricing[response.model];
        const promptCost = response.usage.input_tokens / 1000 * pricing.promptCostPer1k;
        const completionCost = response.usage.output_tokens / 1000 * pricing.completionCostPer1k;
        return {
            id: response.id,
            model: this.mapFromAnthropicModel(response.model),
            provider: 'anthropic',
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
                currency: 'USD'
            },
            finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length'
        };
    }
    async *doStreamComplete(request) {
        const claudeMessages = request.messages.map((msg)=>({
                role: msg.role === 'system' ? 'user' : msg.role,
                content: msg.role === 'system' ? `System: ${msg.content}` : msg.content
            }));
        const systemMessage = request.messages.find((m)=>m.role === 'system');
        const stream = await this.claudeClient.sendMessage(claudeMessages, {
            model: request.model ? this.mapToAnthropicModel(request.model) : undefined,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            systemPrompt: systemMessage?.content,
            stream: true
        });
        let accumulatedContent = '';
        let totalTokens = 0;
        for await (const event of stream){
            if (event.type === 'content_block_delta' && event.delta?.text) {
                accumulatedContent += event.delta.text;
                yield {
                    type: 'content',
                    delta: {
                        content: event.delta.text
                    }
                };
            } else if (event.type === 'message_delta' && event.usage) {
                totalTokens = event.usage.output_tokens;
            } else if (event.type === 'message_stop') {
                const model = request.model || this.config.model;
                const pricing = this.capabilities.pricing[model];
                const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
                const completionTokens = totalTokens;
                const promptCost = promptTokens / 1000 * pricing.promptCostPer1k;
                const completionCost = completionTokens / 1000 * pricing.completionCostPer1k;
                yield {
                    type: 'done',
                    usage: {
                        promptTokens,
                        completionTokens,
                        totalTokens: promptTokens + completionTokens
                    },
                    cost: {
                        promptCost,
                        completionCost,
                        totalCost: promptCost + completionCost,
                        currency: 'USD'
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
                'chat',
                'completion',
                ...model.startsWith('claude-3') ? [
                    'vision'
                ] : []
            ],
            pricing: this.capabilities.pricing[model]
        };
    }
    async doHealthCheck() {
        try {
            await this.claudeClient.complete('Hi', {
                maxTokens: 1
            });
            return {
                healthy: true,
                timestamp: new Date()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            };
        }
    }
    mapToAnthropicModel(model) {
        return model;
    }
    mapFromAnthropicModel(model) {
        return model;
    }
    destroy() {
        super.destroy();
        this.claudeClient?.destroy();
    }
}

//# sourceMappingURL=anthropic-provider.js.map