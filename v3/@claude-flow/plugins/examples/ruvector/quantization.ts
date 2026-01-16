/**
 * RuVector PostgreSQL Bridge - Quantization Example
 *
 * This example demonstrates:
 * - Comparing different quantization methods
 * - Measuring recall vs compression trade-offs
 * - Production configuration recommendations
 * - Memory optimization strategies
 *
 * Run with: npx ts-node examples/ruvector/quantization.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/quantization
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
  dimensions: 768,      // Typical embedding dimension
  testVectors: 10000,   // Number of test vectors
  queryVectors: 100,    // Number of query vectors
  k: 10,               // Top-k for recall calculation
};

// ============================================================================
// Quantization Types
// ============================================================================

type QuantizationMethod = 'none' | 'int8' | 'int4' | 'binary' | 'pq';

interface QuantizationConfig {
  method: QuantizationMethod;
  name: string;
  bitsPerComponent: number;
  description: string;
}

const quantizationMethods: QuantizationConfig[] = [
  {
    method: 'none',
    name: 'Float32 (No Quantization)',
    bitsPerComponent: 32,
    description: 'Full precision floating point',
  },
  {
    method: 'int8',
    name: 'Int8 Scalar Quantization',
    bitsPerComponent: 8,
    description: '4x compression, ~99% recall',
  },
  {
    method: 'int4',
    name: 'Int4 Scalar Quantization',
    bitsPerComponent: 4,
    description: '8x compression, ~95% recall',
  },
  {
    method: 'binary',
    name: 'Binary Quantization',
    bitsPerComponent: 1,
    description: '32x compression, ~85% recall',
  },
  {
    method: 'pq',
    name: 'Product Quantization (PQ)',
    bitsPerComponent: 8, // per subvector
    description: 'Adaptive compression, good for high dimensions',
  },
];

// ============================================================================
// Quantization Implementation
// ============================================================================

/**
 * Scalar quantization to Int8.
 */
function quantizeInt8(vector: number[]): { quantized: Int8Array; scale: number; offset: number } {
  const min = Math.min(...vector);
  const max = Math.max(...vector);
  const scale = (max - min) / 255;
  const offset = min;

  const quantized = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    quantized[i] = Math.round((vector[i] - offset) / scale) - 128;
  }

  return { quantized, scale, offset };
}

/**
 * Dequantize Int8 back to float.
 */
function dequantizeInt8(data: { quantized: Int8Array; scale: number; offset: number }): number[] {
  const result = new Array(data.quantized.length);
  for (let i = 0; i < data.quantized.length; i++) {
    result[i] = (data.quantized[i] + 128) * data.scale + data.offset;
  }
  return result;
}

/**
 * Scalar quantization to Int4 (packed).
 */
function quantizeInt4(vector: number[]): { quantized: Uint8Array; scale: number; offset: number } {
  const min = Math.min(...vector);
  const max = Math.max(...vector);
  const scale = (max - min) / 15;
  const offset = min;

  // Pack two Int4 values into one byte
  const packedLength = Math.ceil(vector.length / 2);
  const quantized = new Uint8Array(packedLength);

  for (let i = 0; i < vector.length; i += 2) {
    const v1 = Math.round((vector[i] - offset) / scale) & 0x0F;
    const v2 = i + 1 < vector.length
      ? Math.round((vector[i + 1] - offset) / scale) & 0x0F
      : 0;
    quantized[i / 2] = (v1 << 4) | v2;
  }

  return { quantized, scale, offset };
}

/**
 * Dequantize Int4 back to float.
 */
function dequantizeInt4(
  data: { quantized: Uint8Array; scale: number; offset: number },
  originalLength: number
): number[] {
  const result = new Array(originalLength);

  for (let i = 0; i < originalLength; i += 2) {
    const packed = data.quantized[i / 2];
    result[i] = ((packed >> 4) & 0x0F) * data.scale + data.offset;
    if (i + 1 < originalLength) {
      result[i + 1] = (packed & 0x0F) * data.scale + data.offset;
    }
  }

  return result;
}

/**
 * Binary quantization (sign bit only).
 */
