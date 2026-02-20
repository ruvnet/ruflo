/**
 * Agent Configuration Manager
 * Manages configuration for abstract agents and their providers
 */

import { EventEmitter } from 'node:events';
import type { AgentConfiguration, AgentProvider } from '../interfaces/abstract-coding-agent.js';

// ===== CONFIGURATION INTERFACES =====

export interface AgentConfigManagerConfig {
  configPath: string;
  autoSave: boolean;
  validationEnabled: boolean;
  encryptionEnabled: boolean;
  backupEnabled: boolean;
  maxBackups: number;
}

export interface ProviderConfig {
  provider: AgentProvider;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  requirements: ProviderRequirements;
  configuration: ProviderConfiguration;
  authentication: AuthenticationConfig;
  limits: ProviderLimits;
  pricing: PricingConfig;
}

export interface ProviderRequirements {
  apiKey: boolean;
  endpoint?: string;
  model?: string;
  environment?: string[];
  dependencies?: string[];
  minimumVersion?: string;
}

export interface ProviderConfiguration {
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  supportedModels: string[];
  supportedLanguages: string[];
  supportedFrameworks: string[];
  features: string[];
}

export interface AuthenticationConfig {
  methods: AuthenticationMethod[];
  required: boolean;
  refreshable: boolean;
  expiresIn?: number;
}

export interface AuthenticationMethod {
  type: 'api-key' | 'oauth' | 'jwt' | 'certificate' | 'custom';
  name: string;
  description: string;
  fields: AuthenticationField[];
  validation: ValidationRule[];
}

export interface AuthenticationField {
  name: string;
  type: 'string' | 'password' | 'number' | 'boolean' | 'url' | 'email';
  required: boolean;
  description: string;
  placeholder?: string;
  defaultValue?: any;
  validation?: ValidationRule[];
}

export interface ValidationRule {
  type: 'required' | 'min-length' | 'max-length' | 'pattern' | 'range' | 'custom';
  value?: any;
  message: string;
  validator?: (value: any) => boolean;
}

export interface ProviderLimits {
  maxTokensPerRequest: number;
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  maxConcurrentRequests: number;
  maxFileSize: number;
  timeout: number;
}

export interface PricingConfig {
  model: 'per-token' | 'per-request' | 'per-minute' | 'subscription' | 'free';
  basePrice: number;
  currency: string;
  tiers?: PricingTier[];
  freeTier?: FreeTierConfig;
}

export interface PricingTier {
  name: string;
  minTokens: number;
  maxTokens: number;
  pricePerToken: number;
  features: string[];
}

export interface FreeTierConfig {
  maxTokensPerDay: number;
  maxRequestsPerDay: number;
  features: string[];
  limitations: string[];
}

export interface AgentConfigTemplate {
  id: string;
  name: string;
  description: string;
  provider: AgentProvider;
  configuration: Partial<AgentConfiguration>;
  tags: string[];
  category: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  usage: number;
  rating: number;
}

export interface ConfigurationValidationResult {
  valid: boolean;
  errors: ConfigurationError[];
  warnings: ConfigurationWarning[];
  suggestions: ConfigurationSuggestion[];
}

export interface ConfigurationError {
  field: string;
  message: string;
  code: string;
  severity: 'error' | 'critical';
}

export interface ConfigurationWarning {
  field: string;
  message: string;
  code: string;
  recommendation: string;
}

export interface ConfigurationSuggestion {
  field: string;
  message: string;
  improvement: string;
  impact: 'low' | 'medium' | 'high';
}

// ===== AGENT CONFIG MANAGER CLASS =====

export class AgentConfigManager extends EventEmitter {
  private config: AgentConfigManagerConfig;
  private providerConfigs = new Map<AgentProvider, ProviderConfig>();
  private agentConfigs = new Map<string, AgentConfiguration>();
  private configTemplates = new Map<string, AgentConfigTemplate>();
  private validationRules = new Map<string, ValidationRule[]>();

