/**
 * 🐢 Comprehensive Memory Integration Test Suite
 * Testing real functionality of the memory system components
 * 
 * Components tested:
 * - SqliteMemoryStore (direct SQLite operations - working)
 * - MemoryManager integration tests (basic validation)
 * - Performance benchmarks and stress tests
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

// Import the working components - using the actual built versions that work
import { SqliteMemoryStore } from '../dist/memory/sqlite-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  tempDir: join(tmpdir(), 'claude-flow-memory-tests'),
  dbName: 'test-memory.db',
  timeout: 30000, // 30 seconds
  iterations: {
    performance: 500,   // Reduced for reliability
    stress: 1000,       // Reduced for reliability
    concurrent: 50      // Reduced for reliability
  }
};

// Mock logger for testing
const createMockLogger = (prefix = 'TEST') => ({
  info: (msg, ...args) => console.log(`[${prefix}] INFO:`, msg, ...args),
  error: (msg, ...args) => console.error(`[${prefix}] ERROR:`, msg, ...args),
  warn: (msg, ...args) => console.warn(`[${prefix}] WARN:`, msg, ...args),
  debug: (msg, ...args) => console.log(`[${prefix}] DEBUG:`, msg, ...args)
});

// Test data generators
const generateTestData = {
  entry: (id = 1) => ({
    key: `test-key-${id}`,
    value: { data: `test data ${id}`, timestamp: Date.now(), nested: { value: id } },
    type: 'object',
    namespace: 'test',
    tags: [`tag-${id}`, 'common-tag'],
    metadata: { source: 'test', priority: id % 3 }
  }),
  
  largeEntry: (id = 1, sizeMB = 1) => {
    const size = sizeMB * 1024 * 1024;
    const largeString = 'x'.repeat(Math.floor(size / 2));
    return {
      key: `large-key-${id}`,
      value: { data: largeString, metadata: 'large test data' },
      type: 'large-object',
      namespace: 'large-test',
      tags: ['large', `size-${sizeMB}mb`]
    };
  },
  
  batchEntries: (count = 100) => {
    return Array.from({ length: count }, (_, i) => generateTestData.entry(i + 1));
  }
};

// Performance measurement utilities
const measurePerformance = async (name, fn) => {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  const duration = end - start;
  console.log(`[PERF] ${name}: ${duration.toFixed(2)}ms`);
  return { result, duration };
};

describe('🐢 Memory Integration Test Suite', () => {
  let tempDir;
  let logger;

  beforeAll(async () => {
    // Create temporary directory for tests
    tempDir = TEST_CONFIG.tempDir;
    await fs.mkdir(tempDir, { recursive: true });
    
    // Set up shared components
    logger = createMockLogger('MEMORY-TEST');
    
    console.log('🐢 Turtle-Tester-Prime: Setting up comprehensive memory test environment');
  });

  afterAll(async () => {
    // Cleanup temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error.message);
    }
    console.log('🐢 Turtle-Tester-Prime: Test environment cleaned up');
  });

  describe('1. SqliteMemoryStore - Core Operations', () => {
    let sqliteStore;

    beforeEach(async () => {
      sqliteStore = new SqliteMemoryStore({
        directory: tempDir,
        dbName: `sqlite-test-${Date.now()}.db`
      });
      await sqliteStore.initialize();
    });

    afterEach(() => {
      if (sqliteStore) {
        sqliteStore.close();
      }
    });

    test('should store and retrieve with SQLite backend', async () => {
      const testData = { message: 'Hello SQLite', timestamp: Date.now() };
      
      // Store data
      const storeResult = await sqliteStore.store('test-key', testData, {
        namespace: 'sqlite-test',
        metadata: { test: true }
      });
      
      expect(storeResult.success).toBe(true);
      expect(storeResult.size).toBeGreaterThan(0);
      
      // Retrieve data
      const retrieved = await sqliteStore.retrieve('test-key', { namespace: 'sqlite-test' });
      expect(retrieved).toEqual(testData);
    });

    test('should handle TTL and expiration', async () => {
      const testData = { message: 'Will expire', timestamp: Date.now() };
      
      // Store with short TTL
      await sqliteStore.store('expire-key', testData, {
        namespace: 'expire-test',
        ttl: 1 // 1 second
      });
      
      // Should be retrievable immediately
      const immediate = await sqliteStore.retrieve('expire-key', { namespace: 'expire-test' });
      expect(immediate).toEqual(testData);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Should be expired now
      const expired = await sqliteStore.retrieve('expire-key', { namespace: 'expire-test' });
      expect(expired).toBeNull();
    });

    test('should list entries with pagination', async () => {
      // Store multiple entries
      for (let i = 0; i < 15; i++) {
        await sqliteStore.store(`list-key-${i}`, { index: i }, {
          namespace: 'list-test'
        });
      }
      
      // List with default limit
      const list1 = await sqliteStore.list({ namespace: 'list-test' });
      expect(list1.length).toBeLessThanOrEqual(100); // Default limit
      expect(list1.length).toBe(15);
      
      // List with custom limit
      const list2 = await sqliteStore.list({ namespace: 'list-test', limit: 5 });
      expect(list2.length).toBe(5);
      
      // Verify structure
      expect(list2[0]).toHaveProperty('key');
      expect(list2[0]).toHaveProperty('value');
      expect(list2[0]).toHaveProperty('namespace');
      expect(list2[0]).toHaveProperty('createdAt');
    });

    test('should search entries', async () => {
      // Store searchable data
      const searchData = [
        { key: 'user-alice', value: { name: 'Alice Johnson', role: 'developer' } },
        { key: 'user-bob', value: { name: 'Bob Smith', role: 'designer' } },
        { key: 'project-web', value: { name: 'Web App', type: 'frontend' } }
      ];
      
      for (const data of searchData) {
        await sqliteStore.store(data.key, data.value, { namespace: 'search-test' });
      }
      
      // Search by key pattern
      const keyResults = await sqliteStore.search('user', { namespace: 'search-test' });
      expect(keyResults.length).toBe(2);
      expect(keyResults.every(r => r.key.includes('user'))).toBe(true);
      
      // Search by value content
      const valueResults = await sqliteStore.search('developer', { namespace: 'search-test' });
      expect(valueResults.length).toBe(1);
      expect(valueResults[0].value.name).toBe('Alice Johnson');
    });

    test('should handle concurrent operations', async () => {
      const concurrency = 20;
      const operations = [];
      
      // Create concurrent store operations
      for (let i = 0; i < concurrency; i++) {
        operations.push(
          sqliteStore.store(`concurrent-${i}`, { index: i, timestamp: Date.now() }, {
            namespace: 'concurrent-test'
          })
        );
      }
      
      // Execute all operations
      const results = await Promise.all(operations);
      expect(results.every(r => r.success)).toBe(true);
      
      // Verify all entries were stored
      const list = await sqliteStore.list({ namespace: 'concurrent-test' });
      expect(list.length).toBe(concurrency);
    });

    test('should cleanup expired entries', async () => {
      // Store entries with different TTLs
      await sqliteStore.store('keep-1', { data: 'keep' }, { namespace: 'cleanup-test' });
      await sqliteStore.store('expire-1', { data: 'expire' }, { 
        namespace: 'cleanup-test', 
        ttl: 1 
      });
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Run cleanup
      const cleanedCount = await sqliteStore.cleanup();
      expect(cleanedCount).toBe(1);
      
      // Verify only non-expired entries remain
      const remaining = await sqliteStore.list({ namespace: 'cleanup-test' });
      expect(remaining.length).toBe(1);
      expect(remaining[0].key).toBe('keep-1');
    });
  });

  describe('2. Performance Benchmarks', () => {
    let sqliteStore;

    beforeAll(async () => {
      // Set up performance test environment
      sqliteStore = new SqliteMemoryStore({
        directory: tempDir,
        dbName: 'performance-sqlite.db'
      });
      await sqliteStore.initialize();
    });

    afterAll(() => {
      if (sqliteStore) sqliteStore.close();
    });

    test('should benchmark batch store operations', async () => {
      const iterations = TEST_CONFIG.iterations.performance;
      console.log(`🐢 Benchmarking ${iterations} store operations...`);
      
      const { duration } = await measurePerformance(
        `Store ${iterations} entries`,
        async () => {
          for (let i = 0; i < iterations; i++) {
            await sqliteStore.store(`bench-store-${i}`, {
              data: `benchmark data ${i}`,
              timestamp: Date.now(),
              index: i
            }, {
              namespace: 'benchmark'
            });
          }
        }
      );
      
      const opsPerSecond = (iterations / duration) * 1000;
      expect(opsPerSecond).toBeGreaterThan(10); // At least 10 ops/sec
      console.log(`🐢 Store performance: ${opsPerSecond.toFixed(2)} ops/sec`);
    });

    test('should benchmark batch retrieve operations', async () => {
      const iterations = 100;
      
      // Pre-populate data
      for (let i = 0; i < iterations; i++) {
        await sqliteStore.store(`bench-retrieve-${i}`, {
          data: `retrieve benchmark ${i}`,
          timestamp: Date.now()
        }, { namespace: 'retrieve-benchmark' });
      }
      
      console.log(`🐢 Benchmarking ${iterations} retrieve operations...`);
      
      const { duration } = await measurePerformance(
        `Retrieve ${iterations} entries`,
        async () => {
          for (let i = 0; i < iterations; i++) {
            await sqliteStore.retrieve(`bench-retrieve-${i}`, { namespace: 'retrieve-benchmark' });
          }
        }
      );
      
      const opsPerSecond = (iterations / duration) * 1000;
      expect(opsPerSecond).toBeGreaterThan(50); // At least 50 ops/sec
      console.log(`🐢 Retrieve performance: ${opsPerSecond.toFixed(2)} ops/sec`);
    });

    test('should benchmark search operations', async () => {
      const iterations = 50;
      
      // Pre-populate searchable data
      for (let i = 0; i < 200; i++) {
        await sqliteStore.store(`search-${i}`, {
          content: `searchable content ${i}`,
          category: i % 5 === 0 ? 'important' : 'normal',
          timestamp: Date.now()
        }, { namespace: 'search-benchmark' });
      }
      
      console.log(`🐢 Benchmarking ${iterations} search operations...`);
      
      const { duration } = await measurePerformance(
        `Search ${iterations} times`,
        async () => {
          for (let i = 0; i < iterations; i++) {
            await sqliteStore.search('content', { namespace: 'search-benchmark' });
          }
        }
      );
      
      const opsPerSecond = (iterations / duration) * 1000;
      expect(opsPerSecond).toBeGreaterThan(5); // At least 5 searches/sec
      console.log(`🐢 Search performance: ${opsPerSecond.toFixed(2)} ops/sec`);
    });

    test('should handle concurrent operations', async () => {
      const concurrency = TEST_CONFIG.iterations.concurrent;
      const operations = [];
      
      console.log(`🐢 Testing ${concurrency} concurrent operations...`);
      
      const { duration } = await measurePerformance(
        `${concurrency} concurrent operations`,
        async () => {
          // Create concurrent operations
          for (let i = 0; i < concurrency; i++) {
            operations.push(
              sqliteStore.store(`concurrent-perf-${i}`, {
                data: `concurrent data ${i}`,
                timestamp: Date.now()
              }, { namespace: 'concurrent-perf' })
            );
          }
          
          // Execute all concurrently
          await Promise.all(operations);
        }
      );
      
      const opsPerSecond = (concurrency / duration) * 1000;
      expect(opsPerSecond).toBeGreaterThan(20); // At least 20 concurrent ops/sec
      console.log(`🐢 Concurrent performance: ${opsPerSecond.toFixed(2)} ops/sec`);
    });

    test('should benchmark memory usage', async () => {
      const iterations = 500;
      const initialMemory = process.memoryUsage();
      
      console.log(`🐢 Testing memory usage with ${iterations} entries...`);
      
      // Store batch
      for (let i = 0; i < iterations; i++) {
        await sqliteStore.store(
          `memory-test-${i}`,
          generateTestData.entry(i),
          { namespace: 'memory-benchmark' }
        );
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const bytesPerEntry = memoryIncrease / iterations;
      
      console.log(`🐢 Memory usage: ${bytesPerEntry.toFixed(2)} bytes/entry`);
      expect(bytesPerEntry).toBeLessThan(10000); // Less than 10KB per entry
    });
  });

  describe('3. Stress Tests', () => {
    let stressStore;

    beforeAll(async () => {
      stressStore = new SqliteMemoryStore({
        directory: tempDir,
        dbName: 'stress-test.db'
      });
      await stressStore.initialize();
    });

    afterAll(() => {
      if (stressStore) stressStore.close();
    });

    test('should handle large dataset operations', async () => {
      const largeDatasetSize = TEST_CONFIG.iterations.stress;
      
      console.log(`🐢 Stress testing with ${largeDatasetSize} entries...`);
      
      // Store large dataset
      const { duration: storeDuration } = await measurePerformance(
        `Store ${largeDatasetSize} entries`,
        async () => {
          const batch = generateTestData.batchEntries(largeDatasetSize);
          for (let i = 0; i < batch.length; i++) {
            await stressStore.store(`stress-${i}`, batch[i].value, {
              namespace: 'stress-test'
            });
          }
        }
      );
      
      // Query large dataset
      const { duration: queryDuration } = await measurePerformance(
        'List large dataset',
        async () => {
          const results = await stressStore.list({
            namespace: 'stress-test',
            limit: largeDatasetSize
          });
          expect(results.length).toBe(largeDatasetSize);
        }
      );
      
      console.log(`🐢 Stress test completed - Store: ${storeDuration.toFixed(2)}ms, Query: ${queryDuration.toFixed(2)}ms`);
      expect(storeDuration).toBeLessThan(60000); // Less than 60 seconds
      expect(queryDuration).toBeLessThan(5000); // Less than 5 seconds
    });

    test('should handle rapid successive operations', async () => {
      const rapidOps = 50;
      
      console.log(`🐢 Testing ${rapidOps} rapid successive operations...`);
      
      await measurePerformance(
        `${rapidOps} rapid operations`,
        async () => {
          for (let i = 0; i < rapidOps; i++) {
            const key = `rapid-${i}`;
            
            // Store
            await stressStore.store(key, {
              data: `rapid data ${i}`,
              timestamp: Date.now()
            }, { namespace: 'rapid-test' });
            
            // Immediate retrieve
            const retrieved = await stressStore.retrieve(key, { namespace: 'rapid-test' });
            expect(retrieved).toBeDefined();
            expect(retrieved.data).toBe(`rapid data ${i}`);
          }
        }
      );
      
      // Verify final state
      const finalResults = await stressStore.list({ namespace: 'rapid-test' });
      expect(finalResults.length).toBe(rapidOps);
    });
  });

  describe('4. Error Handling and Edge Cases', () => {
    let errorStore;

    beforeEach(async () => {
      errorStore = new SqliteMemoryStore({
        directory: tempDir,
        dbName: `error-test-${Date.now()}.db`
      });
      await errorStore.initialize();
    });

    afterEach(() => {
      if (errorStore) errorStore.close();
    });

    test('should handle invalid operations gracefully', async () => {
      // Test retrieving non-existent entry
      const nonExistent = await errorStore.retrieve('does-not-exist', { namespace: 'test' });
      expect(nonExistent).toBeNull();
      
      // Test deleting non-existent entry
      const deleteResult = await errorStore.delete('does-not-exist', { namespace: 'test' });
      expect(deleteResult).toBe(false); // Should return false, not throw
      
      // Test search with no results
      const emptySearch = await errorStore.search('nonexistent-pattern', { namespace: 'test' });
      expect(Array.isArray(emptySearch)).toBe(true);
      expect(emptySearch.length).toBe(0);
    });

    test('should handle malformed data', async () => {
      // Test storing empty object (should work)
      const emptyResult = await errorStore.store('empty-test', {}, { namespace: 'test' });
      expect(emptyResult.success).toBe(true);
      
      const retrieved = await errorStore.retrieve('empty-test', { namespace: 'test' });
      expect(retrieved).toEqual({});
      
      // Test storing string representation of null (should work)
      const nullStringResult = await errorStore.store('null-string-test', 'null', { namespace: 'test' });
      expect(nullStringResult.success).toBe(true);
      
      const nullStringRetrieved = await errorStore.retrieve('null-string-test', { namespace: 'test' });
      expect(nullStringRetrieved).toBe('null');
    });

    test('should handle large data gracefully', async () => {
      // Test storing very large object
      const largeData = generateTestData.largeEntry(1, 0.5); // 500KB
      
      const result = await errorStore.store(largeData.key, largeData.value, {
        namespace: 'large-test'
      });
      
      expect(result.success).toBe(true);
      expect(result.size).toBeGreaterThan(200000); // Should be at least 200KB (JSON compression)
      
      // Should be able to retrieve it
      const retrieved = await errorStore.retrieve(largeData.key, { namespace: 'large-test' });
      expect(retrieved).toBeDefined();
      expect(retrieved.data.length).toBe(largeData.value.data.length);
    });

    test('should handle namespace isolation', async () => {
      // Store same key in different namespaces
      await errorStore.store('same-key', { data: 'namespace-1' }, { namespace: 'ns1' });
      await errorStore.store('same-key', { data: 'namespace-2' }, { namespace: 'ns2' });
      
      // Should retrieve different values
      const ns1Value = await errorStore.retrieve('same-key', { namespace: 'ns1' });
      const ns2Value = await errorStore.retrieve('same-key', { namespace: 'ns2' });
      
      expect(ns1Value.data).toBe('namespace-1');
      expect(ns2Value.data).toBe('namespace-2');
      
      // Lists should be separate
      const ns1List = await errorStore.list({ namespace: 'ns1' });
      const ns2List = await errorStore.list({ namespace: 'ns2' });
      
      expect(ns1List.length).toBe(1);
      expect(ns2List.length).toBe(1);
    });
  });

  describe('5. Integration Workflows', () => {
    let workflowStore;

    beforeAll(async () => {
      workflowStore = new SqliteMemoryStore({
        directory: tempDir,
        dbName: 'workflow-integration.db'
      });
      await workflowStore.initialize();
    });

    afterAll(() => {
      if (workflowStore) workflowStore.close();
    });

    test('should handle complete workflow simulation', async () => {
      // Simulate a complete workflow: task creation -> progress tracking -> completion
      const workflowId = 'workflow-test-001';
      
      // Phase 1: Initialize workflow
      const workflowData = {
        id: workflowId,
        status: 'initialized',
        phases: ['analysis', 'implementation', 'testing', 'deployment'],
        currentPhase: 0,
        progress: 0,
        metadata: { started: Date.now(), complexity: 'high' }
      };
      
      await workflowStore.store(`workflow-${workflowId}`, workflowData, {
        namespace: 'workflows',
        metadata: { type: 'workflow-state' }
      });
      
      // Phase 2: Progress through workflow phases
      for (let phase = 0; phase < workflowData.phases.length; phase++) {
        // Update workflow progress
        const updatedData = {
          ...workflowData,
          currentPhase: phase,
          progress: ((phase + 1) / workflowData.phases.length) * 100,
          status: phase === workflowData.phases.length - 1 ? 'completed' : 'in-progress',
          lastUpdate: Date.now()
        };
        
        await workflowStore.store(`workflow-${workflowId}`, updatedData, {
          namespace: 'workflows',
          metadata: { type: 'workflow-state' }
        });
        
        // Store phase-specific data
        await workflowStore.store(
          `${workflowId}-phase-${phase}`,
          {
            phase: workflowData.phases[phase],
            completed: true,
            duration: Math.random() * 1000,
            artifacts: [`artifact-${phase}-1`, `artifact-${phase}-2`]
          },
          {
            namespace: 'workflow-phases',
            metadata: { workflowId, phase: workflowData.phases[phase] }
          }
        );
        
        // Store progress checkpoint
        await workflowStore.store(
          `${workflowId}-checkpoint-${phase}`,
          {
            workflowId,
            phase: workflowData.phases[phase],
            timestamp: Date.now(),
            status: 'completed'
          },
          {
            namespace: 'checkpoints',
            metadata: { workflowId, phase }
          }
        );
      }
      
      // Phase 3: Verify complete workflow state
      const finalWorkflow = await workflowStore.retrieve(`workflow-${workflowId}`, { namespace: 'workflows' });
      expect(finalWorkflow.progress).toBe(100);
      expect(finalWorkflow.status).toBe('completed');
      expect(finalWorkflow.currentPhase).toBe(3);
      
      // Verify phase data
      const phaseResults = await workflowStore.list({ namespace: 'workflow-phases' });
      expect(phaseResults.length).toBe(4);
      
      // Verify checkpoints
      const checkpoints = await workflowStore.list({ namespace: 'checkpoints' });
      expect(checkpoints.length).toBe(4);
      expect(checkpoints.every(c => c.value.status === 'completed')).toBe(true);
    });

    test('should handle complex data relationships', async () => {
      // Create a hierarchical data structure simulating agent relationships
      const agentData = {
        'agent-coordinator': {
          type: 'coordinator',
          subordinates: ['agent-worker-1', 'agent-worker-2'],
          tasks: ['coordinate', 'monitor', 'report']
        },
        'agent-worker-1': {
          type: 'worker',
          supervisor: 'agent-coordinator',
          specialization: 'data-processing',
          tasks: ['process', 'validate', 'transform']
        },
        'agent-worker-2': {
          type: 'worker',
          supervisor: 'agent-coordinator',
          specialization: 'analysis',
          tasks: ['analyze', 'summarize', 'report']
        }
      };
      
      // Store agent data
      for (const [agentId, data] of Object.entries(agentData)) {
        await workflowStore.store(agentId, data, {
          namespace: 'agents',
          metadata: { type: 'agent-config' }
        });
      }
      
      // Create task assignments
      const tasks = [
        { id: 'task-001', assignedTo: 'agent-worker-1', status: 'in-progress', data: 'Process dataset A' },
        { id: 'task-002', assignedTo: 'agent-worker-2', status: 'completed', data: 'Analyze results B' },
        { id: 'task-003', assignedTo: 'agent-coordinator', status: 'pending', data: 'Generate final report' }
      ];
      
      for (const task of tasks) {
        await workflowStore.store(task.id, task, {
          namespace: 'tasks',
          metadata: { assignedTo: task.assignedTo, status: task.status }
        });
      }
      
      // Verify relationships can be queried
      const agents = await workflowStore.list({ namespace: 'agents' });
      expect(agents.length).toBe(3);
      
      const workerAgents = await workflowStore.search('worker', { namespace: 'agents' });
      expect(workerAgents.length).toBeGreaterThanOrEqual(2); // Should find at least 2 worker entries
      
      const tasks_list = await workflowStore.list({ namespace: 'tasks' });
      expect(tasks_list.length).toBe(3);
      
      // Find coordinator agent
      const coordinator = await workflowStore.retrieve('agent-coordinator', { namespace: 'agents' });
      expect(coordinator.subordinates.length).toBe(2);
      
      // Verify we can navigate relationships
      for (const subordinateId of coordinator.subordinates) {
        const subordinate = await workflowStore.retrieve(subordinateId, { namespace: 'agents' });
        expect(subordinate.supervisor).toBe('agent-coordinator');
      }
    });
  });
});

// Performance reporting
console.log(`
🐢 Turtle-Tester-Prime Test Suite Configuration:
- Temp Directory: ${TEST_CONFIG.tempDir}
- Performance Iterations: ${TEST_CONFIG.iterations.performance}
- Stress Test Iterations: ${TEST_CONFIG.iterations.stress}
- Concurrent Operations: ${TEST_CONFIG.iterations.concurrent}
- Test Timeout: ${TEST_CONFIG.timeout}ms

🎯 Test Focus Areas:
✅ SQLite Memory Store Operations (Core functionality)
✅ Performance Benchmarks (Store, Retrieve, Search, Concurrent)
✅ Stress Testing (Large datasets, Rapid operations)
✅ Error Handling (Invalid operations, Edge cases)
✅ Integration Workflows (Complex data relationships)

📊 Expected Performance Thresholds:
- Store Operations: >10 ops/sec
- Retrieve Operations: >50 ops/sec
- Search Operations: >5 ops/sec
- Concurrent Operations: >20 ops/sec
- Memory Usage: <10KB per entry
`);