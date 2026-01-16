/**
 * RuVector PostgreSQL Bridge - Streaming Large Data Example
 *
 * This example demonstrates:
 * - Streaming millions of vectors efficiently
 * - Processing with backpressure handling
 * - Monitoring progress and throughput
 * - Memory-efficient batch processing
 *
 * Run with: npx ts-node examples/ruvector/streaming-large-data.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/streaming-large-data
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
  type VectorRecord,
} from '../../src/integrations/ruvector/index.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'vectors',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  dimensions: 128,
  // Adjust these for your machine's resources
  totalVectors: 100000,    // Total vectors to process
  batchSize: 1000,         // Vectors per batch
  maxConcurrentBatches: 5, // Max batches in flight
};

// ============================================================================
// Progress Tracking
// ============================================================================

interface ProgressStats {
  totalProcessed: number;
  totalErrors: number;
  startTime: number;
  lastBatchTime: number;
  batchDurations: number[];
  memoryUsage: number[];
}

class ProgressTracker {
  private stats: ProgressStats;
  private totalTarget: number;
  private lastPrintTime: number = 0;

  constructor(totalTarget: number) {
    this.totalTarget = totalTarget;
    this.stats = {
      totalProcessed: 0,
      totalErrors: 0,
      startTime: Date.now(),
      lastBatchTime: Date.now(),
      batchDurations: [],
      memoryUsage: [],
    };
  }

  recordBatch(count: number, durationMs: number, errors: number = 0): void {
    this.stats.totalProcessed += count;
    this.stats.totalErrors += errors;
    this.stats.batchDurations.push(durationMs);
    this.stats.lastBatchTime = Date.now();

    // Track memory usage
    const memUsage = process.memoryUsage();
    this.stats.memoryUsage.push(memUsage.heapUsed);
  }

  getProgress(): number {
    return this.stats.totalProcessed / this.totalTarget;
  }

  getElapsedMs(): number {
    return Date.now() - this.stats.startTime;
  }

  getThroughput(): number {
    const elapsedSec = this.getElapsedMs() / 1000;
    return elapsedSec > 0 ? this.stats.totalProcessed / elapsedSec : 0;
  }

  getAverageBatchDuration(): number {
    if (this.stats.batchDurations.length === 0) return 0;
    return this.stats.batchDurations.reduce((a, b) => a + b, 0) / this.stats.batchDurations.length;
  }

  getMemoryUsageMB(): number {
    const memUsage = process.memoryUsage();
    return memUsage.heapUsed / (1024 * 1024);
  }

  getETA(): number {
    const throughput = this.getThroughput();
    if (throughput <= 0) return Infinity;
    const remaining = this.totalTarget - this.stats.totalProcessed;
    return remaining / throughput;
  }

  print(): void {
    const now = Date.now();
    // Throttle printing to every 2 seconds
    if (now - this.lastPrintTime < 2000 && this.stats.totalProcessed < this.totalTarget) {
      return;
    }
    this.lastPrintTime = now;

    const progress = (this.getProgress() * 100).toFixed(1);
    const throughput = this.getThroughput().toFixed(0);
    const eta = this.getETA();
    const etaStr = eta === Infinity ? 'N/A' : `${eta.toFixed(0)}s`;
    const memory = this.getMemoryUsageMB().toFixed(1);
    const avgBatch = this.getAverageBatchDuration().toFixed(1);

    const bar = this.createProgressBar(this.getProgress(), 30);

    console.log(
      `   ${bar} ${progress}% | ` +
      `${this.stats.totalProcessed.toLocaleString()}/${this.totalTarget.toLocaleString()} | ` +
      `${throughput} vec/s | ` +
      `ETA: ${etaStr} | ` +
      `Mem: ${memory}MB | ` +
      `Errors: ${this.stats.totalErrors}`
    );
  }

  private createProgressBar(progress: number, width: number): string {
    const filled = Math.floor(progress * width);
    const empty = width - filled;
    return '[' + '='.repeat(filled) + '>'.slice(0, empty > 0 ? 1 : 0) + ' '.repeat(Math.max(0, empty - 1)) + ']';
  }

  getSummary(): {
    totalProcessed: number;
    totalErrors: number;
    durationMs: number;
    throughput: number;
    avgBatchDuration: number;
    peakMemoryMB: number;
  } {
    return {
      totalProcessed: this.stats.totalProcessed,
      totalErrors: this.stats.totalErrors,
      durationMs: this.getElapsedMs(),
      throughput: this.getThroughput(),
      avgBatchDuration: this.getAverageBatchDuration(),
      peakMemoryMB: Math.max(...this.stats.memoryUsage) / (1024 * 1024),
    };
  }
}

// ============================================================================
// Vector Generator (Simulated Data Source)
// ============================================================================

/**
 * Async generator that produces vectors in batches.
 * In production, this could read from files, APIs, or databases.
 */