  constructor(config: Partial<AgentConfigManagerConfig> = {}) {
    super();
    
    this.config = {
      configPath: './config/agents',
      autoSave: true,
      validationEnabled: true,
      encryptionEnabled: false,
      backupEnabled: true,
      maxBackups: 10,
      ...config
    };

    this.initializeDefaultProviderConfigs();
    this.setupEventHandlers();
  }

  // ===== INITIALIZATION =====

  /**
   * Initialize the configuration manager
   */
  async initialize(): Promise<void> {
    try {
      // Load existing configurations
      await this.loadConfigurations();
      
      // Load configuration templates
      await this.loadConfigTemplates();
      
      // Setup validation rules
      this.setupValidationRules();
      
      this.emit('initialized');
    } catch (error) {
      this.emit('initialization-failed', { error });
      throw error;
    }
  }

  /**
   * Initialize default provider configurations
   */
  private initializeDefaultProviderConfigs(): void {
    // Claude Code configuration
    this.providerConfigs.set('anthropic-claude-code', {
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
    });

    // OpenAI Codex configuration
    this.providerConfigs.set('openai-codex', {
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
    });

    // Google Gemini configuration
    this.providerConfigs.set('google-gemini', {
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
    });

    // Cursor AI configuration
    this.providerConfigs.set('cursor-ai', {
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
    });
  }

  // ===== CONFIGURATION MANAGEMENT =====

  /**
   * Create agent configuration
   */
  async createAgentConfig(
    agentId: string,
    provider: AgentProvider,
    config: Partial<AgentConfiguration>
  ): Promise<AgentConfiguration> {
    const providerConfig = this.providerConfigs.get(provider);
    if (!providerConfig) {
      throw new Error(`Provider ${provider} not supported`);
    }

    // Create base configuration
    const agentConfig: AgentConfiguration = {
      provider,
      apiKey: config.apiKey || '',
      endpoint: config.endpoint || providerConfig.requirements.endpoint,
      model: config.model || providerConfig.configuration.defaultModel,
      capabilities: config.capabilities || {},
      limits: {
        maxConcurrentTasks: 3,
        maxTokensPerRequest: providerConfig.limits.maxTokensPerRequest,
        maxExecutionTime: providerConfig.limits.timeout,
        maxMemoryUsage: 512 * 1024 * 1024, // 512MB
        maxCpuUsage: 1.0,
        rateLimitPerMinute: providerConfig.limits.maxRequestsPerMinute,
        dailyTokenLimit: providerConfig.limits.maxRequestsPerDay * providerConfig.limits.maxTokensPerRequest,
        dailyCostLimit: 10.0, // $10 default
        ...config.limits
      },
      preferences: {
        codeStyle: {
          indentation: 'spaces',
          indentSize: 2,
          lineLength: 80,
          quoteStyle: 'single',
          semicolons: true,
          trailingCommas: true,
          ...config.preferences?.codeStyle
        },
        languagePreferences: {
          primary: providerConfig.configuration.supportedLanguages.slice(0, 3),
          secondary: providerConfig.configuration.supportedLanguages.slice(3),
          avoid: [],
          versions: {},
          ...config.preferences?.languagePreferences
        },
        frameworkPreferences: {
          preferred: providerConfig.configuration.supportedFrameworks.slice(0, 3),
          avoid: [],
          versions: {},
          ...config.preferences?.frameworkPreferences
        },
        qualityPreferences: {
          minQuality: 0.8,
          testCoverage: 0.8,
          documentationLevel: 'standard',
          codeReview: true,
          linting: true,
          ...config.preferences?.qualityPreferences
        },
        outputPreferences: {
          format: 'detailed',
          includeComments: true,
          includeTests: true,
          includeDocumentation: true,
          includeExamples: false,
          ...config.preferences?.outputPreferences
        },
        ...config.preferences
      },
      security: {
        encryption: this.config.encryptionEnabled,
        authentication: {
          method: 'api-key',
          credentials: { apiKey: config.apiKey || '' },
          ...config.security?.authentication
        },
        authorization: {
          permissions: ['read', 'write', 'execute'],
          roles: ['developer'],
          restrictions: [],
          ...config.security?.authorization
        },
        audit: {
          enabled: true,
          level: 'basic',
          retention: 30,
          ...config.security?.audit
        },
        ...config.security
      },
      performance: {
        timeout: providerConfig.limits.timeout,
        retries: 3,
        caching: {
          enabled: true,
          ttl: 300, // 5 minutes
          maxSize: 100 * 1024 * 1024, // 100MB
          strategy: 'lru',
          ...config.performance?.caching
        },
        optimization: {
          enabled: true,
          strategies: ['parallel', 'caching', 'compression'],
          thresholds: {
            responseTime: 1000,
            memoryUsage: 0.8,
            cpuUsage: 0.8
          },
          ...config.performance?.optimization
        },
        ...config.performance
      },
      ...config
    };

    // Validate configuration
    if (this.config.validationEnabled) {
      const validation = await this.validateConfiguration(agentConfig);
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }
    }

