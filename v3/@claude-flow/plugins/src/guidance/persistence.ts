/**
 * Ledger Persistence Layer
 *
 * Connects the in-memory RunLedger to durable file-based storage using
 * newline-delimited JSON (NDJSON). Provides append-only event logging,
 * compaction, and lock-based concurrent access prevention.
 *
 * Storage layout:
 *   {storagePath}/events.ndjson  - Newline-delimited JSON events
 *   {storagePath}/index.json     - Metadata index (counts, timestamps, task IDs)
 *   {storagePath}/.lock          - Lock file for concurrent access prevention
 *
 * @module @claude-flow/guidance/persistence
 */

import { mkdir, readFile, writeFile, appendFile, stat, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunLedger } from './ledger.js';
import type { RunEvent } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the persistent ledger
 */
export interface PersistenceConfig {
  /** Directory path for storage files (default: '.claude-flow/guidance') */
  storagePath: string;
  /** Maximum events to keep; oldest evicted on compact (default: 10000) */
  maxEvents: number;
  /** How often to compact/vacuum in milliseconds (default: 1 hour) */
  compactIntervalMs: number;
  /** Enable write-ahead logging style (flush after each write) (default: true) */
  enableWAL: boolean;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  /** Total number of stored events */
  eventCount: number;
  /** Storage size in bytes */
  storageSizeBytes: number;
  /** Timestamp of the oldest event (null if empty) */
  oldestEvent: number | null;
  /** Timestamp of the newest event (null if empty) */
  newestEvent: number | null;
}

/**
 * Index file structure for quick metadata lookups
 */
interface StorageIndex {
  /** Number of events in the NDJSON file */
  eventCount: number;
  /** Oldest event timestamp */
  oldestTimestamp: number | null;
  /** Newest event timestamp */
  newestTimestamp: number | null;
  /** Set of unique task IDs */
  taskIds: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  storagePath: '.claude-flow/guidance',
  maxEvents: 10_000,
  compactIntervalMs: 60 * 60 * 1000, // 1 hour
  enableWAL: true,
};

// Lock file stale threshold: 30 seconds
const LOCK_STALE_MS = 30_000;

// ============================================================================
// EventStore (Internal)
// ============================================================================

/**
 * Low-level NDJSON-based event storage.
 *
 * Handles file I/O, append-only writes, range reads, compaction,
 * and lock-based concurrent access prevention.
 */
export class EventStore {
  private readonly eventsPath: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly baseDir: string;
  private lockHolder: string | null = null;

  constructor(storagePath: string) {
    this.baseDir = storagePath;
    this.eventsPath = join(storagePath, 'events.ndjson');
    this.indexPath = join(storagePath, 'index.json');
    this.lockPath = join(storagePath, '.lock');
  }

  /**
   * Append a single event to the NDJSON file and update the index.
   */
  async append(event: RunEvent): Promise<void> {
    await this.ensureDirectory();
    const line = JSON.stringify(event) + '\n';
    await appendFile(this.eventsPath, line, 'utf-8');
    await this.updateIndex(event);
  }

  /**
   * Read and parse all events from storage.
   */
  async readAll(): Promise<RunEvent[]> {
    if (!existsSync(this.eventsPath)) {
      return [];
    }

    const content = await readFile(this.eventsPath, 'utf-8');
    return this.parseNdjson(content);
  }

