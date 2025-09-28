/**
 * Provider Registry
 * Registry for managing AI coding agent providers
 */

import { EventEmitter } from 'node:events';
import type { AgentProvider } from '../interfaces/abstract-coding-agent.js';
import type { ProviderConfig } from './agent-config-manager.js';

// ===== REGISTRY INTERFACES =====

export interface ProviderRegistryConfig {
  autoDiscovery: boolean;
  cacheEnabled: boolean;
  cacheTtl: number;
  validationEnabled: boolean;
  updateCheckInterval: number;
}

export interface ProviderStatus {
  provider: AgentProvider;
  status: 'active' | 'inactive' | 'maintenance' | 'deprecated';
  lastChecked: Date;
  responseTime: number;
  errorRate: number;
  availability: number; // 0-1
  issues: ProviderIssue[];
}

export interface ProviderIssue {
  type: 'connectivity' | 'performance' | 'rate-limit' | 'authentication' | 'service';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolution?: string;
}

export interface ProviderMetrics {
  provider: AgentProvider;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  totalTokensUsed: number;
  totalCost: number;
  uptime: number;
  lastActivity: Date;
}

export interface ProviderCapability {
  provider: AgentProvider;
  capability: string;
  supported: boolean;
  quality: number; // 0-1
  performance: number; // 0-1
  cost: number; // relative cost
  limitations: string[];
}

export interface ProviderComparison {
  providers: AgentProvider[];
  comparison: {
    capability: string;
    scores: Record<AgentProvider, number>;
    winner: AgentProvider;
    margin: number;
  }[];
  overall: {
    bestOverall: AgentProvider;
    bestPerformance: AgentProvider;
    bestCost: AgentProvider;
    bestQuality: AgentProvider;
  };
}

// ===== PROVIDER REGISTRY CLASS =====

export class ProviderRegistry extends EventEmitter {
  private config: ProviderRegistryConfig;
  private providers = new Map<AgentProvider, ProviderConfig>();
  private providerStatus = new Map<AgentProvider, ProviderStatus>();
  private providerMetrics = new Map<AgentProvider, ProviderMetrics>();
  private providerCapabilities = new Map<string, ProviderCapability[]>();
  private updateInterval?: NodeJS.Timeout;

  constructor(config: Partial<ProviderRegistryConfig> = {}) {
    super();
    
    this.config = {
      autoDiscovery: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes
      validationEnabled: true,
      updateCheckInterval: 600000, // 10 minutes
      ...config
    };

    this.setupEventHandlers();
  }

  // ===== INITIALIZATION =====

  /**
   * Initialize the provider registry
   */
  async initialize(): Promise<void> {
    try {
      // Register default providers
      await this.registerDefaultProviders();
      
      // Start status monitoring if enabled
      if (this.config.autoDiscovery) {
        this.startStatusMonitoring();
      }
      
      this.emit('initialized');
    } catch (error) {
      this.emit('initialization-failed', { error });
      throw error;
    }
  }

