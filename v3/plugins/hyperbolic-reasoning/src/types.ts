/**
 * Hyperbolic Reasoning Plugin - Type Definitions
 *
 * Types for hyperbolic geometry operations including Poincare ball embeddings,
 * taxonomic reasoning, hierarchy comparison, and entailment graphs.
 */

import { z } from 'zod';

// ============================================================================
// Hyperbolic Geometry Types
// ============================================================================

/**
 * Point in hyperbolic space (Poincare ball model)
 */
export interface HyperbolicPoint {
  /** Coordinates in the Poincare ball (norm < 1) */
  readonly coordinates: Float32Array;
  /** Curvature parameter (negative) */
  readonly curvature: number;
  /** Dimension of the space */
  readonly dimension: number;
}

/**
 * Hyperbolic model type
 */
export type HyperbolicModel = 'poincare_ball' | 'lorentz' | 'klein' | 'half_plane';

/**
 * Mobius transformation parameters
 */
export interface MobiusTransform {
  /** Translation vector */
  readonly translation: Float32Array;
  /** Rotation matrix (flattened) */
  readonly rotation?: Float32Array;
  /** Scale factor */
  readonly scale: number;
}

// ============================================================================
// Hierarchy Types
// ============================================================================

/**
 * Node in a hierarchy
 */
export interface HierarchyNode {
  /** Unique node identifier */
  readonly id: string;
  /** Parent node ID (null for root) */
  readonly parent: string | null;
  /** Node features for embedding */
  readonly features?: Record<string, unknown>;
  /** Node label/name */
  readonly label?: string;
  /** Depth in tree (0 for root) */
  readonly depth?: number;
}

/**
 * Edge in a hierarchy (for DAGs)
 */
export interface HierarchyEdge {
  /** Source node ID */
  readonly source: string;
  /** Target node ID */
  readonly target: string;
  /** Edge weight */
  readonly weight?: number;
  /** Edge type */
  readonly type?: string;
}

/**
 * Complete hierarchy structure
 */
export interface Hierarchy {
  /** All nodes */
  readonly nodes: ReadonlyArray<HierarchyNode>;
  /** Optional edges (for DAGs) */
  readonly edges?: ReadonlyArray<HierarchyEdge>;
  /** Root node ID */
  readonly root?: string;
}

/**
 * Embedded hierarchy with hyperbolic coordinates
 */
export interface EmbeddedHierarchy {
  /** Node embeddings as id -> HyperbolicPoint */
  readonly embeddings: Map<string, HyperbolicPoint>;
  /** Model parameters */
  readonly model: HyperbolicModel;
  /** Learned or fixed curvature */
  readonly curvature: number;
  /** Embedding dimension */
  readonly dimension: number;
  /** Embedding quality metrics */
  readonly metrics: {
    readonly distortionMean: number;
    readonly distortionMax: number;
    readonly mapScore: number;
  };
}

// ============================================================================
// Taxonomic Reasoning Types
// ============================================================================

/**
 * Taxonomic query type
 */
export type TaxonomicQueryType =
  | 'is_a'
  | 'subsumption'
  | 'lowest_common_ancestor'
  | 'path'
  | 'similarity';

/**
 * Taxonomic query
 */
export interface TaxonomicQuery {
  /** Query type */
  readonly type: TaxonomicQueryType;
  /** Subject concept */
  readonly subject: string;
  /** Object concept (optional for some queries) */
  readonly object?: string;
}

/**
 * Inference configuration
 */
export interface InferenceConfig {
  /** Allow transitive reasoning */
  readonly transitive: boolean;
  /** Enable fuzzy matching */
  readonly fuzzy: boolean;
  /** Confidence threshold */
  readonly confidence: number;
}

/**
 * Taxonomic reasoning result
 */
export interface TaxonomicResult {
  /** Query result (boolean for is_a, etc.) */
  readonly result: boolean | string | string[] | number;
  /** Confidence in the result */
  readonly confidence: number;
  /** Explanation of reasoning path */
  readonly explanation: string;
  /** Intermediate steps if transitive */
  readonly steps?: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly relation: string;
    readonly confidence: number;
  }>;
}

// ============================================================================
// Semantic Search Types
// ============================================================================

/**
 * Search mode for hierarchical search
 */
export type SearchMode = 'nearest' | 'subtree' | 'ancestors' | 'siblings' | 'cone';

