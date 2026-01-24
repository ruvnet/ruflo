/**
 * Beads Sync Manager Tests
 *
 * TDD London School tests for BeadsSyncManager.
 * Tests focus on behavior verification through mocks, testing how the sync manager
 * interacts with the file system and emits events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module before importing
vi.mock('fs', () => ({
  watch: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Import after mocks are set up
import {
  BeadsSyncManager,
  createBeadsSyncManager,
  DEFAULT_SYNC_CONFIG,
  isSyncEvent,
  isChangeRecord,
  isConflictRecord,
  type SyncConfig,
  type SyncEvent,
  type ChangeRecord,
  type ConflictRecord,
  type SyncState,
} from '../../src/beads/sync.js';
import type { BeadsIssue } from '../../src/beads/types.js';

// Helper to create mock issues
const createMockIssue = (overrides: Partial<BeadsIssue> = {}): BeadsIssue => ({
  id: 'bd-test1',
  title: 'Test Issue',
  status: 'open',
  priority: 2,
  type: 'task',
  labels: [],
  dependencies: [],
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  ...overrides,
});

// Helper to create mock watcher
const createMockWatcher = (): { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } => ({
  on: vi.fn(),
  close: vi.fn(),
});

describe('BeadsSyncManager', () => {
  let syncManager: BeadsSyncManager;
  let mockWatcher: ReturnType<typeof createMockWatcher>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWatcher = createMockWatcher();
    (fs.watch as ReturnType<typeof vi.fn>).mockReturnValue(mockWatcher);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    syncManager = new BeadsSyncManager();
  });

  afterEach(async () => {
    await syncManager.stop();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const manager = new BeadsSyncManager();
      expect(manager).toBeInstanceOf(BeadsSyncManager);
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    it('should accept custom config', () => {
      const customConfig: Partial<SyncConfig> = {
        beadsDir: '.custom-beads',
        debounceMs: 200,
        conflictStrategy: 'local-wins',
        autoSync: false,
      };
      const manager = new BeadsSyncManager(customConfig);
      expect(manager).toBeInstanceOf(BeadsSyncManager);
    });

    it('should merge custom config with defaults', () => {
      const customConfig: Partial<SyncConfig> = {
        debounceMs: 500,
      };
      const manager = new BeadsSyncManager(customConfig);
      const state = manager.getState();
      expect(state.isWatching).toBe(false);
    });
  });

  describe('start()', () => {
    it('should start file watcher when .beads directory exists', async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      await syncManager.start();

      expect(fs.watch).toHaveBeenCalled();
      expect(syncManager.getState().isWatching).toBe(true);
    });

    it('should emit watcher:started event on successful start', async () => {
      const startedHandler = vi.fn();
      syncManager.on('watcher:started', startedHandler);

      await syncManager.start();

      expect(startedHandler).toHaveBeenCalledTimes(1);
      expect(startedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'watcher:started',
          timestamp: expect.any(String),
        })
      );
    });

    it('should throw error when .beads directory does not exist', async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const errorHandler = vi.fn();
      syncManager.on('watcher:error', errorHandler);

      await expect(syncManager.start()).rejects.toThrow('Beads directory not found');
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should not start twice if already watching', async () => {
      await syncManager.start();
      await syncManager.start();

      expect(fs.watch).toHaveBeenCalledTimes(1);
    });

    it('should load initial state from beads file', async () => {
      const mockIssue = createMockIssue();
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(mockIssue)
      );

      await syncManager.start();

      expect(fs.readFileSync).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should stop file watcher', async () => {
      await syncManager.start();
      await syncManager.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
      expect(syncManager.getState().isWatching).toBe(false);
    });

    it('should emit watcher:stopped event', async () => {
      const stoppedHandler = vi.fn();
      syncManager.on('watcher:stopped', stoppedHandler);

      await syncManager.start();
      await syncManager.stop();

      expect(stoppedHandler).toHaveBeenCalledTimes(1);
      expect(stoppedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'watcher:stopped',
        })
      );
    });

    it('should do nothing if not watching', async () => {
      const stoppedHandler = vi.fn();
      syncManager.on('watcher:stopped', stoppedHandler);

      await syncManager.stop();

      expect(stoppedHandler).not.toHaveBeenCalled();
    });
  });

  describe('sync()', () => {
    it('should emit sync:started event', async () => {
      const startedHandler = vi.fn();
      syncManager.on('sync:started', startedHandler);

      await syncManager.sync();

      expect(startedHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit sync:completed event on success', async () => {
      const completedHandler = vi.fn();
      syncManager.on('sync:completed', completedHandler);

      await syncManager.sync();

      expect(completedHandler).toHaveBeenCalledTimes(1);
      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync:completed',
        })
      );
    });

    it('should update lastSync timestamp', async () => {
      const before = syncManager.getState().lastSync;

      await syncManager.sync();

      const after = syncManager.getState().lastSync;
      expect(after).not.toBeNull();
      expect(after).not.toBe(before);
    });

    it('should not run concurrent syncs', async () => {
      const startedHandler = vi.fn();
      syncManager.on('sync:started', startedHandler);

      // Start two syncs simultaneously
      await Promise.all([
        syncManager.sync(),
        syncManager.sync(),
      ]);

      // Should only have started once
      expect(startedHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordLocalChange()', () => {
    it('should add change to pending local changes', () => {
      syncManager.recordLocalChange({
        issueId: 'bd-test1',
        changeType: 'create',
        newState: createMockIssue(),
      });

      const state = syncManager.getState();
      expect(state.pendingLocal).toHaveLength(1);
      expect(state.pendingLocal[0].issueId).toBe('bd-test1');
    });

    it('should emit change:local event', () => {
      const changeHandler = vi.fn();
      syncManager.on('change:local', changeHandler);

      syncManager.recordLocalChange({
        issueId: 'bd-test1',
        changeType: 'update',
        previousState: createMockIssue(),
        newState: createMockIssue({ title: 'Updated' }),
      });

      expect(changeHandler).toHaveBeenCalledTimes(1);
      expect(changeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'change:local',
          source: 'local',
        })
      );
    });

    it('should set source to local automatically', () => {
      syncManager.recordLocalChange({
        issueId: 'bd-test1',
        changeType: 'delete',
        previousState: createMockIssue(),
      });

      const state = syncManager.getState();
      expect(state.pendingLocal[0].source).toBe('local');
    });

    it('should set timestamp automatically', () => {
      const before = Date.now();

      syncManager.recordLocalChange({
        issueId: 'bd-test1',
        changeType: 'create',
        newState: createMockIssue(),
      });

      const state = syncManager.getState();
      const timestamp = new Date(state.pendingLocal[0].timestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('recordRemoteChange()', () => {
    it('should add change to pending remote changes', () => {
      syncManager.recordRemoteChange({
        issueId: 'bd-remote1',
        changeType: 'create',
        newState: createMockIssue({ id: 'bd-remote1' }),
      });

      const state = syncManager.getState();
      expect(state.pendingRemote).toHaveLength(1);
      expect(state.pendingRemote[0].issueId).toBe('bd-remote1');
    });

    it('should emit change:remote event', () => {
      const changeHandler = vi.fn();
      syncManager.on('change:remote', changeHandler);

      syncManager.recordRemoteChange({
        issueId: 'bd-remote1',
        changeType: 'update',
        newState: createMockIssue({ id: 'bd-remote1' }),
      });

      expect(changeHandler).toHaveBeenCalledTimes(1);
      expect(changeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'change:remote',
          source: 'remote',
        })
      );
    });

    it('should set source to remote automatically', () => {
      syncManager.recordRemoteChange({
        issueId: 'bd-remote1',
        changeType: 'create',
        newState: createMockIssue({ id: 'bd-remote1' }),
      });

      const state = syncManager.getState();
      expect(state.pendingRemote[0].source).toBe('remote');
    });
  });

  describe('conflict detection', () => {
    it('should detect conflict when same issue changes locally and remotely', () => {
      // Create manager with manual conflict strategy to prevent auto-resolution
      const manager = new BeadsSyncManager({ conflictStrategy: 'manual' });
      const conflictHandler = vi.fn();
      manager.on('sync:conflict', conflictHandler);

      // Record local change
      manager.recordLocalChange({
        issueId: 'bd-conflict1',
        changeType: 'update',
        newState: createMockIssue({ id: 'bd-conflict1', title: 'Local Title' }),
      });

      // Record remote change for same issue
      manager.recordRemoteChange({
        issueId: 'bd-conflict1',
        changeType: 'update',
        newState: createMockIssue({ id: 'bd-conflict1', title: 'Remote Title' }),
      });

      expect(conflictHandler).toHaveBeenCalledTimes(1);
      expect(manager.getConflicts()).toHaveLength(1);
    });

    it('should not detect conflict for different issues', () => {
      const conflictHandler = vi.fn();
      syncManager.on('sync:conflict', conflictHandler);

      syncManager.recordLocalChange({
        issueId: 'bd-local1',
        changeType: 'update',
        newState: createMockIssue({ id: 'bd-local1' }),
      });

      syncManager.recordRemoteChange({
        issueId: 'bd-remote1',
        changeType: 'update',
        newState: createMockIssue({ id: 'bd-remote1' }),
      });

      expect(conflictHandler).not.toHaveBeenCalled();
      expect(syncManager.getConflicts()).toHaveLength(0);
    });
  });

  describe('conflict resolution', () => {
    let conflictManager: BeadsSyncManager;

    beforeEach(() => {
      // Create manager with manual conflict strategy for controlled testing
      conflictManager = new BeadsSyncManager({ conflictStrategy: 'manual' });

      // Create a conflict scenario
      conflictManager.recordLocalChange({
        issueId: 'bd-conflict1',
        changeType: 'update',
        newState: createMockIssue({
          id: 'bd-conflict1',
          title: 'Local Title',
          updated_at: '2024-01-15T10:00:00Z',
        }),
      });

      conflictManager.recordRemoteChange({
        issueId: 'bd-conflict1',
        changeType: 'update',
        newState: createMockIssue({
          id: 'bd-conflict1',
          title: 'Remote Title',
          updated_at: '2024-01-15T11:00:00Z',
        }),
      });
    });

    it('should resolve conflict with local-wins strategy', () => {
      const conflicts = conflictManager.getConflicts();
      expect(conflicts).toHaveLength(1);

      conflictManager.resolveConflict('bd-conflict1', 'local-wins');

      expect(conflictManager.getConflicts()).toHaveLength(0);
    });

    it('should resolve conflict with remote-wins strategy', () => {
      conflictManager.resolveConflict('bd-conflict1', 'remote-wins');

      expect(conflictManager.getConflicts()).toHaveLength(0);
    });

    it('should resolve conflict with most-recent strategy', () => {
      conflictManager.resolveConflict('bd-conflict1', 'most-recent');

      // Remote has later timestamp, so it should win
      expect(conflictManager.getConflicts()).toHaveLength(0);
    });

    it('should resolve conflict with merge strategy', () => {
      // Create conflict with different fields changed
      const manager = new BeadsSyncManager({ conflictStrategy: 'manual' });

      manager.recordLocalChange({
        issueId: 'bd-merge1',
        changeType: 'update',
        newState: createMockIssue({
          id: 'bd-merge1',
          title: 'Local Title',
          labels: ['local-label'],
          updated_at: '2024-01-15T10:00:00Z',
        }),
      });

      manager.recordRemoteChange({
        issueId: 'bd-merge1',
        changeType: 'update',
        newState: createMockIssue({
          id: 'bd-merge1',
          title: 'Remote Title',
          labels: ['remote-label'],
          updated_at: '2024-01-15T11:00:00Z',
        }),
      });

      manager.resolveConflict('bd-merge1', 'merge');

      expect(manager.getConflicts()).toHaveLength(0);
    });

    it('should allow manual resolution with custom state', () => {
      const customResolution = createMockIssue({
        id: 'bd-conflict1',
        title: 'Manually Resolved Title',
      });

      conflictManager.resolveConflict('bd-conflict1', 'manual', customResolution);

      expect(conflictManager.getConflicts()).toHaveLength(0);
    });

    it('should do nothing when resolving non-existent conflict', () => {
      conflictManager.resolveConflict('bd-nonexistent', 'local-wins');

      // Should still have the original conflict
      expect(conflictManager.getConflicts()).toHaveLength(1);
    });
  });

  describe('applyRemoteChange()', () => {
    const mockIssue = createMockIssue({ id: 'bd-existing' });

    beforeEach(() => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(mockIssue)
      );
    });

    it('should handle create changes', async () => {
      const newIssue = createMockIssue({ id: 'bd-new' });

      await syncManager.applyRemoteChange({
        issueId: 'bd-new',
        changeType: 'create',
        timestamp: new Date().toISOString(),
        source: 'remote',
        newState: newIssue,
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle update changes', async () => {
      await syncManager.applyRemoteChange({
        issueId: 'bd-existing',
        changeType: 'update',
        timestamp: new Date().toISOString(),
        source: 'remote',
        newState: { ...mockIssue, title: 'Updated Title' },
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should handle delete changes', async () => {
      await syncManager.applyRemoteChange({
        issueId: 'bd-existing',
        changeType: 'delete',
        timestamp: new Date().toISOString(),
        source: 'remote',
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should emit change:merged event', async () => {
      const mergedHandler = vi.fn();
      syncManager.on('change:merged', mergedHandler);

      await syncManager.applyRemoteChange({
        issueId: 'bd-existing',
        changeType: 'update',
        timestamp: new Date().toISOString(),
        source: 'remote',
        newState: mockIssue,
      });

      expect(mergedHandler).toHaveBeenCalledTimes(1);
    });

    it('should throw error when beads file not found', async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await expect(
        syncManager.applyRemoteChange({
          issueId: 'bd-test',
          changeType: 'create',
          timestamp: new Date().toISOString(),
          source: 'remote',
          newState: mockIssue,
        })
      ).rejects.toThrow('Beads file not found');
    });
  });

  describe('getState()', () => {
    it('should return current sync state', () => {
      const state = syncManager.getState();

      expect(state).toHaveProperty('lastSync');
      expect(state).toHaveProperty('pendingLocal');
      expect(state).toHaveProperty('pendingRemote');
      expect(state).toHaveProperty('conflicts');
      expect(state).toHaveProperty('isSyncing');
      expect(state).toHaveProperty('isWatching');
    });

    it('should return copy of state (not reference)', () => {
      const state1 = syncManager.getState();
      const state2 = syncManager.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('getConflicts()', () => {
    it('should return empty array when no conflicts', () => {
      expect(syncManager.getConflicts()).toEqual([]);
    });

    it('should return copy of conflicts array', () => {
      syncManager.recordLocalChange({
        issueId: 'bd-test',
        changeType: 'update',
        newState: createMockIssue(),
      });

      syncManager.recordRemoteChange({
        issueId: 'bd-test',
        changeType: 'update',
        newState: createMockIssue(),
      });

      const conflicts1 = syncManager.getConflicts();
      const conflicts2 = syncManager.getConflicts();

      expect(conflicts1).not.toBe(conflicts2);
      expect(conflicts1).toEqual(conflicts2);
    });
  });

  describe('setConflictStrategy()', () => {
    it('should update conflict strategy', () => {
      const manager = new BeadsSyncManager({ conflictStrategy: 'local-wins' });

      manager.setConflictStrategy('remote-wins');

      // Create conflict to verify strategy is used
      manager.recordLocalChange({
        issueId: 'bd-test',
        changeType: 'update',
        newState: createMockIssue(),
      });

      manager.recordRemoteChange({
        issueId: 'bd-test',
        changeType: 'update',
        newState: createMockIssue(),
      });

      // With non-manual strategy, should auto-resolve
      expect(manager.getConflicts()).toHaveLength(0);
    });
  });
});

describe('createBeadsSyncManager factory', () => {
  it('should create instance with default config', () => {
    const manager = createBeadsSyncManager();
    expect(manager).toBeInstanceOf(BeadsSyncManager);
  });

  it('should create instance with custom config', () => {
    const manager = createBeadsSyncManager({
      beadsDir: '.custom',
      debounceMs: 500,
    });
    expect(manager).toBeInstanceOf(BeadsSyncManager);
  });
});

describe('DEFAULT_SYNC_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_SYNC_CONFIG.beadsDir).toBe('.beads');
    expect(DEFAULT_SYNC_CONFIG.debounceMs).toBe(100);
    expect(DEFAULT_SYNC_CONFIG.conflictStrategy).toBe('most-recent');
    expect(DEFAULT_SYNC_CONFIG.autoSync).toBe(true);
    expect(DEFAULT_SYNC_CONFIG.syncInterval).toBe(5000);
    expect(DEFAULT_SYNC_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_SYNC_CONFIG.verbose).toBe(false);
  });
});

describe('Type guards', () => {
  describe('isSyncEvent()', () => {
    it('should return true for valid SyncEvent', () => {
      const event: SyncEvent = {
        type: 'sync:started',
        timestamp: new Date().toISOString(),
      };
      expect(isSyncEvent(event)).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isSyncEvent(null)).toBe(false);
      expect(isSyncEvent(undefined)).toBe(false);
      expect(isSyncEvent({})).toBe(false);
      expect(isSyncEvent({ type: 'test' })).toBe(false);
      expect(isSyncEvent({ timestamp: '2024' })).toBe(false);
    });
  });

  describe('isChangeRecord()', () => {
    it('should return true for valid ChangeRecord', () => {
      const record: ChangeRecord = {
        issueId: 'bd-test',
        changeType: 'create',
        timestamp: new Date().toISOString(),
        source: 'local',
      };
      expect(isChangeRecord(record)).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isChangeRecord(null)).toBe(false);
      expect(isChangeRecord(undefined)).toBe(false);
      expect(isChangeRecord({})).toBe(false);
      expect(isChangeRecord({ issueId: 'test' })).toBe(false);
    });
  });

  describe('isConflictRecord()', () => {
    it('should return true for valid ConflictRecord', () => {
      const record: ConflictRecord = {
        issueId: 'bd-test',
        local: {},
        remote: {},
        detectedAt: new Date().toISOString(),
      };
      expect(isConflictRecord(record)).toBe(true);
    });

    it('should return false for invalid values', () => {
      expect(isConflictRecord(null)).toBe(false);
      expect(isConflictRecord(undefined)).toBe(false);
      expect(isConflictRecord({})).toBe(false);
      expect(isConflictRecord({ issueId: 'test' })).toBe(false);
    });
  });
});

describe('File watcher behavior', () => {
  let syncManager: BeadsSyncManager;
  let mockWatcher: ReturnType<typeof createMockWatcher>;
  let watchCallback: ((eventType: string, filename: string | null) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWatcher = createMockWatcher();

    (fs.watch as ReturnType<typeof vi.fn>).mockImplementation((path, options, callback) => {
      watchCallback = callback;
      return mockWatcher;
    });
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    syncManager = new BeadsSyncManager({ debounceMs: 10 });
  });

  afterEach(async () => {
    await syncManager.stop();
    vi.restoreAllMocks();
  });

  it('should ignore non-json/jsonl file changes', async () => {
    await syncManager.start();

    const changeHandler = vi.fn();
    syncManager.on('change:local', changeHandler);

    // Simulate file change for non-relevant file
    if (watchCallback) {
      watchCallback('change', 'readme.md');
    }

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(changeHandler).not.toHaveBeenCalled();
  });

  it('should process jsonl file changes', async () => {
    // Start with empty state
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    await syncManager.start();

    // Now set up the file to have a new issue
    const mockIssue = createMockIssue({ id: 'bd-new' });
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify(mockIssue)
    );

    const changeHandler = vi.fn();
    syncManager.on('change:local', changeHandler);

    // Simulate file change
    if (watchCallback) {
      watchCallback('change', 'beads.jsonl');
    }

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(changeHandler).toHaveBeenCalled();
  });

  it('should handle null filename', async () => {
    await syncManager.start();

    // Should not throw
    if (watchCallback) {
      watchCallback('change', null);
    }
  });

  it('should debounce rapid changes', async () => {
    await syncManager.start();

    // Clear previous calls from start()
    vi.mocked(fs.readFileSync).mockClear();

    const changeHandler = vi.fn();
    syncManager.on('change:local', changeHandler);

    // Simulate rapid file changes
    if (watchCallback) {
      watchCallback('change', 'beads.jsonl');
      watchCallback('change', 'beads.jsonl');
      watchCallback('change', 'beads.jsonl');
    }

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should only process once due to debouncing
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it('should handle watcher errors', async () => {
    await syncManager.start();

    const errorHandler = vi.fn();
    syncManager.on('watcher:error', errorHandler);

    // Get the error handler that was registered
    const errorCallback = mockWatcher.on.mock.calls.find(
      call => call[0] === 'error'
    )?.[1];

    if (errorCallback) {
      errorCallback(new Error('Watch failed'));
    }

    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'watcher:error',
      })
    );
  });
});

describe('Auto-sync behavior', () => {
  it('should trigger sync at configured interval when autoSync is enabled', async () => {
    vi.useFakeTimers();

    const mockWatcher = createMockWatcher();
    (fs.watch as ReturnType<typeof vi.fn>).mockReturnValue(mockWatcher);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    const manager = new BeadsSyncManager({
      autoSync: true,
      syncInterval: 1000,
    });

    const completedHandler = vi.fn();
    manager.on('sync:completed', completedHandler);

    await manager.start();

    // Advance time past sync interval and run pending timers
    await vi.advanceTimersByTimeAsync(1100);

    expect(completedHandler).toHaveBeenCalled();

    await manager.stop();
    vi.useRealTimers();
  });

  it('should not auto-sync when disabled', async () => {
    vi.useFakeTimers();

    const mockWatcher = createMockWatcher();
    (fs.watch as ReturnType<typeof vi.fn>).mockReturnValue(mockWatcher);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    const manager = new BeadsSyncManager({
      autoSync: false,
      syncInterval: 1000,
    });

    const completedHandler = vi.fn();
    manager.on('sync:completed', completedHandler);

    await manager.start();

    // Advance time past sync interval
    await vi.advanceTimersByTimeAsync(2000);

    expect(completedHandler).not.toHaveBeenCalled();

    await manager.stop();
    vi.useRealTimers();
  });
});
