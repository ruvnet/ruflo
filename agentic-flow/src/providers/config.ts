/**
 * Provider Configuration Types and Defaults
 * Configuration management for LLM providers with security and validation
 */

import { LLMProvider, ProviderConfig, FallbackStrategy, ProviderManagerConfig } from './types';
import { CircuitBreakerConfig } from './circuit-breaker';

/**
 * Environment variable names for provider API keys
 */
export const API_KEY_ENV_VARS: Record<LLMProvider, string> = {
  [LLMProvider.ANTHROPIC]: 'ANTHROPIC_API_KEY',
  [LLMProvider.OPENAI]: 'OPENAI_API_KEY',
  [LLMProvider.GOOGLE]: 'GOOGLE_API_KEY',
  [LLMProvider.OLLAMA]: 'OLLAMA_HOST',
  [LLMProvider.COHERE]: 'COHERE_API_KEY',
  [LLMProvider.HUGGINGFACE]: 'HUGGINGFACE_API_KEY'
};

/**
 * Default base URLs for providers
 */
export const DEFAULT_BASE_URLS: Partial<Record<LLMProvider, string>> = {
  [LLMProvider.OLLAMA]: 'http://localhost:11434',
  [LLMProvider.ANTHROPIC]: 'https://api.anthropic.com',
  [LLMProvider.OPENAI]: 'https://api.openai.com/v1',
  [LLMProvider.GOOGLE]: 'https://generativelanguage.googleapis.com/v1'
};

/**
 * Default provider configurations
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<LLMProvider, Partial<ProviderConfig>> = {
  [LLMProvider.ANTHROPIC]: {
    timeout: 60000,
    maxRetries: 3,
    retryDelay: 1000
  },
  [LLMProvider.OPENAI]: {
    timeout: 60000,
    maxRetries: 3,
    retryDelay: 1000
  },
  [LLMProvider.GOOGLE]: {
    timeout: 60000,
    maxRetries: 3,
    retryDelay: 1000
  },
  [LLMProvider.OLLAMA]: {
    timeout: 120000, // Longer timeout for local models
    maxRetries: 2,
    retryDelay: 500
  },
  [LLMProvider.COHERE]: {
    timeout: 60000,
    maxRetries: 3,
    retryDelay: 1000
  },
  [LLMProvider.HUGGINGFACE]: {
    timeout: 90000,
    maxRetries: 3,
    retryDelay: 2000
  }
};

/**
 * Provider feature flags
 */
export interface ProviderFeatures {
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  supportsSystemMessages: boolean;
  supportsMultiModal: boolean;
  requiresApiKey: boolean;
  isLocal: boolean;
}

/**
 * Provider feature configurations
 */
export const PROVIDER_FEATURES: Record<LLMProvider, ProviderFeatures> = {
  [LLMProvider.ANTHROPIC]: {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsSystemMessages: true,
    supportsMultiModal: true,
    requiresApiKey: true,
    isLocal: false
  },
  [LLMProvider.OPENAI]: {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsSystemMessages: true,
    supportsMultiModal: true,
    requiresApiKey: true,
    isLocal: false
  },
  [LLMProvider.GOOGLE]: {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsSystemMessages: false, // Gemini handles system messages differently
    supportsMultiModal: true,
    requiresApiKey: true,
    isLocal: false
  },
  [LLMProvider.OLLAMA]: {
    supportsStreaming: true,
    supportsFunctionCalling: true, // Depends on model
    supportsVision: true, // Depends on model
    supportsSystemMessages: true,
    supportsMultiModal: true, // Depends on model
    requiresApiKey: false,
    isLocal: true
  },
  [LLMProvider.COHERE]: {
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    supportsSystemMessages: true,
    supportsMultiModal: false,
    requiresApiKey: true,
    isLocal: false
  },
  [LLMProvider.HUGGINGFACE]: {
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsVision: true, // Depends on model
    supportsSystemMessages: true,
    supportsMultiModal: true, // Depends on model
    requiresApiKey: true,
    isLocal: false
  }
};

/**
 * Rate limit configurations per provider
 */
export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  requestsPerDay?: number;
  concurrentRequests: number;
}

/**
 * Default rate limits for providers
 */
