/**
 * ControllerRegistry - Central controller lifecycle management for AgentDB v3
 *
 * Wraps the AgentDB class and adds CLI-specific controllers from @claude-flow/memory.
 * Manages initialization (level-based ordering), health checks, and graceful shutdown.
 *
 * Per ADR-053: Replaces memory-initializer.js's raw sql.js usage with a unified
 * controller ecosystem routing all memory operations through AgentDB v3.
 *
 * @module @claude-flow/memory/controller-registry
 */

import { EventEmitter } from 'node:events';
import type {
  IMemoryBackend,
  HealthCheckResult,
  ComponentHealth,
  BackendStats,
  EmbeddingGenerator,
  SONAMode,
} from './types.js';
import { LearningBridge } from './learning-bridge.js';
import type { LearningBridgeConfig } from './learning-bridge.js';
import { MemoryGraph } from './memory-graph.js';
import type { MemoryGraphConfig } from './memory-graph.js';
import { CacheManager, TieredCacheManager } from './cache-manager.js';
import type { CacheConfig } from './types.js';

// ===== Types =====

/**
 * Controllers accessible via AgentDB.getController()
 */
export type AgentDBControllerName =
  | 'reasoningBank'
  | 'skills'
  | 'reflexion'
  | 'causalGraph'
  | 'causalRecall'
  | 'learningSystem'
  | 'explainableRecall'
  | 'nightlyLearner'
  | 'graphTransformer'
  | 'mutationGuard'
  | 'attestationLog'
  | 'vectorBackend'
  | 'graphAdapter';

/**
 * CLI-layer controllers (from @claude-flow/memory or new)
 */
export type CLIControllerName =
  | 'learningBridge'
  | 'memoryGraph'
  | 'agentMemoryScope'
  | 'tieredCache'
  | 'hybridSearch'
  | 'federatedSession'
  | 'semanticRouter'
  | 'sonaTrajectory';

/**
 * All controller names
 */
export type ControllerName = AgentDBControllerName | CLIControllerName;

/**
 * Initialization level for dependency ordering
 */
export interface InitLevel {
  level: number;
  controllers: ControllerName[];
}

/**
 * Individual controller health status
 */
export interface ControllerHealth {
  name: ControllerName;
  status: 'healthy' | 'degraded' | 'unavailable';
  initTimeMs: number;
  error?: string;
}

/**
 * Aggregated health report for all controllers
 */
export interface RegistryHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  controllers: ControllerHealth[];
  agentdbAvailable: boolean;
  initTimeMs: number;
  timestamp: number;
  activeControllers: number;
  totalControllers: number;
}

/**
 * Runtime configuration for controller activation
 */
export interface RuntimeConfig {
  /** Database path for AgentDB */
  dbPath?: string;

  /** Vector dimension (default: 384 for MiniLM) */
  dimension?: number;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Memory backend config */
  memory?: {
    enableHNSW?: boolean;
    learningBridge?: Partial<LearningBridgeConfig>;
    memoryGraph?: Partial<MemoryGraphConfig>;
    tieredCache?: Partial<CacheConfig>;
  };

  /** Neural config */
  neural?: {
    enabled?: boolean;
    modelPath?: string;
    sonaMode?: SONAMode;
  };

  /** Controllers to explicitly enable/disable */
  controllers?: Partial<Record<ControllerName, boolean>>;

  /** Backend instance to use (if pre-created) */
  backend?: IMemoryBackend;
}

/**
 * Controller instance wrapper
 */
interface ControllerEntry {
  name: ControllerName;
  instance: unknown;
  level: number;
  initTimeMs: number;
  enabled: boolean;
  error?: string;
}

// ===== Initialization Levels =====

/**
 * Level-based initialization order per ADR-053.
 * Controllers at each level can be initialized in parallel.
 * Each level must complete before the next begins.
 */
export const INIT_LEVELS: InitLevel[] = [
  // Level 0: Foundation - already exists
  { level: 0, controllers: [] },
  // Level 1: Core intelligence
  { level: 1, controllers: ['reasoningBank', 'learningBridge', 'hybridSearch', 'tieredCache'] },
  // Level 2: Graph & security
  { level: 2, controllers: ['memoryGraph', 'agentMemoryScope', 'vectorBackend', 'mutationGuard'] },
  // Level 3: Specialization
  { level: 3, controllers: ['skills', 'explainableRecall', 'reflexion', 'attestationLog'] },
  // Level 4: Causal & routing
  { level: 4, controllers: ['causalGraph', 'nightlyLearner', 'learningSystem', 'semanticRouter'] },
  // Level 5: Advanced services
  { level: 5, controllers: ['graphTransformer', 'sonaTrajectory'] },
  // Level 6: Session management
  { level: 6, controllers: ['federatedSession', 'graphAdapter'] },
];

