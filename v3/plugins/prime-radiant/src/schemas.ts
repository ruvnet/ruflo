/**
 * Prime Radiant Plugin - Zod Validation Schemas
 *
 * Provides runtime validation for all plugin inputs:
 * - MCP tool inputs
 * - Configuration options
 * - Engine inputs
 *
 * Uses Zod for type-safe validation with automatic TypeScript inference.
 *
 * @module prime-radiant/schemas
 * @version 0.1.3
 */

import { z } from 'zod';

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * Schema for embedding vectors (array of numbers)
 */
export const EmbeddingVectorSchema = z.array(z.number()).min(1).describe('Embedding vector');

/**
 * Schema for multiple embedding vectors
 */
export const EmbeddingVectorsSchema = z
  .array(EmbeddingVectorSchema)
  .min(1)
  .describe('Array of embedding vectors');

/**
 * Schema for adjacency matrix (2D array of numbers)
 */
export const AdjacencyMatrixSchema = z
  .array(z.array(z.number()))
  .min(1)
  .describe('Adjacency matrix representing connections');

/**
 * Schema for coherence energy (0-1)
 */
export const CoherenceEnergySchema = z
  .number()
  .min(0)
  .max(1)
  .describe('Coherence energy (0=coherent, 1=contradictory)');

/**
 * Schema for threshold values (0-1)
 */
export const ThresholdSchema = z.number().min(0).max(1).describe('Threshold value between 0 and 1');

// ============================================================================
// Coherence Schemas
// ============================================================================

/**
 * Schema for coherence check input
 */
export const CoherenceCheckInputSchema = z.object({
  vectors: EmbeddingVectorsSchema.describe('Array of embedding vectors to check for coherence'),
  threshold: ThresholdSchema.default(0.3).describe('Energy threshold for coherence (0-1)'),
});

export type CoherenceCheckInput = z.infer<typeof CoherenceCheckInputSchema>;

/**
 * Schema for coherence check result
 */
export const CoherenceCheckResultSchema = z.object({
  coherent: z.boolean().describe('Whether the vectors are considered coherent'),
  energy: CoherenceEnergySchema,
  violations: z.array(z.string()).describe('List of detected violations/contradictions'),
  confidence: z.number().min(0).max(1).describe('Confidence score (1 - energy)'),
});

export type CoherenceCheckResult = z.infer<typeof CoherenceCheckResultSchema>;

/**
 * Schema for coherence thresholds configuration
 */
export const CoherenceThresholdsSchema = z.object({
  reject: ThresholdSchema.default(0.7).describe('Energy threshold for rejection'),
  warn: ThresholdSchema.default(0.3).describe('Energy threshold for warning'),
  allow: ThresholdSchema.default(0.3).describe('Energy threshold for automatic allow'),
});

export type CoherenceThresholds = z.infer<typeof CoherenceThresholdsSchema>;

// ============================================================================
// Spectral Analysis Schemas
// ============================================================================

/**
 * Schema for spectral analysis type
 */
export const SpectralAnalysisTypeSchema = z.enum(['stability', 'clustering', 'connectivity']);

export type SpectralAnalysisType = z.infer<typeof SpectralAnalysisTypeSchema>;

/**
 * Schema for spectral analysis input
 */
export const SpectralAnalyzeInputSchema = z.object({
  adjacencyMatrix: AdjacencyMatrixSchema.describe('Adjacency matrix representing connections'),
  analyzeType: SpectralAnalysisTypeSchema.default('stability').describe('Type of analysis'),
});

export type SpectralAnalyzeInput = z.infer<typeof SpectralAnalyzeInputSchema>;

/**
 * Schema for spectral analysis result
 */
export const SpectralAnalysisResultSchema = z.object({
  stable: z.boolean().describe('Whether the system is spectrally stable'),
  eigenvalues: z.array(z.number()).describe('Array of computed eigenvalues'),
  spectralGap: z.number().describe('Gap between eigenvalues indicating stability'),
  stabilityIndex: z.number().min(0).max(1).describe('Overall stability index'),
});

export type SpectralAnalysisResult = z.infer<typeof SpectralAnalysisResultSchema>;

// ============================================================================
// Causal Inference Schemas
// ============================================================================

/**
 * Schema for causal graph
 */
export const CausalGraphSchema = z.object({
  nodes: z.array(z.string()).min(1).describe('Node names in the graph'),
  edges: z
    .array(z.tuple([z.string(), z.string()]))
    .describe('Directed edges as [source, target] pairs'),
});

export type CausalGraph = z.infer<typeof CausalGraphSchema>;

/**
 * Schema for causal inference input
 */
