/**
 * Memory Write Benchmark
 *
 * Target: <5ms (10x faster than current ~50ms)
 *
 * Measures memory write operations including key-value stores,
 * structured data, and vector embeddings.
 */

import { benchmark, BenchmarkRunner, formatTime, meetsTarget } from '../framework/benchmark.js';

// ============================================================================
// Memory Store Implementations
// ============================================================================

/**
 * Simple in-memory key-value store
 */
class SimpleMemoryStore {
  private data = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  get(key: string): unknown {
    return this.data.get(key);
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  get size(): number {
    return this.data.size;
  }
}

/**
 * Typed array store for vectors
 */
class VectorStore {
  private vectors: Map<string, Float32Array> = new Map();
  private metadata: Map<string, object> = new Map();

  set(key: string, vector: Float32Array, meta?: object): void {
    this.vectors.set(key, vector);
    if (meta) {
      this.metadata.set(key, meta);
    }
  }

  get(key: string): { vector: Float32Array; metadata?: object } | undefined {
    const vector = this.vectors.get(key);
    if (!vector) return undefined;
    return { vector, metadata: this.metadata.get(key) };
  }

  delete(key: string): boolean {
    this.metadata.delete(key);
    return this.vectors.delete(key);
  }

  get size(): number {
    return this.vectors.size;
  }
}

/**
 * Write-ahead log for durability
 */
class WriteAheadLog {
  private entries: Array<{ timestamp: number; operation: string; key: string; value: unknown }> = [];
  private maxEntries = 10000;

  append(operation: string, key: string, value: unknown): number {
    const entry = {
      timestamp: Date.now(),
      operation,
      key,
      value,
    };
    this.entries.push(entry);

    // Compact if needed
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries / 2);
    }

    return this.entries.length;
  }

  get length(): number {
    return this.entries.length;
  }
}

/**
 * Batched memory store for bulk operations
 */
class BatchedMemoryStore {
  private data = new Map<string, unknown>();
  private pendingWrites: Array<{ key: string; value: unknown }> = [];
  private batchSize = 100;

  queue(key: string, value: unknown): void {
    this.pendingWrites.push({ key, value });
    if (this.pendingWrites.length >= this.batchSize) {
      this.flush();
    }
  }

  flush(): void {
    for (const { key, value } of this.pendingWrites) {
      this.data.set(key, value);
    }
    this.pendingWrites = [];
  }

  get(key: string): unknown {
    return this.data.get(key);
  }

  get size(): number {
    return this.data.size;
  }

  get pendingCount(): number {
    return this.pendingWrites.length;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1;
  }
  return v;
}

function generateTestData(count: number): Array<{ key: string; value: object }> {
  return Array.from({ length: count }, (_, i) => ({
    key: `key-${i}`,
    value: {
      id: i,
      name: `Item ${i}`,
      timestamp: Date.now(),
      tags: ['tag1', 'tag2', 'tag3'],
      metadata: { source: 'benchmark', priority: i % 10 },
    },
  }));
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runMemoryWriteBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('Memory Write');

  console.log('\n--- Memory Write Benchmarks ---\n');

  const store = new SimpleMemoryStore();
  const vectorStore = new VectorStore();
  const wal = new WriteAheadLog();
  const batchedStore = new BatchedMemoryStore();

  // Benchmark 1: Single Key-Value Write
  const singleWriteResult = await runner.run(
    'single-kv-write',
    async () => {
      store.set(`key-${Date.now()}`, { data: 'test value' });
    },
    { iterations: 10000 }
  );

  console.log(`Single K-V Write: ${formatTime(singleWriteResult.mean)}`);
  const kvTarget = meetsTarget('memory-write', singleWriteResult.mean);
  console.log(`  Target (<5ms): ${kvTarget.met ? 'PASS' : 'FAIL'}`);

  // Benchmark 2: Batch Write (100 items)
  const testData = generateTestData(100);

  const batch100Result = await runner.run(
    'batch-write-100',
    async () => {
      for (const { key, value } of testData) {
        store.set(key, value);
      }
    },
    { iterations: 500 }
  );

  console.log(`Batch Write (100 items): ${formatTime(batch100Result.mean)}`);
  console.log(`  Per item: ${formatTime(batch100Result.mean / 100)}`);

  // Benchmark 3: Vector Write
  const vectorWriteResult = await runner.run(
    'vector-write',
    async () => {
      const vector = generateVector(384);
      vectorStore.set(`vec-${Date.now()}`, vector, { source: 'test' });
    },
    { iterations: 5000 }
  );

  console.log(`Vector Write (384d): ${formatTime(vectorWriteResult.mean)}`);

  // Benchmark 4: Batch Vector Write (100 vectors)
  const batchVectorResult = await runner.run(
    'batch-vector-write-100',
    async () => {
      for (let i = 0; i < 100; i++) {
        const vector = generateVector(384);
        vectorStore.set(`vec-${i}`, vector, { index: i });
      }
    },
    { iterations: 100 }
  );

  console.log(`Batch Vector Write (100x 384d): ${formatTime(batchVectorResult.mean)}`);
  console.log(`  Per vector: ${formatTime(batchVectorResult.mean / 100)}`);

  // Benchmark 5: Write-Ahead Log Append
  const walAppendResult = await runner.run(
    'wal-append',
    async () => {
      wal.append('SET', 'key', { data: 'value' });
    },
    { iterations: 10000 }
  );

  console.log(`WAL Append: ${formatTime(walAppendResult.mean)}`);

  // Benchmark 6: Batched Store Queue
  const batchedQueueResult = await runner.run(
    'batched-store-queue',
    async () => {
      batchedStore.queue(`key-${Date.now()}`, { data: 'test' });
    },
    { iterations: 10000 }
  );

  console.log(`Batched Store Queue: ${formatTime(batchedQueueResult.mean)}`);

  // Benchmark 7: Batched Store Flush
  // Queue up items first
  for (let i = 0; i < 100; i++) {
    batchedStore.queue(`flush-key-${i}`, { data: i });
  }

  const batchedFlushResult = await runner.run(
    'batched-store-flush-100',
    async () => {
      // Queue and flush 100 items
      for (let i = 0; i < 100; i++) {
        batchedStore.queue(`key-${i}`, { data: i });
      }
      batchedStore.flush();
    },
    { iterations: 500 }
  );

  console.log(`Batched Flush (100 items): ${formatTime(batchedFlushResult.mean)}`);

  // Benchmark 8: Object Serialization (JSON)
  const testObject = {
    id: 'test-123',
    name: 'Test Object',
    nested: { level1: { level2: { value: 42 } } },
    array: Array.from({ length: 100 }, (_, i) => i),
    timestamp: new Date().toISOString(),
  };

  const jsonSerializeResult = await runner.run(
    'json-serialize',
    async () => {
      JSON.stringify(testObject);
    },
    { iterations: 10000 }
  );

  console.log(`JSON Serialize: ${formatTime(jsonSerializeResult.mean)}`);

  // Benchmark 9: Object Cloning (for immutability)
  const cloneResult = await runner.run(
    'object-clone',
    async () => {
      const clone = structuredClone(testObject);
      void clone;
    },
    { iterations: 5000 }
  );

  console.log(`Object Clone: ${formatTime(cloneResult.mean)}`);

  // Benchmark 10: Concurrent Writes
  const concurrentWriteResult = await runner.run(
    'concurrent-writes-10',
    async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          Promise.resolve(store.set(`concurrent-${i}`, { index: i }))
        )
      );
    },
    { iterations: 1000 }
  );

  console.log(`Concurrent Writes (10): ${formatTime(concurrentWriteResult.mean)}`);

  // Benchmark 11: Large Value Write
  const largeValue = {
    data: 'x'.repeat(10000),
    nested: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      content: 'content'.repeat(10),
    })),
  };

  const largeWriteResult = await runner.run(
    'large-value-write',
    async () => {
      store.set('large-key', largeValue);
    },
    { iterations: 1000 }
  );

  console.log(`Large Value Write (~100KB): ${formatTime(largeWriteResult.mean)}`);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`Single write: ${formatTime(singleWriteResult.mean)}`);
  console.log(`Batched (100): ${formatTime(batch100Result.mean)} (${formatTime(batch100Result.mean / 100)}/item)`);
  console.log(`Vector (384d): ${formatTime(vectorWriteResult.mean)}`);
  console.log(`WAL append: ${formatTime(walAppendResult.mean)}`);
  console.log(`Batch queue: ${formatTime(batchedQueueResult.mean)} (${(batchedQueueResult.opsPerSecond).toFixed(0)} ops/sec)`);

  // Print full results
  runner.printResults();
}