/**
 * Search constraints
 */
export interface SearchConstraints {
  /** Maximum depth from root */
  readonly maxDepth?: number;
  /** Minimum depth from root */
  readonly minDepth?: number;
  /** Restrict to subtree of this node */
  readonly subtreeRoot?: string;
  /** Filter by node type */
  readonly nodeTypes?: ReadonlyArray<string>;
}

/**
 * Search result item
 */
export interface SearchResultItem {
  /** Node ID */
  readonly id: string;
  /** Hyperbolic distance */
  readonly distance: number;
  /** Euclidean similarity (for comparison) */
  readonly similarity?: number;
  /** Node metadata */
  readonly metadata?: Record<string, unknown>;
  /** Path from root */
  readonly path?: ReadonlyArray<string>;
}

/**
 * Search result
 */
export interface SearchResult {
  /** Matching items */
  readonly items: ReadonlyArray<SearchResultItem>;
  /** Total candidates considered */
  readonly totalCandidates: number;
  /** Search time in ms */
  readonly searchTimeMs: number;
}

// ============================================================================
// Hierarchy Comparison Types
// ============================================================================

/**
 * Alignment method for comparing hierarchies
 */
export type AlignmentMethod =
  | 'wasserstein'
  | 'gromov_wasserstein'
  | 'tree_edit'
  | 'subtree_isomorphism';

/**
 * Comparison metric
 */
export type ComparisonMetric =
  | 'structural_similarity'
  | 'semantic_similarity'
  | 'coverage'
  | 'precision';

/**
 * Node alignment pair
 */
export interface NodeAlignment {
  /** Source node ID */
  readonly source: string;
  /** Target node ID */
  readonly target: string;
  /** Alignment confidence */
  readonly confidence: number;
}

/**
 * Hierarchy comparison result
 */
export interface ComparisonResult {
  /** Overall similarity score (0-1) */
  readonly similarity: number;
  /** Node alignments */
  readonly alignments: ReadonlyArray<NodeAlignment>;
  /** Metrics */
  readonly metrics: Record<ComparisonMetric, number>;
  /** Unmatched source nodes */
  readonly unmatchedSource: ReadonlyArray<string>;
  /** Unmatched target nodes */
  readonly unmatchedTarget: ReadonlyArray<string>;
  /** Edit operations for tree edit distance */
  readonly editOperations?: ReadonlyArray<{
    readonly type: 'insert' | 'delete' | 'rename' | 'move';
    readonly node: string;
    readonly cost: number;
  }>;
}

// ============================================================================
// Entailment Graph Types
// ============================================================================

/**
 * Concept for entailment graph
 */
export interface Concept {
  /** Unique concept ID */
  readonly id: string;
  /** Concept text/description */
  readonly text: string;
  /** Concept type/category */
  readonly type?: string;
  /** Pre-computed embedding */
  readonly embedding?: Float32Array;
}

/**
 * Entailment relation
 */
export interface EntailmentRelation {
  /** Premise concept ID */
  readonly premise: string;
  /** Hypothesis concept ID */
  readonly hypothesis: string;
  /** Entailment confidence */
  readonly confidence: number;
  /** Relation type */
  readonly type: 'entails' | 'contradicts' | 'neutral';
}

/**
 * Entailment graph action
 */
export type EntailmentAction = 'build' | 'query' | 'expand' | 'prune';

/**
 * Prune strategy
 */
export type PruneStrategy = 'none' | 'transitive_reduction' | 'confidence_threshold';

/**
 * Entailment graph
 */
export interface EntailmentGraph {
  /** All concepts */
  readonly concepts: ReadonlyArray<Concept>;
  /** Entailment relations */
  readonly relations: ReadonlyArray<EntailmentRelation>;
  /** Whether transitive closure is computed */
  readonly transitiveClosure: boolean;
  /** Graph statistics */
  readonly stats: {
    readonly nodeCount: number;
    readonly edgeCount: number;
    readonly density: number;
    readonly maxDepth: number;
  };
}

/**
 * Entailment query result
 */
export interface EntailmentQueryResult {
  /** Direct entailments */
  readonly direct: ReadonlyArray<EntailmentRelation>;
  /** Transitive entailments */
  readonly transitive?: ReadonlyArray<EntailmentRelation>;
  /** Contradiction paths */
  readonly contradictions?: ReadonlyArray<ReadonlyArray<string>>;
}

