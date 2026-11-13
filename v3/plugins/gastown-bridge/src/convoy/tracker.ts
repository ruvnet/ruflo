/**
 * Convoy Tracker
 *
 * Manages convoy lifecycle including creation, modification, progress
 * tracking, and completion. Convoys are work-order groups that track
 * related beads (issues) through their lifecycle.
 *
 * Features:
 * - Create and manage convoy groups
 * - Add/remove beads to convoys
 * - Track progress and status changes
 * - Event emission for status transitions
 * - Integration with bd-bridge for bead operations
 *
 * @module gastown-bridge/convoy/tracker
 */

import { EventEmitter } from 'events';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type {
  Convoy,
  ConvoyStatus,
  ConvoyProgress,
  CreateConvoyOptions,
  Bead,
  BeadStatus,
} from '../types.js';
import {
  ConvoySchema,
  CreateConvoyOptionsSchema,
} from '../types.js';
import { BdBridge, type BeadQuery } from '../bridges/bd-bridge.js';
import { ConvoyError, GasTownErrorCode, wrapError } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Convoy event types
 */
export type ConvoyEventType =
  | 'convoy:created'
  | 'convoy:started'
  | 'convoy:progressed'
  | 'convoy:completed'
  | 'convoy:cancelled'
  | 'convoy:paused'
  | 'convoy:resumed'
  | 'convoy:issue:added'
  | 'convoy:issue:removed'
  | 'convoy:issue:updated';

/**
 * Convoy event payload
 */
export interface ConvoyEvent {
  /** Event type */
  type: ConvoyEventType;
  /** Convoy ID */
  convoyId: string;
  /** Convoy name */
  convoyName: string;
  /** Event timestamp */
  timestamp: Date;
  /** Previous status (for status change events) */
  previousStatus?: ConvoyStatus;
  /** Current status */
  status: ConvoyStatus;
  /** Progress at time of event */
  progress: ConvoyProgress;
  /** Issue IDs affected (for issue events) */
  issues?: string[];
  /** Cancellation reason (for cancelled events) */
  reason?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Convoy tracker configuration
 */
export interface ConvoyTrackerConfig {
  /** BD bridge instance for bead operations */
  bdBridge: BdBridge;
  /** Auto-update progress on issue changes */
  autoUpdateProgress?: boolean;
  /** Progress update interval in milliseconds */
  progressUpdateInterval?: number;
  /** Enable persistent storage */
  persistConvoys?: boolean;
  /** Storage path for convoy data */
  storagePath?: string;
}

/**
 * Internal convoy storage
 */
interface ConvoyStore {
  convoy: Convoy;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * Logger interface
 */
export interface ConvoyLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// ============================================================================
// Default Logger
// ============================================================================

const defaultLogger: ConvoyLogger = {
  debug: (msg, meta) => console.debug(`[convoy-tracker] ${msg}`, meta ?? ''),
  info: (msg, meta) => console.info(`[convoy-tracker] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[convoy-tracker] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[convoy-tracker] ${msg}`, meta ?? ''),
};

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Convoy ID schema
 */
const ConvoyIdSchema = z.string()
  .uuid('Invalid convoy ID format');

/**
 * Issue ID array schema
 */
const IssueIdsSchema = z.array(z.string().min(1))
  .min(1, 'At least one issue ID required');

// ============================================================================
// Convoy Tracker Implementation
// ============================================================================

/**
 * Convoy Tracker
 *
 * Manages convoy lifecycle and tracks progress of grouped work.
 *
 * @example
 * ```typescript
 * const tracker = new ConvoyTracker({
 *   bdBridge: await createBdBridge().initialize(),
 * });
 *
 * // Create a convoy
 * const convoy = await tracker.create(
 *   'Sprint 1',
 *   ['gt-abc12', 'gt-def34', 'gt-ghi56'],
 *   'First sprint tasks'
 * );
 *
 * // Monitor progress
 * tracker.on('convoy:progressed', (event) => {
 *   console.log(`Progress: ${event.progress.closed}/${event.progress.total}`);
 * });
 *
 * // Check status
 * const status = await tracker.getStatus(convoy.id);
 * ```
 */
export class ConvoyTracker extends EventEmitter {
  private bdBridge: BdBridge;
  private convoys: Map<string, ConvoyStore> = new Map();
  private logger: ConvoyLogger;
  private config: Required<Omit<ConvoyTrackerConfig, 'bdBridge'>>;
  private progressTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: ConvoyTrackerConfig, logger?: ConvoyLogger) {
    super();
    this.bdBridge = config.bdBridge;
    this.logger = logger ?? defaultLogger;
    this.config = {
      autoUpdateProgress: config.autoUpdateProgress ?? true,
      progressUpdateInterval: config.progressUpdateInterval ?? 30000,
      persistConvoys: config.persistConvoys ?? false,
      storagePath: config.storagePath ?? './data/convoys',
    };
  }

