/**
 * Prime Radiant MCP Tool Types
 *
 * Type definitions for Prime Radiant mathematical AI tools.
 */

import { z } from 'zod';

// ============================================================================
// Common Types
// ============================================================================

export interface MCPToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  category?: string;
  tags?: string[];
  version?: string;
  cacheable?: boolean;
  cacheTTL?: number;
  handler: (input: Record<string, unknown>, context?: ToolContext) => Promise<MCPToolResult>;
}

// ============================================================================
// Tool Context
// ============================================================================

export interface ToolContext {
  bridge?: PrimeRadiantBridge;
  config?: PrimeRadiantConfig;
  logger?: Logger;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface PrimeRadiantConfig {
  coherence: {
    warnThreshold: number;
    rejectThreshold: number;
    cacheEnabled: boolean;
    cacheTTL: number;
  };
  spectral: {
    stabilityThreshold: number;
    maxMatrixSize: number;
  };
  causal: {
    maxBackdoorPaths: number;
    confidenceThreshold: number;
  };
}

// ============================================================================
// WASM Bridge Interface
// ============================================================================

export interface PrimeRadiantBridge {
  initialized: boolean;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  checkCoherence(vectors: Float32Array[]): Promise<CoherenceResult>;
  analyzeSpectral(adjacencyMatrix: Float32Array, size: number): Promise<SpectralResult>;
  inferCausal(graph: CausalGraph, intervention: string, outcome: string): Promise<CausalResult>;
  computeTopology(complex: SimplicialComplex): Promise<TopologyResult>;
}

// ============================================================================
// Coherence Types
// ============================================================================

export const CoherenceInputSchema = z.object({
  vectors: z.array(z.array(z.number())).min(1).describe('Array of embedding vectors to check for coherence'),
  threshold: z.number().min(0).max(1).default(0.3).describe('Energy threshold for coherence (0-1)'),
});

export type CoherenceInput = z.infer<typeof CoherenceInputSchema>;

export interface CoherenceResult {
  coherent: boolean;
  energy: number;        // 0 = fully coherent, 1 = contradictory
  violations: string[];
  confidence: number;
}

export interface CoherenceOutput {
  energy: number;
  isCoherent: boolean;
  details: {
    violations: string[];
    confidence: number;
    interpretation: string;
    vectorCount: number;
    threshold: number;
  };
}

// ============================================================================
// Spectral Types
// ============================================================================

export const SpectralInputSchema = z.object({
  matrix: z.array(z.array(z.number())).min(1).describe('Adjacency matrix representing connections'),
  analyzeType: z.enum(['stability', 'clustering', 'connectivity']).default('stability'),
});

export type SpectralInput = z.infer<typeof SpectralInputSchema>;

export interface SpectralResult {
  stable: boolean;
  eigenvalues: number[];
  spectralGap: number;
  stabilityIndex: number;
}

export interface SpectralOutput {
  spectralGap: number;
  eigenvalues: number[];
  stable: boolean;
  details: {
    stabilityIndex: number;
    interpretation: string;
    matrixSize: number;
    analyzeType: string;
  };
}

// ============================================================================
// Causal Types
// ============================================================================

export const CausalGraphSchema = z.object({
  nodes: z.array(z.string()).min(1).describe('List of variable names'),
  edges: z.array(z.tuple([z.string(), z.string()])).describe('Directed edges as [from, to] pairs'),
});

export type CausalGraph = z.infer<typeof CausalGraphSchema>;

export const CausalInputSchema = z.object({
  graph: CausalGraphSchema.describe('Causal graph with nodes and edges'),
  intervention: z.string().describe('Treatment/intervention variable'),
  outcome: z.string().describe('Outcome variable to measure effect on'),
});

export type CausalInput = z.infer<typeof CausalInputSchema>;

export interface CausalResult {
  effect: number;
  confounders: string[];
  interventionValid: boolean;
  backdoorPaths: string[][];
  confidence: number;
}

export interface CausalOutput {
  effect: number;
  confidence: number;
  backdoorPaths: string[];
  details: {
    confounders: string[];
    interventionValid: boolean;
    interpretation: string;
    nodeCount: number;
    edgeCount: number;
  };
}

// ============================================================================
// Consensus Types
// ============================================================================

export const AgentStateSchema = z.object({
  agentId: z.string().describe('Unique agent identifier'),
  embedding: z.array(z.number()).describe('Agent state embedding vector'),
  vote: z.string().optional().describe('Agent vote or decision'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional agent metadata'),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

export const ConsensusInputSchema = z.object({
  agentStates: z.array(AgentStateSchema).min(1).describe('Array of agent states to verify consensus'),
  threshold: z.number().min(0).max(1).default(0.8).describe('Required agreement threshold (0-1)'),
});

export type ConsensusInput = z.infer<typeof ConsensusInputSchema>;

export interface ConsensusOutput {
  verified: boolean;
  coherenceScore: number;
  divergentAgents: string[];
  details: {
    agreementRatio: number;
    coherenceEnergy: number;
    spectralStability: boolean;
    spectralGap: number;
    interpretation: string;
    agentCount: number;
  };
}

// ============================================================================
// Topology Types
// ============================================================================

export const SimplexSchema = z.object({
  vertices: z.array(z.number()).describe('Vertex indices forming the simplex'),
  dimension: z.number().int().min(0).describe('Dimension of the simplex'),
});

export type Simplex = z.infer<typeof SimplexSchema>;

export const SimplicialComplexSchema = z.object({
  vertices: z.array(z.array(z.number())).describe('Vertex coordinates'),
  simplices: z.array(SimplexSchema).optional().describe('Explicit simplices (if not provided, computed from vertices)'),
  maxDimension: z.number().int().min(0).max(3).default(2).describe('Maximum homology dimension to compute'),
});

export type SimplicialComplex = z.infer<typeof SimplicialComplexSchema>;

export const TopologyInputSchema = z.object({
  complex: SimplicialComplexSchema.describe('Simplicial complex for topological analysis'),
});

export type TopologyInput = z.infer<typeof TopologyInputSchema>;

export interface TopologyResult {
  bettiNumbers: number[];
  persistenceDiagram: [number, number][];
  homologyClasses: number;
}

export interface TopologyOutput {
  bettiNumbers: number[];
  persistenceDiagram: {
    birth: number;
    death: number;
    dimension: number;
  }[];
  details: {
    homologyClasses: number;
    interpretation: {
      b0: string;
      b1: string;
      b2: string;
    };
    vertexCount: number;
    maxDimension: number;
  };
}

// ============================================================================
// Memory Gate Types
// ============================================================================

export const MemoryGateInputSchema = z.object({
  key: z.string().describe('Memory entry key'),
  value: z.unknown().describe('Value to be stored'),
  existingVectors: z.array(z.array(z.number())).optional().describe('Existing context embeddings'),
  thresholds: z.object({
    reject: z.number().min(0).max(1).default(0.7),
    warn: z.number().min(0).max(1).default(0.3),
  }).optional().describe('Custom coherence thresholds'),
});

export type MemoryGateInput = z.infer<typeof MemoryGateInputSchema>;

export interface MemoryGateOutput {
  allowed: boolean;
  coherenceEnergy: number;
  reason?: string;
  details: {
    action: 'allow' | 'warn' | 'reject';
    violations: string[];
    confidence: number;
    interpretation: string;
    contextSize: number;
  };
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerformanceMetrics {
  operationName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  inputSize?: number;
  error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a successful MCP tool result
 */
export function successResult(data: unknown): MCPToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

/**
 * Create an error MCP tool result
 */
export function errorResult(error: Error | string): MCPToolResult {
  const message = error instanceof Error ? error.message : error;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: true,
        message,
        timestamp: new Date().toISOString(),
      }, null, 2),
    }],
    isError: true,
  };
}

/**
 * Track performance metrics
 */
export function trackPerformance<T>(
  operationName: string,
  operation: () => T | Promise<T>,
): Promise<{ result: T; metrics: PerformanceMetrics }> {
  const startTime = performance.now();

  return Promise.resolve()
    .then(() => operation())
    .then((result) => {
      const endTime = performance.now();
      return {
        result,
        metrics: {
          operationName,
          startTime,
          endTime,
          duration: endTime - startTime,
          success: true,
        },
      };
    })
    .catch((error) => {
      const endTime = performance.now();
      throw {
        error,
        metrics: {
          operationName,
          startTime,
          endTime,
          duration: endTime - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    });
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
