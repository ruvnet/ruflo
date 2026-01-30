/**
 * Claude Flow V3 Transport Layer - Main Export Module
 *
 * Provides unified interface for batch request processing and transport
 * layer integration with the existing MCP server architecture.
 *
 * @module @claude-flow/cli/transport
 * @version 3.0.0
 */

export * from './types.js';
export * from './protocol-detector.js';
export * from './batch-request-processor.js';
export * from './mcp-server-integration.js';

// Re-export factory functions for convenience
export { createProtocolDetector } from './protocol-detector.js';
export { createBatchProcessor } from './batch-request-processor.js';
export { createIntegratedMCPServer } from './mcp-server-integration.js';

/**
 * Default transport configuration optimized for Claude Flow V3
 */
export const DEFAULT_TRANSPORT_CONFIG = {
  defaultTransport: 'stdio' as const,
  transports: {
    stdio: {
      bufferSize: 8192,
      binaryMode: false,
      lineDelimiter: '\n',
      timeoutMs: 30000,
    },
    http: {
      host: 'localhost',
      port: 3000,
      timeoutMs: 30000,
      keepAlive: true,
      maxConnections: 100,
      compression: {
        enabled: true,
        level: 6,
      },
    },
    websocket: {
      url: 'ws://localhost:3001',
      reconnect: {
        enabled: true,
        maxAttempts: 5,
        delayMs: 1000,
      },
      heartbeat: {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 5000,
      },
      queueSize: 1000,
    },
  },
  batch: {
    maxBatchSize: 50,
    maxWaitTime: 1000,
    minBatchSize: 3,
    adaptiveBatching: true,
    timeoutStrategy: 'partial-success' as const,
    errorHandling: 'continue-on-error' as const,
  },
  monitoring: {
    enabled: true,
    metricsRetentionMs: 300000, // 5 minutes
    detailedLogging: false,
  },
  security: {
    tls: false,
    validateCertificates: true,
    auth: {
      type: 'none' as const,
    },
    rateLimit: {
      enabled: true,
      requestsPerMinute: 1000,
      burstSize: 100,
    },
  },
} as const;

/**
 * Performance optimization presets
 */
export const PERFORMANCE_PRESETS = {
  /**
   * Optimized for minimum latency
   */
  LATENCY_OPTIMIZED: {
    batch: {
      maxBatchSize: 10,
      maxWaitTime: 100,
      minBatchSize: 2,
      adaptiveBatching: false,
      timeoutStrategy: 'fail-fast' as const,
      errorHandling: 'abort-all' as const,
    },
    detection: {
      batchThreshold: 5,
      analysisWindow: 500,
    },
  },

  /**
   * Optimized for maximum throughput
   */
  THROUGHPUT_OPTIMIZED: {
    batch: {
      maxBatchSize: 100,
      maxWaitTime: 2000,
      minBatchSize: 5,
      adaptiveBatching: true,
      timeoutStrategy: 'partial-success' as const,
      errorHandling: 'continue-on-error' as const,
    },
    detection: {
      batchThreshold: 3,
      analysisWindow: 2000,
    },
  },

  /**
   * Balanced configuration for general use
   */
  BALANCED: {
    batch: {
      maxBatchSize: 50,
      maxWaitTime: 1000,
      minBatchSize: 3,
      adaptiveBatching: true,
      timeoutStrategy: 'partial-success' as const,
      errorHandling: 'continue-on-error' as const,
    },
    detection: {
      batchThreshold: 3,
      analysisWindow: 1000,
    },
  },

  /**
   * Conservative configuration for stability
   */
  CONSERVATIVE: {
    batch: {
      maxBatchSize: 20,
      maxWaitTime: 500,
      minBatchSize: 5,
      adaptiveBatching: false,
      timeoutStrategy: 'fail-fast' as const,
      errorHandling: 'abort-all' as const,
    },
    detection: {
      batchThreshold: 8,
      analysisWindow: 1000,
    },
  },
} as const;

/**
 * Utility functions for transport layer
 */
export const TransportUtils = {
  /**
   * Merge transport configurations with proper defaults
   */
  mergeConfig: (base: any, override: any) => {
    return {
      ...base,
      ...override,
      batch: { ...base.batch, ...override.batch },
      monitoring: { ...base.monitoring, ...override.monitoring },
      transports: {
        ...base.transports,
        ...override.transports,
        stdio: { ...base.transports?.stdio, ...override.transports?.stdio },
        http: { ...base.transports?.http, ...override.transports?.http },
        websocket: { ...base.transports?.websocket, ...override.transports?.websocket },
      },
    };
  },

  /**
   * Apply performance preset to configuration
   */
  applyPreset: (config: any, preset: keyof typeof PERFORMANCE_PRESETS) => {
    const presetConfig = PERFORMANCE_PRESETS[preset];
    return TransportUtils.mergeConfig(config, presetConfig);
  },

  /**
   * Validate transport configuration
   */
  validateConfig: (config: any): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Validate batch configuration
    if (config.batch) {
      if (config.batch.minBatchSize > config.batch.maxBatchSize) {
        errors.push('minBatchSize cannot be greater than maxBatchSize');
      }
      if (config.batch.maxWaitTime < 0) {
        errors.push('maxWaitTime cannot be negative');
      }
    }

    // Validate transport configurations
    if (config.transports?.http?.port &&
        (config.transports.http.port < 1 || config.transports.http.port > 65535)) {
      errors.push('HTTP port must be between 1 and 65535');
    }

    // Validate monitoring configuration
    if (config.monitoring?.metricsRetentionMs && config.monitoring.metricsRetentionMs < 0) {
      errors.push('metricsRetentionMs cannot be negative');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Get recommended configuration based on usage patterns
   */
  getRecommendedConfig: (
    requestVolume: 'low' | 'medium' | 'high',
    latencyRequirement: 'strict' | 'moderate' | 'flexible'
  ) => {
    if (latencyRequirement === 'strict') {
      return PERFORMANCE_PRESETS.LATENCY_OPTIMIZED;
    }

    if (requestVolume === 'high' && latencyRequirement === 'flexible') {
      return PERFORMANCE_PRESETS.THROUGHPUT_OPTIMIZED;
    }

    if (requestVolume === 'low') {
      return PERFORMANCE_PRESETS.CONSERVATIVE;
    }

    return PERFORMANCE_PRESETS.BALANCED;
  },
};

/**
 * Transport layer version and compatibility information
 */
export const TRANSPORT_VERSION = {
  version: '3.0.0',
  apiVersion: '1.0',
  mcpCompatibility: '2024-11-05',
  features: [
    'batch-processing',
    'adaptive-batching',
    'protocol-detection',
    'performance-monitoring',
    'backward-compatibility',
    'transport-optimization',
    'error-recovery',
    'metrics-collection',
  ],
  supportedTransports: ['stdio', 'http', 'websocket'],
} as const;