// ============================================================================
// Zod Schemas for MCP Tool Validation
// ============================================================================

export const HierarchyNodeSchema = z.object({
  id: z.string().max(200),
  parent: z.string().max(200).nullable(),
  features: z.record(z.string(), z.unknown()).optional(),
  label: z.string().max(500).optional(),
  depth: z.number().int().min(0).optional(),
});

export const HierarchyEdgeSchema = z.object({
  source: z.string().max(200),
  target: z.string().max(200),
  weight: z.number().finite().optional(),
  type: z.string().max(100).optional(),
});

export const HierarchySchema = z.object({
  nodes: z.array(HierarchyNodeSchema).min(1).max(1_000_000),
  edges: z.array(HierarchyEdgeSchema).max(10_000_000).optional(),
  root: z.string().max(200).optional(),
});

export const EmbedHierarchyInputSchema = z.object({
  hierarchy: HierarchySchema,
  model: z.enum(['poincare_ball', 'lorentz', 'klein', 'half_plane']).default('poincare_ball'),
  parameters: z.object({
    dimensions: z.number().int().min(2).max(512).default(32),
    curvature: z.number().min(-10).max(-0.01).default(-1.0),
    learnCurvature: z.boolean().default(true),
    epochs: z.number().int().min(1).max(1000).default(100),
    learningRate: z.number().min(0.0001).max(1).default(0.01),
  }).optional(),
});

export type EmbedHierarchyInput = z.infer<typeof EmbedHierarchyInputSchema>;

export const TaxonomicReasonInputSchema = z.object({
  query: z.object({
    type: z.enum(['is_a', 'subsumption', 'lowest_common_ancestor', 'path', 'similarity']),
    subject: z.string().max(500),
    object: z.string().max(500).optional(),
  }),
  taxonomy: z.string().max(200),
  inference: z.object({
    transitive: z.boolean().default(true),
    fuzzy: z.boolean().default(false),
    confidence: z.number().min(0).max(1).default(0.8),
  }).optional(),
});

export type TaxonomicReasonInput = z.infer<typeof TaxonomicReasonInputSchema>;

export const SemanticSearchInputSchema = z.object({
  query: z.string().max(5000),
  index: z.string().max(200),
  searchMode: z.enum(['nearest', 'subtree', 'ancestors', 'siblings', 'cone']).default('nearest'),
  constraints: z.object({
    maxDepth: z.number().int().min(0).max(100).optional(),
    minDepth: z.number().int().min(0).max(100).optional(),
    subtreeRoot: z.string().max(200).optional(),
    nodeTypes: z.array(z.string().max(100)).optional(),
  }).optional(),
  topK: z.number().int().min(1).max(10000).default(10),
});

export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>;

export const HierarchyCompareInputSchema = z.object({
  source: HierarchySchema,
  target: HierarchySchema,
  alignment: z.enum(['wasserstein', 'gromov_wasserstein', 'tree_edit', 'subtree_isomorphism']).default('gromov_wasserstein'),
  metrics: z.array(z.enum(['structural_similarity', 'semantic_similarity', 'coverage', 'precision'])).optional(),
});

export type HierarchyCompareInput = z.infer<typeof HierarchyCompareInputSchema>;

export const ConceptSchema = z.object({
  id: z.string().max(200),
  text: z.string().max(5000),
  type: z.string().max(100).optional(),
});

export const EntailmentGraphInputSchema = z.object({
  action: z.enum(['build', 'query', 'expand', 'prune']),
  concepts: z.array(ConceptSchema).max(100000).optional(),
  graphId: z.string().max(200).optional(),
  query: z.object({
    premise: z.string().max(200).optional(),
    hypothesis: z.string().max(200).optional(),
  }).optional(),
  entailmentThreshold: z.number().min(0).max(1).default(0.7),
  transitiveClosure: z.boolean().default(true),
  pruneStrategy: z.enum(['none', 'transitive_reduction', 'confidence_threshold']).optional(),
});

export type EntailmentGraphInput = z.infer<typeof EntailmentGraphInputSchema>;

