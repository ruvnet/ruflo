/**
 * Convoy Observer
 *
 * Monitors convoy completion by observing issue state changes
 * and detecting when all tracked issues are complete. Uses
 * WASM-accelerated graph analysis for dependency resolution.
 *
 * Features:
 * - Watch convoys for completion
 * - Detect blocking issues
 * - Identify ready-to-work issues
 * - WASM-accelerated dependency graph analysis
 * - Configurable polling intervals
 *
 * @module gastown-bridge/convoy/observer
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import type {
  Convoy,
  ConvoyProgress,
  Bead,
  BeadStatus,
  BeadGraph,
  TopoSortResult,
} from '../types.js';
import { BdBridge } from '../bridges/bd-bridge.js';
import { ConvoyTracker } from './tracker.js';
import { ConvoyError, GasTownErrorCode, GasTownError } from '../errors.js';
import { LRUCache, DebouncedEmitter, BatchDeduplicator } from '../cache.js';
import {
  beadPool,
  PooledBead,
  LazyObserver,
  type LazyStats,
} from '../memory/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * WASM graph module interface
 */
export interface WasmGraphModule {
  /** Check if dependency graph has cycles */
  has_cycle(beadsJson: string): boolean;
  /** Find nodes participating in cycles */
  find_cycle_nodes(beadsJson: string): string;
  /** Get beads with no unresolved dependencies */
  get_ready_beads(beadsJson: string): string;
  /** Compute execution levels for parallel processing */
  compute_levels(beadsJson: string): string;
  /** Topological sort of beads */
  topo_sort(beadsJson: string): string;
  /** Critical path analysis */
  critical_path(beadsJson: string): string;
}

/**
 * Bead node for WASM operations
 */
interface WasmBeadNode {
  id: string;
  title: string;
  status: string;
  priority: number;
  blocked_by: string[];
  blocks: string[];
  duration?: number;
}

/**
 * Completion callback signature
 */
export type CompletionCallback = (convoy: Convoy, allComplete: boolean) => void;

/**
 * Observer watch handle
 */
export interface WatchHandle {
  /** Convoy ID being watched */
  convoyId: string;
  /** Stop watching */
  stop(): void;
  /** Check if still watching */
  isActive(): boolean;
}

/**
 * Observer configuration
 */
export interface ConvoyObserverConfig {
  /** BD bridge instance */
  bdBridge: BdBridge;
  /** Convoy tracker instance */
  tracker: ConvoyTracker;
  /** Optional WASM graph module */
  wasmModule?: WasmGraphModule;
  /** Initial polling interval in milliseconds */
  pollInterval?: number;
  /** Maximum poll attempts before giving up */
  maxPollAttempts?: number;
  /** Enable WASM acceleration (falls back to JS if unavailable) */
  useWasm?: boolean;
  /** Enable exponential backoff for polling */
  useExponentialBackoff?: boolean;
  /** Maximum backoff interval in milliseconds */
  maxBackoffInterval?: number;
  /** Backoff multiplier (default: 1.5) */
  backoffMultiplier?: number;
  /** Enable delta-based updates (only emit on changes) */
  deltaUpdatesOnly?: boolean;
  /** Debounce interval for progress updates in milliseconds */
  progressDebounceMs?: number;
}

/**
 * Blocker information
 */
export interface BlockerInfo {
  /** Issue ID that is blocked */
  blockedIssue: string;
  /** Issue IDs that are blocking */
  blockers: string[];
  /** True if blockers are from within the convoy */
  internalBlockers: boolean;
}

/**
 * Ready issue information
 */
export interface ReadyIssueInfo {
  /** Issue ID */
  id: string;
  /** Issue title */
  title: string;
  /** Priority */
  priority: number;
  /** Execution level (for parallel processing) */
  level: number;
}

/**
 * Completion check result
 */
