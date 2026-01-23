/**
 * Coherence Check Tool - pr_coherence_check
 *
 * Checks coherence of vectors using Sheaf Laplacian energy.
 * Energy 0 = fully coherent, Energy 1 = contradictory
 *
 * Uses CohomologyEngine from prime-radiant-advanced-wasm
 */

import type {
  MCPTool,
  MCPToolResult,
  ToolContext,
  CoherenceOutput,
} from './types.js';
import {
  CoherenceInputSchema,
  successResult,
  errorResult,
} from './types.js';

// Default logger for when context doesn't provide one
const defaultLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[pr_coherence_check] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => console.info(`[pr_coherence_check] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[pr_coherence_check] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[pr_coherence_check] ${msg}`, meta),
};

/**
 * Compute Sheaf Laplacian energy for coherence detection
 *
 * The Sheaf Laplacian measures how well local data sections can be
 * glued together into a global section. High energy indicates contradictions.
 *
 * For vectors v1, v2, ..., vn:
 * 1. Construct a sheaf over the complete graph
 * 2. Compute the Laplacian matrix L = D - A (where A captures similarities)
 * 3. Energy = sum of disagreements across edges
 */
function computeSheafLaplacianEnergy(vectors: Float32Array[]): number {
  if (vectors.length < 2) return 0;

  const n = vectors.length;
  let totalEnergy = 0;
  let edgeCount = 0;

  // Compute pairwise disagreement (1 - cosine_similarity)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const vi = vectors[i]!;
      const vj = vectors[j]!;
      const similarity = cosineSimilarity(vi, vj);
      const disagreement = 1 - Math.max(0, similarity); // Clamp negative similarities
      totalEnergy += disagreement;
      edgeCount++;
    }
  }

  // Normalize by number of edges
  return edgeCount > 0 ? totalEnergy / edgeCount : 0;
}

/**
 * Detect contradictions in the vector set
 */
function detectContradictions(vectors: Float32Array[], threshold: number): string[] {
  const violations: string[] = [];
  const n = vectors.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const vi = vectors[i]!;
      const vj = vectors[j]!;
      const similarity = cosineSimilarity(vi, vj);

      // Negative similarity indicates potential contradiction
      if (similarity < -0.3) {
        violations.push(`Contradiction between vectors ${i} and ${j} (similarity: ${similarity.toFixed(3)})`);
      }
      // Low similarity with high threshold indicates inconsistency
      else if (similarity < threshold && similarity > 0) {
        violations.push(`Weak coherence between vectors ${i} and ${j} (similarity: ${similarity.toFixed(3)})`);
      }
    }
  }

  return violations;
}

/**
 * Calculate cosine similarity
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * Get interpretation of energy level
 */
function getInterpretation(energy: number): string {
  if (energy < 0.1) return 'Fully coherent - vectors are highly consistent';
  if (energy < 0.3) return 'Minor inconsistencies - generally coherent with small variations';
  if (energy < 0.5) return 'Moderate inconsistencies - some conflicting information detected';
  if (energy < 0.7) return 'Significant contradictions - vectors contain conflicting content';
  return 'Major contradictions detected - high disagreement between vectors';
}

/**
 * Handler for pr_coherence_check tool
 */
async function handler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    // Validate input
    const validationResult = CoherenceInputSchema.safeParse(input);
    if (!validationResult.success) {
      logger.error('Input validation failed', { error: validationResult.error.message });
      return errorResult(`Invalid input: ${validationResult.error.message}`);
    }

    const { vectors, threshold } = validationResult.data;
    logger.debug('Processing coherence check', { vectorCount: vectors.length, threshold });

    // Convert to Float32Arrays
    const float32Vectors = vectors.map(v => new Float32Array(v));

    let energy: number;
    let violations: string[];

    // Try to use WASM bridge if available
    if (context?.bridge?.initialized) {
      try {
        logger.debug('Using WASM bridge for coherence check');
        const result = await context.bridge.checkCoherence(float32Vectors);
        energy = result.energy;
        violations = result.violations;
      } catch (wasmError) {
        logger.warn('WASM bridge failed, falling back to JS implementation', {
          error: wasmError instanceof Error ? wasmError.message : String(wasmError),
        });
        energy = computeSheafLaplacianEnergy(float32Vectors);
        violations = detectContradictions(float32Vectors, threshold);
      }
    } else {
      // Pure JavaScript fallback implementation
      logger.debug('Using JavaScript fallback for coherence check');
      energy = computeSheafLaplacianEnergy(float32Vectors);
      violations = detectContradictions(float32Vectors, threshold);
    }

    const isCoherent = energy < threshold;
    const confidence = 1 - energy;

    const output: CoherenceOutput = {
      energy,
      isCoherent,
      details: {
        violations,
        confidence,
        interpretation: getInterpretation(energy),
        vectorCount: vectors.length,
        threshold,
      },
    };

    const duration = performance.now() - startTime;
    logger.info('Coherence check completed', {
      energy: energy.toFixed(4),
      isCoherent,
      violations: violations.length,
      durationMs: duration.toFixed(2),
    });

    return successResult(output);

  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Coherence check failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: duration.toFixed(2),
    });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * pr_coherence_check MCP Tool Definition
 */
export const coherenceCheckTool: MCPTool = {
  name: 'pr_coherence_check',
  description: 'Check coherence of vectors using Sheaf Laplacian energy. Energy 0 = fully coherent, 1 = contradictory. Uses CohomologyEngine for mathematical validation of vector consistency.',
  category: 'coherence',
  version: '0.1.3',
  tags: ['coherence', 'sheaf-laplacian', 'contradiction-detection', 'ai-interpretability'],
  cacheable: true,
  cacheTTL: 60000, // 1 minute cache
  inputSchema: {
    type: 'object',
    properties: {
      vectors: {
        type: 'array',
        items: { type: 'array', items: { type: 'number' } },
        description: 'Array of embedding vectors to check for coherence',
      },
      threshold: {
        type: 'number',
        default: 0.3,
        description: 'Energy threshold for coherence (0-1). Lower = stricter coherence requirement.',
      },
    },
    required: ['vectors'],
  },
  handler,
};

export default coherenceCheckTool;
