/**
 * RuVector PostgreSQL Bridge - Transactions Example
 *
 * This example demonstrates:
 * - Multi-vector atomic updates using transactions
 * - Savepoint usage for partial rollbacks
 * - Error recovery strategies
 * - Batch operations within transactions
 *
 * Run with: npx ts-node examples/ruvector/transactions.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/transactions
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
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a random normalized embedding.
 */
function generateEmbedding(dim: number): number[] {
  const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / mag);
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Transaction Wrapper Types
// ============================================================================

interface TransactionContext {
  id: string;
  startTime: number;
  operations: Array<{
    type: string;
    target: string;
    success: boolean;
    duration: number;
  }>;
}

interface TransactionResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  context: TransactionContext;
}

// ============================================================================
// Transaction Manager
// ============================================================================

/**
 * Transaction manager for atomic vector operations.
 * Note: This is a simulation - in production, use PostgreSQL's native transactions.
 */
class VectorTransactionManager {
  private bridge: RuVectorBridge;
  private activeTransactions: Map<string, TransactionContext> = new Map();
  private savepointStack: Map<string, Array<{ name: string; snapshot: Map<string, VectorRecord> }>> = new Map();

  constructor(bridge: RuVectorBridge) {
    this.bridge = bridge;
  }

  /**
   * Begin a new transaction.
   */
  async begin(): Promise<TransactionContext> {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const context: TransactionContext = {
      id: txId,
      startTime: Date.now(),
      operations: [],
    };

    this.activeTransactions.set(txId, context);
    this.savepointStack.set(txId, []);

    console.log(`   [TX ${txId.slice(0, 12)}] Transaction started`);
    return context;
  }

  /**
   * Create a savepoint within the transaction.
   */
  async savepoint(context: TransactionContext, name: string, collection: string): Promise<void> {
    const stack = this.savepointStack.get(context.id);
    if (!stack) throw new Error('Transaction not found');

    // Capture current state (simplified - in production, PostgreSQL handles this)
    const snapshot = new Map<string, VectorRecord>();

    // This is a simulation - in production, use SAVEPOINT SQL command
    stack.push({ name, snapshot });

    console.log(`   [TX ${context.id.slice(0, 12)}] Savepoint '${name}' created`);
  }

  /**
   * Rollback to a savepoint.
   */
  async rollbackToSavepoint(context: TransactionContext, name: string): Promise<void> {
    const stack = this.savepointStack.get(context.id);
    if (!stack) throw new Error('Transaction not found');

    // Find and remove savepoints up to and including the named one
    let found = false;
    while (stack.length > 0) {
      const sp = stack.pop()!;
      if (sp.name === name) {
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error(`Savepoint '${name}' not found`);
    }

    console.log(`   [TX ${context.id.slice(0, 12)}] Rolled back to savepoint '${name}'`);
  }

  /**
   * Commit the transaction.
   */
  async commit(context: TransactionContext): Promise<void> {
    const duration = Date.now() - context.startTime;
    const successOps = context.operations.filter(op => op.success).length;

    this.activeTransactions.delete(context.id);
    this.savepointStack.delete(context.id);

    console.log(
      `   [TX ${context.id.slice(0, 12)}] Committed ` +
      `(${successOps}/${context.operations.length} ops, ${duration}ms)`
    );
  }

  /**
   * Rollback the transaction.
   */
  async rollback(context: TransactionContext, reason?: string): Promise<void> {
    const duration = Date.now() - context.startTime;

    this.activeTransactions.delete(context.id);
    this.savepointStack.delete(context.id);

    console.log(
      `   [TX ${context.id.slice(0, 12)}] Rolled back ` +
      `(${reason || 'explicit rollback'}, ${duration}ms)`
    );
  }

  /**
   * Execute an operation within the transaction.
   */
  async execute<T>(
    context: TransactionContext,
    operationType: string,
    target: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now();
    let success = false;

    try {
      const result = await operation();
      success = true;
      return result;
    } catch (error) {
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      context.operations.push({
        type: operationType,
        target,
        success,
        duration,
      });
    }
  }

  /**
   * Run a transaction with automatic commit/rollback.
   */
  async run<T>(
    fn: (context: TransactionContext) => Promise<T>
  ): Promise<TransactionResult<T>> {
    const context = await this.begin();

    try {
      const result = await fn(context);
      await this.commit(context);
      return { success: true, result, context };
    } catch (error) {
      await this.rollback(context, (error as Error).message);
      return { success: false, error: error as Error, context };
    }
  }
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Transactions Example');
  console.log('===================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
    poolSize: 5,
  });

