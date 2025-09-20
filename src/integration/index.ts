/**
 * Integration Index - Complete Claude Flow MCP System Integration
 * Created by System Coordinator for integrated system optimization
 */

export { 
  SystemStartupManager, 
  createSystemInstance, 
  getSystemInstance, 
  destroySystemInstance,
  type SystemComponents,
  type StartupOptions,
  type SystemStatus
} from './system-startup-manager.js';

export { 
  UnifiedConfigManager,
  type SystemConfig,
  type ConfigValidationResult,
  DEFAULT_CONFIG
} from './unified-config-manager.js';

export { 
  CommunicationBridge,
  type MessageEnvelope,
  type CommunicationMetrics,
  type CommunicationConfig,
  type MessageHandler
} from './communication-bridge.js';

export { 
  PerformanceOptimizer,
  type PerformanceMetrics,
  type ComponentMetrics,
  type OptimizationRecommendation,
  type PerformanceConfig
} from './performance-optimizer.js';

export { 
  SystemValidator,
  type ValidationResult,
  type ValidationIssue,
  type SystemValidationReport,
  type ValidationConfig
} from './system-validator.js';

/**
 * Complete integrated system factory
 */
export async function createIntegratedSystem(options: {
  configPath?: string;
  enableSwarm?: boolean;
  enableHealthMonitoring?: boolean;
  enablePerformanceOptimization?: boolean;
  enableValidation?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
} = {}): Promise<{
  systemManager: SystemStartupManager;
  configManager: UnifiedConfigManager;
  communicationBridge: CommunicationBridge;
  performanceOptimizer: PerformanceOptimizer;
  systemValidator: SystemValidator;
  components: SystemComponents;
}> {
  
  // Initialize unified configuration
  const configManager = new UnifiedConfigManager(options.configPath);
  await configManager.load();
  
  // Get system configuration
  const systemConfig = configManager.getConfig();
  
  // Create and start system with configuration
  const systemManager = createSystemInstance({
    enableSwarm: options.enableSwarm ?? systemConfig.swarm.enabled,
    enableHealthMonitoring: options.enableHealthMonitoring ?? systemConfig.health.enabled,
    enableMemoryPersistence: systemConfig.memory.backend !== undefined,
    logLevel: options.logLevel ?? systemConfig.system.logLevel,
    configPath: options.configPath,
    memoryBackend: systemConfig.memory.backend,
    swarmMaxAgents: systemConfig.swarm.maxAgents,
    healthCheckInterval: systemConfig.health.checkInterval
  });
  
  // Start the system
  const components = await systemManager.start();
  
  // Initialize communication bridge
  const communicationBridge = new CommunicationBridge(components, {
    enablePrioritization: true,
    enableRetries: true,
    defaultTimeout: systemConfig.integration.mcpTimeout,
    maxRetries: systemConfig.swarm.maxRetries,
    queueLimit: 1000,
    batchSize: 10,
    flushInterval: 100,
    enableMetrics: systemConfig.system.enableMetrics,
    enableCompression: systemConfig.memory.enableCompression
  });
  
  let performanceOptimizer: PerformanceOptimizer;
  let systemValidator: SystemValidator;
  
  // Initialize performance optimizer if enabled
  if (options.enablePerformanceOptimization ?? systemConfig.performance.enableOptimization) {
    performanceOptimizer = new PerformanceOptimizer(components, {
      metricsInterval: 5000,
      enableOptimization: systemConfig.performance.enableOptimization ? 1 : 0,
      enableProfiling: systemConfig.performance.enableProfiling,
      enableGCOptimization: systemConfig.performance.gcOptimization,
      enableResourceLimits: systemConfig.performance.enableResourceLimits,
      memoryLimitMB: systemConfig.performance.memoryLimitMB,
      cpuLimitPercent: systemConfig.performance.cpuLimitPercent,
      alertThresholds: {
        cpuUsage: systemConfig.performance.cpuLimitPercent,
        memoryUsage: 80,
        responseTime: 1000,
        errorRate: 0.05,
        queueDepth: 100
      }
    });
    
    performanceOptimizer.setCommunicationBridge(communicationBridge);
  } else {
    // Create a minimal performance optimizer for validation
    performanceOptimizer = new PerformanceOptimizer(components, { enableOptimization: 0 });
  }
  
  // Initialize system validator if enabled
  if (options.enableValidation !== false) {
    systemValidator = new SystemValidator(components, {
      includePerformanceTests: options.enablePerformanceOptimization ?? true,
      includeSecurityTests: true,
      includeIntegrationTests: true,
      performanceThresholds: {
        responseTime: 1000,
        memoryUsage: 80,
        cpuUsage: systemConfig.performance.cpuLimitPercent,
        errorRate: 0.05
      },
      timeout: systemConfig.integration.mcpTimeout,
      retries: systemConfig.swarm.maxRetries
    });
    
    systemValidator.setCommunicationBridge(communicationBridge);
    systemValidator.setPerformanceOptimizer(performanceOptimizer);
  } else {
    // Create a minimal validator
    systemValidator = new SystemValidator(components, { 
      includePerformanceTests: false,
      includeSecurityTests: false,
      includeIntegrationTests: false
    });
  }
  
  return {
    systemManager,
    configManager,
    communicationBridge,
    performanceOptimizer,
    systemValidator,
    components
  };
}