export interface CompletionCheckResult {
  /** True if all issues are complete */
  allComplete: boolean;
  /** Progress statistics */
  progress: ConvoyProgress;
  /** Issues that are still open */
  openIssues: string[];
  /** Issues that are in progress */
  inProgressIssues: string[];
  /** Issues that are blocked */
  blockedIssues: BlockerInfo[];
  /** Issues ready to work on */
  readyIssues: ReadyIssueInfo[];
  /** True if there are dependency cycles */
  hasCycles: boolean;
  /** Issues involved in cycles */
  cycleIssues: string[];
}

/**
 * Logger interface
 */
export interface ObserverLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// ============================================================================
// Default Logger
// ============================================================================

const defaultLogger: ObserverLogger = {
  debug: (msg, meta) => console.debug(`[convoy-observer] ${msg}`, meta ?? ''),
  info: (msg, meta) => console.info(`[convoy-observer] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[convoy-observer] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[convoy-observer] ${msg}`, meta ?? ''),
};

// ============================================================================
// Validation Schemas
// ============================================================================

const ConvoyIdSchema = z.string().uuid('Invalid convoy ID format');

// ============================================================================
// Convoy Observer Implementation
// ============================================================================

/**
 * Convoy Observer
 *
 * Monitors convoys for completion and provides dependency analysis.
 *
 * @example
 * ```typescript
 * const observer = new ConvoyObserver({
 *   bdBridge,
 *   tracker,
 *   pollInterval: 5000,
 *   useWasm: true,
 * });
 *
 * // Watch for completion
 * const handle = observer.watch(convoyId, (convoy, complete) => {
 *   if (complete) {
 *     console.log('Convoy complete!');
 *   }
 * });
 *
 * // Check blockers
 * const blockers = await observer.getBlockers(convoyId);
 *
 * // Get ready issues
 * const ready = await observer.getReadyIssues(convoyId);
 *
 * // Stop watching
 * handle.stop();
 * ```
 */
export class ConvoyObserver extends EventEmitter {
  private bdBridge: BdBridge;
  private tracker: ConvoyTracker;
  private wasmModule?: WasmGraphModule;
  private logger: ObserverLogger;
  private config: Required<Omit<ConvoyObserverConfig, 'bdBridge' | 'tracker' | 'wasmModule'>>;
  private watchers: Map<string, {
    timer: NodeJS.Timeout;
    callback: CompletionCallback;
    attempts: number;
    currentInterval: number;
    lastState: string | null;
  }> = new Map();

  // Performance optimization caches
  private readonly beadCache: LRUCache<string, Bead>;
  private readonly completionCache: LRUCache<string, CompletionCheckResult>;
  private readonly fetchDedup: BatchDeduplicator<Bead[]>;
  private readonly progressEmitters: Map<string, DebouncedEmitter<ConvoyProgress>>;

  // Subscription batching
  private pendingSubscriptions: Map<string, Set<CompletionCallback>> = new Map();
  private subscriptionFlushTimer: NodeJS.Timeout | null = null;

  constructor(config: ConvoyObserverConfig, logger?: ObserverLogger) {
    super();
    this.bdBridge = config.bdBridge;
    this.tracker = config.tracker;
    this.wasmModule = config.wasmModule;
    this.logger = logger ?? defaultLogger;
    this.config = {
      pollInterval: config.pollInterval ?? 10000,
      maxPollAttempts: config.maxPollAttempts ?? 0, // 0 = unlimited
      useWasm: config.useWasm ?? true,
      useExponentialBackoff: config.useExponentialBackoff ?? true,
      maxBackoffInterval: config.maxBackoffInterval ?? 60000, // 1 minute max
      backoffMultiplier: config.backoffMultiplier ?? 1.5,
      deltaUpdatesOnly: config.deltaUpdatesOnly ?? true,
      progressDebounceMs: config.progressDebounceMs ?? 500,
    };

    // Initialize performance caches
    this.beadCache = new LRUCache<string, Bead>({
      maxEntries: 1000,
      ttlMs: 30 * 1000, // 30 seconds (beads change frequently)
    });

    this.completionCache = new LRUCache<string, CompletionCheckResult>({
      maxEntries: 100,
      ttlMs: 5 * 1000, // 5 seconds (completion state changes)
    });

    this.fetchDedup = new BatchDeduplicator<Bead[]>(30000);
    this.progressEmitters = new Map();
  }