function quantizeBinary(vector: number[]): Uint8Array {
  const packedLength = Math.ceil(vector.length / 8);
  const quantized = new Uint8Array(packedLength);

  for (let i = 0; i < vector.length; i++) {
    if (vector[i] >= 0) {
      quantized[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }

  return quantized;
}

/**
 * Compute Hamming distance for binary vectors.
 */
function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    // Count differing bits
    let xor = a[i] ^ b[i];
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Product Quantization (simplified).
 */
class ProductQuantizer {
  private numSubvectors: number;
  private subvectorDim: number;
  private codebooks: number[][][]; // [subvector][centroid][dimension]
  private numCentroids: number = 256;

  constructor(dimension: number, numSubvectors: number = 8) {
    this.numSubvectors = numSubvectors;
    this.subvectorDim = Math.ceil(dimension / numSubvectors);
    this.codebooks = [];

    // Initialize random codebooks (in production, train on data)
    for (let m = 0; m < numSubvectors; m++) {
      const codebook: number[][] = [];
      for (let c = 0; c < this.numCentroids; c++) {
        const centroid = Array.from(
          { length: this.subvectorDim },
          () => Math.random() * 2 - 1
        );
        codebook.push(centroid);
      }
      this.codebooks.push(codebook);
    }
  }

  encode(vector: number[]): Uint8Array {
    const codes = new Uint8Array(this.numSubvectors);

    for (let m = 0; m < this.numSubvectors; m++) {
      const start = m * this.subvectorDim;
      const end = Math.min(start + this.subvectorDim, vector.length);
      const subvector = vector.slice(start, end);

      // Pad if necessary
      while (subvector.length < this.subvectorDim) {
        subvector.push(0);
      }

      // Find nearest centroid
      let minDist = Infinity;
      let minIdx = 0;

      for (let c = 0; c < this.numCentroids; c++) {
        const dist = this.euclideanDistance(subvector, this.codebooks[m][c]);
        if (dist < minDist) {
          minDist = dist;
          minIdx = c;
        }
      }

      codes[m] = minIdx;
    }

    return codes;
  }

  decode(codes: Uint8Array): number[] {
    const result: number[] = [];

    for (let m = 0; m < this.numSubvectors; m++) {
      const centroid = this.codebooks[m][codes[m]];
      result.push(...centroid);
    }

    return result.slice(0, this.numSubvectors * this.subvectorDim);
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }
}

// ============================================================================
// Evaluation Functions
// ============================================================================

/**
 * Compute cosine similarity.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Generate random normalized vectors.
 */
function generateVectors(count: number, dim: number): number[][] {
  const vectors: number[][] = [];
  for (let i = 0; i < count; i++) {
    const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    vectors.push(vec.map(v => v / mag));
  }
  return vectors;
}

/**
 * Find ground truth top-k by exact search.
 */
function exactTopK(query: number[], vectors: number[][], k: number): number[] {
  const distances = vectors.map((v, i) => ({
    index: i,
    similarity: cosineSimilarity(query, v),
  }));
  distances.sort((a, b) => b.similarity - a.similarity);
  return distances.slice(0, k).map(d => d.index);
}

/**
 * Calculate recall@k.
 */
function calculateRecall(groundTruth: number[], predicted: number[]): number {
  const gtSet = new Set(groundTruth);
  const overlap = predicted.filter(p => gtSet.has(p)).length;
  return overlap / groundTruth.length;
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Quantization Example');
  console.log('===================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
  });

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Generate Test Data
    // ========================================================================
    console.log('1. Generating test data...');
    console.log('   ' + '-'.repeat(50));

    const vectors = generateVectors(config.testVectors, config.dimensions);
    const queries = generateVectors(config.queryVectors, config.dimensions);

    console.log(`   Generated ${config.testVectors.toLocaleString()} test vectors`);
    console.log(`   Generated ${config.queryVectors} query vectors`);
    console.log(`   Dimensions: ${config.dimensions}`);
    console.log();

    // ========================================================================
    // 2. Compute Ground Truth
    // ========================================================================
    console.log('2. Computing ground truth (exact search)...');
    console.log('   ' + '-'.repeat(50));

    const startGT = performance.now();
    const groundTruths = queries.map(q => exactTopK(q, vectors, config.k));
    const gtTime = performance.now() - startGT;

    console.log(`   Ground truth computed in ${gtTime.toFixed(2)}ms`);
    console.log(`   Average time per query: ${(gtTime / config.queryVectors).toFixed(2)}ms`);
    console.log();

    // ========================================================================
    // 3. Compare Quantization Methods
    // ========================================================================
    console.log('3. Comparing Quantization Methods');
    console.log('   ' + '-'.repeat(70));
    console.log('   Method                        | Compression | Recall@10 | Query Time | Mem/Vector');
    console.log('   ' + '-'.repeat(70));

    const results: Array<{
      method: string;
      compression: number;
      recall: number;
      queryTimeMs: number;
      bytesPerVector: number;
    }> = [];

    // Test each quantization method
    for (const qConfig of quantizationMethods) {
      let quantizedVectors: any[];
      let queryFn: (query: number[], vectors: any[], k: number) => number[];
      let bytesPerVector: number;

      switch (qConfig.method) {
        case 'none':
          quantizedVectors = vectors;
          queryFn = (q, vecs, k) => exactTopK(q, vecs, k);
          bytesPerVector = config.dimensions * 4;
          break;

        case 'int8':
          quantizedVectors = vectors.map(v => ({
            original: v,
            ...quantizeInt8(v),
          }));
          queryFn = (q, vecs, k) => {
            const queryQ = quantizeInt8(q);
            const distances = vecs.map((v: any, i: number) => ({
              index: i,
              similarity: cosineSimilarity(
                dequantizeInt8({ quantized: v.quantized, scale: v.scale, offset: v.offset }),
                dequantizeInt8(queryQ)
              ),
            }));
            distances.sort((a: any, b: any) => b.similarity - a.similarity);
            return distances.slice(0, k).map((d: any) => d.index);
          };
          bytesPerVector = config.dimensions * 1 + 8; // quantized + scale + offset
          break;

        case 'int4':
          quantizedVectors = vectors.map(v => ({
            original: v,
            ...quantizeInt4(v),
            originalLength: v.length,
          }));
          queryFn = (q, vecs, k) => {
            const queryQ = quantizeInt4(q);
            const distances = vecs.map((v: any, i: number) => ({
              index: i,
              similarity: cosineSimilarity(
                dequantizeInt4(
                  { quantized: v.quantized, scale: v.scale, offset: v.offset },
                  v.originalLength
                ),
                dequantizeInt4(queryQ, q.length)
              ),
            }));
            distances.sort((a: any, b: any) => b.similarity - a.similarity);
            return distances.slice(0, k).map((d: any) => d.index);
          };
          bytesPerVector = Math.ceil(config.dimensions / 2) + 8;
          break;

        case 'binary':
          quantizedVectors = vectors.map(v => ({
            original: v,
            binary: quantizeBinary(v),
          }));
          queryFn = (q, vecs, k) => {
            const queryB = quantizeBinary(q);
            const distances = vecs.map((v: any, i: number) => ({
              index: i,
              // Lower Hamming distance = more similar
              distance: hammingDistance(v.binary, queryB),
            }));
            distances.sort((a: any, b: any) => a.distance - b.distance);
            return distances.slice(0, k).map((d: any) => d.index);
          };
          bytesPerVector = Math.ceil(config.dimensions / 8);
          break;

        case 'pq':
          const pq = new ProductQuantizer(config.dimensions, 8);
          quantizedVectors = vectors.map(v => ({
            original: v,
            codes: pq.encode(v),
            pq,
          }));
          queryFn = (q, vecs, k) => {
            const distances = vecs.map((v: any, i: number) => ({
              index: i,
              similarity: cosineSimilarity(v.pq.decode(v.codes), q),
            }));
            distances.sort((a: any, b: any) => b.similarity - a.similarity);
            return distances.slice(0, k).map((d: any) => d.index);
          };
          bytesPerVector = 8; // 8 subvectors, 1 byte each
          break;

        default:
          continue;
      }

      // Measure recall and query time
      const recalls: number[] = [];
      const startQuery = performance.now();

      for (let i = 0; i < queries.length; i++) {
        const predicted = queryFn(queries[i], quantizedVectors, config.k);
        recalls.push(calculateRecall(groundTruths[i], predicted));
      }

      const queryTime = (performance.now() - startQuery) / queries.length;
      const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length;
      const compression = (config.dimensions * 4) / bytesPerVector;

      results.push({
        method: qConfig.name,
        compression,
        recall: avgRecall,
        queryTimeMs: queryTime,
        bytesPerVector,
      });

      console.log(
        `   ${qConfig.name.padEnd(30)} | ` +
        `${compression.toFixed(1).padStart(6)}x    | ` +
        `${(avgRecall * 100).toFixed(1).padStart(6)}%   | ` +
        `${queryTime.toFixed(2).padStart(8)}ms | ` +
        `${bytesPerVector.toString().padStart(5)} B`
      );
    }
    console.log();

    // ========================================================================
    // 4. Memory Savings Analysis
    // ========================================================================
    console.log('4. Memory Savings Analysis');
    console.log('   ' + '-'.repeat(50));

    const baseMemory = config.testVectors * config.dimensions * 4 / (1024 * 1024);
    console.log(`   Base memory (Float32): ${baseMemory.toFixed(2)} MB`);

    console.log('\n   Memory usage by method:');
    results.forEach(r => {
      const memory = config.testVectors * r.bytesPerVector / (1024 * 1024);
      const savings = ((baseMemory - memory) / baseMemory * 100);
      console.log(
        `     ${r.method.padEnd(30)}: ${memory.toFixed(2).padStart(6)} MB ` +
        `(${savings.toFixed(1)}% reduction)`
      );
    });
    console.log();

    // ========================================================================
    // 5. Recall vs Compression Trade-off
    // ========================================================================
    console.log('5. Recall vs Compression Trade-off');
    console.log('   ' + '-'.repeat(50));

    console.log('   Visual representation (Compression -> Recall):');
    console.log();

    results.forEach(r => {
      const compressionBar = '='.repeat(Math.floor(r.compression * 2));
      const recallBar = '*'.repeat(Math.floor(r.recall * 50));
      console.log(`   ${r.method.slice(0, 20).padEnd(20)}`);
      console.log(`     Compression: ${compressionBar} ${r.compression.toFixed(1)}x`);
      console.log(`     Recall:      ${recallBar} ${(r.recall * 100).toFixed(1)}%`);
      console.log();
    });

    // ========================================================================
    // 6. Production Recommendations
    // ========================================================================
    console.log('6. Production Recommendations');
    console.log('   ' + '-'.repeat(50));

    console.log('\n   Use Case Recommendations:');

    console.log('\n   High Accuracy (recall > 99%):');
    console.log('     - Method: Int8 Scalar Quantization');
    console.log('     - Compression: 4x');
    console.log('     - Best for: RAG, semantic search, recommendations');

    console.log('\n   Balanced (recall > 95%):');
    console.log('     - Method: Int4 Scalar Quantization');
    console.log('     - Compression: 8x');
    console.log('     - Best for: Large-scale similarity search');

    console.log('\n   Maximum Compression (recall > 85%):');
    console.log('     - Method: Binary Quantization');
    console.log('     - Compression: 32x');
    console.log('     - Best for: Candidate generation, first-pass filtering');

    console.log('\n   High-Dimensional Data:');
    console.log('     - Method: Product Quantization (PQ)');
    console.log('     - Compression: Variable (8-64x typical)');
    console.log('     - Best for: Embeddings > 512 dimensions');

    // ========================================================================
    // 7. PostgreSQL Integration Notes
    // ========================================================================
    console.log('\n7. PostgreSQL Integration Notes');
    console.log('   ' + '-'.repeat(50));

    console.log('\n   pgvector supports:');
    console.log('     - halfvec (Float16): 2x compression, ~99.9% recall');
    console.log('     - sparsevec: For sparse vectors');
    console.log('     - HNSW with quantization: Index-level compression');

    console.log('\n   Example SQL for halfvec:');
    console.log('     CREATE TABLE items (');
    console.log('       id bigserial PRIMARY KEY,');
    console.log('       embedding halfvec(768)  -- Float16 storage');
    console.log('     );');

    console.log('\n   Example SQL for quantized index:');
    console.log('     CREATE INDEX ON items USING hnsw (');
    console.log('       (embedding::halfvec(768)) halfvec_l2_ops');
    console.log('     );');

    // ========================================================================
    // 8. Store Quantized Vectors (Demo)
    // ========================================================================
    console.log('\n8. Storing Vectors with Different Precisions');
    console.log('   ' + '-'.repeat(50));

    // Create collections for different precisions
    const collections = ['vectors_float32', 'vectors_int8_sim'];

    for (const collection of collections) {
      await bridge.createCollection(collection, {
        dimensions: config.dimensions,
        distanceMetric: 'cosine',
        indexType: 'hnsw',
      });
    }

    // Insert sample vectors
    const sampleSize = 1000;
    console.log(`\n   Inserting ${sampleSize} vectors to each collection...`);

    // Float32 (original)
    const float32Start = performance.now();
    for (let i = 0; i < sampleSize; i++) {
      await bridge.insert('vectors_float32', {
        id: `float32_${i}`,
        embedding: vectors[i],
        metadata: { precision: 'float32' },
      });
    }
    const float32Time = performance.now() - float32Start;

    // Simulated Int8 (stored as float but simulating quantization overhead)
    const int8Start = performance.now();
    for (let i = 0; i < sampleSize; i++) {
      const q = quantizeInt8(vectors[i]);
      const dequantized = dequantizeInt8(q);
      await bridge.insert('vectors_int8_sim', {
        id: `int8_${i}`,
        embedding: dequantized,
        metadata: { precision: 'int8_simulated', scale: q.scale, offset: q.offset },
      });
    }
    const int8Time = performance.now() - int8Start;

    console.log(`   Float32 insert time: ${float32Time.toFixed(2)}ms`);
    console.log(`   Int8 (simulated) insert time: ${int8Time.toFixed(2)}ms`);

    // Compare search results
    const testQuery = queries[0];
    const float32Results = await bridge.search('vectors_float32', testQuery, {
      k: 10,
      includeDistance: true,
    });

    const int8Results = await bridge.search('vectors_int8_sim', testQuery, {
      k: 10,
      includeDistance: true,
    });

    console.log('\n   Search result comparison (first 5):');
    console.log('   Float32 IDs:   ' + float32Results.slice(0, 5).map(r => r.id).join(', '));
    console.log('   Int8 (sim) IDs: ' + int8Results.slice(0, 5).map(r => r.id.replace('int8', 'float32')).join(', '));

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(55));
    console.log('Quantization example completed!');
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