  /**
   * Create a new convoy
   *
   * @param name - Convoy name
   * @param issues - Issue IDs to include
   * @param description - Optional description
   * @returns Created convoy
   */
  async create(
    name: string,
    issues: string[],
    description?: string
  ): Promise<Convoy> {
    // Validate inputs
    const validatedOptions = CreateConvoyOptionsSchema.parse({
      name,
      issues,
      description,
    });

    // Verify issues exist
    const verifiedIssues = await this.verifyIssues(validatedOptions.issues);
    if (verifiedIssues.length === 0) {
      throw ConvoyError.createFailed('No valid issues found');
    }

    // Calculate initial progress
    const progress = await this.calculateProgress(verifiedIssues);

    // Create convoy
    const convoyId = randomUUID();
    const now = new Date();

    const convoy: Convoy = {
      id: convoyId,
      name: validatedOptions.name,
      trackedIssues: verifiedIssues,
      status: 'active',
      startedAt: now,
      progress,
      description: validatedOptions.description,
    };

    // Store convoy
    this.convoys.set(convoyId, {
      convoy,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    });

    // Emit creation event
    this.emitConvoyEvent('convoy:created', convoy);

    // Start progress tracking if enabled
    if (this.config.autoUpdateProgress) {
      this.startProgressTracking(convoyId);
    }

    this.logger.info('Convoy created', {
      convoyId,
      name,
      issueCount: verifiedIssues.length,
    });

    return convoy;
  }

  /**
   * Add issues to an existing convoy
   *
   * @param convoyId - Convoy ID
   * @param issues - Issue IDs to add
   * @returns Updated convoy
   */
  async addIssues(convoyId: string, issues: string[]): Promise<Convoy> {
    // Validate inputs
    ConvoyIdSchema.parse(convoyId);
    IssueIdsSchema.parse(issues);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    // Verify issues
    const verifiedIssues = await this.verifyIssues(issues);
    if (verifiedIssues.length === 0) {
      throw new ConvoyError(
        'No valid issues to add',
        GasTownErrorCode.CONVOY_CREATE_FAILED,
        { convoyId, issues }
      );
    }

    // Add new issues (avoid duplicates)
    const existingSet = new Set(store.convoy.trackedIssues);
    const newIssues = verifiedIssues.filter(id => !existingSet.has(id));

    if (newIssues.length === 0) {
      return store.convoy;
    }

    // Update convoy
    const updatedIssues = [...store.convoy.trackedIssues, ...newIssues];
    const progress = await this.calculateProgress(updatedIssues);

    const updatedConvoy: Convoy = {
      ...store.convoy,
      trackedIssues: updatedIssues,
      progress,
    };

    store.convoy = updatedConvoy;
    store.updatedAt = new Date();

    // Emit event
    this.emitConvoyEvent('convoy:issue:added', updatedConvoy, {
      issues: newIssues,
    });

    this.logger.info('Issues added to convoy', {
      convoyId,
      addedCount: newIssues.length,
      totalCount: updatedIssues.length,
    });

    return updatedConvoy;
  }

  /**
   * Remove issues from a convoy
   *
   * @param convoyId - Convoy ID
   * @param issues - Issue IDs to remove
   * @returns Updated convoy
   */
  async removeIssues(convoyId: string, issues: string[]): Promise<Convoy> {
    // Validate inputs
    ConvoyIdSchema.parse(convoyId);
    IssueIdsSchema.parse(issues);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    // Remove issues
    const removeSet = new Set(issues);
    const remainingIssues = store.convoy.trackedIssues.filter(
      id => !removeSet.has(id)
    );

    if (remainingIssues.length === store.convoy.trackedIssues.length) {
      return store.convoy;
    }

    // Recalculate progress
    const progress = remainingIssues.length > 0
      ? await this.calculateProgress(remainingIssues)
      : { total: 0, closed: 0, inProgress: 0, blocked: 0 };

    const updatedConvoy: Convoy = {
      ...store.convoy,
      trackedIssues: remainingIssues,
      progress,
    };

    store.convoy = updatedConvoy;
    store.updatedAt = new Date();

    // Emit event
    const removedIssues = issues.filter(id =>
      store.convoy.trackedIssues.includes(id) && !remainingIssues.includes(id)
    );

    this.emitConvoyEvent('convoy:issue:removed', updatedConvoy, {
      issues: removedIssues,
    });

    this.logger.info('Issues removed from convoy', {
      convoyId,
      removedCount: removedIssues.length,
      remainingCount: remainingIssues.length,
    });

    return updatedConvoy;
  }