  /**
   * Watch a convoy for completion
   *
   * @param convoyId - Convoy ID to watch
   * @param callback - Called on each check with completion status
   * @returns Watch handle to stop watching
   */
  watch(convoyId: string, callback: CompletionCallback): WatchHandle {
    ConvoyIdSchema.parse(convoyId);

    // Stop existing watcher if any
    this.stopWatching(convoyId);

    const initialInterval = this.config.pollInterval;

    // Create initial polling timer (will be rescheduled with backoff)
    const scheduleNextPoll = (interval: number): NodeJS.Timeout => {
      return setTimeout(async () => {
        await this.pollConvoyWithBackoff(convoyId, callback);
      }, interval);
    };

    const timer = scheduleNextPoll(initialInterval);

    this.watchers.set(convoyId, {
      timer,
      callback,
      attempts: 0,
      currentInterval: initialInterval,
      lastState: null,
    });

    // Create debounced progress emitter for this convoy
    this.progressEmitters.set(
      convoyId,
      new DebouncedEmitter<ConvoyProgress>(
        (progress) => this.emit('progress', convoyId, progress),
        this.config.progressDebounceMs
      )
    );

    // Immediate first check
    this.pollConvoyWithBackoff(convoyId, callback);

    this.logger.info('Started watching convoy', { convoyId, interval: initialInterval });

    return {
      convoyId,
      stop: () => this.stopWatching(convoyId),
      isActive: () => this.watchers.has(convoyId),
    };
  }

  /**
   * Batch subscribe to multiple convoys
   * Subscriptions are batched and flushed together for efficiency
   *
   * @param convoyId - Convoy ID to watch
   * @param callback - Callback for completion status
   */
  batchSubscribe(convoyId: string, callback: CompletionCallback): void {
    if (!this.pendingSubscriptions.has(convoyId)) {
      this.pendingSubscriptions.set(convoyId, new Set());
    }
    this.pendingSubscriptions.get(convoyId)!.add(callback);

    // Flush after a short delay to batch multiple subscriptions
    if (!this.subscriptionFlushTimer) {
      this.subscriptionFlushTimer = setTimeout(() => {
        this.flushSubscriptions();
      }, 50); // 50ms batching window
    }
  }