async function* vectorGenerator(
  total: number,
  batchSize: number,
  dimensions: number
): AsyncGenerator<VectorRecord[], void, unknown> {
  let generated = 0;

  while (generated < total) {
    const currentBatchSize = Math.min(batchSize, total - generated);
    const batch: VectorRecord[] = [];

    for (let i = 0; i < currentBatchSize; i++) {
      const id = `vec_${generated + i}`;

      // Generate random normalized vector
      const embedding = new Array(dimensions);
      let sumSq = 0;
      for (let d = 0; d < dimensions; d++) {
        embedding[d] = Math.random() * 2 - 1;
        sumSq += embedding[d] * embedding[d];
      }
      const magnitude = Math.sqrt(sumSq);
      for (let d = 0; d < dimensions; d++) {
        embedding[d] /= magnitude;
      }

      batch.push({
        id,
        embedding,
        metadata: {
          batchIndex: Math.floor(generated / batchSize),
          itemIndex: i,
          timestamp: new Date().toISOString(),
        },
      });
    }

    generated += currentBatchSize;

    // Simulate some async delay (e.g., network latency, file I/O)
    await new Promise(resolve => setTimeout(resolve, 1));

    yield batch;
  }
}

// ============================================================================
// Backpressure Handler
// ============================================================================

/**
 * Semaphore for controlling concurrency with backpressure.
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }

  get availablePermits(): number {
    return this.permits;
  }
}

// ============================================================================
// Streaming Processor
// ============================================================================

interface ProcessorConfig {
  bridge: RuVectorBridge;
  collectionName: string;
  batchSize: number;
  maxConcurrency: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, batch: VectorRecord[]) => void;
}

/**
 * Process streaming data with backpressure and concurrency control.
 */
