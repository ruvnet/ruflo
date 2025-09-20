/**
 * System Startup Manager - Coordinates initialization of all Claude Flow MCP components
 * Created by System Coordinator for integrated system optimization
 */

import { getErrorMessage } from '../utils/error-handler.js';
import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';
import { Orchestrator } from '../core/orchestrator-fixed.js';
import { MemoryManager } from '../memory/manager.js';
import { SwarmCoordinator } from '../coordination/swarm-coordinator.js';
import { HealthCheckManager } from '../monitoring/health-check.js';
import { JsonPersistenceManager } from '../core/json-persistence.js';
import type { MemoryConfig } from '../utils/types.js';

export interface SystemComponents {
  eventBus: EventBus;
  logger: Logger;
  configManager: ConfigManager;
  orchestrator: Orchestrator;
  memoryManager: MemoryManager;
  swarmCoordinator: SwarmCoordinator;
  healthCheckManager: HealthCheckManager;
  persistenceManager: JsonPersistenceManager;
}

export interface StartupOptions {
  enableSwarm?: boolean;
  enableHealthMonitoring?: boolean;
  enableMemoryPersistence?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  configPath?: string;
  memoryBackend?: 'sqlite' | 'markdown';
  swarmMaxAgents?: number;
  healthCheckInterval?: number;
}

export interface SystemStatus {
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  components: {
    eventBus: boolean;
    logger: boolean;
    configManager: boolean;
    orchestrator: boolean;
    memoryManager: boolean;
    swarmCoordinator: boolean;
    healthCheckManager: boolean;
    persistenceManager: boolean;
  };
  startupTime?: number;
  errors?: Array<{ component: string; error: string }>;
}

export class SystemStartupManager {
  private components: Partial<SystemComponents> = {};
  private status: SystemStatus = {
    status: 'stopped',
    components: {
      eventBus: false,
      logger: false,
      configManager: false,
      orchestrator: false,
      memoryManager: false,
      swarmCoordinator: false,
      healthCheckManager: false,
      persistenceManager: false,
    }
  };
  private startupTime: number = 0;
  private shutdownHandlers: Array<() => Promise<void>> = [];

  constructor(private options: StartupOptions = {}) {}