export const DEFAULT_RATE_LIMITS: Record<LLMProvider, RateLimitConfig> = {
  [LLMProvider.ANTHROPIC]: {
    requestsPerMinute: 50,
    tokensPerMinute: 100000,
    concurrentRequests: 5
  },
  [LLMProvider.OPENAI]: {
    requestsPerMinute: 60,
    tokensPerMinute: 150000,
    requestsPerDay: 10000,
    concurrentRequests: 10
  },
  [LLMProvider.GOOGLE]: {
    requestsPerMinute: 60,
    tokensPerMinute: 100000,
    concurrentRequests: 5
  },
  [LLMProvider.OLLAMA]: {
    requestsPerMinute: 1000, // Local, no real limit
    tokensPerMinute: 1000000,
    concurrentRequests: 3 // Limited by local resources
  },
  [LLMProvider.COHERE]: {
    requestsPerMinute: 100,
    tokensPerMinute: 100000,
    concurrentRequests: 5
  },
  [LLMProvider.HUGGINGFACE]: {
    requestsPerMinute: 30,
    tokensPerMinute: 50000,
    concurrentRequests: 3
  }
};

/**
 * Create provider configuration from environment
 */
export function createProviderConfigFromEnv(provider: LLMProvider): ProviderConfig {
  const envVar = API_KEY_ENV_VARS[provider];
  const apiKey = process.env[envVar];
  
  const config: ProviderConfig = {
    ...DEFAULT_PROVIDER_CONFIGS[provider]
  };

  if (provider === LLMProvider.OLLAMA) {
    // Special handling for Ollama
    if (apiKey) {
      config.baseUrl = apiKey; // OLLAMA_HOST contains the base URL
    } else {
      config.baseUrl = DEFAULT_BASE_URLS[provider];
    }
  } else {
    config.apiKey = apiKey;
    if (DEFAULT_BASE_URLS[provider]) {
      config.baseUrl = process.env[`${provider.toUpperCase()}_BASE_URL`] || DEFAULT_BASE_URLS[provider];
    }
  }

  // Check for proxy configuration
  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      const url = new URL(proxyUrl);
      config.proxy = {
        host: url.hostname,
        port: parseInt(url.port) || 80
      };
      
      if (url.username && url.password) {
        config.proxy.auth = {
          username: url.username,
          password: url.password
        };
      }
    }
  }

  return config;
}

/**
 * Create default provider manager configuration
 */