  /**
   * Read events within a time range [startTime, endTime].
   */
  async readRange(startTime: number, endTime: number): Promise<RunEvent[]> {
    const all = await this.readAll();
    return all.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);
  }

  /**
   * Compact the event store to keep at most `maxEvents` events.
   * Oldest events are evicted first. Rewrites the NDJSON file atomically.
   *
   * @returns The number of evicted events.
   */
  async compact(maxEvents: number): Promise<number> {
    const events = await this.readAll();

    if (events.length <= maxEvents) {
      return 0;
    }

    // Sort by timestamp ascending, keep the newest maxEvents
    events.sort((a, b) => a.timestamp - b.timestamp);
    const evicted = events.length - maxEvents;
    const kept = events.slice(evicted);

    // Atomic rewrite: write to temp file, then rename
    await this.ensureDirectory();
    const tempPath = join(this.baseDir, `events.tmp.${randomUUID()}.ndjson`);
    const content = kept.map(e => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : '');
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, this.eventsPath);

    // Rebuild index from kept events
    await this.rebuildIndex(kept);

    return evicted;
  }

  /**
   * Atomically replace all events in storage with the given array.
   * Rewrites the NDJSON file and rebuilds the index.
   */
  async writeAll(events: RunEvent[]): Promise<void> {
    await this.ensureDirectory();
    const tempPath = join(this.baseDir, `events.tmp.${randomUUID()}.ndjson`);
    const content = events.map(e => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, this.eventsPath);
    await this.rebuildIndex(events);
  }

  /**
   * Get storage statistics.
   */
  async getStats(): Promise<StorageStats> {
    const index = await this.readIndex();
    let storageSizeBytes = 0;

    if (existsSync(this.eventsPath)) {
      const fileStat = await stat(this.eventsPath);
      storageSizeBytes = fileStat.size;
    }

    if (existsSync(this.indexPath)) {
      const indexStat = await stat(this.indexPath);
      storageSizeBytes += indexStat.size;
    }

    return {
      eventCount: index.eventCount,
      storageSizeBytes,
      oldestEvent: index.oldestTimestamp,
      newestEvent: index.newestTimestamp,
    };
  }

  /**
   * Acquire a file-based lock for concurrent access prevention.
   * Throws if the lock is already held by another process.
   */
  async acquireLock(): Promise<void> {
    await this.ensureDirectory();

    // Check for stale locks
    if (existsSync(this.lockPath)) {
      try {
        const lockContent = await readFile(this.lockPath, 'utf-8');
        const lockData = JSON.parse(lockContent);
        const age = Date.now() - lockData.timestamp;

        if (age < LOCK_STALE_MS) {
          throw new Error(
            `Storage is locked by another process (holder: ${lockData.holder}, age: ${age}ms). ` +
            `Lock file: ${this.lockPath}`
          );
        }
        // Stale lock, remove it
        await unlink(this.lockPath);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Storage is locked')) {
          throw err;
        }
        // Corrupted lock file, remove it
        try { await unlink(this.lockPath); } catch { /* ignore */ }
      }
    }

    const holder = randomUUID();
    const lockData = { holder, timestamp: Date.now(), pid: process.pid };
    await writeFile(this.lockPath, JSON.stringify(lockData), 'utf-8');
    this.lockHolder = holder;
  }

  /**
   * Release the file-based lock.
   */
  async releaseLock(): Promise<void> {
    if (existsSync(this.lockPath)) {
      try {
        const lockContent = await readFile(this.lockPath, 'utf-8');
        const lockData = JSON.parse(lockContent);

        // Only release if we own the lock
        if (this.lockHolder && lockData.holder === this.lockHolder) {
          await unlink(this.lockPath);
        }
      } catch {
        // Best-effort removal
        try { await unlink(this.lockPath); } catch { /* ignore */ }
      }
    }
    this.lockHolder = null;
  }

  /**
   * Remove all storage files (events, index, lock).
   */
  async destroy(): Promise<void> {
    for (const filePath of [this.eventsPath, this.indexPath, this.lockPath]) {
      if (existsSync(filePath)) {
        try { await unlink(filePath); } catch { /* ignore */ }
      }
    }
  }

  // ===== Private helpers =====

  /**
   * Ensure the storage directory exists.
   */
  private async ensureDirectory(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  /**
   * Parse an NDJSON string into RunEvent array, skipping blank/invalid lines.
   */
  private parseNdjson(content: string): RunEvent[] {
    const events: RunEvent[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        events.push(JSON.parse(trimmed) as RunEvent);
      } catch {
        // Skip malformed lines
      }
    }

    return events;
  }

  /**
   * Read the index file, returning a default if it does not exist.
   */
  private async readIndex(): Promise<StorageIndex> {
    if (!existsSync(this.indexPath)) {
      return { eventCount: 0, oldestTimestamp: null, newestTimestamp: null, taskIds: [] };
    }

    try {
      const content = await readFile(this.indexPath, 'utf-8');
      return JSON.parse(content) as StorageIndex;
    } catch {
      return { eventCount: 0, oldestTimestamp: null, newestTimestamp: null, taskIds: [] };
    }
  }

  /**
   * Update the index with a new event.
   */
  private async updateIndex(event: RunEvent): Promise<void> {
    const index = await this.readIndex();

    index.eventCount++;
    if (index.oldestTimestamp === null || event.timestamp < index.oldestTimestamp) {
      index.oldestTimestamp = event.timestamp;
    }
    if (index.newestTimestamp === null || event.timestamp > index.newestTimestamp) {
      index.newestTimestamp = event.timestamp;
    }
    if (!index.taskIds.includes(event.taskId)) {
      index.taskIds.push(event.taskId);
    }

    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * Rebuild the index from a given set of events.
   */
  private async rebuildIndex(events: RunEvent[]): Promise<void> {
    const taskIdSet = new Set<string>();
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const event of events) {
      taskIdSet.add(event.taskId);
      if (oldest === null || event.timestamp < oldest) {
        oldest = event.timestamp;
      }
      if (newest === null || event.timestamp > newest) {
        newest = event.timestamp;
      }
    }

    const index: StorageIndex = {
      eventCount: events.length,
      oldestTimestamp: oldest,
      newestTimestamp: newest,
      taskIds: Array.from(taskIdSet),
    };

    await this.ensureDirectory();
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }
}

