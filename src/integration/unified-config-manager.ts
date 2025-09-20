/**
 * Unified Configuration Manager - Centralized configuration for all Claude Flow MCP components
 * Created by System Coordinator for integrated system optimization
 */

import { getErrorMessage } from '../utils/error-handler.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventBus } from '../core/event-bus.js';

export interface SystemConfig {
  // Core system configuration
  system: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    environment: 'development' | 'production' | 'test';
    enableMetrics: boolean;
    enableTelemetry: boolean;
    dataPath: string;
    tempPath: string;
  };

  // Memory system configuration
  memory: {
    backend: 'sqlite' | 'markdown' | 'hybrid';
    cacheSizeMB: number;
    maxEntries: number;
    ttlSeconds: number;
    enableSync: boolean;
    syncIntervalMs: number;
    enableCompression: boolean;
    enableEncryption: boolean;
    backupIntervalMs: number;
  };

  // Swarm coordination configuration
  swarm: {
    enabled: boolean;
    maxAgents: number;
    maxConcurrentTasks: number;
    taskTimeout: number;
    enableMonitoring: boolean;
    enableWorkStealing: boolean;
    enableCircuitBreaker: boolean;
    coordinationStrategy: 'centralized' | 'distributed' | 'hybrid';
    healthCheckInterval: number;
    maxRetries: number;
    backoffMultiplier: number;
  };

  // Orchestrator configuration
  orchestrator: {
    enabled: boolean;
    maxSessions: number;
    sessionTimeout: number;
    enablePersistence: boolean;
    enableDistribution: boolean;
    loadBalancingStrategy: 'round-robin' | 'least-loaded' | 'random';
    enableFailover: boolean;
  };

  // Health monitoring configuration
  health: {
    enabled: boolean;
    checkInterval: number;
    timeout: number;
    retries: number;
    enableMetrics: boolean;
    enableAlerts: boolean;
    alertThreshold: number;
    webhookUrl?: string;
  };

  // Performance optimization configuration
  performance: {
    enableOptimization: boolean;
    enableProfiling: boolean;
    gcOptimization: boolean;
    enableCaching: boolean;
    cacheStrategy: 'lru' | 'lfu' | 'ttl';
    threadPoolSize: number;
    enableResourceLimits: boolean;
    memoryLimitMB: number;
    cpuLimitPercent: number;
  };

  // Communication configuration
  communication: {
    enableWebSocket: boolean;
    webSocketPort: number;
    enableREST: boolean;
    restPort: number;
    enableSSL: boolean;
    sslCertPath?: string;
    sslKeyPath?: string;
    corsEnabled: boolean;
    rateLimitEnabled: boolean;
    rateLimitRequests: number;
    rateLimitWindow: number;
  };

  // Security configuration
  security: {
    enableAuthentication: boolean;
    enableAuthorization: boolean;
    jwtSecret?: string;
    sessionSecret?: string;
    enableInputValidation: boolean;
    enableOutputSanitization: boolean;
    enableAuditLogging: boolean;
    auditLogPath: string;
  };

  // Integration configuration
  integration: {
    enableMCP: boolean;
    mcpTimeout: number;
    enableHooks: boolean;
    hooksPath: string;
    enablePlugins: boolean;
    pluginsPath: string;
    enableExternalAPIs: boolean;
    apiTimeout: number;
  };
}