/**
 * Quick system health check
 */
export async function quickHealthCheck(): Promise<{
  healthy: boolean;
  components: Record<string, boolean>;
  issues: string[];
  uptime: number;
  version: string;
}> {
  const systemInstance = getSystemInstance();
  
  if (!systemInstance || !systemInstance.isRunning()) {
    return {
      healthy: false,
      components: {},
      issues: ['System not running'],
      uptime: 0,
      version: '2.0.0-alpha.61-aime'
    };
  }
  
  const status = systemInstance.getStatus();
  const components = systemInstance.getComponents();
  const issues: string[] = [];
  
  // Check each component
  const componentStatus: Record<string, boolean> = {};
  for (const [name, active] of Object.entries(status.components)) {
    componentStatus[name] = active;
    if (!active) {
      issues.push(`${name} is not active`);
    }
  }
  
  // Check for system errors
  if (status.errors && status.errors.length > 0) {
    issues.push(...status.errors.map(e => `${e.component}: ${e.error}`));
  }
  
  const healthy = issues.length === 0 && status.status === 'running';
  
  return {
    healthy,
    components: componentStatus,
    issues,
    uptime: systemInstance.getUptime(),
    version: '2.0.0-alpha.61-aime'
  };
}

/**
 * Get system metrics summary
 */
export function getSystemMetrics(): {
  performance: any;
  communication: any;
  configuration: any;
  validation: any;
} {
  const systemInstance = getSystemInstance();
  
  if (!systemInstance) {
    return {
      performance: null,
      communication: null,
      configuration: null,
      validation: null
    };
  }
  
  // This would be implemented to gather metrics from all components
  return {
    performance: null, // Would get from PerformanceOptimizer
    communication: null, // Would get from CommunicationBridge
    configuration: null, // Would get from UnifiedConfigManager
    validation: null // Would get from SystemValidator
  };
}

/**
 * Graceful system shutdown
 */
export async function shutdownSystem(): Promise<void> {
  const systemInstance = getSystemInstance();
  
  if (systemInstance) {
    await systemInstance.shutdown();
    destroySystemInstance();
  }
}

/**
 * System information
 */
export const SYSTEM_INFO = {
  name: 'Claude Flow MCP',
  version: '2.0.0-alpha.61-aime',
  description: 'Enterprise-grade AI agent orchestration with ruv-swarm integration',
  components: [
    'SystemStartupManager',
    'UnifiedConfigManager', 
    'CommunicationBridge',
    'PerformanceOptimizer',
    'SystemValidator',
    'Orchestrator',
    'MemoryManager',
    'SwarmCoordinator',
    'HealthCheckManager',
    'PersistenceManager'
  ],
  features: [
    'Integrated system startup and shutdown',
    'Unified configuration management',
    'Optimized inter-component communication',
    'Real-time performance monitoring and optimization',
    'Comprehensive system validation',
    'Advanced swarm coordination',
    'Memory management with multiple backends',
    'Health monitoring and alerting',
    'Persistent state management'
  ],
  architecture: 'Modular microservices with event-driven communication',
  runtime: 'Node.js 20+',
  license: 'MIT'
} as const;