// ============================================================================
// PersistentLedger
// ============================================================================

/**
 * A RunLedger subclass that persists events to NDJSON file storage.
 *
 * Extends the in-memory RunLedger with:
 * - Automatic persistence on logEvent()
 * - Load from storage on init via importEvents()
 * - Explicit save()/load() for bulk operations
 * - Compaction to enforce maxEvents limit
 * - Storage statistics
 * - Automatic periodic compaction via interval timer
 */
export class PersistentLedger extends RunLedger {
  private readonly config: PersistenceConfig;
  private readonly store: EventStore;
  private compactTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(config?: Partial<PersistenceConfig>) {
    super();
    this.config = { ...DEFAULT_PERSISTENCE_CONFIG, ...config };
    this.store = new EventStore(this.config.storagePath);
  }

  /**
   * Initialize the persistent ledger: load existing events from storage
   * and start the compaction timer.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.load();
    this.startCompactTimer();
    this.initialized = true;
  }

  /**
   * Override logEvent to also persist the event to storage.
   */
  override logEvent(event: RunEvent | Omit<RunEvent, 'eventId'>): RunEvent {
    const logged = super.logEvent(event);

    // Fire-and-forget persist. If enableWAL is true, we await in a microtask
    // to minimize the chance of data loss without blocking the caller.
    if (this.config.enableWAL) {
      // Use a void promise to avoid unhandled rejection
      void this.store.append(logged).catch(() => {
        // Silently swallow persistence errors to not break the caller.
        // In production you would log this.
      });
    }

    return logged;
  }

  /**
   * Override importEvents to also persist imported events to storage.
   */
  override importEvents(events: RunEvent[]): void {
    super.importEvents(events);

    // Persist each imported event
    void (async () => {
      for (const event of events) {
        try {
          await this.store.append(event);
        } catch {
          // Silently continue
        }
      }
    })();
  }

  /**
   * Flush all in-memory events to storage, replacing the storage contents.
   * This performs a full atomic rewrite of the NDJSON file.
   */
  async save(): Promise<void> {
    const events = this.exportEvents();

    await this.store.acquireLock();
    try {
      await this.store.writeAll(events);
    } finally {
      await this.store.releaseLock();
    }
  }

  /**
   * Restore events from storage into memory.
   * Clears the in-memory ledger first, then loads all stored events.
   */
  async load(): Promise<void> {
    const events = await this.store.readAll();
    this.clear();
    if (events.length > 0) {
      super.importEvents(events);
    }
  }

  /**
   * Compact the storage to keep at most maxEvents events.
   * Also updates the in-memory ledger to match.
   *
   * @returns The number of evicted events.
   */
  async compact(): Promise<number> {
    await this.store.acquireLock();
    try {
      const evicted = await this.store.compact(this.config.maxEvents);

      if (evicted > 0) {
        // Reload in-memory state from the compacted storage
        const events = await this.store.readAll();
        this.clear();
        if (events.length > 0) {
          super.importEvents(events);
        }
      }

      return evicted;
    } finally {
      await this.store.releaseLock();
    }
  }

  /**
   * Get storage statistics.
   */
  async getStorageStats(): Promise<StorageStats> {
    return this.store.getStats();
  }

  /**
   * Clean up resources (stop compaction timer, release locks, etc.).
   */
  async destroy(): Promise<void> {
    this.stopCompactTimer();
    await this.store.releaseLock();
  }

  /**
   * Get the underlying EventStore (for advanced use / testing).
   */
  getEventStore(): EventStore {
    return this.store;
  }

  // ===== Private =====

  private startCompactTimer(): void {
    if (this.config.compactIntervalMs > 0) {
      this.compactTimer = setInterval(() => {
        void this.compact().catch(() => { /* ignore timer errors */ });
      }, this.config.compactIntervalMs);

      // Unref the timer so it doesn't keep the process alive
      if (this.compactTimer && typeof this.compactTimer === 'object' && 'unref' in this.compactTimer) {
        this.compactTimer.unref();
      }
    }
  }

  private stopCompactTimer(): void {
    if (this.compactTimer !== null) {
      clearInterval(this.compactTimer);
      this.compactTimer = null;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a PersistentLedger instance. Call `init()` after creation to load
 * existing events from storage.
 */
export function createPersistentLedger(config?: Partial<PersistenceConfig>): PersistentLedger {
  return new PersistentLedger(config);
}

/**
 * Create an EventStore instance for direct low-level storage access.
 */
export function createEventStore(path: string): EventStore {
  return new EventStore(path);
}