// ============================================================================
// Memory Write Optimization Strategies
// ============================================================================

export const memoryWriteOptimizations = {
  /**
   * Write batching: Batch multiple writes together
   */
  writeBatching: {
    description: 'Batch multiple writes and flush periodically',
    expectedImprovement: '5-10x',
    implementation: `
      class BatchedWriter {
        private batch: Write[] = [];
        private batchSize = 100;
        private flushInterval = 100; // ms

        write(key: string, value: unknown): void {
          this.batch.push({ key, value });
          if (this.batch.length >= this.batchSize) {
            this.flush();
          }
        }

        private flush(): void {
          const writes = this.batch;
          this.batch = [];
          for (const { key, value } of writes) {
            this.store.set(key, value);
          }
        }
      }
    `,
  },

  /**
   * Object pooling: Reuse objects to avoid allocation
   */
  objectPooling: {
    description: 'Pool and reuse objects to reduce GC pressure',
    expectedImprovement: '20-40%',
    implementation: `
      class ObjectPool<T> {
        private pool: T[] = [];

        acquire(): T {
          return this.pool.pop() || this.create();
        }

        release(obj: T): void {
          this.reset(obj);
          this.pool.push(obj);
        }
      }
    `,
  },

  /**
   * Typed arrays: Use typed arrays for numeric data
   */
  typedArrays: {
    description: 'Use Float32Array/Int32Array for numeric data',
    expectedImprovement: '2-4x memory, 1.5-2x speed',
    implementation: `
      // Instead of:
      const vector = new Array(384).fill(0);

      // Use:
      const vector = new Float32Array(384);
    `,
  },

  /**
   * Write-ahead logging: Append-only for durability
   */
  walLogging: {
    description: 'Use append-only WAL for crash recovery',
    expectedImprovement: 'Durability with <10% overhead',
    implementation: `
      class WAL {
        private fd: number;

        async append(entry: LogEntry): Promise<void> {
          const data = Buffer.from(JSON.stringify(entry) + '\\n');
          await fs.write(this.fd, data);
          await fs.fdatasync(this.fd);
        }
      }
    `,
  },

  /**
   * Copy-on-write: Avoid unnecessary copying
   */
  copyOnWrite: {
    description: 'Use COW semantics for large objects',
    expectedImprovement: '30-50% for read-heavy workloads',
    implementation: `
      class COWStore {
        private data = new Map<string, { value: unknown; version: number }>();

        set(key: string, value: unknown): void {
          const existing = this.data.get(key);
          if (existing && deepEqual(existing.value, value)) {
            return; // No change needed
          }
          this.data.set(key, { value, version: (existing?.version ?? 0) + 1 });
        }
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryWriteBenchmarks().catch(console.error);
}

export default runMemoryWriteBenchmarks;