  /**
   * Register default providers
   */
  private async registerDefaultProviders(): Promise<void> {
    const defaultProviders: ProviderConfig[] = [
      {
        provider: 'anthropic-claude-code',
        name: 'Claude Code',
        description: 'Anthropic\'s Claude Code for advanced coding assistance',
        version: '1.0.0',
        capabilities: [
          'code-generation',
          'code-review',
          'debugging',
          'refactoring',
          'testing',
          'documentation'
        ],
        requirements: {
          apiKey: true,
          endpoint: 'https://api.anthropic.com/v1',
          model: 'claude-3-sonnet-20240229',
          environment: ['node', 'deno', 'browser'],
          dependencies: ['@anthropic-ai/sdk']
        },
        configuration: {
          defaultModel: 'claude-3-sonnet-20240229',
          defaultTemperature: 0.1,
          defaultMaxTokens: 4000,
          supportedModels: [
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307'
          ],
          supportedLanguages: [
            'typescript',
            'javascript',
            'python',
            'rust',
            'go',
            'java',
            'csharp'
          ],
          supportedFrameworks: [
            'react',
            'vue',
            'angular',
            'express',
            'fastapi',
            'spring'
          ],
          features: [
            'conversation',
            'code-completion',
            'error-analysis',
            'test-generation',
            'documentation'
          ]
        },
        authentication: {
          methods: [{
            type: 'api-key',
            name: 'API Key',
            description: 'Anthropic API key for authentication',
            fields: [{
              name: 'apiKey',
              type: 'password',
              required: true,
              description: 'Your Anthropic API key',
              placeholder: 'sk-ant-...'
            }],
            validation: [{
              type: 'pattern',
              value: '^sk-ant-',
              message: 'API key must start with "sk-ant-"'
            }]
          }],
          required: true,
          refreshable: false
        },
        limits: {
          maxTokensPerRequest: 4000,
          maxRequestsPerMinute: 50,
          maxRequestsPerDay: 10000,
          maxConcurrentRequests: 5,
          maxFileSize: 10 * 1024 * 1024, // 10MB
          timeout: 300000 // 5 minutes
        },
        pricing: {
          model: 'per-token',
          basePrice: 0.000015, // $0.015 per 1K tokens
          currency: 'USD',
          tiers: [{
            name: 'Standard',
            minTokens: 0,
            maxTokens: 1000000,
            pricePerToken: 0.000015,
            features: ['basic-coding', 'code-review', 'debugging']
          }]
        }
      },
      {
        provider: 'openai-codex',
        name: 'OpenAI Codex',
        description: 'OpenAI\'s Codex for code generation and completion',
        version: '1.0.0',
        capabilities: [
          'code-generation',
          'code-completion',
          'debugging',
          'refactoring',
          'testing'
        ],
        requirements: {
          apiKey: true,
          endpoint: 'https://api.openai.com/v1',
          model: 'code-davinci-002',
          environment: ['node', 'python', 'browser'],
          dependencies: ['openai']
        },
        configuration: {
          defaultModel: 'code-davinci-002',
          defaultTemperature: 0.1,
          defaultMaxTokens: 4000,
          supportedModels: [
            'code-davinci-002',
            'code-davinci-001',
            'code-cushman-002'
          ],
          supportedLanguages: [
            'python',
            'javascript',
            'typescript',
            'java',
            'csharp',
            'go',
            'rust',
            'php'
          ],
          supportedFrameworks: [
            'django',
            'flask',
            'fastapi',
            'react',
            'vue',
            'express',
            'spring'
          ],
          features: [
            'code-completion',
            'code-generation',
            'bug-fixing',
            'code-explanation'
          ]
        },
        authentication: {
          methods: [{
            type: 'api-key',
            name: 'API Key',
            description: 'OpenAI API key for authentication',
            fields: [{
              name: 'apiKey',
              type: 'password',
              required: true,
              description: 'Your OpenAI API key',
              placeholder: 'sk-...'
            }],
            validation: [{
              type: 'pattern',
              value: '^sk-',
              message: 'API key must start with "sk-"'
            }]
          }],
          required: true,
          refreshable: false
        },
        limits: {
          maxTokensPerRequest: 4000,
          maxRequestsPerMinute: 60,
          maxRequestsPerDay: 20000,
          maxConcurrentRequests: 10,
          maxFileSize: 25 * 1024 * 1024, // 25MB
          timeout: 300000 // 5 minutes
        },
        pricing: {
          model: 'per-token',
          basePrice: 0.00002, // $0.02 per 1K tokens
          currency: 'USD',
          tiers: [{
            name: 'Standard',
            minTokens: 0,
            maxTokens: 1000000,
            pricePerToken: 0.00002,
            features: ['code-generation', 'completion', 'debugging']
          }]
        }
      },
      {
        provider: 'google-gemini',
        name: 'Google Gemini',
        description: 'Google\'s Gemini for multimodal AI assistance',
        version: '1.0.0',
        capabilities: [
          'code-generation',
          'code-review',
          'debugging',
          'documentation',
          'analysis'
        ],
        requirements: {
          apiKey: true,
          endpoint: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-pro',
          environment: ['node', 'python', 'browser'],
          dependencies: ['@google/generative-ai']
        },
        configuration: {
          defaultModel: 'gemini-pro',
          defaultTemperature: 0.1,
          defaultMaxTokens: 8000,
          supportedModels: [
            'gemini-pro',
            'gemini-pro-vision',
            'gemini-ultra'
          ],
          supportedLanguages: [
            'python',
            'javascript',
            'typescript',
            'java',
            'go',
            'rust'
          ],
          supportedFrameworks: [
            'django',
            'flask',
            'react',
            'vue',
            'express'
          ],
          features: [
            'multimodal',
            'code-generation',
            'analysis',
            'reasoning'
          ]
        },
        authentication: {
          methods: [{
            type: 'api-key',
            name: 'API Key',
            description: 'Google AI API key for authentication',
            fields: [{
              name: 'apiKey',
              type: 'password',
              required: true,
              description: 'Your Google AI API key',
              placeholder: 'AIza...'
            }],
            validation: [{
              type: 'pattern',
              value: '^AIza',
              message: 'API key must start with "AIza"'
            }]
          }],
          required: true,
          refreshable: false
        },
        limits: {
          maxTokensPerRequest: 8000,
          maxRequestsPerMinute: 100,
          maxRequestsPerDay: 15000,
          maxConcurrentRequests: 8,
          maxFileSize: 20 * 1024 * 1024, // 20MB
          timeout: 300000 // 5 minutes
        },
        pricing: {
          model: 'per-token',
          basePrice: 0.00001, // $0.01 per 1K tokens
          currency: 'USD',
          tiers: [{
            name: 'Standard',
            minTokens: 0,
            maxTokens: 1000000,
            pricePerToken: 0.00001,
            features: ['code-generation', 'analysis', 'multimodal']
          }]
        }
      },
      {
        provider: 'cursor-ai',
        name: 'Cursor AI',
        description: 'Cursor AI for intelligent code editing',
        version: '1.0.0',
        capabilities: [
          'code-generation',
          'code-completion',
          'refactoring',
          'debugging',
          'testing'
        ],
        requirements: {
          apiKey: true,
          endpoint: 'https://api.cursor.sh/v1',
          model: 'cursor-pro',
          environment: ['node', 'python', 'browser'],
          dependencies: ['@cursor-ai/sdk']
        },
        configuration: {
          defaultModel: 'cursor-pro',
          defaultTemperature: 0.1,
          defaultMaxTokens: 6000,
          supportedModels: [
            'cursor-pro',
            'cursor-fast',
            'cursor-code'
          ],
          supportedLanguages: [
            'typescript',
            'javascript',
            'python',
            'rust',
            'go',
            'java',
            'csharp'
          ],
          supportedFrameworks: [
            'react',
            'vue',
            'angular',
            'express',
            'fastapi',
            'spring'
          ],
          features: [
            'code-completion',
            'inline-editing',
            'chat',
            'codebase-understanding'
          ]
        },
        authentication: {
          methods: [{
            type: 'api-key',
            name: 'API Key',
            description: 'Cursor AI API key for authentication',
            fields: [{
              name: 'apiKey',
              type: 'password',
              required: true,
              description: 'Your Cursor AI API key',
              placeholder: 'cur_...'
            }],
            validation: [{
              type: 'pattern',
              value: '^cur_',
              message: 'API key must start with "cur_"'
            }]
          }],
          required: true,
          refreshable: false
        },
        limits: {
          maxTokensPerRequest: 6000,
          maxRequestsPerMinute: 80,
          maxRequestsPerDay: 12000,
          maxConcurrentRequests: 6,
          maxFileSize: 15 * 1024 * 1024, // 15MB
          timeout: 300000 // 5 minutes
        },
        pricing: {
          model: 'subscription',
          basePrice: 20, // $20/month
          currency: 'USD',
          tiers: [{
            name: 'Pro',
            minTokens: 0,
            maxTokens: 1000000,
            pricePerToken: 0,
            features: ['unlimited-usage', 'priority-support', 'advanced-features']
          }]
        }
      }
    ];

    for (const provider of defaultProviders) {
      await this.registerProvider(provider);
    }
  }