// ===== ControllerRegistry =====

/**
 * Central registry for AgentDB v3 controller lifecycle management.
 *
 * Handles:
 * - Level-based initialization ordering (levels 0-6)
 * - Graceful degradation (each controller fails independently)
 * - Config-driven activation (controllers only instantiate when enabled)
 * - Health check aggregation across all controllers
 * - Ordered shutdown (reverse initialization order)
 *
 * @example
 * ```typescript
 * const registry = new ControllerRegistry();
 * await registry.initialize({
 *   dbPath: './data/memory.db',
 *   dimension: 384,
 *   memory: {
 *     enableHNSW: true,
 *     learningBridge: { sonaMode: 'balanced' },
 *     memoryGraph: { pageRankDamping: 0.85 },
 *   },
 * });
 *
 * const reasoning = registry.get<ReasoningBank>('reasoningBank');
 * const graph = registry.get<MemoryGraph>('memoryGraph');
 *
 * await registry.shutdown();
 * ```
 */
export class ControllerRegistry extends EventEmitter {
  private controllers: Map<ControllerName, ControllerEntry> = new Map();
  private agentdb: any = null;
  private backend: IMemoryBackend | null = null;
  private config: RuntimeConfig = {};
  private initialized = false;
  private initTimeMs = 0;

  /**
   * Initialize all controllers in level-based order.
   *
   * Each level's controllers are initialized in parallel within the level.
   * Failures are isolated: a controller that fails to init is marked as
   * unavailable but does not block other controllers.
   */
  async initialize(config: RuntimeConfig = {}): Promise<void> {
    if (this.initialized) return;

    this.config = config;
    const startTime = performance.now();

    // Step 1: Initialize AgentDB (the core)
    await this.initAgentDB(config);

    // Step 2: Set up the backend
    this.backend = config.backend || null;

    // Step 3: Initialize controllers level by level
    for (const level of INIT_LEVELS) {
      const controllersToInit = level.controllers.filter(
        (name) => this.isControllerEnabled(name),
      );

      if (controllersToInit.length === 0) continue;

      // Initialize all controllers in this level in parallel
      const results = await Promise.allSettled(
        controllersToInit.map((name) => this.initController(name, level.level)),
      );

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const name = controllersToInit[i];

        if (result.status === 'rejected') {
          const errorMsg = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

          this.controllers.set(name, {
            name,
            instance: null,
            level: level.level,
            initTimeMs: 0,
            enabled: false,
            error: errorMsg,
          });

          this.emit('controller:failed', { name, error: errorMsg, level: level.level });
        }
      }
    }