  const txManager = new VectorTransactionManager(bridge);

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Create Test Collection
    // ========================================================================
    console.log('1. Creating test collection...');
    console.log('   ' + '-'.repeat(50));

    await bridge.createCollection('transactions_demo', {
      dimensions: config.dimensions,
      distanceMetric: 'cosine',
      indexType: 'hnsw',
    });
    console.log('   Collection created\n');

    // ========================================================================
    // 2. Simple Transaction - All or Nothing
    // ========================================================================
    console.log('2. Simple Transaction (All or Nothing)');
    console.log('   ' + '-'.repeat(50));

    const simpleResult = await txManager.run(async (ctx) => {
      // Insert multiple vectors atomically
      for (let i = 0; i < 5; i++) {
        await txManager.execute(ctx, 'INSERT', `doc_${i}`, async () => {
          await bridge.insert('transactions_demo', {
            id: `doc_${i}`,
            embedding: generateEmbedding(config.dimensions),
            metadata: { batch: 1, index: i },
          });
        });
      }

      return { inserted: 5 };
    });

    console.log(`   Result: ${simpleResult.success ? 'Committed' : 'Rolled back'}`);
    console.log(`   Inserted: ${simpleResult.result?.inserted || 0} vectors\n`);

    // ========================================================================
    // 3. Transaction with Error - Automatic Rollback
    // ========================================================================
    console.log('3. Transaction with Error (Automatic Rollback)');
    console.log('   ' + '-'.repeat(50));

    const errorResult = await txManager.run(async (ctx) => {
      // Insert some vectors
      for (let i = 5; i < 8; i++) {
        await txManager.execute(ctx, 'INSERT', `doc_${i}`, async () => {
          await bridge.insert('transactions_demo', {
            id: `doc_${i}`,
            embedding: generateEmbedding(config.dimensions),
            metadata: { batch: 2, index: i },
          });
        });
      }

      // Simulate an error
      throw new Error('Simulated processing error');
    });

    console.log(`   Result: ${errorResult.success ? 'Committed' : 'Rolled back'}`);
    console.log(`   Error: ${errorResult.error?.message}`);
    console.log(`   Operations attempted: ${errorResult.context.operations.length}\n`);

    // ========================================================================
    // 4. Transaction with Savepoints
    // ========================================================================
    console.log('4. Transaction with Savepoints');
    console.log('   ' + '-'.repeat(50));