async function processStream(
  generator: AsyncGenerator<VectorRecord[], void, unknown>,
  config: ProcessorConfig,
  tracker: ProgressTracker
): Promise<void> {
  const semaphore = new Semaphore(config.maxConcurrency);
  const pendingBatches: Promise<void>[] = [];

  for await (const batch of generator) {
    // Apply backpressure - wait if too many batches in flight
    await semaphore.acquire();

    const batchPromise = (async () => {
      const startTime = performance.now();
      let errors = 0;

      try {
        // Insert batch
        await config.bridge.insertBatch(config.collectionName, batch);
      } catch (error) {
        errors = batch.length;
        config.onError?.(error as Error, batch);
      } finally {
        const duration = performance.now() - startTime;
        tracker.recordBatch(batch.length, duration, errors);
        tracker.print();
        semaphore.release();
      }
    })();

    pendingBatches.push(batchPromise);

    // Periodically clean up resolved promises
    if (pendingBatches.length > config.maxConcurrency * 2) {
      await Promise.all(pendingBatches.splice(0, pendingBatches.length));
    }
  }

  // Wait for all remaining batches
  await Promise.all(pendingBatches);
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Streaming Large Data Example');
  console.log('============================================================\n');

  console.log('Configuration:');
  console.log(`  Total vectors: ${config.totalVectors.toLocaleString()}`);
  console.log(`  Batch size: ${config.batchSize.toLocaleString()}`);
  console.log(`  Max concurrent batches: ${config.maxConcurrentBatches}`);
  console.log(`  Vector dimensions: ${config.dimensions}`);
  console.log();

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
    poolSize: config.maxConcurrentBatches + 2,
  });

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Create Collection
    // ========================================================================
    console.log('1. Creating collection...');

    await bridge.createCollection('large_dataset', {
      dimensions: config.dimensions,
      distanceMetric: 'cosine',
      indexType: 'hnsw',
      indexParams: {
        m: 16,
        efConstruction: 64,
      },
    });
    console.log('   Collection created\n');

    // ========================================================================
    // 2. Stream and Insert Data
    // ========================================================================
    console.log('2. Streaming and inserting vectors...');
    console.log('   ' + '-'.repeat(70));

    const tracker = new ProgressTracker(config.totalVectors);
    const generator = vectorGenerator(config.totalVectors, config.batchSize, config.dimensions);

    const errorLog: Array<{ error: Error; batchSize: number }> = [];

    await processStream(generator, {
      bridge,
      collectionName: 'large_dataset',
      batchSize: config.batchSize,
      maxConcurrency: config.maxConcurrentBatches,
      onError: (error, batch) => {
        errorLog.push({ error, batchSize: batch.length });
      },
    }, tracker);

    // Final progress update
    tracker.print();
    console.log();

    // ========================================================================
    // 3. Summary Statistics
    // ========================================================================
    console.log('3. Processing Summary');
    console.log('   ' + '-'.repeat(50));

    const summary = tracker.getSummary();
    console.log(`   Total processed: ${summary.totalProcessed.toLocaleString()} vectors`);
    console.log(`   Total errors: ${summary.totalErrors}`);
    console.log(`   Duration: ${(summary.durationMs / 1000).toFixed(2)} seconds`);
    console.log(`   Throughput: ${summary.throughput.toFixed(0)} vectors/second`);
    console.log(`   Avg batch duration: ${summary.avgBatchDuration.toFixed(2)}ms`);
    console.log(`   Peak memory: ${summary.peakMemoryMB.toFixed(2)} MB`);

    if (errorLog.length > 0) {
      console.log(`\n   Errors encountered: ${errorLog.length}`);
      errorLog.slice(0, 3).forEach((e, i) => {
        console.log(`     ${i + 1}. ${e.error.message} (batch size: ${e.batchSize})`);
      });
    }
    console.log();

    // ========================================================================
    // 4. Verify Data
    // ========================================================================
    console.log('4. Verifying inserted data...');
    console.log('   ' + '-'.repeat(50));

    const stats = await bridge.getCollectionStats('large_dataset');
    console.log(`   Collection stats:`);
    console.log(`     Vector count: ${stats.vectorCount.toLocaleString()}`);
    console.log(`     Dimensions: ${stats.dimensions}`);
    console.log(`     Index type: ${stats.indexType}`);
    console.log(`     Index size: ${(stats.indexSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log();

    // ========================================================================
    // 5. Test Search Performance
    // ========================================================================
    console.log('5. Testing search performance...');
    console.log('   ' + '-'.repeat(50));

    // Generate random query vector
    const queryVector = Array.from({ length: config.dimensions }, () => Math.random() * 2 - 1);
    const magnitude = Math.sqrt(queryVector.reduce((s, v) => s + v * v, 0));
    queryVector.forEach((_, i) => queryVector[i] /= magnitude);

    // Warm up
    await bridge.search('large_dataset', queryVector, { k: 10 });

    // Benchmark
    const searchIterations = 100;
    const searchTimes: number[] = [];

    for (let i = 0; i < searchIterations; i++) {
      const start = performance.now();
      await bridge.search('large_dataset', queryVector, { k: 10 });
      searchTimes.push(performance.now() - start);
    }

    searchTimes.sort((a, b) => a - b);
    const avgSearch = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
    const p50 = searchTimes[Math.floor(searchTimes.length * 0.5)];
    const p95 = searchTimes[Math.floor(searchTimes.length * 0.95)];
    const p99 = searchTimes[Math.floor(searchTimes.length * 0.99)];

    console.log(`   Search performance (${searchIterations} iterations, k=10):`);
    console.log(`     Average: ${avgSearch.toFixed(2)}ms`);
    console.log(`     P50: ${p50.toFixed(2)}ms`);
    console.log(`     P95: ${p95.toFixed(2)}ms`);
    console.log(`     P99: ${p99.toFixed(2)}ms`);
    console.log(`     QPS: ${(1000 / avgSearch).toFixed(0)}`);
    console.log();

    // ========================================================================
    // 6. Streaming Read (Export)
    // ========================================================================
    console.log('6. Streaming read (simulated export)...');
    console.log('   ' + '-'.repeat(50));

    // In production, you would use COPY or cursors for efficient streaming
    const exportBatchSize = 10000;
    let exportedCount = 0;
    const exportStart = performance.now();

    // Simulate streaming export using offset/limit pagination
    // Note: For production, use database cursors for better performance
    const sampleIds = await bridge.search('large_dataset', queryVector, {
      k: Math.min(50000, config.totalVectors),
      includeMetadata: false,
    });

    exportedCount = sampleIds.length;
    const exportDuration = performance.now() - exportStart;

    console.log(`   Exported ${exportedCount.toLocaleString()} vectors in ${exportDuration.toFixed(2)}ms`);
    console.log(`   Export throughput: ${(exportedCount / (exportDuration / 1000)).toFixed(0)} vectors/second`);
    console.log();

    // ========================================================================
    // 7. Cleanup
    // ========================================================================
    console.log('7. Cleanup (optional)...');
    console.log('   ' + '-'.repeat(50));

    // Uncomment to drop the collection
    // await bridge.dropCollection('large_dataset');
    // console.log('   Collection dropped');

    console.log('   Skipping collection drop (uncomment to enable)');

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('Streaming large data example completed!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

main().catch(console.error);