export const DEFAULT_CONFIG: SystemConfig = {
  system: {
    logLevel: 'info',
    environment: 'development',
    enableMetrics: true,
    enableTelemetry: false,
    dataPath: './data',
    tempPath: './tmp'
  },
  memory: {
    backend: 'sqlite',
    cacheSizeMB: 50,
    maxEntries: 10000,
    ttlSeconds: 3600,
    enableSync: true,
    syncIntervalMs: 5000,
    enableCompression: false,
    enableEncryption: false,
    backupIntervalMs: 300000 // 5 minutes
  },
  swarm: {
    enabled: true,
    maxAgents: 10,
    maxConcurrentTasks: 5,
    taskTimeout: 300000, // 5 minutes
    enableMonitoring: true,
    enableWorkStealing: true,
    enableCircuitBreaker: true,
    coordinationStrategy: 'hybrid',
    healthCheckInterval: 10000, // 10 seconds
    maxRetries: 3,
    backoffMultiplier: 2
  },
  orchestrator: {
    enabled: true,
    maxSessions: 100,
    sessionTimeout: 1800000, // 30 minutes
    enablePersistence: true,
    enableDistribution: false,
    loadBalancingStrategy: 'least-loaded',
    enableFailover: true
  },
  health: {
    enabled: true,
    checkInterval: 30000, // 30 seconds
    timeout: 5000, // 5 seconds
    retries: 3,
    enableMetrics: true,
    enableAlerts: true,
    alertThreshold: 2
  },
  performance: {
    enableOptimization: true,
    enableProfiling: false,
    gcOptimization: true,
    enableCaching: true,
    cacheStrategy: 'lru',
    threadPoolSize: 4,
    enableResourceLimits: true,
    memoryLimitMB: 512,
    cpuLimitPercent: 80
  },
  communication: {
    enableWebSocket: true,
    webSocketPort: 8080,
    enableREST: true,
    restPort: 3000,
    enableSSL: false,
    corsEnabled: true,
    rateLimitEnabled: true,
    rateLimitRequests: 100,
    rateLimitWindow: 60000 // 1 minute
  },
  security: {
    enableAuthentication: false,
    enableAuthorization: false,
    enableInputValidation: true,
    enableOutputSanitization: true,
    enableAuditLogging: true,
    auditLogPath: './logs/audit.log'
  },
  integration: {
    enableMCP: true,
    mcpTimeout: 10000, // 10 seconds
    enableHooks: true,
    hooksPath: './hooks',
    enablePlugins: true,
    pluginsPath: './plugins',
    enableExternalAPIs: true,
    apiTimeout: 5000 // 5 seconds
  }
};

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class UnifiedConfigManager {
  private config: SystemConfig;
  private configPath: string;
  private eventBus: EventBus;
  private watchers: Map<string, () => void> = new Map();
  private validationRules: Map<string, (value: any) => string[]> = new Map();

  constructor(configPath: string = './claude-flow.config.json') {
    this.configPath = configPath;
    this.config = { ...DEFAULT_CONFIG };
    this.eventBus = EventBus.getInstance();
    this.setupValidationRules();
  }

  /**
   * Load configuration from file or create default
   */
  async load(): Promise<void> {
    try {
      // Try to load existing configuration
      const configExists = await fs.access(this.configPath).then(() => true).catch(() => false);
      
      if (configExists) {
        const configData = await fs.readFile(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(configData);
        
        // Merge with defaults to ensure all properties exist
        this.config = this.mergeConfigs(DEFAULT_CONFIG, loadedConfig);
        
        console.log(`✅ Configuration loaded from ${this.configPath}`);
      } else {
        // Create default configuration file
        await this.save();
        console.log(`✅ Default configuration created at ${this.configPath}`);
      }

      // Validate configuration
      const validation = this.validate();
      if (!validation.valid) {
        console.warn('⚠️ Configuration validation warnings:', validation.warnings);
        if (validation.errors.length > 0) {
          throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
        }
      }

      // Emit configuration loaded event
      this.eventBus.emit('config:loaded', {
        timestamp: Date.now(),
        path: this.configPath,
        validation
      });

    } catch (error) {
      console.error('❌ Failed to load configuration:', getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Save current configuration to file
   */
  async save(): Promise<void> {
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      // Write configuration with pretty formatting
      const configData = JSON.stringify(this.config, null, 2);
      await fs.writeFile(this.configPath, configData, 'utf8');

      console.log(`✅ Configuration saved to ${this.configPath}`);

      // Emit configuration saved event
      this.eventBus.emit('config:saved', {
        timestamp: Date.now(),
        path: this.configPath
      });

    } catch (error) {
      console.error('❌ Failed to save configuration:', getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Get the complete configuration
   */
  getConfig(): SystemConfig {
    return { ...this.config };
  }

  /**
   * Get configuration for a specific section
   */
  getSection<K extends keyof SystemConfig>(section: K): SystemConfig[K] {
    return { ...this.config[section] };
  }

  /**
   * Update configuration section
   */
  async updateSection<K extends keyof SystemConfig>(
    section: K, 
    updates: Partial<SystemConfig[K]>
  ): Promise<void> {
    const oldConfig = { ...this.config[section] };
    this.config[section] = { ...this.config[section], ...updates };

    // Validate the updated configuration
    const validation = this.validate();
    if (!validation.valid && validation.errors.length > 0) {
      // Revert changes if validation fails
      this.config[section] = oldConfig;
      throw new Error(`Configuration update failed: ${validation.errors.join(', ')}`);
    }

    // Save changes
    await this.save();

    // Emit configuration updated event
    this.eventBus.emit('config:updated', {
      timestamp: Date.now(),
      section,
      oldConfig,
      newConfig: this.config[section]
    });

    // Notify watchers
    const watcherKey = `section:${section}`;
    if (this.watchers.has(watcherKey)) {
      this.watchers.get(watcherKey)?.();
    }
  }

  /**
   * Watch for configuration changes
   */
  watch<K extends keyof SystemConfig>(
    section: K, 
    callback: (newConfig: SystemConfig[K], oldConfig: SystemConfig[K]) => void
  ): () => void {
    const watcherKey = `section:${section}`;
    let oldConfig = { ...this.config[section] };

    const watcher = () => {
      const newConfig = { ...this.config[section] };
      callback(newConfig, oldConfig);
      oldConfig = newConfig;
    };

    this.watchers.set(watcherKey, watcher);

    // Return unwatch function
    return () => {
      this.watchers.delete(watcherKey);
    };
  }

  /**
   * Validate current configuration
   */
  validate(): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate system configuration
      if (this.config.system.logLevel && !['debug', 'info', 'warn', 'error'].includes(this.config.system.logLevel)) {
        errors.push('Invalid log level');
      }

      // Validate memory configuration
      if (this.config.memory.cacheSizeMB <= 0) {
        errors.push('Memory cache size must be positive');
      }
      if (this.config.memory.maxEntries <= 0) {
        errors.push('Memory max entries must be positive');
      }

      // Validate swarm configuration
      if (this.config.swarm.maxAgents <= 0) {
        errors.push('Swarm max agents must be positive');
      }
      if (this.config.swarm.taskTimeout <= 0) {
        errors.push('Swarm task timeout must be positive');
      }

      // Validate communication ports
      if (this.config.communication.webSocketPort <= 0 || this.config.communication.webSocketPort > 65535) {
        errors.push('Invalid WebSocket port');
      }
      if (this.config.communication.restPort <= 0 || this.config.communication.restPort > 65535) {
        errors.push('Invalid REST port');
      }

      // Check for port conflicts
      if (this.config.communication.webSocketPort === this.config.communication.restPort) {
        errors.push('WebSocket and REST ports must be different');
      }

      // Validate performance settings
      if (this.config.performance.memoryLimitMB <= 0) {
        warnings.push('Memory limit should be positive');
      }
      if (this.config.performance.cpuLimitPercent <= 0 || this.config.performance.cpuLimitPercent > 100) {
        warnings.push('CPU limit should be between 1-100%');
      }

      // Validate file paths
      if (this.config.security.enableAuditLogging && !this.config.security.auditLogPath) {
        errors.push('Audit log path required when audit logging is enabled');
      }

    } catch (error) {
      errors.push(`Validation error: ${getErrorMessage(error)}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Reset configuration to defaults
   */
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();

    // Emit configuration reset event
    this.eventBus.emit('config:reset', {
      timestamp: Date.now()
    });

    console.log('✅ Configuration reset to defaults');
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironmentConfig(): Partial<SystemConfig> {
    const env = this.config.system.environment;
    
    const envConfigs: Record<string, Partial<SystemConfig>> = {
      development: {
        system: { logLevel: 'debug', enableMetrics: true },
        health: { checkInterval: 10000 },
        performance: { enableProfiling: true }
      },
      production: {
        system: { logLevel: 'warn', enableTelemetry: true },
        health: { checkInterval: 30000 },
        performance: { enableOptimization: true, gcOptimization: true }
      },
      test: {
        system: { logLevel: 'error' },
        health: { enabled: false },
        performance: { enableOptimization: false }
      }
    };

    return envConfigs[env] || {};
  }

  /**
   * Merge two configuration objects deeply
   */
  private mergeConfigs(target: SystemConfig, source: any): SystemConfig {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key as keyof SystemConfig] = {
          ...result[key as keyof SystemConfig],
          ...source[key]
        };
      } else {
        (result as any)[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Setup validation rules for configuration properties
   */
  private setupValidationRules(): void {
    // Add custom validation rules as needed
    this.validationRules.set('memory.cacheSizeMB', (value) => {
      const errors: string[] = [];
      if (typeof value !== 'number' || value <= 0) {
        errors.push('Cache size must be a positive number');
      }
      if (value > 1024) {
        errors.push('Cache size over 1GB may impact performance');
      }
      return errors;
    });
  }

  /**
   * Export configuration for external use
   */
  export(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from JSON string
   */
  async import(configJson: string): Promise<void> {
    try {
      const importedConfig = JSON.parse(configJson);
      const mergedConfig = this.mergeConfigs(DEFAULT_CONFIG, importedConfig);
      
      // Validate imported configuration
      const tempConfig = this.config;
      this.config = mergedConfig;
      const validation = this.validate();
      
      if (!validation.valid && validation.errors.length > 0) {
        this.config = tempConfig; // Revert
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      await this.save();
      console.log('✅ Configuration imported successfully');

    } catch (error) {
      throw new Error(`Failed to import configuration: ${getErrorMessage(error)}`);
    }
  }
}