    const savepointResult = await txManager.run(async (ctx) => {
      const results: string[] = [];

      // First batch
      for (let i = 10; i < 13; i++) {
        await txManager.execute(ctx, 'INSERT', `doc_${i}`, async () => {
          await bridge.insert('transactions_demo', {
            id: `doc_${i}`,
            embedding: generateEmbedding(config.dimensions),
            metadata: { batch: 3, index: i },
          });
        });
        results.push(`doc_${i}`);
      }

      // Create savepoint after first batch
      await txManager.savepoint(ctx, 'after_batch_1', 'transactions_demo');

      // Second batch (will be rolled back)
      try {
        for (let i = 13; i < 16; i++) {
          await txManager.execute(ctx, 'INSERT', `doc_${i}`, async () => {
            await bridge.insert('transactions_demo', {
              id: `doc_${i}`,
              embedding: generateEmbedding(config.dimensions),
              metadata: { batch: 3, index: i },
            });

            // Simulate error on specific index
            if (i === 14) {
              throw new Error('Error in second batch');
            }
          });
          results.push(`doc_${i}`);
        }
      } catch (error) {
        console.log(`   Error in second batch: ${(error as Error).message}`);
        await txManager.rollbackToSavepoint(ctx, 'after_batch_1');
      }

      // Third batch (after savepoint rollback)
      for (let i = 20; i < 22; i++) {
        await txManager.execute(ctx, 'INSERT', `doc_${i}`, async () => {
          await bridge.insert('transactions_demo', {
            id: `doc_${i}`,
            embedding: generateEmbedding(config.dimensions),
            metadata: { batch: 3, index: i, afterRollback: true },
          });
        });
        results.push(`doc_${i}`);
      }

      return { inserted: results };
    });

    console.log(`   Result: ${savepointResult.success ? 'Committed' : 'Rolled back'}`);
    console.log(`   Final inserted: ${savepointResult.result?.inserted?.join(', ')}\n`);

    // ========================================================================
    // 5. Batch Update Transaction
    // ========================================================================
    console.log('5. Batch Update Transaction');
    console.log('   ' + '-'.repeat(50));

    const updateResult = await txManager.run(async (ctx) => {
      let updated = 0;

      // Get existing documents
      const searchResults = await bridge.search(
        'transactions_demo',
        generateEmbedding(config.dimensions),
        { k: 5, includeMetadata: true }
      );

      // Update each document with new embedding
      for (const result of searchResults) {
        await txManager.execute(ctx, 'UPDATE', result.id, async () => {
          await bridge.update('transactions_demo', result.id, {
            embedding: generateEmbedding(config.dimensions),
            metadata: {
              ...result.metadata,
              updatedAt: new Date().toISOString(),
              version: ((result.metadata?.version as number) || 0) + 1,
            },
          });
        });
        updated++;
      }

      return { updated };
    });

    console.log(`   Result: ${updateResult.success ? 'Committed' : 'Rolled back'}`);
    console.log(`   Updated: ${updateResult.result?.updated || 0} vectors\n`);

    // ========================================================================
    // 6. Conditional Transaction
    // ========================================================================
    console.log('6. Conditional Transaction (with validation)');
    console.log('   ' + '-'.repeat(50));

    const conditionalResult = await txManager.run(async (ctx) => {
      // Check precondition
      const stats = await bridge.getCollectionStats('transactions_demo');
      console.log(`   Current vector count: ${stats.vectorCount}`);

      if (stats.vectorCount > 100) {
        throw new Error('Collection already has too many vectors');
      }

      // Proceed with inserts if validation passes
      for (let i = 30; i < 35; i++) {
        await txManager.execute(ctx, 'INSERT', `cond_${i}`, async () => {
          await bridge.insert('transactions_demo', {
            id: `cond_${i}`,
            embedding: generateEmbedding(config.dimensions),
            metadata: { batch: 'conditional', index: i },
          });
        });
      }

      return { inserted: 5 };
    });

    console.log(`   Result: ${conditionalResult.success ? 'Committed' : 'Rolled back'}`);
    if (conditionalResult.error) {
      console.log(`   Reason: ${conditionalResult.error.message}`);
    } else {
      console.log(`   Inserted: ${conditionalResult.result?.inserted || 0} vectors`);
    }
    console.log();

    // ========================================================================
    // 7. Retry with Exponential Backoff
    // ========================================================================
    console.log('7. Transaction with Retry (Exponential Backoff)');
    console.log('   ' + '-'.repeat(50));

    const maxRetries = 3;
    let retryCount = 0;
    let finalSuccess = false;