// ============================================================================
// MCP Tool Types
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
// Tool Context Types
// ============================================================================

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface HyperbolicReasoningConfig {
  embedding: {
    defaultDimensions: number;
    defaultCurvature: number;
    maxNodes: number;
  };
  search: {
    maxTopK: number;
    defaultTopK: number;
  };
  entailment: {
    defaultThreshold: number;
    maxConcepts: number;
  };
  resourceLimits: {
    maxMemoryBytes: number;
    maxCpuTimeMs: number;
    maxDepth: number;
  };
}

export interface HyperbolicReasoningBridge {
  initialized: boolean;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  embedHierarchy(hierarchy: Hierarchy, config: EmbedHierarchyInput['parameters']): Promise<EmbeddedHierarchy>;
  computeDistance(a: HyperbolicPoint, b: HyperbolicPoint): number;
  search(query: HyperbolicPoint, index: string, k: number): Promise<SearchResult>;
}

export interface ToolContext {
  bridge?: HyperbolicReasoningBridge;
  config?: HyperbolicReasoningConfig;
  logger?: Logger;
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

// ============================================================================
// Security Constants
// ============================================================================

export const POINCARE_BALL_EPS = 1e-10;
export const MAX_NORM = 1 - POINCARE_BALL_EPS;

export const RESOURCE_LIMITS = {
  MAX_NODES: 1_000_000,
  MAX_EDGES: 10_000_000,
  MAX_DIMENSIONS: 512,
  MAX_DEPTH: 100,
  MAX_BRANCHING: 10000,
  MAX_MEMORY_BYTES: 2147483648, // 2GB
  MAX_CPU_TIME_MS: 300000, // 5 minutes
} as const;

// ============================================================================
// Hyperbolic Math Utilities (used by bridges)
// ============================================================================

/**
 * Clip vector to stay within Poincare ball
 */
export function clipToBall(vector: Float32Array, curvature: number): Float32Array {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  const maxNorm = MAX_NORM / Math.sqrt(-curvature);

  if (norm > maxNorm) {
    const scale = maxNorm / norm;
    return new Float32Array(vector.map(v => v * scale));
  }

  return vector;
}

/**
 * Compute hyperbolic distance in Poincare ball
 */
export function poincareDistance(x: Float32Array, y: Float32Array, c: number): number {
  const diffSq = x.reduce((s, v, i) => s + Math.pow(v - (y[i] ?? 0), 2), 0);
  const normXSq = x.reduce((s, v) => s + v * v, 0);
  const normYSq = y.reduce((s, v) => s + v * v, 0);

  const delta = 2 * Math.abs(c) * diffSq / ((1 - Math.abs(c) * normXSq) * (1 - Math.abs(c) * normYSq));
  return Math.acosh(1 + delta) / Math.sqrt(Math.abs(c));
}

/**
 * Mobius addition in Poincare ball
 */
export function mobiusAdd(x: Float32Array, y: Float32Array, c: number): Float32Array {
  const absC = Math.abs(c);
  const normXSq = x.reduce((s, v) => s + v * v, 0);
  const normYSq = y.reduce((s, v) => s + v * v, 0);
  const dotXY = x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);

  const numerator1 = 1 + 2 * absC * dotXY + absC * normYSq;
  const numerator2 = 1 - absC * normXSq;
  const denominator = 1 + 2 * absC * dotXY + absC * absC * normXSq * normYSq;

  const result = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    result[i] = (numerator1 * x[i]! + numerator2 * (y[i] ?? 0)) / denominator;
  }

  return clipToBall(result, c);
}

/**
 * Exponential map from tangent space to Poincare ball
 */
export function expMap(v: Float32Array, c: number): Float32Array {
  const norm = Math.sqrt(v.reduce((s, val) => s + val * val, 0));
  if (norm < 1e-10) {
    return new Float32Array(v.length);
  }

  const sqrtC = Math.sqrt(Math.abs(c));
  const scale = Math.tanh(sqrtC * norm / 2) / (sqrtC * norm);

  return clipToBall(new Float32Array(v.map(val => val * scale)), c);
}

/**
 * Logarithmic map from Poincare ball to tangent space
 */
export function logMap(x: Float32Array, c: number): Float32Array {
  const norm = Math.sqrt(x.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-10) {
    return new Float32Array(x.length);
  }

  const sqrtC = Math.sqrt(Math.abs(c));
  const scale = 2 * Math.atanh(sqrtC * norm) / (sqrtC * norm);

  return new Float32Array(x.map(v => v * scale));
}