    // Store configuration
    this.agentConfigs.set(agentId, agentConfig);

    // Auto-save if enabled
    if (this.config.autoSave) {
      await this.saveConfiguration(agentId, agentConfig);
    }

    this.emit('agent-config-created', { agentId, config: agentConfig });

    return agentConfig;
  }

  /**
   * Update agent configuration
   */
  async updateAgentConfig(
    agentId: string,
    updates: Partial<AgentConfiguration>
  ): Promise<AgentConfiguration> {
    const existingConfig = this.agentConfigs.get(agentId);
    if (!existingConfig) {
      throw new Error(`Agent configuration ${agentId} not found`);
    }

    // Merge updates
    const updatedConfig: AgentConfiguration = {
      ...existingConfig,
      ...updates,
      limits: { ...existingConfig.limits, ...updates.limits },
      preferences: { ...existingConfig.preferences, ...updates.preferences },
      security: { ...existingConfig.security, ...updates.security },
      performance: { ...existingConfig.performance, ...updates.performance }
    };

    // Validate updated configuration
    if (this.config.validationEnabled) {
      const validation = await this.validateConfiguration(updatedConfig);
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }
    }

    // Store updated configuration
    this.agentConfigs.set(agentId, updatedConfig);

    // Auto-save if enabled
    if (this.config.autoSave) {
      await this.saveConfiguration(agentId, updatedConfig);
    }

    this.emit('agent-config-updated', { agentId, config: updatedConfig });

    return updatedConfig;
  }

  /**
   * Get agent configuration
   */
  getAgentConfig(agentId: string): AgentConfiguration | undefined {
    return this.agentConfigs.get(agentId);
  }

  /**
   * Delete agent configuration
   */
  async deleteAgentConfig(agentId: string): Promise<void> {
    const config = this.agentConfigs.get(agentId);
    if (!config) {
      throw new Error(`Agent configuration ${agentId} not found`);
    }

    this.agentConfigs.delete(agentId);

    // Auto-save if enabled
    if (this.config.autoSave) {
      await this.deleteConfiguration(agentId);
    }

    this.emit('agent-config-deleted', { agentId });
  }

  // ===== PROVIDER MANAGEMENT =====

  /**
   * Get provider configuration
   */
  getProviderConfig(provider: AgentProvider): ProviderConfig | undefined {
    return this.providerConfigs.get(provider);
  }

  /**
   * Get all provider configurations
   */
  getAllProviderConfigs(): ProviderConfig[] {
    return Array.from(this.providerConfigs.values());
  }

  /**
   * Get supported providers
   */
  getSupportedProviders(): AgentProvider[] {
    return Array.from(this.providerConfigs.keys());
  }

  /**
   * Check if provider is supported
   */
  isProviderSupported(provider: AgentProvider): boolean {
    return this.providerConfigs.has(provider);
  }

  // ===== CONFIGURATION TEMPLATES =====

  /**
   * Create configuration template
   */
  async createConfigTemplate(
    template: Omit<AgentConfigTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usage' | 'rating'>
  ): Promise<AgentConfigTemplate> {
    const configTemplate: AgentConfigTemplate = {
      ...template,
      id: this.generateTemplateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      usage: 0,
      rating: 0
    };

    this.configTemplates.set(configTemplate.id, configTemplate);

    // Auto-save if enabled
    if (this.config.autoSave) {
      await this.saveConfigTemplate(configTemplate);
    }

    this.emit('config-template-created', { template: configTemplate });

    return configTemplate;
  }

  /**
   * Get configuration template
   */
  getConfigTemplate(templateId: string): AgentConfigTemplate | undefined {
    return this.configTemplates.get(templateId);
  }

  /**
   * Get all configuration templates
   */
  getAllConfigTemplates(): AgentConfigTemplate[] {
    return Array.from(this.configTemplates.values());
  }

  /**
   * Search configuration templates
   */
  searchConfigTemplates(query: {
    provider?: AgentProvider;
    category?: string;
    tags?: string[];
    minRating?: number;
  }): AgentConfigTemplate[] {
    let templates = Array.from(this.configTemplates.values());

    if (query.provider) {
      templates = templates.filter(t => t.provider === query.provider);
    }

    if (query.category) {
      templates = templates.filter(t => t.category === query.category);
    }

    if (query.tags && query.tags.length > 0) {
      templates = templates.filter(t => 
        query.tags!.some(tag => t.tags.includes(tag))
      );
    }

    if (query.minRating !== undefined) {
      templates = templates.filter(t => t.rating >= query.minRating!);
    }

    return templates.sort((a, b) => b.rating - a.rating);
  }

  /**
   * Apply configuration template
   */
  async applyConfigTemplate(
    agentId: string,
    templateId: string,
    overrides: Partial<AgentConfiguration> = {}
  ): Promise<AgentConfiguration> {
    const template = this.configTemplates.get(templateId);
    if (!template) {
      throw new Error(`Configuration template ${templateId} not found`);
    }

    // Update template usage
    template.usage++;
    template.updatedAt = new Date();

    // Create configuration from template
    const config = await this.createAgentConfig(
      agentId,
      template.provider,
      {
        ...template.configuration,
        ...overrides
      }
    );

    this.emit('config-template-applied', { agentId, templateId, config });

    return config;
  }

  // ===== VALIDATION =====

  /**
   * Validate agent configuration
   */
  async validateConfiguration(config: AgentConfiguration): Promise<ConfigurationValidationResult> {
    const errors: ConfigurationError[] = [];
    const warnings: ConfigurationWarning[] = [];
    const suggestions: ConfigurationSuggestion[] = [];

    // Get provider configuration
    const providerConfig = this.providerConfigs.get(config.provider);
    if (!providerConfig) {
      errors.push({
        field: 'provider',
        message: `Provider ${config.provider} is not supported`,
        code: 'UNSUPPORTED_PROVIDER',
        severity: 'critical'
      });
      return { valid: false, errors, warnings, suggestions };
    }

    // Validate authentication
    if (providerConfig.authentication.required) {
      if (!config.apiKey) {
        errors.push({
          field: 'apiKey',
          message: 'API key is required for this provider',
          code: 'MISSING_API_KEY',
          severity: 'critical'
        });
      } else {
        // Validate API key format
        const authMethod = providerConfig.authentication.methods[0];
        if (authMethod) {
          for (const rule of authMethod.validation) {
            if (!this.validateField(config.apiKey, rule)) {
              errors.push({
                field: 'apiKey',
                message: rule.message,
                code: 'INVALID_API_KEY',
                severity: 'error'
              });
            }
          }
        }
      }
    }

    // Validate model
    if (config.model && !providerConfig.configuration.supportedModels.includes(config.model)) {
      warnings.push({
        field: 'model',
        message: `Model ${config.model} may not be supported by this provider`,
        code: 'UNSUPPORTED_MODEL',
        recommendation: `Use one of: ${providerConfig.configuration.supportedModels.join(', ')}`
      });
    }

    // Validate limits
    if (config.limits.maxTokensPerRequest > providerConfig.limits.maxTokensPerRequest) {
      errors.push({
        field: 'limits.maxTokensPerRequest',
        message: `Max tokens per request exceeds provider limit of ${providerConfig.limits.maxTokensPerRequest}`,
        code: 'LIMIT_EXCEEDED',
        severity: 'error'
      });
    }

    if (config.limits.maxConcurrentTasks > providerConfig.limits.maxConcurrentRequests) {
      errors.push({
        field: 'limits.maxConcurrentTasks',
        message: `Max concurrent tasks exceeds provider limit of ${providerConfig.limits.maxConcurrentRequests}`,
        code: 'LIMIT_EXCEEDED',
        severity: 'error'
      });
    }

    // Validate preferences
    if (config.preferences.languagePreferences.primary.length === 0) {
      suggestions.push({
        field: 'preferences.languagePreferences.primary',
        message: 'No primary languages specified',
        improvement: 'Specify at least one primary language for better performance',
        impact: 'medium'
      });
    }

    // Check for unsupported languages
    const unsupportedLanguages = config.preferences.languagePreferences.primary.filter(
      lang => !providerConfig.configuration.supportedLanguages.includes(lang)
    );
    if (unsupportedLanguages.length > 0) {
      warnings.push({
        field: 'preferences.languagePreferences.primary',
        message: `Some primary languages are not supported by this provider: ${unsupportedLanguages.join(', ')}`,
        code: 'UNSUPPORTED_LANGUAGES',
        recommendation: 'Consider using supported languages or switch to a different provider'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };
  }

  /**
   * Validate field value against rule
   */
  private validateField(value: any, rule: ValidationRule): boolean {
    switch (rule.type) {
      case 'required':
        return value !== null && value !== undefined && value !== '';
      case 'min-length':
        return typeof value === 'string' && value.length >= rule.value;
      case 'max-length':
        return typeof value === 'string' && value.length <= rule.value;
      case 'pattern':
        return typeof value === 'string' && new RegExp(rule.value).test(value);
      case 'range':
        return typeof value === 'number' && value >= rule.value.min && value <= rule.value.max;
      case 'custom':
        return rule.validator ? rule.validator(value) : true;
      default:
        return true;
    }
  }

  // ===== PERSISTENCE =====

  /**
   * Load configurations from storage
   */
  private async loadConfigurations(): Promise<void> {
    // This would load from file system or database
    // For now, we'll simulate it
    console.log('Loading agent configurations...');
  }

  /**
   * Load configuration templates from storage
   */
  private async loadConfigTemplates(): Promise<void> {
    // This would load from file system or database
    // For now, we'll simulate it
    console.log('Loading configuration templates...');
  }

  /**
   * Save configuration to storage
   */
  private async saveConfiguration(agentId: string, config: AgentConfiguration): Promise<void> {
    // This would save to file system or database
    console.log(`Saving configuration for agent ${agentId}...`);
  }

  /**
   * Delete configuration from storage
   */
  private async deleteConfiguration(agentId: string): Promise<void> {
    // This would delete from file system or database
    console.log(`Deleting configuration for agent ${agentId}...`);
  }

  /**
   * Save configuration template to storage
   */
  private async saveConfigTemplate(template: AgentConfigTemplate): Promise<void> {
    // This would save to file system or database
    console.log(`Saving configuration template ${template.id}...`);
  }

  // ===== UTILITIES =====

  /**
   * Setup validation rules
   */
  private setupValidationRules(): void {
    // Setup common validation rules
    this.validationRules.set('apiKey', [
      { type: 'required', message: 'API key is required' },
      { type: 'min-length', value: 10, message: 'API key must be at least 10 characters' }
    ]);

    this.validationRules.set('endpoint', [
      { type: 'required', message: 'Endpoint is required' },
      { type: 'pattern', value: '^https?://', message: 'Endpoint must be a valid URL' }
    ]);

    this.validationRules.set('model', [
      { type: 'required', message: 'Model is required' }
    ]);
  }

  /**
   * Generate template ID
   */
  private generateTemplateId(): string {
    return `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Handle configuration events
    this.on('agent-config-created', (data) => {
      console.log(`Agent configuration created: ${data.agentId}`);
    });

    this.on('agent-config-updated', (data) => {
      console.log(`Agent configuration updated: ${data.agentId}`);
    });

    this.on('agent-config-deleted', (data) => {
      console.log(`Agent configuration deleted: ${data.agentId}`);
    });
  }
}

// ===== EXPORTS =====

export default AgentConfigManager;