    while (retryCount < maxRetries && !finalSuccess) {
      const attemptResult = await txManager.run(async (ctx) => {
        // Simulate occasional failures
        const shouldFail = retryCount < 2 && Math.random() > 0.5;

        for (let i = 40; i < 42; i++) {
          await txManager.execute(ctx, 'INSERT', `retry_${i}`, async () => {
            if (shouldFail && i === 41) {
              throw new Error('Transient error');
            }

            await bridge.insert('transactions_demo', {
              id: `retry_${retryCount}_${i}`,
              embedding: generateEmbedding(config.dimensions),
              metadata: { batch: 'retry', attempt: retryCount },
            });
          });
        }

        return { inserted: 2 };
      });

      if (attemptResult.success) {
        finalSuccess = true;
        console.log(`   Success on attempt ${retryCount + 1}`);
      } else {
        retryCount++;
        if (retryCount < maxRetries) {
          const backoffMs = Math.pow(2, retryCount) * 100;
          console.log(`   Attempt ${retryCount} failed, retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
        }
      }
    }

    console.log(`   Final result: ${finalSuccess ? 'Success' : 'Failed after ' + maxRetries + ' attempts'}\n`);

    // ========================================================================
    // 8. Optimistic Locking Pattern
    // ========================================================================
    console.log('8. Optimistic Locking Pattern');
    console.log('   ' + '-'.repeat(50));

    // Insert a document with version
    await bridge.insert('transactions_demo', {
      id: 'optimistic_lock_test',
      embedding: generateEmbedding(config.dimensions),
      metadata: { version: 1, data: 'initial' },
    });

    const optimisticResult = await txManager.run(async (ctx) => {
      // Read current version
      const current = await bridge.get('transactions_demo', 'optimistic_lock_test');
      if (!current) throw new Error('Document not found');

      const currentVersion = (current.metadata?.version as number) || 0;
      console.log(`   Current version: ${currentVersion}`);

      // Simulate concurrent modification check
      // In production, use a WHERE clause with version check
      const expectedVersion = currentVersion;

      // Update with version increment
      await txManager.execute(ctx, 'UPDATE', 'optimistic_lock_test', async () => {
        // Verify version hasn't changed (optimistic lock check)
        const recheck = await bridge.get('transactions_demo', 'optimistic_lock_test');
        if ((recheck?.metadata?.version as number) !== expectedVersion) {
          throw new Error('Optimistic lock failed: version mismatch');
        }

        await bridge.update('transactions_demo', 'optimistic_lock_test', {
          embedding: generateEmbedding(config.dimensions),
          metadata: {
            version: expectedVersion + 1,
            data: 'updated',
            updatedAt: new Date().toISOString(),
          },
        });
      });

      return { newVersion: expectedVersion + 1 };
    });

    console.log(`   Result: ${optimisticResult.success ? 'Committed' : 'Rolled back'}`);
    if (optimisticResult.success) {
      console.log(`   New version: ${optimisticResult.result?.newVersion}`);
    }
    console.log();

    // ========================================================================
    // 9. Transaction Metrics
    // ========================================================================
    console.log('9. Transaction Summary Metrics');
    console.log('   ' + '-'.repeat(50));

    // Collect metrics from all transactions
    const stats = await bridge.getCollectionStats('transactions_demo');

    console.log(`   Final collection state:`);
    console.log(`     Total vectors: ${stats.vectorCount}`);
    console.log(`     Index type: ${stats.indexType}`);
    console.log(`     Index size: ${(stats.indexSizeBytes / 1024).toFixed(2)} KB`);
    console.log();

    // ========================================================================
    // 10. Cleanup
    // ========================================================================
    console.log('10. Cleanup');
    console.log('   ' + '-'.repeat(50));

    // Uncomment to drop the collection
    // await bridge.dropCollection('transactions_demo');
    // console.log('   Collection dropped');

    console.log('   Skipping collection drop (uncomment to enable)');

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(55));
    console.log('Transactions example completed!');
    console.log('='.repeat(55));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

main().catch(console.error);
