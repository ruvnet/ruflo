/**
 * Beads Two-Way Sync Manager
 *
 * Real-time synchronization between Claude-Flow and beads-ui.
 * Provides file system watching, event emission, and conflict resolution
 * for bidirectional sync of Beads issue state.
 *
 * @see https://github.com/steveyegge/beads
 */

import { EventEmitter } from 'events';
import { watch, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { FSWatcher, WatchEventType } from 'fs';
import type { BeadsIssue, BeadsConfig } from './types.js';
import { DEFAULT_BEADS_CONFIG, BeadsError, BeadsErrorCodes } from './types.js';

// ============================================
// Sync Types
// ============================================

/**
 * Sync event types emitted by the manager
 */
export type SyncEventType =
  | 'sync:started'
  | 'sync:completed'
  | 'sync:error'
  | 'sync:conflict'
  | 'change:local'
  | 'change:remote'
  | 'change:merged'
  | 'watcher:started'
  | 'watcher:stopped'
  | 'watcher:error';

/**
 * Sync event payload
 */
export interface SyncEvent {
  /** Event type */
  type: SyncEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event-specific data */
  data?: unknown;
  /** Source of the change (local or remote) */
  source?: 'local' | 'remote';
  /** File path that triggered the event */
  filePath?: string;
}

/**
 * Change record for tracking modifications
 */
export interface ChangeRecord {
  /** Issue ID that changed */
  issueId: string;
  /** Type of change */
  changeType: 'create' | 'update' | 'delete';
  /** Timestamp of change */
  timestamp: string;
  /** Source of change */
  source: 'local' | 'remote';
  /** Previous state (for updates) */
  previousState?: Partial<BeadsIssue>;
  /** New state */
  newState?: Partial<BeadsIssue>;
}

/**
 * Conflict record when local and remote changes collide
 */
export interface ConflictRecord {
  /** Issue ID with conflict */
  issueId: string;
  /** Local version */
  local: Partial<BeadsIssue>;
  /** Remote version */
  remote: Partial<BeadsIssue>;
  /** Timestamp when conflict was detected */
  detectedAt: string;
  /** Resolution strategy applied */
  resolution?: ConflictResolution;
  /** Resolved state after applying strategy */
  resolved?: Partial<BeadsIssue>;
}

/**
 * Conflict resolution strategies
 */
export type ConflictResolution =
  | 'local-wins'      // Local changes take precedence
  | 'remote-wins'     // Remote changes take precedence
  | 'most-recent'     // Most recently modified wins
  | 'merge'           // Attempt to merge non-conflicting fields
  | 'manual';         // Flag for manual resolution

/**
 * Sync manager configuration
 */
export interface SyncConfig {
  /** Path to .beads directory */
  beadsDir: string;
  /** Debounce interval for file changes (ms) */
  debounceMs: number;
  /** Conflict resolution strategy */
  conflictStrategy: ConflictResolution;
  /** Enable automatic sync */
  autoSync: boolean;
  /** Sync interval for polling (ms) */
  syncInterval: number;
  /** Maximum retries for failed operations */
  maxRetries: number;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Default sync configuration
 */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  beadsDir: '.beads',
  debounceMs: 100,
  conflictStrategy: 'most-recent',
  autoSync: true,
  syncInterval: 5000,
  maxRetries: 3,
  verbose: false,
};

/**
 * Sync state snapshot
 */
export interface SyncState {
  /** Last sync timestamp */
  lastSync: string | null;
  /** Pending local changes */
  pendingLocal: ChangeRecord[];
  /** Pending remote changes */
  pendingRemote: ChangeRecord[];
  /** Unresolved conflicts */
  conflicts: ConflictRecord[];
  /** Whether sync is currently in progress */
  isSyncing: boolean;
  /** Whether watcher is active */
  isWatching: boolean;
}

// ============================================
// Sync Manager
// ============================================

/**
 * BeadsSyncManager handles real-time synchronization between Claude-Flow
 * and beads-ui through file system watching and event emission.
 *
 * Usage:
 * ```typescript
 * const sync = new BeadsSyncManager({ beadsDir: '.beads' });
 *
 * sync.on('change:local', (event) => {
 *   console.log('Local change detected:', event.data);
 * });
 *
 * sync.on('sync:conflict', (event) => {
 *   console.log('Conflict detected:', event.data);
 * });
 *
 * await sync.start();
 * ```
 */
export class BeadsSyncManager extends EventEmitter {
  private config: SyncConfig;
  private watcher: FSWatcher | null = null;
  private state: SyncState;
  private debounceTimer: NodeJS.Timeout | null = null;
  private syncIntervalTimer: NodeJS.Timeout | null = null;
  private localStateCache: Map<string, BeadsIssue> = new Map();
  private pendingChanges: Set<string> = new Set();

  constructor(config?: Partial<SyncConfig>) {
    super();
    this.config = {
      ...DEFAULT_SYNC_CONFIG,
      ...config,
    };
    this.state = {
      lastSync: null,
      pendingLocal: [],
      pendingRemote: [],
      conflicts: [],
      isSyncing: false,
      isWatching: false,
    };
  }

  /**
   * Start the sync manager
   * Initializes file watcher and begins monitoring for changes
   */
  async start(): Promise<void> {
    if (this.state.isWatching) {
      return;
    }

    const beadsPath = this.getBeadsPath();

    // Ensure .beads directory exists
    if (!existsSync(beadsPath)) {
      this.emit('watcher:error', this.createEvent('watcher:error', {
        error: 'Beads directory not found',
        path: beadsPath,
      }));
      throw new BeadsError(
        `Beads directory not found: ${beadsPath}`,
        BeadsErrorCodes.NOT_INITIALIZED,
        { path: beadsPath }
      );
    }

    // Load initial state
    await this.loadLocalState();

    // Start file watcher
    this.startWatcher();

    // Start sync interval if enabled
    if (this.config.autoSync) {
      this.startSyncInterval();
    }

    this.state.isWatching = true;
    this.emit('watcher:started', this.createEvent('watcher:started', {
      beadsDir: beadsPath,
      config: this.config,
    }));
  }

  /**
   * Stop the sync manager
   * Cleans up file watcher and timers
   */
  async stop(): Promise<void> {
    if (!this.state.isWatching) {
      return;
    }

    // Stop watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }

    this.state.isWatching = false;
    this.emit('watcher:stopped', this.createEvent('watcher:stopped'));
  }

  /**
   * Trigger a manual sync
   * Processes pending changes and resolves conflicts
   */
  async sync(): Promise<SyncState> {
    if (this.state.isSyncing) {
      return this.state;
    }

    this.state.isSyncing = true;
    this.emit('sync:started', this.createEvent('sync:started'));

    try {
      // Process pending changes
      await this.processPendingChanges();

      // Resolve any conflicts
      await this.resolveConflicts();

      this.state.lastSync = new Date().toISOString();
      this.emit('sync:completed', this.createEvent('sync:completed', {
        lastSync: this.state.lastSync,
        pendingLocal: this.state.pendingLocal.length,
        pendingRemote: this.state.pendingRemote.length,
        conflicts: this.state.conflicts.length,
      }));
    } catch (error) {
      this.emit('sync:error', this.createEvent('sync:error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
      throw error;
    } finally {
      this.state.isSyncing = false;
    }

    return this.getState();
  }

  /**
   * Record a local change
   * Called when the local system makes a change to Beads state
   */
  recordLocalChange(change: Omit<ChangeRecord, 'source' | 'timestamp'>): void {
    const record: ChangeRecord = {
      ...change,
      source: 'local',
      timestamp: new Date().toISOString(),
    };

    this.state.pendingLocal.push(record);
    this.emit('change:local', this.createEvent('change:local', record, 'local'));

    // Check for conflicts with pending remote changes
    this.checkForConflicts(record);
  }

  /**
   * Record a remote change
   * Called when receiving updates from beads-ui or external sources
   */
  recordRemoteChange(change: Omit<ChangeRecord, 'source' | 'timestamp'>): void {
    const record: ChangeRecord = {
      ...change,
      source: 'remote',
      timestamp: new Date().toISOString(),
    };

    this.state.pendingRemote.push(record);
    this.emit('change:remote', this.createEvent('change:remote', record, 'remote'));

    // Check for conflicts with pending local changes
    this.checkForConflicts(record);
  }

  /**
   * Apply a remote change to local state
   * Used when processing incoming updates from beads-ui
   */
  async applyRemoteChange(change: ChangeRecord): Promise<void> {
    const beadsFile = this.getBeadsFilePath();

    if (!existsSync(beadsFile)) {
      throw new BeadsError(
        'Beads file not found',
        BeadsErrorCodes.NOT_INITIALIZED,
        { path: beadsFile }
      );
    }

    // Read current state
    const issues = this.readBeadsFile();

    switch (change.changeType) {
      case 'create':
        if (change.newState) {
          issues.push(change.newState as BeadsIssue);
        }
        break;

      case 'update':
        const updateIndex = issues.findIndex(i => i.id === change.issueId);
        if (updateIndex >= 0 && change.newState) {
          issues[updateIndex] = {
            ...issues[updateIndex],
            ...change.newState,
            updated_at: new Date().toISOString(),
          };
        }
        break;

      case 'delete':
        const deleteIndex = issues.findIndex(i => i.id === change.issueId);
        if (deleteIndex >= 0) {
          issues.splice(deleteIndex, 1);
        }
        break;
    }

    // Write updated state
    this.writeBeadsFile(issues);

    // Update cache
    if (change.changeType === 'delete') {
      this.localStateCache.delete(change.issueId);
    } else if (change.newState) {
      this.localStateCache.set(change.issueId, change.newState as BeadsIssue);
    }

    this.emit('change:merged', this.createEvent('change:merged', change));
  }

  /**
   * Get current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }

  /**
   * Get pending conflicts
   */
  getConflicts(): ConflictRecord[] {
    return [...this.state.conflicts];
  }

  /**
   * Resolve a specific conflict manually
   */
  resolveConflict(issueId: string, resolution: ConflictResolution, resolved?: Partial<BeadsIssue>): void {
    const conflictIndex = this.state.conflicts.findIndex(c => c.issueId === issueId);
    if (conflictIndex < 0) {
      return;
    }

    const conflict = this.state.conflicts[conflictIndex];
    conflict.resolution = resolution;
    conflict.resolved = resolved || this.applyResolutionStrategy(conflict, resolution);

    // Apply the resolution
    if (conflict.resolved) {
      this.applyRemoteChange({
        issueId,
        changeType: 'update',
        timestamp: new Date().toISOString(),
        source: 'local',
        newState: conflict.resolved,
      });
    }

    // Remove from conflicts
    this.state.conflicts.splice(conflictIndex, 1);
  }

  /**
   * Set conflict resolution strategy
   */
  setConflictStrategy(strategy: ConflictResolution): void {
    this.config.conflictStrategy = strategy;
  }

  // ============================================
  // Private Methods
  // ============================================

  private getBeadsPath(): string {
    return join(process.cwd(), this.config.beadsDir);
  }

  private getBeadsFilePath(): string {
    return join(this.getBeadsPath(), 'beads.jsonl');
  }

  private createEvent(type: SyncEventType, data?: unknown, source?: 'local' | 'remote', filePath?: string): SyncEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      data,
      source,
      filePath,
    };
  }

  private async loadLocalState(): Promise<void> {
    const beadsFile = this.getBeadsFilePath();

    if (!existsSync(beadsFile)) {
      return;
    }

    const issues = this.readBeadsFile();
    this.localStateCache.clear();

    for (const issue of issues) {
      this.localStateCache.set(issue.id, issue);
    }
  }

  private readBeadsFile(): BeadsIssue[] {
    const beadsFile = this.getBeadsFilePath();

    if (!existsSync(beadsFile)) {
      return [];
    }

    try {
      const content = readFileSync(beadsFile, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());

      return lines.map(line => JSON.parse(line) as BeadsIssue);
    } catch (error) {
      throw new BeadsError(
        'Failed to read beads file',
        BeadsErrorCodes.PARSE_ERROR,
        { error }
      );
    }
  }

  private writeBeadsFile(issues: BeadsIssue[]): void {
    const beadsFile = this.getBeadsFilePath();
    const dir = dirname(beadsFile);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const content = issues.map(issue => JSON.stringify(issue)).join('\n');
    writeFileSync(beadsFile, content + '\n', 'utf-8');
  }

  private startWatcher(): void {
    const beadsPath = this.getBeadsPath();

    try {
      this.watcher = watch(beadsPath, { recursive: true }, (eventType, filename) => {
        this.handleFileChange(eventType, filename);
      });

      this.watcher.on('error', (error) => {
        this.emit('watcher:error', this.createEvent('watcher:error', {
          error: error.message,
        }));
      });
    } catch (error) {
      throw new BeadsError(
        'Failed to start file watcher',
        BeadsErrorCodes.COMMAND_FAILED,
        { error }
      );
    }
  }

  private handleFileChange(eventType: WatchEventType, filename: string | null): void {
    if (!filename) {
      return;
    }

    // Ignore non-relevant files
    if (!filename.endsWith('.jsonl') && !filename.endsWith('.json')) {
      return;
    }

    // Add to pending changes with debouncing
    this.pendingChanges.add(filename);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processDebouncedChanges();
    }, this.config.debounceMs);
  }

  private async processDebouncedChanges(): Promise<void> {
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();

    for (const filename of changes) {
      await this.detectChanges(filename);
    }
  }

  private async detectChanges(filename: string): Promise<void> {
    // Re-read the file and compare with cache
    const beadsFile = this.getBeadsFilePath();

    if (!existsSync(beadsFile)) {
      return;
    }

    const currentIssues = this.readBeadsFile();
    const currentMap = new Map(currentIssues.map(i => [i.id, i]));

    // Detect new issues
    for (const [id, issue] of Array.from(currentMap.entries())) {
      const cached = this.localStateCache.get(id);

      if (!cached) {
        // New issue
        this.recordLocalChange({
          issueId: id,
          changeType: 'create',
          newState: issue,
        });
      } else if (this.hasChanged(cached, issue)) {
        // Updated issue
        this.recordLocalChange({
          issueId: id,
          changeType: 'update',
          previousState: cached,
          newState: issue,
        });
      }
    }

    // Detect deleted issues
    for (const [id, cached] of Array.from(this.localStateCache.entries())) {
      if (!currentMap.has(id)) {
        this.recordLocalChange({
          issueId: id,
          changeType: 'delete',
          previousState: cached,
        });
      }
    }

    // Update cache
    this.localStateCache = currentMap;
  }

  private hasChanged(old: BeadsIssue, current: BeadsIssue): boolean {
    // Compare relevant fields
    const fields: (keyof BeadsIssue)[] = [
      'title', 'description', 'status', 'priority', 'type',
      'assignee', 'labels', 'notes', 'close_reason',
    ];

    for (const field of fields) {
      const oldVal = old[field];
      const newVal = current[field];

      if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        if (JSON.stringify(oldVal.sort()) !== JSON.stringify(newVal.sort())) {
          return true;
        }
      } else if (oldVal !== newVal) {
        return true;
      }
    }

    return false;
  }

  private checkForConflicts(change: ChangeRecord): void {
    const opposing = change.source === 'local'
      ? this.state.pendingRemote
      : this.state.pendingLocal;

    const conflicting = opposing.find(c => c.issueId === change.issueId);

    if (conflicting) {
      const conflict: ConflictRecord = {
        issueId: change.issueId,
        local: change.source === 'local' ? change.newState || {} : conflicting.newState || {},
        remote: change.source === 'remote' ? change.newState || {} : conflicting.newState || {},
        detectedAt: new Date().toISOString(),
      };

      this.state.conflicts.push(conflict);
      this.emit('sync:conflict', this.createEvent('sync:conflict', conflict));

      // Auto-resolve if strategy is not manual
      if (this.config.conflictStrategy !== 'manual') {
        this.resolveConflict(change.issueId, this.config.conflictStrategy);
      }
    }
  }

  private applyResolutionStrategy(conflict: ConflictRecord, strategy: ConflictResolution): Partial<BeadsIssue> {
    switch (strategy) {
      case 'local-wins':
        return conflict.local;

      case 'remote-wins':
        return conflict.remote;

      case 'most-recent': {
        const localTime = new Date(conflict.local.updated_at || 0).getTime();
        const remoteTime = new Date(conflict.remote.updated_at || 0).getTime();
        return localTime > remoteTime ? conflict.local : conflict.remote;
      }

      case 'merge':
        return this.mergeIssues(conflict.local, conflict.remote);

      default:
        return conflict.local;
    }
  }

  private mergeIssues(local: Partial<BeadsIssue>, remote: Partial<BeadsIssue>): Partial<BeadsIssue> {
    // Merge non-conflicting fields, prefer remote for conflicts
    const merged: Partial<BeadsIssue> = { ...local };

    for (const key of Object.keys(remote) as (keyof BeadsIssue)[]) {
      const localVal = local[key];
      const remoteVal = remote[key];

      if (localVal === undefined) {
        // Remote has value, local doesn't
        (merged as Record<string, unknown>)[key] = remoteVal;
      } else if (remoteVal !== undefined && localVal !== remoteVal) {
        // Both have different values - use most recent timestamp
        const localTime = new Date(local.updated_at || 0).getTime();
        const remoteTime = new Date(remote.updated_at || 0).getTime();

        if (remoteTime > localTime) {
          (merged as Record<string, unknown>)[key] = remoteVal;
        }
      }
    }

    // Merge labels array
    if (local.labels && remote.labels) {
      merged.labels = Array.from(new Set([...local.labels, ...remote.labels]));
    }

    merged.updated_at = new Date().toISOString();
    return merged;
  }

  private async processPendingChanges(): Promise<void> {
    // Process remote changes first
    for (const change of this.state.pendingRemote) {
      await this.applyRemoteChange(change);
    }

    // Clear processed changes
    this.state.pendingLocal = this.state.pendingLocal.filter(
      c => this.state.conflicts.some(conflict => conflict.issueId === c.issueId)
    );
    this.state.pendingRemote = [];
  }

  private async resolveConflicts(): Promise<void> {
    const autoResolvable = this.state.conflicts.filter(
      c => !c.resolution && this.config.conflictStrategy !== 'manual'
    );

    for (const conflict of autoResolvable) {
      this.resolveConflict(conflict.issueId, this.config.conflictStrategy);
    }
  }

  private startSyncInterval(): void {
    this.syncIntervalTimer = setInterval(async () => {
      try {
        await this.sync();
      } catch (error) {
        // Error already emitted in sync()
      }
    }, this.config.syncInterval);
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a BeadsSyncManager instance with optional configuration
 */
export function createBeadsSyncManager(config?: Partial<SyncConfig>): BeadsSyncManager {
  return new BeadsSyncManager(config);
}

// ============================================
// Type Guards
// ============================================

/**
 * Check if a value is a valid SyncEvent
 */
export function isSyncEvent(value: unknown): value is SyncEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const event = value as SyncEvent;
  return typeof event.type === 'string' && typeof event.timestamp === 'string';
}

/**
 * Check if a value is a valid ChangeRecord
 */
export function isChangeRecord(value: unknown): value is ChangeRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as ChangeRecord;
  return (
    typeof record.issueId === 'string' &&
    typeof record.changeType === 'string' &&
    typeof record.timestamp === 'string' &&
    typeof record.source === 'string'
  );
}

/**
 * Check if a value is a valid ConflictRecord
 */
export function isConflictRecord(value: unknown): value is ConflictRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as ConflictRecord;
  return (
    typeof record.issueId === 'string' &&
    typeof record.detectedAt === 'string' &&
    typeof record.local === 'object' &&
    typeof record.remote === 'object'
  );
}