  // ===== PROVIDER MANAGEMENT =====

  /**
   * Register a provider
   */
  async registerProvider(providerConfig: ProviderConfig): Promise<void> {
    if (this.providers.has(providerConfig.provider)) {
      throw new Error(`Provider ${providerConfig.provider} is already registered`);
    }

    // Validate provider configuration
    if (this.config.validationEnabled) {
      await this.validateProviderConfig(providerConfig);
    }

    // Register provider
    this.providers.set(providerConfig.provider, providerConfig);

    // Initialize provider status
    this.providerStatus.set(providerConfig.provider, {
      provider: providerConfig.provider,
      status: 'active',
      lastChecked: new Date(),
      responseTime: 0,
      errorRate: 0,
      availability: 1.0,
      issues: []
    });

    // Initialize provider metrics
    this.providerMetrics.set(providerConfig.provider, {
      provider: providerConfig.provider,
      requests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      uptime: 100,
      lastActivity: new Date()
    });

    // Initialize provider capabilities
    this.initializeProviderCapabilities(providerConfig);

    this.emit('provider-registered', { provider: providerConfig.provider });
  }

  /**
   * Unregister a provider
   */
  async unregisterProvider(provider: AgentProvider): Promise<void> {
    if (!this.providers.has(provider)) {
      throw new Error(`Provider ${provider} is not registered`);
    }

    this.providers.delete(provider);
    this.providerStatus.delete(provider);
    this.providerMetrics.delete(provider);

    // Remove capabilities
    for (const [capability, providers] of this.providerCapabilities) {
      const filtered = providers.filter(p => p.provider !== provider);
      if (filtered.length === 0) {
        this.providerCapabilities.delete(capability);
      } else {
        this.providerCapabilities.set(capability, filtered);
      }
    }

    this.emit('provider-unregistered', { provider });
  }

