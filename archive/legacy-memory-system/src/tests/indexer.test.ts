/**
 * SPARC Memory Bank - Indexer Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryIndexer } from '../indexer/memory-indexer';
import { SqliteBackend } from '../backends/sqlite-backend';
import { MemoryItem } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('MemoryIndexer', () => {
  let indexer: MemoryIndexer;
  let backend: SqliteBackend;
  const testDir = '/tmp/indexer-test';

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    
    backend = new SqliteBackend({
      path: path.join(testDir, 'test.db')
    });
    await backend.initialize();

    indexer = new MemoryIndexer({
      backend,
      enableVectorSearch: true,
      vectorDimensions: 128
    });
    await indexer.initialize();
  });

  afterEach(async () => {
    await indexer.close();
    await backend.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Basic Indexing', () => {
    it('should index items by category', async () => {
      const item1: MemoryItem = {
        id: 'test1',
        category: 'users',
        key: 'user1',
        value: { name: 'Alice' }
      };

      const item2: MemoryItem = {
        id: 'test2',
        category: 'users',
        key: 'user2',
        value: { name: 'Bob' }
      };

      const item3: MemoryItem = {
        id: 'test3',
        category: 'posts',
        key: 'post1',
        value: { title: 'Hello' }
      };

      await indexer.index(item1);
      await indexer.index(item2);
      await indexer.index(item3);

      const userCandidates = await indexer.query({ categories: ['users'] });
      expect(userCandidates.size).toBe(2);
      expect(userCandidates.has('users:user1')).toBe(true);
      expect(userCandidates.has('users:user2')).toBe(true);
    });

    it('should index items by tags', async () => {
      const item1: MemoryItem = {
        id: 'test1',
        category: 'articles',
        key: 'article1',
        value: 'Content',
        metadata: { tags: ['tech', 'ai'] }
      };

      const item2: MemoryItem = {
        id: 'test2',
        category: 'articles',
        key: 'article2',
        value: 'Content',
        metadata: { tags: ['tech', 'web'] }
      };

      await indexer.index(item1);
      await indexer.index(item2);

      const techCandidates = await indexer.query({ tags: ['tech'] });
      expect(techCandidates.size).toBe(2);

      const aiCandidates = await indexer.query({ tags: ['ai'] });
      expect(aiCandidates.size).toBe(1);
      expect(aiCandidates.has('articles:article1')).toBe(true);
    });

    it('should index items by namespace', async () => {
      const item1: MemoryItem = {
        id: 'test1',
        category: 'config',
        key: 'setting1',
        value: 'value1',
        metadata: { namespace: 'app1' }
      };

      const item2: MemoryItem = {
        id: 'test2',
        category: 'config',
        key: 'setting2',
        value: 'value2',
        metadata: { namespace: 'app2' }
      };

      await indexer.index(item1);
      await indexer.index(item2);

      const app1Candidates = await indexer.query({ namespace: 'app1' });
      expect(app1Candidates.size).toBe(1);
      expect(app1Candidates.has('config:setting1')).toBe(true);
    });

    it('should remove items from index', async () => {
      const item: MemoryItem = {
        id: 'test1',
        category: 'temp',
        key: 'temp1',
        value: 'temporary',
        metadata: { tags: ['temporary'] }
      };

      await indexer.index(item);
      
      let candidates = await indexer.query({ categories: ['temp'] });
      expect(candidates.size).toBe(1);

      await indexer.remove('temp', 'temp1');

      candidates = await indexer.query({ categories: ['temp'] });
      expect(candidates.size).toBe(0);

      // Also removed from tag index
      const tagCandidates = await indexer.query({ tags: ['temporary'] });
      expect(tagCandidates.size).toBe(0);
    });
  });

  describe('Complex Queries', () => {
    beforeEach(async () => {
      // Add test data
      await indexer.index({
        id: 'user1',
        category: 'users',
        key: 'alice',
        value: { name: 'Alice' },
        metadata: { tags: ['admin', 'active'], namespace: 'prod' }
      });

      await indexer.index({
        id: 'user2',
        category: 'users',
        key: 'bob',
        value: { name: 'Bob' },
        metadata: { tags: ['user', 'active'], namespace: 'prod' }
      });

      await indexer.index({
        id: 'user3',
        category: 'users',
        key: 'charlie',
        value: { name: 'Charlie' },
        metadata: { tags: ['user', 'inactive'], namespace: 'dev' }
      });

      await indexer.index({
        id: 'post1',
        category: 'posts',
        key: 'post1',
        value: { title: 'Post 1' },
        metadata: { tags: ['featured'], namespace: 'prod' }
      });
    });

    it('should handle multiple filter criteria', async () => {
      // Users in prod namespace
      const candidates = await indexer.query({
        categories: ['users'],
        namespace: 'prod'
      });

      expect(candidates.size).toBe(2);
      expect(candidates.has('users:alice')).toBe(true);
      expect(candidates.has('users:bob')).toBe(true);
    });

    it('should handle tag combinations', async () => {
      // Active users
      const candidates = await indexer.query({
        categories: ['users'],
        tags: ['active']
      });

      expect(candidates.size).toBe(2);
      expect(candidates.has('users:alice')).toBe(true);
      expect(candidates.has('users:bob')).toBe(true);
    });

    it('should return all items when no filters specified', async () => {
      const candidates = await indexer.query({});
      expect(candidates.size).toBe(4); // All items
    });
  });

  describe('Vector Search', () => {
    it('should support vector search', () => {
      expect(indexer.supportsVectorSearch()).toBe(true);
    });

    it('should index and search vectors', async () => {
      const embedding1 = new Array(128).fill(0).map((_, i) => Math.sin(i));
      const embedding2 = new Array(128).fill(0).map((_, i) => Math.cos(i));
      const embedding3 = new Array(128).fill(0).map((_, i) => Math.sin(i * 2));

      await backend.store({
        id: 'doc1',
        category: 'documents',
        key: 'doc1',
        value: 'Document 1',
        vectorEmbedding: embedding1
      });

      await backend.store({
        id: 'doc2',
        category: 'documents',
        key: 'doc2',
        value: 'Document 2',
        vectorEmbedding: embedding2
      });

      await backend.store({
        id: 'doc3',
        category: 'documents',
        key: 'doc3',
        value: 'Document 3',
        vectorEmbedding: embedding3
      });

      await indexer.index({
        id: 'doc1',
        category: 'documents',
        key: 'doc1',
        value: 'Document 1',
        vectorEmbedding: embedding1
      });

      await indexer.index({
        id: 'doc2',
        category: 'documents',
        key: 'doc2',
        value: 'Document 2',
        vectorEmbedding: embedding2
      });

      await indexer.index({
        id: 'doc3',
        category: 'documents',
        key: 'doc3',
        value: 'Document 3',
        vectorEmbedding: embedding3
      });

      // Search with a query similar to embedding1
      const queryEmbedding = embedding1.map(v => v + Math.random() * 0.1);
      
      const results = await indexer.vectorSearch({
        vectorSearch: {
          embedding: queryEmbedding,
          topK: 2
        }
      });

      expect(results).toHaveLength(2);
      // First result should be most similar (doc1)
      expect(results[0].key).toBe('doc1');
    });

    it('should apply threshold filtering', async () => {
      const embedding1 = new Array(128).fill(1);
      const embedding2 = new Array(128).fill(-1);

      await backend.store({
        id: 'similar',
        category: 'test',
        key: 'similar',
        value: 'Similar',
        vectorEmbedding: embedding1
      });

      await backend.store({
        id: 'different',
        category: 'test',
        key: 'different',
        value: 'Different',
        vectorEmbedding: embedding2
      });

      await indexer.index({
        id: 'similar',
        category: 'test',
        key: 'similar',
        value: 'Similar',
        vectorEmbedding: embedding1
      });

      await indexer.index({
        id: 'different',
        category: 'test',
        key: 'different',
        value: 'Different',
        vectorEmbedding: embedding2
      });

      const results = await indexer.vectorSearch({
        vectorSearch: {
          embedding: embedding1,
          threshold: 0.9
        }
      });

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('similar');
    });
  });

  describe('Statistics', () => {
    it('should provide index statistics', async () => {
      await indexer.index({
        id: 'test1',
        category: 'cat1',
        key: 'key1',
        value: 'value1',
        metadata: { tags: ['tag1'], namespace: 'ns1' }
      });

      await indexer.index({
        id: 'test2',
        category: 'cat2',
        key: 'key2',
        value: 'value2',
        metadata: { tags: ['tag2'], namespace: 'ns2' },
        vectorEmbedding: new Array(128).fill(0)
      });

      const stats = indexer.getStats();

      expect(stats.categories).toBe(2);
      expect(stats.tags).toBe(2);
      expect(stats.namespaces).toBe(2);
      expect(stats.vectors).toBe(1);
    });
  });

  describe('Text Embedding Generation', () => {
    it('should generate text embeddings', async () => {
      const text = 'This is a test document for embedding generation';
      const embedding = await indexer.generateEmbedding(text);

      expect(embedding).toHaveLength(128);
      expect(embedding.every(v => v >= 0 && v <= 1)).toBe(true);

      // Different texts should produce different embeddings
      const embedding2 = await indexer.generateEmbedding('Different text');
      expect(embedding).not.toEqual(embedding2);
    });
  });

  describe('Event Emissions', () => {
    it('should emit events on operations', async () => {
      const indexedHandler = vi.fn();
      const removedHandler = vi.fn();

      indexer.on('indexed', indexedHandler);
      indexer.on('removed', removedHandler);

      const item: MemoryItem = {
        id: 'event-test',
        category: 'events',
        key: 'event1',
        value: 'test'
      };

      await indexer.index(item);
      expect(indexedHandler).toHaveBeenCalledWith(item);

      await indexer.remove('events', 'event1');
      expect(removedHandler).toHaveBeenCalledWith({
        category: 'events',
        key: 'event1'
      });
    });
  });
});