export function createDefaultManagerConfig(): {
  providers: Record<LLMProvider, ProviderConfig>;
  fallbackStrategy: FallbackStrategy;
  healthCheckInterval: number;
  metricsEnabled: boolean;
} {
  const providers: Partial<Record<LLMProvider, ProviderConfig>> = {};

  // Auto-configure providers based on environment variables
  for (const provider of Object.values(LLMProvider)) {
    const config = createProviderConfigFromEnv(provider);
    
    // Only include providers that have API keys (or don't need them)
    if (config.apiKey || !PROVIDER_FEATURES[provider].requiresApiKey) {
      providers[provider] = config;
    }
  }

  return {
    providers: providers as Record<LLMProvider, ProviderConfig>,
    fallbackStrategy: FallbackStrategy.SEQUENTIAL,
    healthCheckInterval: 60000, // 1 minute
    metricsEnabled: true
  };
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(provider: LLMProvider, config: ProviderConfig): string[] {
  const errors: string[] = [];
  const features = PROVIDER_FEATURES[provider];

  if (features.requiresApiKey && !config.apiKey) {
    errors.push(`API key is required for ${provider}`);
  }

  if (config.timeout && config.timeout < 1000) {
    errors.push('Timeout must be at least 1000ms');
  }

  if (config.maxRetries && config.maxRetries < 0) {
    errors.push('Max retries must be non-negative');
  }

  if (config.retryDelay && config.retryDelay < 0) {
    errors.push('Retry delay must be non-negative');
  }

  return errors;
}

/**
 * Merge provider configurations
 */
export function mergeProviderConfig(
  base: ProviderConfig,
  override: Partial<ProviderConfig>
): ProviderConfig {
  const merged = { ...base, ...override };

  // Merge headers
  if (base.headers || override.headers) {
    merged.headers = {
      ...base.headers,
      ...override.headers
    };
  }

  // Merge proxy
  if (base.proxy || override.proxy) {
    merged.proxy = {
      ...base.proxy,
      ...override.proxy
    } as any;
    
    if (base.proxy?.auth || override.proxy?.auth) {
      merged.proxy!.auth = {
        ...base.proxy?.auth,
        ...override.proxy?.auth
      } as any;
    }
  }

  return merged;
}

/**
 * Cost optimization presets
 */
export interface CostPreset {
  name: string;
  description: string;
  preferredProviders: LLMProvider[];
  maxCostPer1kTokens: number;
  fallbackStrategy: FallbackStrategy;
}

export const COST_PRESETS: CostPreset[] = [
  {
    name: 'ultra-low-cost',
    description: 'Minimize costs using local models when possible',
    preferredProviders: [LLMProvider.OLLAMA, LLMProvider.GOOGLE, LLMProvider.OPENAI],
    maxCostPer1kTokens: 0.002,
    fallbackStrategy: FallbackStrategy.COST_OPTIMIZE
  },
  {
    name: 'balanced',
    description: 'Balance between cost and performance',
    preferredProviders: [LLMProvider.OPENAI, LLMProvider.ANTHROPIC, LLMProvider.GOOGLE],
    maxCostPer1kTokens: 0.02,
    fallbackStrategy: FallbackStrategy.LOAD_BALANCE
  },
  {
    name: 'high-performance',
    description: 'Prioritize performance and capabilities',
    preferredProviders: [LLMProvider.ANTHROPIC, LLMProvider.OPENAI],
    maxCostPer1kTokens: 0.1,
    fallbackStrategy: FallbackStrategy.LATENCY_OPTIMIZE
  }
];

/**
 * Circuit breaker configurations for different providers
 */
export const CIRCUIT_BREAKER_CONFIGS: Record<LLMProvider, CircuitBreakerConfig> = {
  [LLMProvider.ANTHROPIC]: {
    failureThreshold: 5,
    recoveryTimeout: 30000,
    monitoringPeriod: 60000,
    successThreshold: 3,
  },
  [LLMProvider.OPENAI]: {
    failureThreshold: 5,
    recoveryTimeout: 30000,
    monitoringPeriod: 60000,
    successThreshold: 3,
  },
  [LLMProvider.GOOGLE]: {
    failureThreshold: 3,
    recoveryTimeout: 60000,
    monitoringPeriod: 60000,
    successThreshold: 2,
  },
  [LLMProvider.COHERE]: {
    failureThreshold: 3,
    recoveryTimeout: 45000,
    monitoringPeriod: 60000,
    successThreshold: 2,
  },
  [LLMProvider.OLLAMA]: {
    failureThreshold: 2,
    recoveryTimeout: 15000,
    monitoringPeriod: 30000,
    successThreshold: 1,
  },
  [LLMProvider.HUGGINGFACE]: {
    failureThreshold: 3,
    recoveryTimeout: 120000,
    monitoringPeriod: 120000,
    successThreshold: 2,
  },
};

/**
 * Enhanced configuration loader with security and validation
 */
export class ProviderConfigLoader {
  /**
   * Load configuration from environment variables with validation
   */
  static loadFromEnvironment(): ProviderManagerConfig {
    const providers: Record<LLMProvider, ProviderConfig> = {} as any;
    
    // Load each provider configuration
    for (const provider of Object.values(LLMProvider)) {
      const config = createProviderConfigFromEnv(provider);
      const validationErrors = validateProviderConfig(provider, config);
      
      if (validationErrors.length === 0) {
        // Additional security validation
        if (this.validateSecurityConfig(provider, config)) {
          providers[provider] = config;
        }
      } else {
        console.warn(`Skipping provider ${provider}: ${validationErrors.join(', ')}`);
      }
    }

    const managerConfig: ProviderManagerConfig = {
      providers,
      fallbackStrategy: this.getFallbackStrategy(),
      healthCheckInterval: this.getEnvNumber('LLM_HEALTH_CHECK_INTERVAL', 30000),
      metricsEnabled: this.getEnvBoolean('LLM_METRICS_ENABLED', true),
      costThreshold: this.getEnvNumber('LLM_COST_THRESHOLD', 10.00),
      latencyThreshold: this.getEnvNumber('LLM_LATENCY_THRESHOLD', 30000),
    };

    // Validate the final configuration
    const configErrors = this.validateManagerConfig(managerConfig);
    if (configErrors.length > 0) {
      throw new Error(`Configuration validation failed: ${configErrors.join(', ')}`);
    }

    return managerConfig;
  }

  /**
   * Validate security aspects of provider configuration
   */
  private static validateSecurityConfig(provider: LLMProvider, config: ProviderConfig): boolean {
    const features = PROVIDER_FEATURES[provider];
    
    // Check API key format if required
    if (features.requiresApiKey && config.apiKey) {
      if (!this.validateApiKeyFormat(provider, config.apiKey)) {
        console.warn(`Invalid API key format for ${provider}`);
        return false;
      }
      
      if (this.isTestKey(config.apiKey)) {
        console.warn(`Test/example API key detected for ${provider}`);
        return false;
      }
    }

    // Validate base URL security
    if (config.baseUrl && !features.isLocal) {
      try {
        const url = new URL(config.baseUrl);
        if (url.protocol !== 'https:') {
          console.warn(`Insecure HTTP URL for cloud provider ${provider}`);
          return false;
        }
      } catch {
        console.warn(`Invalid base URL for ${provider}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Validate API key format for different providers
   */
  private static validateApiKeyFormat(provider: LLMProvider, apiKey: string): boolean {
    if (!apiKey) return false;

    switch (provider) {
      case LLMProvider.ANTHROPIC:
        return apiKey.startsWith('sk-ant-') && apiKey.length > 20;
      case LLMProvider.OPENAI:
        return apiKey.startsWith('sk-') && apiKey.length > 20;
      case LLMProvider.GOOGLE:
        return apiKey.length >= 20;
      case LLMProvider.COHERE:
        return apiKey.length >= 20;
      case LLMProvider.HUGGINGFACE:
        return apiKey.startsWith('hf_') && apiKey.length > 20;
      default:
        return apiKey.length >= 10;
    }
  }

  /**
   * Check if API key appears to be a test/example key
   */
  private static isTestKey(apiKey: string): boolean {
    const testPatterns = [
      'test', 'example', 'demo', 'placeholder', 'your-', 'replace-me',
      'sk-1234', 'sk-test', 'sk-example', 'sk-proj-'
    ];
    
    return testPatterns.some(pattern => 
      apiKey.toLowerCase().includes(pattern)
    );
  }

  /**
   * Get fallback strategy from environment
   */
  private static getFallbackStrategy(): FallbackStrategy {
    const strategy = process.env.LLM_FALLBACK_STRATEGY?.toLowerCase();
    
    switch (strategy) {
      case 'sequential':
        return FallbackStrategy.SEQUENTIAL;
      case 'load_balance':
        return FallbackStrategy.LOAD_BALANCE;
      case 'cost_optimize':
        return FallbackStrategy.COST_OPTIMIZE;
      case 'latency_optimize':
        return FallbackStrategy.LATENCY_OPTIMIZE;
      default:
        return FallbackStrategy.SEQUENTIAL;
    }
  }

  /**
   * Validate manager configuration
   */
  private static validateManagerConfig(config: ProviderManagerConfig): string[] {
    const errors: string[] = [];
    
    if (Object.keys(config.providers).length === 0) {
      errors.push('No providers configured - check API keys in environment');
    }

    if (config.costThreshold && config.costThreshold < 0) {
      errors.push('Cost threshold must be positive');
    }

    if (config.latencyThreshold && config.latencyThreshold < 1000) {
      errors.push('Latency threshold should be at least 1000ms');
    }

    if (config.healthCheckInterval && config.healthCheckInterval < 5000) {
      errors.push('Health check interval should be at least 5000ms');
    }

    return errors;
  }

  /**
   * Get environment variable as number
   */
  private static getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;
    
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Get environment variable as boolean
   */
  private static getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key]?.toLowerCase();
    if (!value) return defaultValue;
    
    return value === 'true' || value === '1' || value === 'yes';
  }

  /**
   * Mask sensitive configuration for logging
   */
  static maskSensitiveConfig(config: ProviderManagerConfig): any {
    const masked = JSON.parse(JSON.stringify(config));
    
    for (const [providerName, providerConfig] of Object.entries(masked.providers)) {
      if (providerConfig.apiKey) {
        providerConfig.apiKey = `${providerConfig.apiKey.substring(0, 8)}***`;
      }
    }
    
    return masked;
  }
}

/**
 * Security utilities for API key management
 */
export class SecurityUtils {
  /**
   * Generate secure headers for API requests
   */
  static generateSecureHeaders(provider: LLMProvider, config: ProviderConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Agentic-Flow/2.0',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...config.headers
    };

    // Add request ID for tracing
    headers['X-Request-ID'] = this.generateRequestId();
    
    // Provider-specific headers
    if (provider === LLMProvider.ANTHROPIC && config.apiKey) {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider === LLMProvider.OPENAI && config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    } else if (provider === LLMProvider.GOOGLE && config.apiKey) {
      // Google uses API key in URL params, not headers
    }
    
    return headers;
  }

  /**
   * Generate unique request ID
   */
  private static generateRequestId(): string {
    return `af-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Sanitize URL for logging (remove API keys)
   */
  static sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('key')) {
        parsed.searchParams.set('key', '***');
      }
      return parsed.toString();
    } catch {
      return url.replace(/key=[^&]+/gi, 'key=***');
    }
  }
}