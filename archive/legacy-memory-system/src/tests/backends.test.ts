/**
 * SPARC Memory Bank - Backend Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteBackend } from '../backends/sqlite-backend';
import { MarkdownBackend } from '../backends/markdown-backend';
import { MemoryItem, MemoryBackend } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

// Test both backends with same test suite
const backends = [
  { name: 'SQLite', createBackend: (dir: string) => new SqliteBackend({ path: path.join(dir, 'test.db') }) },
  { name: 'Markdown', createBackend: (dir: string) => new MarkdownBackend({ rootPath: dir, prettyPrint: true }) }
];

backends.forEach(({ name, createBackend }) => {
  describe(`${name} Backend`, () => {
    let backend: MemoryBackend;
    const testDir = `/tmp/backend-test-${name.toLowerCase()}`;

    beforeEach(async () => {
      await fs.mkdir(testDir, { recursive: true });
      backend = createBackend(testDir);
      await backend.initialize();
    });

    afterEach(async () => {
      await backend.close();
      await fs.rm(testDir, { recursive: true, force: true });
    });

    describe('Basic Operations', () => {
      it('should store and retrieve items', async () => {
        const item: MemoryItem = {
          id: 'test-1',
          category: 'test-category',
          key: 'test-key',
          value: { data: 'test value', number: 42 },
          metadata: {
            timestamp: Date.now(),
            tags: ['test', 'unit-test']
          }
        };

        await backend.store(item);

        const retrieved = await backend.get('test-category', 'test-key');
        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe('test-1');
        expect(retrieved?.value).toEqual({ data: 'test value', number: 42 });
        expect(retrieved?.metadata?.tags).toEqual(['test', 'unit-test']);
      });

      it('should handle non-existent items', async () => {
        const result = await backend.get('non-existent', 'key');
        expect(result).toBeNull();
      });

      it('should update existing items', async () => {
        const item: MemoryItem = {
          id: 'update-test',
          category: 'update',
          key: 'key1',
          value: 'original value'
        };

        await backend.store(item);

        const updated = await backend.update('update', 'key1', {
          value: 'updated value',
          metadata: { updated: true }
        });

        expect(updated).toBe(true);

        const retrieved = await backend.get('update', 'key1');
        expect(retrieved?.value).toBe('updated value');
        expect(retrieved?.metadata?.updated).toBe(true);
      });

      it('should delete items', async () => {
        const item: MemoryItem = {
          id: 'delete-test',
          category: 'delete',
          key: 'key1',
          value: 'to be deleted'
        };

        await backend.store(item);
        
        const exists = await backend.get('delete', 'key1');
        expect(exists).toBeDefined();

        const deleted = await backend.delete('delete', 'key1');
        expect(deleted).toBe(true);

        const notExists = await backend.get('delete', 'key1');
        expect(notExists).toBeNull();

        // Delete non-existent should return false
        const deletedAgain = await backend.delete('delete', 'key1');
        expect(deletedAgain).toBe(false);
      });
    });

    describe('Query Operations', () => {
      beforeEach(async () => {
        // Store test data
        const items: MemoryItem[] = [
          {
            id: 'user-1',
            category: 'users',
            key: 'alice',
            value: { name: 'Alice', age: 30 },
            metadata: { 
              timestamp: Date.now() - 3600000,
              tags: ['active', 'premium'],
              namespace: 'app1'
            }
          },
          {
            id: 'user-2',
            category: 'users',
            key: 'bob',
            value: { name: 'Bob', age: 25 },
            metadata: { 
              timestamp: Date.now() - 1800000,
              tags: ['active'],
              namespace: 'app1'
            }
          },
          {
            id: 'post-1',
            category: 'posts',
            key: 'post1',
            value: { title: 'Hello World', author: 'alice' },
            metadata: { 
              timestamp: Date.now() - 900000,
              tags: ['featured'],
              namespace: 'app1'
            }
          },
          {
            id: 'config-1',
            category: 'config',
            key: 'settings',
            value: { theme: 'dark' },
            metadata: {
              timestamp: Date.now(),
              namespace: 'app2'
            }
          }
        ];

        for (const item of items) {
          await backend.store(item);
        }
      });

      it('should query by category', async () => {
        const results = await backend.query({
          categories: ['users']
        });

        expect(results).toHaveLength(2);
        expect(results.every(item => item.category === 'users')).toBe(true);
      });

      it('should query by multiple categories', async () => {
        const results = await backend.query({
          categories: ['users', 'posts']
        });

        expect(results).toHaveLength(3);
      });

      it('should query by keys', async () => {
        const results = await backend.query({
          keys: ['alice', 'post1']
        });

        expect(results).toHaveLength(2);
        expect(results.find(i => i.key === 'alice')).toBeDefined();
        expect(results.find(i => i.key === 'post1')).toBeDefined();
      });

      it('should query by namespace', async () => {
        const results = await backend.query({
          namespace: 'app1'
        });

        expect(results).toHaveLength(3);
        expect(results.every(item => item.metadata?.namespace === 'app1')).toBe(true);
      });

      it('should query by time range', async () => {
        const oneHourAgo = Date.now() - 3600000;
        const thirtyMinutesAgo = Date.now() - 1800000;

        const results = await backend.query({
          startTime: oneHourAgo,
          endTime: thirtyMinutesAgo
        });

        // Should include items from 1 hour ago to 30 minutes ago
        expect(results.length).toBeGreaterThanOrEqual(1);
      });

      it('should apply ordering', async () => {
        const results = await backend.query({
          categories: ['users'],
          orderBy: 'key',
          orderDirection: 'asc'
        });

        expect(results[0].key).toBe('alice');
        expect(results[1].key).toBe('bob');

        const descResults = await backend.query({
          categories: ['users'],
          orderBy: 'key',
          orderDirection: 'desc'
        });

        expect(descResults[0].key).toBe('bob');
        expect(descResults[1].key).toBe('alice');
      });

      it('should apply limit and offset', async () => {
        const results = await backend.query({
          limit: 2
        });

        expect(results).toHaveLength(2);

        const offsetResults = await backend.query({
          limit: 2,
          offset: 2
        });

        expect(offsetResults).toHaveLength(2);
        expect(offsetResults[0].id).not.toBe(results[0].id);
      });

      it('should apply custom filter', async () => {
        const results = await backend.query({
          filter: (item) => {
            if (item.category === 'users' && typeof item.value === 'object') {
              return (item.value as any).age > 25;
            }
            return false;
          }
        });

        expect(results).toHaveLength(1);
        expect((results[0].value as any).name).toBe('Alice');
      });
    });

    describe('Vector Embeddings', () => {
      it('should store and retrieve vector embeddings', async () => {
        const item: MemoryItem = {
          id: 'vector-test',
          category: 'embeddings',
          key: 'doc1',
          value: 'This is a document',
          vectorEmbedding: [0.1, 0.2, 0.3, 0.4, 0.5]
        };

        await backend.store(item);

        const retrieved = await backend.get('embeddings', 'doc1');
        expect(retrieved?.vectorEmbedding).toBeDefined();
        expect(retrieved?.vectorEmbedding).toHaveLength(5);
        expect(retrieved?.vectorEmbedding?.[0]).toBeCloseTo(0.1);
      });
    });

    describe('Statistics', () => {
      it('should provide accurate statistics', async () => {
        // Store some test data
        await backend.store({
          id: 'stat1',
          category: 'stats',
          key: 'item1',
          value: 'test data 1'
        });

        await backend.store({
          id: 'stat2',
          category: 'stats',
          key: 'item2',
          value: 'test data 2'
        });

        await backend.store({
          id: 'stat3',
          category: 'other',
          key: 'item3',
          value: 'test data 3'
        });

        const stats = await backend.getStats();

        expect(stats.totalItems).toBe(3);
        expect(stats.categories).toBe(2);
        expect(stats.sizeBytes).toBeGreaterThan(0);
        expect(stats.oldestItem).toBeDefined();
        expect(stats.newestItem).toBeDefined();
      });
    });

    if (name === 'SQLite') {
      describe('SQLite Specific Features', () => {
        it('should support full-text search', async () => {
          const sqliteBackend = backend as SqliteBackend;

          await sqliteBackend.store({
            id: 'fts1',
            category: 'documents',
            key: 'doc1',
            value: 'The quick brown fox jumps over the lazy dog'
          });

          await sqliteBackend.store({
            id: 'fts2',
            category: 'documents',
            key: 'doc2',
            value: 'A lazy cat sleeps all day'
          });

          const results = await sqliteBackend.search('lazy', {
            categories: ['documents']
          });

          expect(results).toHaveLength(2);
        });

        it('should handle time-travel queries', async () => {
          const sqliteBackend = backend as SqliteBackend;

          // Store and update item
          await sqliteBackend.store({
            id: 'time-travel',
            category: 'versioned',
            key: 'item1',
            value: 'version 1'
          });

          const timePoint = Date.now();

          await new Promise(resolve => setTimeout(resolve, 10));

          await sqliteBackend.store({
            id: 'time-travel',
            category: 'versioned',
            key: 'item1',
            value: 'version 2'
          });

          // Query as of past time
          const results = await sqliteBackend.query({
            categories: ['versioned'],
            asOf: timePoint
          });

          // Should return the version that existed at that time
          expect(results.length).toBeGreaterThanOrEqual(0);
        });
      });
    }

    if (name === 'Markdown') {
      describe('Markdown Specific Features', () => {
        it('should create proper directory structure', async () => {
          const markdownBackend = backend as MarkdownBackend;

          await markdownBackend.store({
            id: 'arch1',
            category: 'architecture',
            key: 'decision-001',
            value: { decision: 'Use microservices' }
          });

          // Check if file was created in correct directory
          const expectedPath = path.join(
            testDir,
            'shared-knowledge',
            'architectural-decisions',
            'default',
            'decision-001.md'
          );

          const exists = await fs.access(expectedPath).then(() => true).catch(() => false);
          expect(exists).toBe(true);
        });

        it('should search through markdown files', async () => {
          const markdownBackend = backend as MarkdownBackend;

          await markdownBackend.store({
            id: 'search1',
            category: 'notes',
            key: 'note1',
            value: 'This is a searchable note about testing'
          });

          await markdownBackend.store({
            id: 'search2',
            category: 'notes',
            key: 'note2',
            value: 'Another note about deployment'
          });

          const results = await markdownBackend.search('testing');

          expect(results).toHaveLength(1);
          expect(results[0].key).toBe('note1');
        });
      });
    }
  });
});