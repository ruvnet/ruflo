/**
 * RuVector PostgreSQL Bridge - Attention Mechanisms Example
 *
 * This example demonstrates:
 * - Multi-head attention for vector aggregation
 * - Flash attention for long sequences
 * - Sparse attention for efficiency
 * - Cross-attention for multi-modal scenarios
 *
 * Run with: npx ts-node examples/ruvector/attention-patterns.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/attention-patterns
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
  type AttentionConfig,
  type AttentionInput,
} from '../../src/integrations/ruvector/index.js';

import {
  MultiHeadAttention,
  SelfAttention,
  CrossAttention,
  CausalAttention,
  AttentionRegistry,
  type AttentionOptions,
} from '../../src/integrations/ruvector/attention.js';

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
  embedDim: 512,
  numHeads: 8,
  headDim: 64,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate random vectors for demonstration.
 */
function generateRandomVectors(count: number, dim: number): number[][] {
  return Array.from({ length: count }, () =>
    Array.from({ length: dim }, () => Math.random() * 2 - 1)
  );
}

/**
 * Measure execution time of an async function.
 */
async function measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  console.log(`   ${name}: ${duration.toFixed(2)}ms`);
  return result;
}

/**
 * Print vector statistics.
 */
function printVectorStats(name: string, vec: number[]): void {
  const min = Math.min(...vec);
  const max = Math.max(...vec);
  const mean = vec.reduce((a, b) => a + b, 0) / vec.length;
  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));

  console.log(`   ${name}:`);
  console.log(`     Dimension: ${vec.length}`);
  console.log(`     Range: [${min.toFixed(4)}, ${max.toFixed(4)}]`);
  console.log(`     Mean: ${mean.toFixed(4)}`);
  console.log(`     Magnitude: ${magnitude.toFixed(4)}`);
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Attention Mechanisms Example');
  console.log('==========================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
  });

  // Initialize attention registry
  const registry = new AttentionRegistry();

  // Register attention mechanisms
  registry.register(new MultiHeadAttention({ numHeads: config.numHeads, headDim: config.headDim }));
  registry.register(new SelfAttention({ headDim: config.headDim }));
  registry.register(new CrossAttention({ numHeads: config.numHeads, headDim: config.headDim }));
  registry.register(new CausalAttention({ numHeads: config.numHeads, headDim: config.headDim }));

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Multi-Head Attention Example
    // ========================================================================
    console.log('1. Multi-Head Attention');
    console.log('   ' + '-'.repeat(40));
    console.log('   Parallel attention heads for capturing different relationships\n');

    const multiHeadAttn = registry.get('multi_head');
    console.log(`   Configuration:`);
    console.log(`     - Heads: ${config.numHeads}`);
    console.log(`     - Head dimension: ${config.headDim}`);
    console.log(`     - Total dimension: ${config.numHeads * config.headDim}\n`);

    // Generate sample data
    const sequenceLength = 32;
    const queries = generateRandomVectors(sequenceLength, config.headDim);
    const keys = generateRandomVectors(sequenceLength, config.headDim);
    const values = generateRandomVectors(sequenceLength, config.headDim);

    // Compute attention for a single query
    const singleOutput = await measure('Single query attention', async () => {
      return multiHeadAttn.compute(queries[0], keys, values);
    });
    printVectorStats('Output vector', singleOutput);

    // Batch computation
    const batchOutput = await measure('Batch attention (32 queries)', async () => {
      return multiHeadAttn.computeBatch(queries, keys, values);
    });
    console.log(`   Batch output shape: [${batchOutput.length}, ${batchOutput[0].length}]\n`);

    // ========================================================================
    // 2. Self-Attention Example
    // ========================================================================
    console.log('2. Self-Attention');
    console.log('   ' + '-'.repeat(40));
    console.log('   Attention where Q, K, V come from the same sequence\n');

    const selfAttn = registry.get('self_attention');

    // Create a sequence where each token attends to all others
    const selfSequence = generateRandomVectors(16, config.headDim);

    // Self-attention: query = key = value = same sequence
    const selfOutput = await measure('Self-attention (16 tokens)', async () => {
      return selfAttn.computeBatch(selfSequence, selfSequence, selfSequence);
    });

    console.log(`   Input sequence: [${selfSequence.length}, ${selfSequence[0].length}]`);
    console.log(`   Output sequence: [${selfOutput.length}, ${selfOutput[0].length}]`);

    // Show attention pattern (which tokens attend to which)
    console.log('\n   Attention pattern visualization (simplified):');
    const attentionPattern = selfSequence.map((q, i) => {
      const scores = selfSequence.map(k =>
        q.reduce((sum, val, j) => sum + val * k[j], 0)
      );
      const maxIdx = scores.indexOf(Math.max(...scores));
      return maxIdx;
    });
    console.log(`   Token -> Most attended: [${attentionPattern.join(', ')}]\n`);

    // ========================================================================
    // 3. Cross-Attention Example (Encoder-Decoder)
    // ========================================================================
    console.log('3. Cross-Attention (Encoder-Decoder)');
    console.log('   ' + '-'.repeat(40));
    console.log('   Decoder attends to encoder outputs\n');

    const crossAttn = registry.get('cross_attention');

    // Simulate encoder output (e.g., from processing an image or source text)
    const encoderOutput = generateRandomVectors(64, config.headDim);

    // Simulate decoder queries (e.g., generating target text)
    const decoderQueries = generateRandomVectors(16, config.headDim);

    const crossOutput = await measure('Cross-attention (16 decoder queries, 64 encoder outputs)', async () => {
      return crossAttn.computeBatch(decoderQueries, encoderOutput, encoderOutput);
    });

    console.log(`   Encoder sequence: [${encoderOutput.length}, ${encoderOutput[0].length}]`);
    console.log(`   Decoder queries: [${decoderQueries.length}, ${decoderQueries[0].length}]`);
    console.log(`   Cross-attention output: [${crossOutput.length}, ${crossOutput[0].length}]\n`);

    // ========================================================================
    // 4. Causal (Masked) Attention Example
    // ========================================================================
    console.log('4. Causal (Masked) Attention');
    console.log('   ' + '-'.repeat(40));
    console.log('   Autoregressive attention - each position only sees previous positions\n');

    const causalAttn = registry.get('causal');

    // Simulate autoregressive generation
    const autoregSequence = generateRandomVectors(8, config.headDim);

    const causalOutput = await measure('Causal attention (8 tokens)', async () => {
      return causalAttn.computeBatch(autoregSequence, autoregSequence, autoregSequence);
    });

    console.log('   Causal mask pattern (1 = attend, 0 = masked):');
    for (let i = 0; i < 8; i++) {
      const mask = Array.from({ length: 8 }, (_, j) => (j <= i ? '1' : '0')).join(' ');
      console.log(`     Token ${i}: [${mask}]`);
    }
    console.log();

    // ========================================================================
    // 5. Flash Attention Simulation
    // ========================================================================
    console.log('5. Flash Attention (Memory-Efficient)');
    console.log('   ' + '-'.repeat(40));
    console.log('   Tiled computation for long sequences with O(N) memory\n');

    // Flash attention uses tiling to reduce memory usage
    // Here we simulate the performance characteristics

    const longSequenceLengths = [128, 256, 512, 1024];

    console.log('   Sequence length | Standard Attention | Flash Attention (simulated)');
    console.log('   ' + '-'.repeat(65));

    for (const seqLen of longSequenceLengths) {
      // Standard attention: O(N^2) memory
      const standardMemory = seqLen * seqLen * 4; // float32

      // Flash attention: O(N) memory with tiling
      const blockSize = 64;
      const flashMemory = 2 * blockSize * seqLen * 4;

      const memoryRatio = (standardMemory / flashMemory).toFixed(1);

      console.log(
        `   ${seqLen.toString().padStart(6)} tokens  | ` +
        `${(standardMemory / 1024).toFixed(0).padStart(10)} KB        | ` +
        `${(flashMemory / 1024).toFixed(0).padStart(10)} KB (${memoryRatio}x less)`
      );
    }
    console.log();

    // ========================================================================
    // 6. Sparse Attention Patterns
    // ========================================================================
    console.log('6. Sparse Attention Patterns');
    console.log('   ' + '-'.repeat(40));
    console.log('   Reduce computation by attending to subset of tokens\n');

    // Demonstrate different sparse patterns
    const sparsePatterns = {
      local: 'Each token attends to k nearest neighbors',
      strided: 'Attend every n-th token for global context',
      global: 'Special tokens attend to all, others attend locally',
      random: 'Random subset of tokens (BigBird style)',
    };

    console.log('   Common sparse attention patterns:');
    Object.entries(sparsePatterns).forEach(([name, desc]) => {
      console.log(`     - ${name}: ${desc}`);
    });

    // Compute complexity comparison
    const N = 1024; // sequence length
    const k = 64;   // local window
    const s = 16;   // stride

    console.log(`\n   Complexity comparison (N=${N}, k=${k}, s=${s}):`);
    console.log(`     - Full attention: O(N^2) = ${N * N} ops`);
    console.log(`     - Local attention: O(N*k) = ${N * k} ops (${((N * k) / (N * N) * 100).toFixed(1)}%)`);
    console.log(`     - Strided attention: O(N*N/s) = ${Math.floor(N * N / s)} ops (${(100 / s).toFixed(1)}%)`);
    console.log(`     - Local + Strided: O(N*(k+N/s)) = ${N * (k + N / s)} ops`);
    console.log();

    // ========================================================================
    // 7. Attention with KV Cache
    // ========================================================================
    console.log('7. Attention with KV Cache (Inference Optimization)');
    console.log('   ' + '-'.repeat(40));
    console.log('   Cache key-value pairs for autoregressive generation\n');

    // Simulate KV cache for incremental generation
    interface KVCache {
      keys: number[][];
      values: number[][];
    }

    const kvCache: KVCache = { keys: [], values: [] };

    // Simulate generating 8 tokens one by one
    console.log('   Simulating autoregressive generation with KV cache:');

    const tokenDim = config.headDim;
    let totalWithoutCache = 0;
    let totalWithCache = 0;

    for (let step = 0; step < 8; step++) {
      // New token embedding
      const newToken = generateRandomVectors(1, tokenDim)[0];

      // Without cache: recompute all K, V
      const withoutCacheOps = (step + 1) * (step + 1) * tokenDim;
      totalWithoutCache += withoutCacheOps;

      // With cache: only compute for new token
      const withCacheOps = (step + 1) * tokenDim;
      totalWithCache += withCacheOps;

      // Update cache
      kvCache.keys.push(newToken);
      kvCache.values.push(newToken);

      console.log(
        `     Step ${step + 1}: Without cache ${withoutCacheOps.toLocaleString()} ops, ` +
        `With cache ${withCacheOps.toLocaleString()} ops ` +
        `(${((1 - withCacheOps / withoutCacheOps) * 100).toFixed(1)}% reduction)`
      );
    }

    console.log(`\n   Total: Without cache ${totalWithoutCache.toLocaleString()} ops, ` +
                `With cache ${totalWithCache.toLocaleString()} ops`);
    console.log(`   Overall speedup: ${(totalWithoutCache / totalWithCache).toFixed(1)}x\n`);

    // ========================================================================
    // 8. SQL Generation for PostgreSQL
    // ========================================================================
    console.log('8. SQL Generation for PostgreSQL Execution');
    console.log('   ' + '-'.repeat(40));
    console.log('   Generate SQL for executing attention in PostgreSQL\n');

    const input: AttentionInput = {
      query: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      key: new Float32Array([0.5, 0.6, 0.7, 0.8]),
      value: new Float32Array([0.9, 1.0, 1.1, 1.2]),
    };

    // Multi-head attention SQL
    const multiHeadSQL = multiHeadAttn.toSQL(input);
    console.log('   Multi-Head Attention SQL:');
    console.log(`   ${multiHeadSQL}\n`);

    // Self-attention SQL
    const selfSQL = selfAttn.toSQL(input);
    console.log('   Self-Attention SQL:');
    console.log(`   ${selfSQL}\n`);

    // Causal attention SQL
    const causalSQL = causalAttn.toSQL(input);
    console.log('   Causal Attention SQL:');
    console.log(`   ${causalSQL}\n`);

    // ========================================================================
    // 9. Available Attention Mechanisms
    // ========================================================================
    console.log('9. Available Attention Mechanisms');
    console.log('   ' + '-'.repeat(40));

    const available = registry.getAllWithMetadata();
    console.log(`   Registered: ${available.length} mechanisms\n`);

    available.forEach(mech => {
      console.log(`   ${mech.name} (${mech.type})`);
      console.log(`     Category: ${mech.category}`);
      console.log(`     ${mech.description}\n`);
    });

    // ========================================================================
    // Done
    // ========================================================================
    console.log('='.repeat(60));
    console.log('Attention mechanisms example completed!');
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
