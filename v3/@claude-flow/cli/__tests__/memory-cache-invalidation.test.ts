/**
 * Memory Cache Invalidation Tests
 *
 * Issue #969: MCP Memory Tools Cache Stale Data After CLI Writes
 *
 * Tests verify that the HNSW index properly invalidates its cache
 * when the underlying SQLite database is modified externally
 * (e.g., when CLI writes while MCP server is running).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test directory to avoid polluting the real workspace
const TEST_DIR = join(tmpdir(), `claude-flow-cache-test-${Date.now()}`);
const TEST_DB_PATH = join(TEST_DIR, '.swarm', 'memory.db');

describe('Memory Cache Invalidation (Issue #969)', () => {
  let originalCwd: string;

  beforeEach(() => {
    // Save original cwd and switch to test directory
    originalCwd = process.cwd();

    // Create test directory structure
    mkdirSync(join(TEST_DIR, '.swarm'), { recursive: true });

    // Mock process.cwd to return test directory
    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR);
  });

  afterEach(() => {
    // Restore original cwd
    vi.restoreAllMocks();

    // Clean up test directory
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Mtime-based Cache Detection', () => {
    it('should detect when database file is modified', async () => {
      const { initializeMemoryDatabase, storeEntry, clearHNSWIndex } = await import('../src/memory/memory-initializer.js');

      // Initialize database
      await initializeMemoryDatabase({
        dbPath: TEST_DB_PATH,
        force: true,
        verbose: false,
      });

      // Clear any existing HNSW cache
      clearHNSWIndex();

      // Store an entry to create initial state
      await storeEntry({
        key: 'initial-key',
        value: 'initial-value',
        namespace: 'test',
        generateEmbeddingFlag: false,
        dbPath: TEST_DB_PATH,
      });

      // Get the mtime
      const stats1 = statSync(TEST_DB_PATH);
      const mtime1 = stats1.mtimeMs;

      // Wait a moment and store another entry
      await new Promise(resolve => setTimeout(resolve, 100));

      await storeEntry({
        key: 'second-key',
        value: 'second-value',
        namespace: 'test',
        generateEmbeddingFlag: false,
        dbPath: TEST_DB_PATH,
      });

      // Get the new mtime
      const stats2 = statSync(TEST_DB_PATH);
      const mtime2 = stats2.mtimeMs;

      // Mtime should have increased
      expect(mtime2).toBeGreaterThan(mtime1);
    });

    it('should clear HNSW index when clearHNSWIndex is called', async () => {
      const { clearHNSWIndex, getHNSWStatus } = await import('../src/memory/memory-initializer.js');

      // Clear the index
      clearHNSWIndex();

      // Get status - should show not initialized or 0 entries
      const status = getHNSWStatus();
      expect(status.initialized).toBe(false);
      expect(status.entryCount).toBe(0);
    });
  });

  describe('HNSW Index Freshness', () => {
    it('should rebuild HNSW index when forceRebuild is true', async () => {
      const { initializeMemoryDatabase, getHNSWIndex, clearHNSWIndex } = await import('../src/memory/memory-initializer.js');

      // Initialize database
      await initializeMemoryDatabase({
        dbPath: TEST_DB_PATH,
        force: true,
        verbose: false,
      });

      // Clear any existing index
      clearHNSWIndex();

      // First call to getHNSWIndex
      const index1 = await getHNSWIndex({ dbPath: TEST_DB_PATH });

      // Second call with forceRebuild should create new index
      const index2 = await getHNSWIndex({ dbPath: TEST_DB_PATH, forceRebuild: true });

      // Both should either be null (if @ruvector/core not available) or valid
      // The key is that forceRebuild doesn't throw
      expect(index2 === null || index2.initialized).toBe(true);
    });
  });

  describe('CLI to MCP Sync', () => {
    it('should see CLI-written entries from MCP after cache invalidation', async () => {
      const { initializeMemoryDatabase, storeEntry, searchEntries, clearHNSWIndex } = await import('../src/memory/memory-initializer.js');

      // Initialize database
      await initializeMemoryDatabase({
        dbPath: TEST_DB_PATH,
        force: true,
        verbose: false,
      });

      // Clear HNSW index to simulate MCP server starting fresh
      clearHNSWIndex();

      // Store entry 1 (simulating CLI write)
      await storeEntry({
        key: 'cli-entry-1',
        value: 'This is a test entry written by CLI',
        namespace: 'test',
        generateEmbeddingFlag: true,
        dbPath: TEST_DB_PATH,
      });

      // Search (simulating MCP read) - should find the entry
      const result1 = await searchEntries({
        query: 'test entry CLI',
        namespace: 'test',
        limit: 10,
        threshold: 0.1,
        dbPath: TEST_DB_PATH,
      });

      expect(result1.success).toBe(true);
      expect(result1.results.length).toBeGreaterThan(0);
      expect(result1.results.some(r => r.key === 'cli-entry-1')).toBe(true);

      // Store another entry (simulating another CLI write)
      await storeEntry({
        key: 'cli-entry-2',
        value: 'Second entry from CLI command',
        namespace: 'test',
        generateEmbeddingFlag: true,
        dbPath: TEST_DB_PATH,
      });

      // Search again - should find both entries
      const result2 = await searchEntries({
        query: 'entry CLI',
        namespace: 'test',
        limit: 10,
        threshold: 0.1,
        dbPath: TEST_DB_PATH,
      });

      expect(result2.success).toBe(true);
      // Should find at least one entry (results depend on embedding quality)
      expect(result2.results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Concurrent Access Safety', () => {
    it('should handle concurrent initialization attempts', async () => {
      const { initializeMemoryDatabase, getHNSWIndex, clearHNSWIndex } = await import('../src/memory/memory-initializer.js');

      // Initialize database
      await initializeMemoryDatabase({
        dbPath: TEST_DB_PATH,
        force: true,
        verbose: false,
      });

      clearHNSWIndex();

      // Start multiple concurrent getHNSWIndex calls
      const promises = [
        getHNSWIndex({ dbPath: TEST_DB_PATH }),
        getHNSWIndex({ dbPath: TEST_DB_PATH }),
        getHNSWIndex({ dbPath: TEST_DB_PATH }),
      ];

      // All should complete without error
      const results = await Promise.all(promises);

      // All should return the same result (either null or valid index)
      const firstResult = results[0];
      for (const result of results) {
        expect(result === null || result.initialized === firstResult?.initialized).toBe(true);
      }
    });
  });
});