  /**
   * Get convoy status
   *
   * @param convoyId - Convoy ID
   * @returns Convoy with updated progress
   */
  async getStatus(convoyId: string): Promise<Convoy> {
    ConvoyIdSchema.parse(convoyId);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    // Refresh progress
    const progress = await this.calculateProgress(store.convoy.trackedIssues);
    const previousProgress = store.convoy.progress;

    // Check if progress changed
    if (
      progress.closed !== previousProgress.closed ||
      progress.inProgress !== previousProgress.inProgress ||
      progress.blocked !== previousProgress.blocked
    ) {
      const updatedConvoy: Convoy = {
        ...store.convoy,
        progress,
      };

      store.convoy = updatedConvoy;
      store.updatedAt = new Date();

      this.emitConvoyEvent('convoy:progressed', updatedConvoy);
    }

    return store.convoy;
  }

  /**
   * Mark convoy as complete
   *
   * @param convoyId - Convoy ID
   * @returns Completed convoy
   */
  async complete(convoyId: string): Promise<Convoy> {
    ConvoyIdSchema.parse(convoyId);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    if (store.convoy.status === 'landed') {
      return store.convoy;
    }

    const previousStatus = store.convoy.status;
    const now = new Date();

    const completedConvoy: Convoy = {
      ...store.convoy,
      status: 'landed',
      completedAt: now,
    };

    store.convoy = completedConvoy;
    store.updatedAt = now;

    // Stop progress tracking
    this.stopProgressTracking(convoyId);

    // Emit event
    this.emitConvoyEvent('convoy:completed', completedConvoy, {
      previousStatus,
    });

    this.logger.info('Convoy completed', {
      convoyId,
      name: completedConvoy.name,
      duration: now.getTime() - completedConvoy.startedAt.getTime(),
    });

    return completedConvoy;
  }

  /**
   * Cancel a convoy
   *
   * @param convoyId - Convoy ID
   * @param reason - Cancellation reason
   * @returns Cancelled convoy
   */
  async cancel(convoyId: string, reason?: string): Promise<Convoy> {
    ConvoyIdSchema.parse(convoyId);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    if (store.convoy.status === 'failed' || store.convoy.status === 'landed') {
      return store.convoy;
    }

    const previousStatus = store.convoy.status;
    const now = new Date();

    const cancelledConvoy: Convoy = {
      ...store.convoy,
      status: 'failed',
      completedAt: now,
    };

    store.convoy = cancelledConvoy;
    store.updatedAt = now;
    store.metadata.cancellationReason = reason;

    // Stop progress tracking
    this.stopProgressTracking(convoyId);

    // Emit event
    this.emitConvoyEvent('convoy:cancelled', cancelledConvoy, {
      previousStatus,
      reason,
    });

    this.logger.info('Convoy cancelled', {
      convoyId,
      name: cancelledConvoy.name,
      reason,
    });

    return cancelledConvoy;
  }

  /**
   * Pause a convoy
   *
   * @param convoyId - Convoy ID
   * @returns Paused convoy
   */
  async pause(convoyId: string): Promise<Convoy> {
    ConvoyIdSchema.parse(convoyId);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    if (store.convoy.status !== 'active') {
      return store.convoy;
    }

    const previousStatus = store.convoy.status;

    const pausedConvoy: Convoy = {
      ...store.convoy,
      status: 'paused',
    };

    store.convoy = pausedConvoy;
    store.updatedAt = new Date();

    // Stop progress tracking while paused
    this.stopProgressTracking(convoyId);

    // Emit event
    this.emitConvoyEvent('convoy:paused', pausedConvoy, {
      previousStatus,
    });

    this.logger.info('Convoy paused', {
      convoyId,
      name: pausedConvoy.name,
    });

    return pausedConvoy;
  }

  /**
   * Resume a paused convoy
   *
   * @param convoyId - Convoy ID
   * @returns Resumed convoy
   */
  async resume(convoyId: string): Promise<Convoy> {
    ConvoyIdSchema.parse(convoyId);

    const store = this.convoys.get(convoyId);
    if (!store) {
      throw ConvoyError.notFound(convoyId);
    }

    if (store.convoy.status !== 'paused') {
      return store.convoy;
    }

    const previousStatus = store.convoy.status;

    const resumedConvoy: Convoy = {
      ...store.convoy,
      status: 'active',
    };

    store.convoy = resumedConvoy;
    store.updatedAt = new Date();

    // Resume progress tracking
    if (this.config.autoUpdateProgress) {
      this.startProgressTracking(convoyId);
    }

    // Emit event
    this.emitConvoyEvent('convoy:resumed', resumedConvoy, {
      previousStatus,
    });

    this.logger.info('Convoy resumed', {
      convoyId,
      name: resumedConvoy.name,
    });

    return resumedConvoy;
  }

  /**
   * List all convoys
   *
   * @param status - Optional status filter
   * @returns Array of convoys
   */
  listConvoys(status?: ConvoyStatus): Convoy[] {
    const convoys = Array.from(this.convoys.values())
      .map(store => store.convoy);

    if (status) {
      return convoys.filter(convoy => convoy.status === status);
    }

    return convoys;
  }