export const CausalInferInputSchema = z.object({
  treatment: z.string().min(1).describe('Treatment/intervention variable'),
  outcome: z.string().min(1).describe('Outcome variable to measure effect on'),
  graph: CausalGraphSchema.describe('Causal graph with nodes and directed edges'),
});

export type CausalInferInput = z.infer<typeof CausalInferInputSchema>;

/**
 * Schema for causal inference result
 */
export const CausalInferenceResultSchema = z.object({
  effect: z.number().describe('Estimated causal effect magnitude'),
  confounders: z.array(z.string()).describe('Identified confounding variables'),
  interventionValid: z.boolean().describe('Whether the intervention is valid'),
  backdoorPaths: z.array(z.string()).describe('Backdoor paths that may bias the effect'),
});

export type CausalInferenceResult = z.infer<typeof CausalInferenceResultSchema>;

// ============================================================================
// Consensus Verification Schemas
// ============================================================================

/**
 * Schema for agent state
 */
export const AgentStateSchema = z.object({
  agentId: z.string().min(1).describe('Agent identifier'),
  embedding: EmbeddingVectorSchema.describe("Agent's embedding vector"),
  vote: z.union([z.string(), z.boolean()]).optional().describe("Agent's vote"),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * Schema for consensus verification input
 */
export const ConsensusVerifyInputSchema = z.object({
  agentStates: z
    .array(AgentStateSchema)
    .min(1)
    .describe('Array of agent states to verify consensus'),
  consensusThreshold: ThresholdSchema.default(0.8).describe('Required agreement threshold (0-1)'),
});

export type ConsensusVerifyInput = z.infer<typeof ConsensusVerifyInputSchema>;

/**
 * Schema for consensus result
 */
export const VotingResultSchema = z.object({
  consensusAchieved: z.boolean().describe('Whether consensus was mathematically achieved'),
  agreementRatio: z.number().min(0).max(1).describe('Ratio of agents in agreement'),
  coherenceEnergy: CoherenceEnergySchema.describe('Coherence energy among agent states'),
  spectralStability: z.boolean().describe('Whether the swarm is spectrally stable'),
  spectralGap: z.number().describe('Spectral gap of the agent network'),
  violations: z.array(z.string()).describe('Any detected violations'),
  recommendation: z.string().describe('Human-readable recommendation'),
});

export type VotingResult = z.infer<typeof VotingResultSchema>;

// ============================================================================
// Quantum Topology Schemas
// ============================================================================

/**
 * Schema for point cloud (array of points)
 */
export const PointCloudSchema = z.array(EmbeddingVectorSchema).min(1).describe('Point cloud data');

/**
 * Schema for quantum topology input
 */
export const QuantumTopologyInputSchema = z.object({
  points: PointCloudSchema.describe('Point cloud for topological analysis'),
  maxDimension: z.number().int().min(0).max(3).default(2).describe('Maximum homology dimension'),
});

export type QuantumTopologyInput = z.infer<typeof QuantumTopologyInputSchema>;

/**
 * Schema for persistence point
 */
export const PersistencePointSchema = z
  .tuple([z.number(), z.number()])
  .describe('[birth, death] pair');

/**
 * Schema for topology result
 */
export const TopologyResultSchema = z.object({
  bettiNumbers: z.array(z.number().int().min(0)).describe('Betti numbers for each dimension'),
  persistenceDiagram: z.array(PersistencePointSchema).describe('Persistence diagram'),
  homologyClasses: z.number().int().min(0).describe('Total number of homology classes'),
});

export type TopologyResult = z.infer<typeof TopologyResultSchema>;

// ============================================================================
// Memory Gate Schemas
// ============================================================================

/**
 * Schema for memory entry
 */
export const MemoryEntrySchema = z.object({
  key: z.string().min(1).describe('Unique key for the entry'),
  content: z.string().describe('Text content of the entry'),
  embedding: EmbeddingVectorSchema.describe('Embedding vector for the content'),
  metadata: z.record(z.unknown()).optional().describe('Optional metadata'),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/**
 * Schema for memory gate input
 */
export const MemoryGateInputSchema = z.object({
  entry: MemoryEntrySchema.describe('Memory entry to validate'),
  contextEmbeddings: EmbeddingVectorsSchema.optional().describe(
    'Existing context embeddings to check against'
  ),
  thresholds: CoherenceThresholdsSchema.optional().describe('Custom thresholds'),
});

export type MemoryGateInput = z.infer<typeof MemoryGateInputSchema>;

/**
 * Schema for coherence action
 */
export const CoherenceActionSchema = z.enum(['allow', 'warn', 'reject']);

export type CoherenceAction = z.infer<typeof CoherenceActionSchema>;

/**
 * Schema for memory gate result
 */
export const MemoryGateResultSchema = z.object({
  action: CoherenceActionSchema.describe('Recommended action'),
  coherent: z.boolean().describe('Whether entry is coherent with context'),
  energy: CoherenceEnergySchema,
  violations: z.array(z.string()).describe('Any detected violations'),
  confidence: z.number().min(0).max(1).describe('Confidence score'),
  recommendation: z.string().describe('Human-readable recommendation'),
});

export type MemoryGateResult = z.infer<typeof MemoryGateResultSchema>;

// ============================================================================
// Configuration Schemas
// ============================================================================

/**
 * Schema for coherence configuration
 */
export const CoherenceConfigSchema = z.object({
  warnThreshold: ThresholdSchema.default(0.3).describe('Energy threshold for warnings'),
  rejectThreshold: ThresholdSchema.default(0.7).describe('Energy threshold for rejection'),
  cacheEnabled: z.boolean().default(true).describe('Enable result caching'),
  cacheTTL: z.number().int().positive().default(60000).describe('Cache TTL in milliseconds'),
});

/**
 * Schema for spectral configuration
 */
export const SpectralConfigSchema = z.object({
  stabilityThreshold: ThresholdSchema.default(0.1).describe('Spectral gap threshold for stability'),
  maxMatrixSize: z.number().int().positive().default(1000).describe('Maximum adjacency matrix size'),
});

/**
 * Schema for causal configuration
 */
export const CausalConfigSchema = z.object({
  maxBackdoorPaths: z.number().int().positive().default(10).describe('Maximum backdoor paths'),
  confidenceThreshold: ThresholdSchema.default(0.8).describe('Minimum confidence threshold'),
});

/**
 * Schema for full plugin configuration
 */
export const PrimeRadiantConfigSchema = z.object({
  coherence: CoherenceConfigSchema.default({}),
  spectral: SpectralConfigSchema.default({}),
  causal: CausalConfigSchema.default({}),
});

export type PrimeRadiantConfig = z.infer<typeof PrimeRadiantConfigSchema>;

// ============================================================================
// HoTT Schemas
// ============================================================================

/**
 * Schema for HoTT verification input
 */
export const HottVerificationInputSchema = z.object({
  proposition: z.string().min(1).describe('The proposition to prove'),
  proof: z.string().min(1).describe('The proof term'),
});

export type HottVerificationInput = z.infer<typeof HottVerificationInputSchema>;

/**
 * Schema for HoTT proof result
 */
export const HottProofResultSchema = z.object({
  valid: z.boolean().describe('Whether the proof is valid'),
  type: z.string().describe('Inferred type of the proof term'),
  normalForm: z.string().describe('Normal form of the proof term'),
});

export type HottProofResult = z.infer<typeof HottProofResultSchema>;

// ============================================================================
// Morphism Schemas
// ============================================================================

/**
 * Schema for morphism input
 */
export const MorphismInputSchema = z.object({
  source: z.unknown().describe('Source object'),
  target: z.unknown().describe('Target object'),
  morphism: z.string().min(1).describe('Morphism specification'),
});

export type MorphismInput = z.infer<typeof MorphismInputSchema>;

/**
 * Schema for morphism result
 */
export const MorphismResultSchema = z.object({
  valid: z.boolean().describe('Whether the morphism is valid'),
  result: z.unknown().describe('Result of applying the morphism'),
  naturalTransformation: z.boolean().describe('Whether this is a natural transformation'),
});

export type MorphismResult = z.infer<typeof MorphismResultSchema>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate coherence check input
 */
export function validateCoherenceInput(input: unknown): CoherenceCheckInput {
  return CoherenceCheckInputSchema.parse(input);
}

/**
 * Validate spectral analysis input
 */
export function validateSpectralInput(input: unknown): SpectralAnalyzeInput {
  return SpectralAnalyzeInputSchema.parse(input);
}

/**
 * Validate causal inference input
 */
export function validateCausalInput(input: unknown): CausalInferInput {
  return CausalInferInputSchema.parse(input);
}

/**
 * Validate consensus verification input
 */
export function validateConsensusInput(input: unknown): ConsensusVerifyInput {
  return ConsensusVerifyInputSchema.parse(input);
}

/**
 * Validate quantum topology input
 */
export function validateTopologyInput(input: unknown): QuantumTopologyInput {
  return QuantumTopologyInputSchema.parse(input);
}

/**
 * Validate memory gate input
 */
export function validateMemoryGateInput(input: unknown): MemoryGateInput {
  return MemoryGateInputSchema.parse(input);
}

/**
 * Validate plugin configuration
 */
export function validateConfig(config: unknown): PrimeRadiantConfig {
  return PrimeRadiantConfigSchema.parse(config);
}

/**
 * Safe validation that returns result or error
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