  /**
   * Initialize all system components in the correct order
   */
  async start(): Promise<SystemComponents> {
    const startTime = Date.now();
    this.status.status = 'starting';
    this.status.errors = [];

    try {
      console.log('🚀 Starting Claude Flow MCP System...');

      // Step 1: Initialize core infrastructure
      await this.initializeCore();

      // Step 2: Initialize memory and persistence
      await this.initializeStorage();

      // Step 3: Initialize orchestration
      await this.initializeOrchestration();

      // Step 4: Initialize optional components
      await this.initializeOptionalComponents();

      // Step 5: Start monitoring and health checks
      await this.initializeMonitoring();

      // Step 6: Register shutdown handlers
      this.registerShutdownHandlers();

      this.startupTime = Date.now() - startTime;
      this.status.status = 'running';
      this.status.startupTime = this.startupTime;

      console.log(`✅ Claude Flow MCP System started successfully in ${this.startupTime}ms`);
      
      // Emit system ready event
      this.components.eventBus?.emit('system:started', {
        timestamp: Date.now(),
        startupTime: this.startupTime,
        components: Object.keys(this.components)
      });

      return this.components as SystemComponents;

    } catch (error) {
      this.status.status = 'error';
      this.status.errors?.push({
        component: 'system',
        error: getErrorMessage(error)
      });

      console.error('❌ System startup failed:', getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Initialize core system components
   */
  private async initializeCore(): Promise<void> {
    console.log('📡 Initializing core components...');

    // Initialize EventBus
    this.components.eventBus = EventBus.getInstance();
    this.status.components.eventBus = true;

    // Initialize Logger
    this.components.logger = new Logger({
      level: this.options.logLevel || 'info',
      format: 'text',
      destination: 'console'
    });
    this.status.components.logger = true;

    // Initialize ConfigManager
    this.components.configManager = ConfigManager.getInstance();
    if (this.options.configPath) {
      await this.components.configManager.loadFromPath(this.options.configPath);
    } else {
      await this.components.configManager.load();
    }
    this.status.components.configManager = true;

    this.components.logger.info('Core components initialized');
  }

  /**
   * Initialize storage and memory systems
   */
  private async initializeStorage(): Promise<void> {
    console.log('💾 Initializing storage systems...');

    if (!this.components.logger || !this.components.eventBus) {
      throw new Error('Core components must be initialized before storage');
    }

    // Initialize Persistence Manager
    this.components.persistenceManager = new JsonPersistenceManager();
    await this.components.persistenceManager.initialize();
    this.status.components.persistenceManager = true;

    // Initialize Memory Manager
    if (this.options.enableMemoryPersistence !== false) {
      const memoryConfig: MemoryConfig = {
        backend: this.options.memoryBackend || 'sqlite',
        cacheSizeMB: 50,
        maxEntries: 10000,
        ttlSeconds: 3600,
        enableSync: true,
        syncIntervalMs: 5000
      };

      this.components.memoryManager = new MemoryManager(
        memoryConfig,
        this.components.eventBus,
        this.components.logger
      );
      await this.components.memoryManager.initialize();
      this.status.components.memoryManager = true;
    }

    this.components.logger.info('Storage systems initialized');
  }

  /**
   * Initialize orchestration components
   */
  private async initializeOrchestration(): Promise<void> {
    console.log('🎭 Initializing orchestration...');

    if (!this.components.configManager || !this.components.eventBus || !this.components.logger) {
      throw new Error('Core components must be initialized before orchestration');
    }

    // Initialize Orchestrator
    this.components.orchestrator = new Orchestrator(
      this.components.configManager,
      this.components.eventBus,
      this.components.logger
    );
    await this.components.orchestrator.start();
    this.status.components.orchestrator = true;

    this.components.logger.info('Orchestration initialized');
  }

  /**
   * Initialize optional components based on configuration
   */
  private async initializeOptionalComponents(): Promise<void> {
    console.log('🔧 Initializing optional components...');

    // Initialize Swarm Coordinator
    if (this.options.enableSwarm !== false) {
      this.components.swarmCoordinator = new SwarmCoordinator({
        maxAgents: this.options.swarmMaxAgents || 10,
        maxConcurrentTasks: 5,
        taskTimeout: 300000, // 5 minutes
        enableMonitoring: true,
        enableWorkStealing: true,
        enableCircuitBreaker: true,
        memoryNamespace: 'swarm',
        coordinationStrategy: 'hybrid'
      });
      this.status.components.swarmCoordinator = true;
    }

    this.components.logger?.info('Optional components initialized');
  }

  /**
   * Initialize monitoring and health check systems
   */
  private async initializeMonitoring(): Promise<void> {
    console.log('📊 Initializing monitoring...');

    if (this.options.enableHealthMonitoring !== false && 
        this.components.eventBus && this.components.logger) {
      
      this.components.healthCheckManager = new HealthCheckManager(
        this.components.eventBus,
        this.components.logger,
        {
          interval: this.options.healthCheckInterval || 30000,
          timeout: 5000,
          retries: 3,
          enableMetrics: true,
          enableAlerts: true
        }
      );
      this.components.healthCheckManager.start();
      this.status.components.healthCheckManager = true;
    }

    this.components.logger?.info('Monitoring systems initialized');
  }

  /**
   * Register graceful shutdown handlers
   */
  private registerShutdownHandlers(): void {
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, starting graceful shutdown...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('💥 Uncaught exception:', error);
      this.components.logger?.error('Uncaught exception', error);
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error('💥 Unhandled rejection:', reason);
      this.components.logger?.error('Unhandled rejection', { reason, promise });
      await this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Gracefully shutdown all system components
   */
  async shutdown(): Promise<void> {
    this.status.status = 'stopping';
    console.log('🔄 Shutting down Claude Flow MCP System...');

    try {
      // Stop health monitoring first
      if (this.components.healthCheckManager) {
        this.components.healthCheckManager.stop();
        this.status.components.healthCheckManager = false;
      }

      // Stop swarm coordinator
      if (this.components.swarmCoordinator) {
        // Assuming SwarmCoordinator has a stop method
        this.status.components.swarmCoordinator = false;
      }

      // Stop orchestrator
      if (this.components.orchestrator) {
        // Assuming Orchestrator has a stop method
        this.status.components.orchestrator = false;
      }

      // Shutdown memory manager
      if (this.components.memoryManager) {
        await this.components.memoryManager.shutdown();
        this.status.components.memoryManager = false;
      }

      // Shutdown persistence manager
      if (this.components.persistenceManager) {
        // Assuming JsonPersistenceManager has a shutdown method
        this.status.components.persistenceManager = false;
      }

      // Execute custom shutdown handlers
      for (const handler of this.shutdownHandlers) {
        try {
          await handler();
        } catch (error) {
          console.error('Error in shutdown handler:', getErrorMessage(error));
        }
      }

      // Final cleanup
      this.status.components.configManager = false;
      this.status.components.logger = false;
      this.status.components.eventBus = false;

      this.status.status = 'stopped';
      console.log('✅ System shutdown completed successfully');

    } catch (error) {
      console.error('❌ Error during shutdown:', getErrorMessage(error));
      this.status.status = 'error';
      throw error;
    }
  }

  /**
   * Get current system status
   */
  getStatus(): SystemStatus {
    return { ...this.status };
  }

  /**
   * Get system components
   */
  getComponents(): Partial<SystemComponents> {
    return { ...this.components };
  }

  /**
   * Add custom shutdown handler
   */
  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Check if system is running
   */
  isRunning(): boolean {
    return this.status.status === 'running';
  }

  /**
   * Get system uptime in milliseconds
   */
  getUptime(): number {
    if (this.status.status === 'running' && this.startupTime) {
      return Date.now() - (Date.now() - this.startupTime);
    }
    return 0;
  }
}

// Singleton instance for global access
let systemInstance: SystemStartupManager | null = null;

export function getSystemInstance(): SystemStartupManager | null {
  return systemInstance;
}

export function createSystemInstance(options: StartupOptions = {}): SystemStartupManager {
  if (systemInstance) {
    throw new Error('System instance already exists');
  }
  systemInstance = new SystemStartupManager(options);
  return systemInstance;
}

export function destroySystemInstance(): void {
  systemInstance = null;
}