  /**
   * Get provider configuration
   */
  getProvider(provider: AgentProvider): ProviderConfig | undefined {
    return this.providers.get(provider);
  }

  /**
   * Get all providers
   */
  getAllProviders(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get supported providers
   */
  getSupportedProviders(): AgentProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if provider is supported
   */
  isProviderSupported(provider: AgentProvider): boolean {
    return this.providers.has(provider);
  }

  // ===== PROVIDER STATUS =====

  /**
   * Get provider status
   */
  getProviderStatus(provider: AgentProvider): ProviderStatus | undefined {
    return this.providerStatus.get(provider);
  }

  /**
   * Get all provider statuses
   */
  getAllProviderStatuses(): ProviderStatus[] {
    return Array.from(this.providerStatus.values());
  }

  /**
   * Check provider health
   */
  async checkProviderHealth(provider: AgentProvider): Promise<ProviderStatus> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`Provider ${provider} not found`);
    }

    const startTime = Date.now();
    let responseTime = 0;
    let errorRate = 0;
    let availability = 1.0;
    const issues: ProviderIssue[] = [];

    try {
      // Perform health check
      const healthCheckResult = await this.performHealthCheck(providerConfig);
      responseTime = Date.now() - startTime;
      
      if (healthCheckResult.success) {
        availability = 1.0;
      } else {
        availability = 0.5;
        issues.push({
          type: 'connectivity',
          severity: 'medium',
          message: healthCheckResult.error || 'Health check failed',
          timestamp: new Date(),
          resolved: false
        });
      }
    } catch (error) {
      responseTime = Date.now() - startTime;
      errorRate = 1.0;
      availability = 0.0;
      issues.push({
        type: 'connectivity',
        severity: 'critical',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
        resolved: false
      });
    }

    // Update provider status
    const status: ProviderStatus = {
      provider,
      status: availability > 0.8 ? 'active' : availability > 0.5 ? 'inactive' : 'maintenance',
      lastChecked: new Date(),
      responseTime,
      errorRate,
      availability,
      issues
    };

    this.providerStatus.set(provider, status);
    this.emit('provider-health-checked', { provider, status });

    return status;
  }

  /**
   * Perform health check for provider
   */
  private async performHealthCheck(providerConfig: ProviderConfig): Promise<{ success: boolean; error?: string }> {
    try {
      // Simulate health check based on provider type
      switch (providerConfig.provider) {
        case 'anthropic-claude-code':
          return await this.checkAnthropicHealth(providerConfig);
        case 'openai-codex':
          return await this.checkOpenAIHealth(providerConfig);
        case 'google-gemini':
          return await this.checkGoogleHealth(providerConfig);
        case 'cursor-ai':
          return await this.checkCursorHealth(providerConfig);
        default:
          return { success: true };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Check Anthropic health
   */
  private async checkAnthropicHealth(providerConfig: ProviderConfig): Promise<{ success: boolean; error?: string }> {
    // Simulate Anthropic API health check
    return { success: true };
  }

  /**
   * Check OpenAI health
   */
  private async checkOpenAIHealth(providerConfig: ProviderConfig): Promise<{ success: boolean; error?: string }> {
    // Simulate OpenAI API health check
    return { success: true };
  }

  /**
   * Check Google health
   */
  private async checkGoogleHealth(providerConfig: ProviderConfig): Promise<{ success: boolean; error?: string }> {
    // Simulate Google API health check
    return { success: true };
  }

  /**
   * Check Cursor health
   */
  private async checkCursorHealth(providerConfig: ProviderConfig): Promise<{ success: boolean; error?: string }> {
    // Simulate Cursor API health check
    return { success: true };
  }

  // ===== PROVIDER METRICS =====

  /**
   * Get provider metrics
   */
  getProviderMetrics(provider: AgentProvider): ProviderMetrics | undefined {
    return this.providerMetrics.get(provider);
  }

  /**
   * Get all provider metrics
   */
  getAllProviderMetrics(): ProviderMetrics[] {
    return Array.from(this.providerMetrics.values());
  }

  /**
   * Update provider metrics
   */
  updateProviderMetrics(
    provider: AgentProvider,
    metrics: {
      requestTime?: number;
      tokensUsed?: number;
      cost?: number;
      success?: boolean;
    }
  ): void {
    const currentMetrics = this.providerMetrics.get(provider);
    if (!currentMetrics) {
      return;
    }

    // Update request counts
    currentMetrics.requests++;
    if (metrics.success) {
      currentMetrics.successfulRequests++;
    } else {
      currentMetrics.failedRequests++;
    }

    // Update response time
    if (metrics.requestTime) {
      const totalTime = currentMetrics.averageResponseTime * (currentMetrics.requests - 1) + metrics.requestTime;
      currentMetrics.averageResponseTime = totalTime / currentMetrics.requests;
    }

    // Update tokens and cost
    if (metrics.tokensUsed) {
      currentMetrics.totalTokensUsed += metrics.tokensUsed;
    }
    if (metrics.cost) {
      currentMetrics.totalCost += metrics.cost;
    }

    // Update last activity
    currentMetrics.lastActivity = new Date();

    // Update uptime
    const successRate = currentMetrics.successfulRequests / currentMetrics.requests;
    currentMetrics.uptime = successRate * 100;

    this.providerMetrics.set(provider, currentMetrics);
    this.emit('provider-metrics-updated', { provider, metrics: currentMetrics });
  }

  // ===== PROVIDER CAPABILITIES =====

  /**
   * Get providers by capability
   */
  getProvidersByCapability(capability: string): ProviderCapability[] {
    return this.providerCapabilities.get(capability) || [];
  }

  /**
   * Get all capabilities
   */
  getAllCapabilities(): string[] {
    return Array.from(this.providerCapabilities.keys());
  }

  /**
   * Compare providers by capability
   */
  compareProvidersByCapability(capability: string): ProviderComparison | null {
    const providers = this.getProvidersByCapability(capability);
    if (providers.length === 0) {
      return null;
    }

    const comparison: ProviderComparison = {
      providers: providers.map(p => p.provider),
      comparison: [{
        capability,
        scores: providers.reduce((acc, p) => {
          acc[p.provider] = (p.quality + p.performance) / 2;
          return acc;
        }, {} as Record<AgentProvider, number>),
        winner: providers.reduce((best, current) => 
          (current.quality + current.performance) / 2 > (best.quality + best.performance) / 2 ? current : best
        ).provider,
        margin: 0
      }],
      overall: {
        bestOverall: providers.reduce((best, current) => 
          (current.quality + current.performance) / 2 > (best.quality + best.performance) / 2 ? current : best
        ).provider,
        bestPerformance: providers.reduce((best, current) => 
          current.performance > best.performance ? current : best
        ).provider,
        bestCost: providers.reduce((best, current) => 
          current.cost < best.cost ? current : best
        ).provider,
        bestQuality: providers.reduce((best, current) => 
          current.quality > best.quality ? current : best
        ).provider
      }
    };

    return comparison;
  }

  /**
   * Initialize provider capabilities
   */
  private initializeProviderCapabilities(providerConfig: ProviderConfig): void {
    for (const capability of providerConfig.capabilities) {
      if (!this.providerCapabilities.has(capability)) {
        this.providerCapabilities.set(capability, []);
      }

      const capabilityEntry: ProviderCapability = {
        provider: providerConfig.provider,
        capability,
        supported: true,
        quality: this.getCapabilityQuality(providerConfig.provider, capability),
        performance: this.getCapabilityPerformance(providerConfig.provider, capability),
        cost: this.getCapabilityCost(providerConfig.provider, capability),
        limitations: this.getCapabilityLimitations(providerConfig.provider, capability)
      };

      this.providerCapabilities.get(capability)!.push(capabilityEntry);
    }
  }

  /**
   * Get capability quality score
   */
  private getCapabilityQuality(provider: AgentProvider, capability: string): number {
    const qualityMap: Record<string, Record<AgentProvider, number>> = {
      'code-generation': {
        'anthropic-claude-code': 0.95,
        'openai-codex': 0.9,
        'google-gemini': 0.85,
        'cursor-ai': 0.9
      },
      'code-review': {
        'anthropic-claude-code': 0.9,
        'openai-codex': 0.8,
        'google-gemini': 0.85,
        'cursor-ai': 0.85
      },
      'debugging': {
        'anthropic-claude-code': 0.9,
        'openai-codex': 0.85,
        'google-gemini': 0.8,
        'cursor-ai': 0.9
      },
      'testing': {
        'anthropic-claude-code': 0.85,
        'openai-codex': 0.8,
        'google-gemini': 0.75,
        'cursor-ai': 0.8
      },
      'documentation': {
        'anthropic-claude-code': 0.9,
        'openai-codex': 0.8,
        'google-gemini': 0.85,
        'cursor-ai': 0.8
      }
    };

    return qualityMap[capability]?.[provider] || 0.8;
  }

  /**
   * Get capability performance score
   */
  private getCapabilityPerformance(provider: AgentProvider, capability: string): number {
    const performanceMap: Record<string, Record<AgentProvider, number>> = {
      'code-generation': {
        'anthropic-claude-code': 0.9,
        'openai-codex': 0.85,
        'google-gemini': 0.8,
        'cursor-ai': 0.9
      },
      'code-review': {
        'anthropic-claude-code': 0.85,
        'openai-codex': 0.8,
        'google-gemini': 0.8,
        'cursor-ai': 0.85
      },
      'debugging': {
        'anthropic-claude-code': 0.85,
        'openai-codex': 0.8,
        'google-gemini': 0.75,
        'cursor-ai': 0.85
      },
      'testing': {
        'anthropic-claude-code': 0.8,
        'openai-codex': 0.75,
        'google-gemini': 0.7,
        'cursor-ai': 0.8
      },
      'documentation': {
        'anthropic-claude-code': 0.85,
        'openai-codex': 0.8,
        'google-gemini': 0.8,
        'cursor-ai': 0.8
      }
    };

    return performanceMap[capability]?.[provider] || 0.8;
  }

  /**
   * Get capability cost score
   */
  private getCapabilityCost(provider: AgentProvider, capability: string): number {
    const costMap: Record<AgentProvider, number> = {
      'anthropic-claude-code': 1.0,
      'openai-codex': 0.8,
      'google-gemini': 0.6,
      'cursor-ai': 1.2
    };

    return costMap[provider] || 1.0;
  }

  /**
   * Get capability limitations
   */
  private getCapabilityLimitations(provider: AgentProvider, capability: string): string[] {
    const limitations: Record<AgentProvider, string[]> = {
      'anthropic-claude-code': ['Rate limits', 'Token limits'],
      'openai-codex': ['Rate limits', 'Model availability'],
      'google-gemini': ['Rate limits', 'Regional restrictions'],
      'cursor-ai': ['Subscription required', 'Usage limits']
    };

    return limitations[provider] || [];
  }

  // ===== STATUS MONITORING =====

  /**
   * Start status monitoring
   */
  private startStatusMonitoring(): void {
    this.updateInterval = setInterval(async () => {
      await this.updateAllProviderStatuses();
    }, this.config.updateCheckInterval);
  }

  /**
   * Stop status monitoring
   */
  private stopStatusMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }

  /**
   * Update all provider statuses
   */
  private async updateAllProviderStatuses(): Promise<void> {
    const providers = Array.from(this.providers.keys());
    
    for (const provider of providers) {
      try {
        await this.checkProviderHealth(provider);
      } catch (error) {
        console.error(`Failed to check health for provider ${provider}:`, error);
      }
    }
  }

  // ===== VALIDATION =====

  /**
   * Validate provider configuration
   */
  private async validateProviderConfig(providerConfig: ProviderConfig): Promise<void> {
    // Validate required fields
    if (!providerConfig.provider) {
      throw new Error('Provider is required');
    }

    if (!providerConfig.name) {
      throw new Error('Provider name is required');
    }

    if (!providerConfig.version) {
      throw new Error('Provider version is required');
    }

    if (!providerConfig.capabilities || providerConfig.capabilities.length === 0) {
      throw new Error('Provider capabilities are required');
    }

    if (!providerConfig.requirements) {
      throw new Error('Provider requirements are required');
    }

    if (!providerConfig.configuration) {
      throw new Error('Provider configuration is required');
    }

    if (!providerConfig.authentication) {
      throw new Error('Provider authentication is required');
    }

    if (!providerConfig.limits) {
      throw new Error('Provider limits are required');
    }

    if (!providerConfig.pricing) {
      throw new Error('Provider pricing is required');
    }
  }

  // ===== EVENT HANDLERS =====

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.on('provider-registered', (data) => {
      console.log(`Provider registered: ${data.provider}`);
    });

    this.on('provider-unregistered', (data) => {
      console.log(`Provider unregistered: ${data.provider}`);
    });

    this.on('provider-health-checked', (data) => {
      console.log(`Provider health checked: ${data.provider} - ${data.status.status}`);
    });

    this.on('provider-metrics-updated', (data) => {
      console.log(`Provider metrics updated: ${data.provider}`);
    });
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    this.stopStatusMonitoring();
    this.emit('shutdown');
  }
}

// ===== EXPORTS =====

export default ProviderRegistry;