    this.initTimeMs = performance.now() - startTime;
    this.initialized = true;
    this.emit('initialized', {
      initTimeMs: this.initTimeMs,
      activeControllers: this.getActiveCount(),
      totalControllers: this.controllers.size,
    });
  }

  /**
   * Shutdown all controllers in reverse initialization order.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Shutdown in reverse level order
    const reverseLevels = [...INIT_LEVELS].reverse();

    for (const level of reverseLevels) {
      const controllersToShutdown = level.controllers
        .filter((name) => {
          const entry = this.controllers.get(name);
          return entry?.enabled && entry?.instance;
        });

      await Promise.allSettled(
        controllersToShutdown.map((name) => this.shutdownController(name)),
      );
    }

    // Shutdown AgentDB
    if (this.agentdb) {
      try {
        if (typeof this.agentdb.close === 'function') {
          await this.agentdb.close();
        }
      } catch {
        // Best-effort cleanup
      }
      this.agentdb = null;
    }

    this.controllers.clear();
    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Get a controller instance by name.
   * Returns null if the controller is not initialized or unavailable.
   */
  get<T>(name: ControllerName): T | null {
    // First check CLI-layer controllers
    const entry = this.controllers.get(name);
    if (entry?.enabled && entry?.instance) {
      return entry.instance as T;
    }

    // Fall back to AgentDB internal controllers
    if (this.agentdb && typeof this.agentdb.getController === 'function') {
      try {
        const controller = this.agentdb.getController(name);
        if (controller) return controller as T;
      } catch {
        // Controller not available in AgentDB
      }
    }

    return null;
  }

  /**
   * Check if a controller is enabled and initialized.
   */
  isEnabled(name: ControllerName): boolean {
    const entry = this.controllers.get(name);
    if (entry?.enabled) return true;

    // Check AgentDB internal controllers
    if (this.agentdb && typeof this.agentdb.getController === 'function') {
      try {
        return this.agentdb.getController(name) !== null;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Aggregate health check across all controllers.
   */
  async healthCheck(): Promise<RegistryHealthReport> {
    const controllerHealth: ControllerHealth[] = [];

    for (const [name, entry] of this.controllers) {
      controllerHealth.push({
        name,
        status: entry.enabled
          ? 'healthy'
          : entry.error
            ? 'unavailable'
            : 'degraded',
        initTimeMs: entry.initTimeMs,
        error: entry.error,
      });
    }

    // Check AgentDB health
    let agentdbAvailable = false;
    if (this.agentdb) {
      try {
        agentdbAvailable = typeof this.agentdb.getController === 'function';
      } catch {
        agentdbAvailable = false;
      }
    }

    const active = controllerHealth.filter((c) => c.status === 'healthy').length;
    const unavailable = controllerHealth.filter((c) => c.status === 'unavailable').length;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (unavailable > 0 && active === 0) {
      status = 'unhealthy';
    } else if (unavailable > 0) {
      status = 'degraded';
    }

    return {
      status,
      controllers: controllerHealth,
      agentdbAvailable,
      initTimeMs: this.initTimeMs,
      timestamp: Date.now(),
      activeControllers: active,
      totalControllers: controllerHealth.length,
    };
  }

  /**
   * Get the underlying AgentDB instance.
   */
  getAgentDB(): any {
    return this.agentdb;
  }

  /**
   * Get the memory backend.
   */
  getBackend(): IMemoryBackend | null {
    return this.backend;
  }

  /**
   * Check if the registry is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the number of active (successfully initialized) controllers.
   */
  getActiveCount(): number {
    let count = 0;
    for (const entry of this.controllers.values()) {
      if (entry.enabled) count++;
    }
    return count;
  }

  /**
   * List all registered controller names and their status.
   */
  listControllers(): Array<{ name: ControllerName; enabled: boolean; level: number }> {
    return Array.from(this.controllers.entries()).map(([name, entry]) => ({
      name,
      enabled: entry.enabled,
      level: entry.level,
    }));
  }

  // ===== Private Methods =====

  /**
   * Initialize AgentDB instance with dynamic import and fallback chain.
   */
  private async initAgentDB(config: RuntimeConfig): Promise<void> {
    try {
      const agentdbModule: any = await import('agentdb');
      const AgentDBClass = agentdbModule.AgentDB || agentdbModule.default;

      if (!AgentDBClass) {
        this.emit('agentdb:unavailable', { reason: 'No AgentDB class found' });
        return;
      }

      this.agentdb = new AgentDBClass({
        dbPath: config.dbPath || ':memory:',
      });

      // Suppress agentdb's info-level console.log during init
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = String(args[0] ?? '');
        if (msg.includes('Transformers.js') ||
            msg.includes('better-sqlite3') ||
            msg.includes('[AgentDB]')) return;
        origLog.apply(console, args);
      };
      try {
        await this.agentdb.initialize();
      } finally {
        console.log = origLog;
      }
      this.emit('agentdb:initialized');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emit('agentdb:unavailable', { reason: msg });
      // AgentDB not available — CLI-layer controllers can still work
      this.agentdb = null;
    }
  }

  /**
   * Check whether a controller should be initialized based on config.
   */
  private isControllerEnabled(name: ControllerName): boolean {
    // Explicit enable/disable from config
    if (this.config.controllers) {
      const explicit = this.config.controllers[name];
      if (explicit !== undefined) return explicit;
    }

    // Default behavior: enable based on category
    switch (name) {
      // Core intelligence — enabled by default
      case 'reasoningBank':
      case 'learningBridge':
      case 'tieredCache':
        return true;

      // Graph — enabled if backend available
      case 'memoryGraph':
        return !!(this.config.memory?.memoryGraph || this.backend);

      // Security — enabled if AgentDB available
      case 'mutationGuard':
      case 'attestationLog':
      case 'vectorBackend':
        return this.agentdb !== null;

      // AgentDB-internal controllers — only if AgentDB available
      case 'skills':
      case 'reflexion':
      case 'causalGraph':
      case 'causalRecall':
      case 'learningSystem':
      case 'explainableRecall':
      case 'nightlyLearner':
      case 'graphTransformer':
      case 'graphAdapter':
        return this.agentdb !== null;

      // Optional controllers
      case 'hybridSearch':
      case 'agentMemoryScope':
      case 'semanticRouter':
      case 'sonaTrajectory':
      case 'federatedSession':
        return false; // Require explicit enabling

      default:
        return false;
    }
  }

  /**
   * Initialize a single controller with error isolation.
   */
  private async initController(name: ControllerName, level: number): Promise<void> {
    const startTime = performance.now();

    try {
      const instance = await this.createController(name);

      const initTimeMs = performance.now() - startTime;

      this.controllers.set(name, {
        name,
        instance,
        level,
        initTimeMs,
        enabled: instance !== null,
        error: instance === null ? 'Controller returned null' : undefined,
      });

      if (instance !== null) {
        this.emit('controller:initialized', { name, level, initTimeMs });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const initTimeMs = performance.now() - startTime;

      this.controllers.set(name, {
        name,
        instance: null,
        level,
        initTimeMs,
        enabled: false,
        error: errorMsg,
      });

      throw error;
    }
  }

  /**
   * Factory method to create a controller instance.
   * Handles CLI-layer controllers; AgentDB-internal controllers are
   * accessed via agentdb.getController().
   */
  private async createController(name: ControllerName): Promise<unknown> {
    switch (name) {
      // ----- CLI-layer controllers -----

      case 'learningBridge': {
        if (!this.backend) return null;
        const config = this.config.memory?.learningBridge || {};
        const bridge = new LearningBridge(this.backend, {
          sonaMode: config.sonaMode || this.config.neural?.sonaMode || 'balanced',
          confidenceDecayRate: config.confidenceDecayRate,
          accessBoostAmount: config.accessBoostAmount,
          consolidationThreshold: config.consolidationThreshold,
          enabled: true,
        });
        return bridge;
      }

      case 'memoryGraph': {
        const config = this.config.memory?.memoryGraph || {};
        const graph = new MemoryGraph({
          pageRankDamping: config.pageRankDamping,
          maxNodes: config.maxNodes,
          ...config,
        });
        // Build from backend if available
        if (this.backend) {
          try {
            await graph.buildFromBackend(this.backend);
          } catch {
            // Graph build from backend failed — empty graph is still usable
          }
        }
        return graph;
      }

      case 'tieredCache': {
        const config = this.config.memory?.tieredCache || {};
        const cache = new TieredCacheManager({
          maxSize: config.maxSize || 10000,
          ttl: config.ttl || 300000,
          lruEnabled: true,
          writeThrough: false,
          ...config,
        });
        return cache;
      }

      case 'hybridSearch':
        // BM25 hybrid search — placeholder for future implementation
        return null;

      case 'agentMemoryScope':
        // Agent memory scope — placeholder, activated when explicitly enabled
        return null;

      case 'semanticRouter':
        // Delegate to AgentDB's SemanticRouter if available
        if (this.agentdb && typeof this.agentdb.getController === 'function') {
          try {
            return this.agentdb.getController('semanticRouter');
          } catch {
            return null;
          }
        }
        return null;

      case 'sonaTrajectory':
        // Delegate to AgentDB's SonaTrajectoryService if available
        if (this.agentdb && typeof this.agentdb.getController === 'function') {
          try {
            return this.agentdb.getController('sonaTrajectory');
          } catch {
            return null;
          }
        }
        return null;

      case 'federatedSession':
        // Federated session — placeholder for Phase 4
        return null;

      // ----- AgentDB-internal controllers -----
      // These are accessed via agentdb.getController() and registered
      // here for health tracking and lifecycle management.

      case 'reasoningBank':
      case 'skills':
      case 'reflexion':
      case 'causalGraph':
      case 'causalRecall':
      case 'learningSystem':
      case 'explainableRecall':
      case 'nightlyLearner':
      case 'graphTransformer':
      case 'mutationGuard':
      case 'attestationLog':
      case 'vectorBackend':
      case 'graphAdapter': {
        if (!this.agentdb || typeof this.agentdb.getController !== 'function') {
          return null;
        }
        try {
          const controller = this.agentdb.getController(name);
          return controller ?? null;
        } catch {
          return null;
        }
      }

      default:
        return null;
    }
  }

  /**
   * Shutdown a single controller gracefully.
   */
  private async shutdownController(name: ControllerName): Promise<void> {
    const entry = this.controllers.get(name);
    if (!entry?.instance) return;

    try {
      const instance = entry.instance as any;

      // Try known shutdown methods
      if (typeof instance.destroy === 'function') {
        instance.destroy();
      } else if (typeof instance.shutdown === 'function') {
        await instance.shutdown();
      } else if (typeof instance.close === 'function') {
        await instance.close();
      }
    } catch {
      // Best-effort cleanup
    }

    entry.enabled = false;
    entry.instance = null;
  }
}

export default ControllerRegistry;