  /**
   * Get convoy by ID
   *
   * @param convoyId - Convoy ID
   * @returns Convoy or undefined
   */
  getConvoy(convoyId: string): Convoy | undefined {
    return this.convoys.get(convoyId)?.convoy;
  }

  /**
   * Delete a convoy
   *
   * @param convoyId - Convoy ID
   * @returns True if deleted
   */
  deleteConvoy(convoyId: string): boolean {
    this.stopProgressTracking(convoyId);
    return this.convoys.delete(convoyId);
  }

  /**
   * Calculate progress for a set of issues
   */
  private async calculateProgress(issueIds: string[]): Promise<ConvoyProgress> {
    if (issueIds.length === 0) {
      return { total: 0, closed: 0, inProgress: 0, blocked: 0 };
    }

    try {
      // Fetch beads
      const beads = await this.fetchBeads(issueIds);
      const beadMap = new Map(beads.map(b => [b.id, b]));

      let closed = 0;
      let inProgress = 0;
      let blocked = 0;

      for (const issueId of issueIds) {
        const bead = beadMap.get(issueId);
        if (!bead) continue;

        if (bead.status === 'closed') {
          closed++;
        } else if (bead.status === 'in_progress') {
          inProgress++;
        }

        // Check if blocked
        if (bead.blockedBy && bead.blockedBy.length > 0) {
          const hasOpenBlocker = bead.blockedBy.some(blockerId => {
            const blocker = beadMap.get(blockerId);
            return blocker && blocker.status !== 'closed';
          });
          if (hasOpenBlocker) {
            blocked++;
          }
        }
      }

      return {
        total: issueIds.length,
        closed,
        inProgress,
        blocked,
      };
    } catch (error) {
      this.logger.warn('Failed to calculate progress', {
        issueIds,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        total: issueIds.length,
        closed: 0,
        inProgress: 0,
        blocked: 0,
      };
    }
  }

  /**
   * Verify issues exist
   */
  private async verifyIssues(issueIds: string[]): Promise<string[]> {
    const verified: string[] = [];

    for (const id of issueIds) {
      try {
        await this.bdBridge.getBead(id);
        verified.push(id);
      } catch {
        this.logger.warn('Issue not found', { issueId: id });
      }
    }

    return verified;
  }

  /**
   * Fetch beads by IDs
   */
  private async fetchBeads(issueIds: string[]): Promise<Bead[]> {
    const beads: Bead[] = [];

    for (const id of issueIds) {
      try {
        const cliBead = await this.bdBridge.getBead(id);
        // Convert CLI bead to Gas Town bead
        beads.push({
          id: cliBead.id,
          title: cliBead.content.slice(0, 100),
          description: cliBead.content,
          status: this.mapBeadStatus(cliBead.type),
          priority: 0,
          labels: cliBead.tags ?? [],
          createdAt: cliBead.timestamp ? new Date(cliBead.timestamp) : new Date(),
          updatedAt: new Date(),
          blockedBy: cliBead.parentId ? [cliBead.parentId] : [],
        });
      } catch {
        // Skip invalid beads
      }
    }

    return beads;
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
   * Start progress tracking timer
   */
  private startProgressTracking(convoyId: string): void {
    if (this.progressTimers.has(convoyId)) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        await this.getStatus(convoyId);
      } catch (error) {
        this.logger.warn('Progress tracking error', {
          convoyId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.progressUpdateInterval);

    this.progressTimers.set(convoyId, timer);
  }

  /**
   * Stop progress tracking timer
   */
  private stopProgressTracking(convoyId: string): void {
    const timer = this.progressTimers.get(convoyId);
    if (timer) {
      clearInterval(timer);
      this.progressTimers.delete(convoyId);
    }
  }

  /**
   * Emit convoy event
   */
  private emitConvoyEvent(
    type: ConvoyEventType,
    convoy: Convoy,
    extra?: Partial<ConvoyEvent>
  ): void {
    const event: ConvoyEvent = {
      type,
      convoyId: convoy.id,
      convoyName: convoy.name,
      timestamp: new Date(),
      status: convoy.status,
      progress: convoy.progress,
      ...extra,
    };

    this.emit(type, event);
    this.emit('convoy:*', event);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    for (const [convoyId, timer] of this.progressTimers) {
      clearInterval(timer);
    }
    this.progressTimers.clear();
    this.removeAllListeners();
  }
}

/**
 * Create a new convoy tracker instance
 */
export function createConvoyTracker(
  config: ConvoyTrackerConfig,
  logger?: ConvoyLogger
): ConvoyTracker {
  return new ConvoyTracker(config, logger);
}

export default ConvoyTracker;