  /**
   * Flush pending subscriptions
   */
  private flushSubscriptions(): void {
    this.subscriptionFlushTimer = null;

    for (const [convoyId, callbacks] of this.pendingSubscriptions) {
      // Create a merged callback that calls all registered callbacks
      const mergedCallback: CompletionCallback = (convoy, allComplete) => {
        for (const cb of callbacks) {
          try {
            cb(convoy, allComplete);
          } catch (error) {
            this.logger.error('Subscription callback error', {
              convoyId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      };

      this.watch(convoyId, mergedCallback);
    }

    this.pendingSubscriptions.clear();
    this.logger.debug('Flushed subscription batch', {
      convoys: this.pendingSubscriptions.size,
    });
  }

  /**
   * Check if all issues in a convoy are complete
   *
   * @param convoyId - Convoy ID
   * @returns Completion check result with detailed status
   */
  async checkCompletion(convoyId: string): Promise<CompletionCheckResult> {
    ConvoyIdSchema.parse(convoyId);

    const convoy = this.tracker.getConvoy(convoyId);
    if (!convoy) {
      throw ConvoyError.notFound(convoyId);
    }

    // Fetch all beads
    const beads = await this.fetchBeads(convoy.trackedIssues);
    const beadMap = new Map(beads.map(b => [b.id, b]));

    // Calculate progress
    const openIssues: string[] = [];
    const inProgressIssues: string[] = [];
    let closed = 0;

    for (const issueId of convoy.trackedIssues) {
      const bead = beadMap.get(issueId);
      if (!bead) continue;

      if (bead.status === 'closed') {
        closed++;
      } else if (bead.status === 'in_progress') {
        inProgressIssues.push(issueId);
      } else {
        openIssues.push(issueId);
      }
    }

    // Use WASM for graph analysis if available
    let hasCycles = false;
    let cycleIssues: string[] = [];
    let readyIssues: ReadyIssueInfo[] = [];
    let blockedIssues: BlockerInfo[] = [];

    if (this.config.useWasm && this.wasmModule) {
      try {
        const wasmResult = this.analyzeWithWasm(beads);
        hasCycles = wasmResult.hasCycles;
        cycleIssues = wasmResult.cycleIssues;
        readyIssues = wasmResult.readyIssues;
        blockedIssues = wasmResult.blockedIssues;
      } catch (error) {
        this.logger.warn('WASM analysis failed, falling back to JS', {
          error: error instanceof Error ? error.message : String(error),
        });
        const jsResult = this.analyzeWithJS(beads, convoy.trackedIssues);
        hasCycles = jsResult.hasCycles;
        cycleIssues = jsResult.cycleIssues;
        readyIssues = jsResult.readyIssues;
        blockedIssues = jsResult.blockedIssues;
      }
    } else {
      const jsResult = this.analyzeWithJS(beads, convoy.trackedIssues);
      hasCycles = jsResult.hasCycles;
      cycleIssues = jsResult.cycleIssues;
      readyIssues = jsResult.readyIssues;
      blockedIssues = jsResult.blockedIssues;
    }

    const progress: ConvoyProgress = {
      total: convoy.trackedIssues.length,
      closed,
      inProgress: inProgressIssues.length,
      blocked: blockedIssues.length,
    };

    return {
      allComplete: closed === convoy.trackedIssues.length,
      progress,
      openIssues,
      inProgressIssues,
      blockedIssues,
      readyIssues,
      hasCycles,
      cycleIssues,
    };
  }

  /**
   * Get blockers for all issues in a convoy
   *
   * @param convoyId - Convoy ID
   * @returns Array of blocker information
   */
  async getBlockers(convoyId: string): Promise<BlockerInfo[]> {
    const result = await this.checkCompletion(convoyId);
    return result.blockedIssues;
  }

  /**
   * Get issues ready to work on (no unresolved dependencies)
   *
   * @param convoyId - Convoy ID
   * @returns Array of ready issue information
   */
  async getReadyIssues(convoyId: string): Promise<ReadyIssueInfo[]> {
    const result = await this.checkCompletion(convoyId);
    return result.readyIssues;
  }

  /**
   * Get execution order for convoy issues
   *
   * @param convoyId - Convoy ID
   * @returns Ordered array of issue IDs
   */
  async getExecutionOrder(convoyId: string): Promise<string[]> {
    ConvoyIdSchema.parse(convoyId);

    const convoy = this.tracker.getConvoy(convoyId);
    if (!convoy) {
      throw ConvoyError.notFound(convoyId);
    }

    const beads = await this.fetchBeads(convoy.trackedIssues);

    if (this.config.useWasm && this.wasmModule) {
      try {
        const wasmNodes = this.beadsToWasmNodes(beads);
        const resultJson = this.wasmModule.topo_sort(JSON.stringify(wasmNodes));
        const result: TopoSortResult = JSON.parse(resultJson);

        if (result.hasCycle) {
          throw new GasTownError(
            'Cannot compute execution order: dependency cycle detected',
            GasTownErrorCode.DEPENDENCY_CYCLE,
            { cycleNodes: result.cycleNodes }
          );
        }

        return result.sorted;
      } catch (error) {
        if (error instanceof GasTownError) throw error;
        this.logger.warn('WASM topo sort failed, falling back to JS', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // JavaScript fallback using Kahn's algorithm
    return this.topoSortJS(beads);
  }

  /**
   * Stop watching a convoy
   */
  stopWatching(convoyId: string): void {
    const watcher = this.watchers.get(convoyId);
    if (watcher) {
      clearTimeout(watcher.timer);
      this.watchers.delete(convoyId);

      // Clean up progress emitter
      const emitter = this.progressEmitters.get(convoyId);
      if (emitter) {
        emitter.flush(); // Emit any pending updates
        this.progressEmitters.delete(convoyId);
      }

      // Invalidate completion cache for this convoy
      this.completionCache.delete(convoyId);

      this.logger.info('Stopped watching convoy', { convoyId });
    }
  }

  /**
   * Stop all watchers
   */
  stopAll(): void {
    for (const [convoyId, watcher] of this.watchers) {
      clearTimeout(watcher.timer);
    }
    this.watchers.clear();

    // Clean up all progress emitters
    for (const emitter of this.progressEmitters.values()) {
      emitter.flush();
    }
    this.progressEmitters.clear();

    // Clear all caches
    this.beadCache.clear();
    this.completionCache.clear();
    this.fetchDedup.clear();

    // Clear pending subscriptions
    if (this.subscriptionFlushTimer) {
      clearTimeout(this.subscriptionFlushTimer);
      this.subscriptionFlushTimer = null;
    }
    this.pendingSubscriptions.clear();

    this.logger.info('Stopped all convoy watchers');
  }

  /**
   * Set WASM module
   */
  setWasmModule(module: WasmGraphModule): void {
    this.wasmModule = module;
    this.logger.info('WASM module set');
  }

  /**
   * Check if WASM is available
   */
  isWasmAvailable(): boolean {
    return !!this.wasmModule;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Poll convoy for completion with exponential backoff
   */
  private async pollConvoyWithBackoff(
    convoyId: string,
    callback: CompletionCallback
  ): Promise<void> {
    const watcher = this.watchers.get(convoyId);
    if (!watcher) return;

    try {
      const convoy = this.tracker.getConvoy(convoyId);
      if (!convoy) {
        this.stopWatching(convoyId);
        return;
      }

      // Skip if already complete
      if (convoy.status === 'landed' || convoy.status === 'failed') {
        callback(convoy, convoy.status === 'landed');
        this.stopWatching(convoyId);
        return;
      }

      const result = await this.checkCompletion(convoyId);

      // Delta-based updates: only emit if state changed
      const currentState = JSON.stringify({
        allComplete: result.allComplete,
        progress: result.progress,
        openIssues: result.openIssues.length,
        inProgress: result.inProgressIssues.length,
        blocked: result.blockedIssues.length,
      });

      const stateChanged = watcher.lastState !== currentState;
      watcher.lastState = currentState;

      if (this.config.deltaUpdatesOnly && !stateChanged) {
        // No state change - increase backoff interval
        if (this.config.useExponentialBackoff) {
          watcher.currentInterval = Math.min(
            watcher.currentInterval * this.config.backoffMultiplier,
            this.config.maxBackoffInterval
          );
        }
      } else {
        // State changed - reset to initial interval and call callback
        watcher.currentInterval = this.config.pollInterval;
        callback(convoy, result.allComplete);

        // Emit debounced progress update
        const emitter = this.progressEmitters.get(convoyId);
        if (emitter) {
          emitter.update(result.progress);
        }
      }

      watcher.attempts++;

      // Check max attempts
      if (
        this.config.maxPollAttempts > 0 &&
        watcher.attempts >= this.config.maxPollAttempts
      ) {
        this.logger.warn('Max poll attempts reached', {
          convoyId,
          attempts: watcher.attempts,
        });
        this.stopWatching(convoyId);
        return;
      }

      // Schedule next poll with current interval (possibly backed off)
      clearTimeout(watcher.timer);
      watcher.timer = setTimeout(async () => {
        await this.pollConvoyWithBackoff(convoyId, callback);
      }, watcher.currentInterval);

    } catch (error) {
      this.logger.error('Poll error', {
        convoyId,
        error: error instanceof Error ? error.message : String(error),
      });

      // On error, increase backoff more aggressively
      if (this.config.useExponentialBackoff) {
        watcher.currentInterval = Math.min(
          watcher.currentInterval * (this.config.backoffMultiplier * 1.5),
          this.config.maxBackoffInterval
        );
      }

      // Schedule retry with backed-off interval
      clearTimeout(watcher.timer);
      watcher.timer = setTimeout(async () => {
        await this.pollConvoyWithBackoff(convoyId, callback);
      }, watcher.currentInterval);
    }
  }

  /**
   * Legacy poll convoy method (without backoff)
   * @deprecated Use pollConvoyWithBackoff instead
   */
  private async pollConvoy(
    convoyId: string,
    callback: CompletionCallback
  ): Promise<void> {
    return this.pollConvoyWithBackoff(convoyId, callback);
  }

  /**
   * Fetch beads by IDs with caching, batch deduplication, and object pooling.
   * Uses PooledBead from memory module for reduced allocations.
   */
  private async fetchBeads(issueIds: string[]): Promise<Bead[]> {
    // Create a batch key for deduplication
    const batchKey = issueIds.sort().join(',');

    return this.fetchDedup.dedupe(batchKey, async () => {
      const beads: Bead[] = [];
      const uncachedIds: string[] = [];

      // Check cache first for each bead
      for (const id of issueIds) {
        const cached = this.beadCache.get(id);
        if (cached) {
          beads.push(cached);
        } else {
          uncachedIds.push(id);
        }
      }

      // Fetch uncached beads in parallel (batch of 10)
      const batchSize = 10;
      for (let i = 0; i < uncachedIds.length; i += batchSize) {
        const batch = uncachedIds.slice(i, i + batchSize);
        const fetchPromises = batch.map(async (id) => {
          try {
            const cliBead = await this.bdBridge.getBead(id);

            // Use pooled bead for reduced allocations
            const pooledBead = beadPool.acquire() as PooledBead;
            pooledBead.id = cliBead.id;
            pooledBead.title = cliBead.content.slice(0, 100);
            pooledBead.description = cliBead.content;
            pooledBead.status = this.mapBeadStatus(cliBead.type);
            pooledBead.priority = 0;
            pooledBead.labels = cliBead.tags ?? [];
            pooledBead.createdAt = cliBead.timestamp ? new Date(cliBead.timestamp) : new Date();
            pooledBead.updatedAt = new Date();
            pooledBead.blockedBy = cliBead.parentId ? [cliBead.parentId] : [];
            pooledBead.blocks = [];

            // Convert to plain Bead object for caching (avoid pool reference issues)
            const bead: Bead = {
              id: pooledBead.id,
              title: pooledBead.title,
              description: pooledBead.description,
              status: pooledBead.status,
              priority: pooledBead.priority,
              labels: pooledBead.labels,
              createdAt: pooledBead.createdAt,
              updatedAt: pooledBead.updatedAt,
              blockedBy: pooledBead.blockedBy,
              blocks: pooledBead.blocks,
            };

            // Release pooled bead back to pool
            beadPool.release(pooledBead);

            // Cache the bead
            this.beadCache.set(id, bead);
            return bead;
          } catch {
            // Skip invalid beads
            return null;
          }
        });

        const results = await Promise.all(fetchPromises);
        beads.push(...results.filter((b): b is Bead => b !== null));
      }

      return beads;
    });
  }

  /**
   * Map CLI bead type to Gas Town status
   */
  private mapBeadStatus(type: string): BeadStatus {
    switch (type) {
      case 'closed':
        return 'closed';
      case 'in_progress':
      case 'response':
      case 'code':
        return 'in_progress';
      default:
        return 'open';
    }
  }

  /**
   * Convert beads to WASM node format
   */
  private beadsToWasmNodes(beads: Bead[]): WasmBeadNode[] {
    return beads.map(bead => ({
      id: bead.id,
      title: bead.title,
      status: bead.status,
      priority: bead.priority,
      blocked_by: bead.blockedBy ?? [],
      blocks: bead.blocks ?? [],
      duration: undefined,
    }));
  }

  /**
   * Analyze dependencies with WASM
   */
  private analyzeWithWasm(beads: Bead[]): {
    hasCycles: boolean;
    cycleIssues: string[];
    readyIssues: ReadyIssueInfo[];
    blockedIssues: BlockerInfo[];
  } {
    if (!this.wasmModule) {
      throw new Error('WASM module not available');
    }

    const wasmNodes = this.beadsToWasmNodes(beads);
    const beadsJson = JSON.stringify(wasmNodes);

    // Check for cycles
    const hasCycles = this.wasmModule.has_cycle(beadsJson);
    let cycleIssues: string[] = [];
    if (hasCycles) {
      const cycleJson = this.wasmModule.find_cycle_nodes(beadsJson);
      cycleIssues = JSON.parse(cycleJson);
    }

    // Get ready beads
    const readyJson = this.wasmModule.get_ready_beads(beadsJson);
    const readyIds: string[] = JSON.parse(readyJson);

    // Get execution levels
    const levelsJson = this.wasmModule.compute_levels(beadsJson);
    const levels: Record<string, string[]> = JSON.parse(levelsJson);

    // Build level map
    const levelMap = new Map<string, number>();
    for (const [levelStr, ids] of Object.entries(levels)) {
      const level = parseInt(levelStr, 10);
      for (const id of ids) {
        levelMap.set(id, level);
      }
    }

    // Build ready issues with level info
    const beadMap = new Map(beads.map(b => [b.id, b]));
    const readyIssues: ReadyIssueInfo[] = readyIds.map(id => {
      const bead = beadMap.get(id)!;
      return {
        id,
        title: bead.title,
        priority: bead.priority,
        level: levelMap.get(id) ?? 0,
      };
    });

    // Find blocked issues
    const closedSet = new Set(
      beads.filter(b => b.status === 'closed').map(b => b.id)
    );
    const convoySet = new Set(beads.map(b => b.id));

    const blockedIssues: BlockerInfo[] = beads
      .filter(bead => {
        if (bead.status === 'closed') return false;
        const blockers = bead.blockedBy ?? [];
        return blockers.some(blockerId => !closedSet.has(blockerId));
      })
      .map(bead => {
        const blockers = (bead.blockedBy ?? []).filter(
          id => !closedSet.has(id)
        );
        const internalBlockers = blockers.every(id => convoySet.has(id));
        return {
          blockedIssue: bead.id,
          blockers,
          internalBlockers,
        };
      });

    return { hasCycles, cycleIssues, readyIssues, blockedIssues };
  }

  /**
   * Analyze dependencies with JavaScript (fallback)
   */
  private analyzeWithJS(beads: Bead[], convoyIssues: string[]): {
    hasCycles: boolean;
    cycleIssues: string[];
    readyIssues: ReadyIssueInfo[];
    blockedIssues: BlockerInfo[];
  } {
    const beadMap = new Map(beads.map(b => [b.id, b]));
    const convoySet = new Set(convoyIssues);
    const closedSet = new Set(
      beads.filter(b => b.status === 'closed').map(b => b.id)
    );

    // Simple cycle detection using DFS
    const hasCycles = this.detectCyclesJS(beads);
    const cycleIssues: string[] = hasCycles
      ? this.findCycleNodesJS(beads)
      : [];

    // Find ready issues (no unresolved blockers)
    const readyIssues: ReadyIssueInfo[] = beads
      .filter(bead => {
        if (bead.status === 'closed') return false;
        const blockers = bead.blockedBy ?? [];
        return blockers.every(id => closedSet.has(id));
      })
      .map((bead, index) => ({
        id: bead.id,
        title: bead.title,
        priority: bead.priority,
        level: 0, // Simplified - no level computation in JS fallback
      }));

    // Find blocked issues
    const blockedIssues: BlockerInfo[] = beads
      .filter(bead => {
        if (bead.status === 'closed') return false;
        const blockers = bead.blockedBy ?? [];
        return blockers.some(id => !closedSet.has(id));
      })
      .map(bead => {
        const blockers = (bead.blockedBy ?? []).filter(
          id => !closedSet.has(id)
        );
        const internalBlockers = blockers.every(id => convoySet.has(id));
        return {
          blockedIssue: bead.id,
          blockers,
          internalBlockers,
        };
      });

    return { hasCycles, cycleIssues, readyIssues, blockedIssues };
  }

  /**
   * Detect cycles using DFS (JavaScript)
   */
  private detectCyclesJS(beads: Bead[]): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const beadMap = new Map(beads.map(b => [b.id, b]));

    const dfs = (id: string): boolean => {
      visited.add(id);
      recStack.add(id);

      const bead = beadMap.get(id);
      if (bead) {
        for (const blockerId of bead.blockedBy ?? []) {
          if (!visited.has(blockerId)) {
            if (dfs(blockerId)) return true;
          } else if (recStack.has(blockerId)) {
            return true;
          }
        }
      }

      recStack.delete(id);
      return false;
    };

    for (const bead of beads) {
      if (!visited.has(bead.id)) {
        if (dfs(bead.id)) return true;
      }
    }

    return false;
  }

  /**
   * Find nodes in cycles (JavaScript)
   */
  private findCycleNodesJS(beads: Bead[]): string[] {
    // Simplified - just return all nodes that might be in cycles
    const inDegree = new Map<string, number>();
    const beadMap = new Map(beads.map(b => [b.id, b]));

    for (const bead of beads) {
      inDegree.set(bead.id, (bead.blockedBy ?? []).length);
    }

    // Remove nodes with no incoming edges iteratively
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, degree] of inDegree) {
        if (degree === 0) {
          inDegree.delete(id);
          // Decrease degree of nodes blocked by this one
          for (const bead of beads) {
            if (bead.blockedBy?.includes(id)) {
              const current = inDegree.get(bead.id) ?? 0;
              if (current > 0) {
                inDegree.set(bead.id, current - 1);
                changed = true;
              }
            }
          }
          changed = true;
        }
      }
    }

    // Remaining nodes are in cycles
    return Array.from(inDegree.keys());
  }

  /**
   * Topological sort using Kahn's algorithm (JavaScript)
   */
  private topoSortJS(beads: Bead[]): string[] {
    const beadMap = new Map(beads.map(b => [b.id, b]));
    const inDegree = new Map<string, number>();
    const result: string[] = [];

    // Initialize in-degrees
    for (const bead of beads) {
      inDegree.set(bead.id, (bead.blockedBy ?? []).length);
    }

    // Queue nodes with no dependencies
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);

      // Find nodes blocked by this one and decrease their in-degree
      for (const bead of beads) {
        if (bead.blockedBy?.includes(id)) {
          const current = inDegree.get(bead.id) ?? 0;
          const newDegree = current - 1;
          inDegree.set(bead.id, newDegree);
          if (newDegree === 0) {
            queue.push(bead.id);
          }
        }
      }
    }

    // If we couldn't process all nodes, there's a cycle
    if (result.length !== beads.length) {
      throw new GasTownError(
        'Cannot compute execution order: dependency cycle detected',
        GasTownErrorCode.DEPENDENCY_CYCLE
      );
    }

    return result;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopAll();
    this.removeAllListeners();
  }
}

/**
 * Create a new convoy observer instance
 */
export function createConvoyObserver(
  config: ConvoyObserverConfig,
  logger?: ObserverLogger
): ConvoyObserver {
  return new ConvoyObserver(config, logger);
}

export default ConvoyObserver;
