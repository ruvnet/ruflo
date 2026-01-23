/**
 * Prime Radiant Plugin - Entry Point
 *
 * Mathematical AI Interpretability for Claude Flow V3
 *
 * Provides:
 * - Sheaf Laplacian coherence detection (CohomologyEngine)
 * - Spectral stability analysis (SpectralEngine)
 * - Do-calculus causal inference (CausalEngine)
 * - Quantum topology computation (QuantumEngine)
 * - Category theory morphisms (CategoryEngine)
 * - Homotopy Type Theory proofs (HottEngine)
 *
 * WASM Bundle: 92KB, zero dependencies
 *
 * @module prime-radiant
 * @version 0.1.3
 */

// ============================================================================
// Core Plugin Export
// ============================================================================

export { PrimeRadiantPlugin } from './plugin';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Core value types
  CoherenceEnergy,
  SpectralGap,
  StabilityIndex,
  CausalEffect,
  BettiNumbers,
  PersistencePoint,
  PersistenceDiagram,

  // Result types
  CoherenceCheckResult,
  CoherenceValidationResult,
  CoherenceThresholds,
  CoherenceAction,
  SpectralAnalysisResult,
  SpectralAnalysisType,
  CausalInferenceResult,
  CausalGraph,
  CausalQuery,
  TopologyResult,
  BettiInterpretation,
  ConsensusResult,
  ConsensusParams,
  MorphismResult,
  FunctorContext,
  HottProofResult,
  HottVerification,

  // Agent types
  AgentState,

  // Memory types
  MemoryEntry,
  MemoryCoherenceValidation,

  // Configuration types
  PrimeRadiantConfig,
  PrimeRadiantErrorCode,
} from './types';

export { DEFAULT_CONFIG, PrimeRadiantErrorCodes } from './types';

// ============================================================================
// Interface Exports
// ============================================================================

export type {
  // Core interfaces
  IPrimeRadiantBridge,
  ICoherenceGate,
  IConsensusVerifier,
  IStabilityAnalyzer,

  // Engine interfaces
  ICohomologyEngine,
  ISpectralEngine,
  ICausalEngine,
  IQuantumEngine,
  ICategoryEngine,
  IHottEngine,

  // Plugin interfaces
  IPlugin,
  PluginContext,
  PluginMCPTool,
  PluginHook,
  IResultCache,

  // Event interfaces
  PrimeRadiantEvent,
  PrimeRadiantEventPayload,
  IPrimeRadiantEventEmitter,
} from './interfaces';

export { HookPriority } from './interfaces';

// ============================================================================
// Schema Exports
// ============================================================================

export {
  // Base schemas
  EmbeddingVectorSchema,
  EmbeddingVectorsSchema,
  AdjacencyMatrixSchema,
  CoherenceEnergySchema,
  ThresholdSchema,

  // Coherence schemas
  CoherenceCheckInputSchema,
  CoherenceCheckResultSchema,
  CoherenceThresholdsSchema,

  // Spectral schemas
  SpectralAnalysisTypeSchema,
  SpectralAnalyzeInputSchema,
  SpectralAnalysisResultSchema,

  // Causal schemas
  CausalGraphSchema,
  CausalInferInputSchema,
  CausalInferenceResultSchema,

  // Consensus schemas
  AgentStateSchema,
  ConsensusVerifyInputSchema,
  ConsensusResultSchema,

  // Topology schemas
  PointCloudSchema,
  QuantumTopologyInputSchema,
  PersistencePointSchema,
  TopologyResultSchema,

  // Memory schemas
  MemoryEntrySchema,
  MemoryGateInputSchema,
  CoherenceActionSchema,
  MemoryGateResultSchema,

  // Configuration schemas
  CoherenceConfigSchema,
  SpectralConfigSchema,
  CausalConfigSchema,
  PrimeRadiantConfigSchema,

  // HoTT schemas
  HottVerificationInputSchema,
  HottProofResultSchema,

  // Morphism schemas
  MorphismInputSchema,
  MorphismResultSchema,

  // Validation functions
  validateCoherenceInput,
  validateSpectralInput,
  validateCausalInput,
  validateConsensusInput,
  validateTopologyInput,
  validateMemoryGateInput,
  validateConfig,
  safeValidate,
} from './schemas';

// Re-export schema types
export type {
  CoherenceCheckInput,
  SpectralAnalyzeInput,
  CausalInferInput,
  ConsensusVerifyInput,
  QuantumTopologyInput,
  MemoryGateInput,
  MemoryGateResult,
  HottVerificationInput,
  MorphismInput,
} from './schemas';

// ============================================================================
// Factory Functions
// ============================================================================

import { PrimeRadiantPlugin } from './plugin';
import type { PrimeRadiantConfig } from './types';

/**
 * Create a new Prime Radiant plugin instance
 * @param config Optional configuration overrides
 * @returns Configured plugin instance
 */
export function createPrimeRadiantPlugin(
  config?: Partial<PrimeRadiantConfig>
): PrimeRadiantPlugin {
  return new PrimeRadiantPlugin(config);
}

/**
 * Plugin metadata for registration
 */
export const pluginMetadata = {
  name: 'prime-radiant',
  version: '0.1.3',
  description:
    'Mathematical AI interpretability with sheaf cohomology, spectral analysis, and causal inference',
  author: 'rUv',
  license: 'MIT',
  repository: 'https://github.com/ruvnet/claude-flow',
  wasmSize: '92KB',
  dependencies: {
    required: [
      '@claude-flow/memory',
      '@claude-flow/security',
      '@claude-flow/coordination',
    ],
    optional: ['@claude-flow/embeddings', '@claude-flow/aidefence'],
  },
  capabilities: [
    'coherence-checking',
    'spectral-analysis',
    'causal-inference',
    'consensus-verification',
    'quantum-topology',
    'category-theory',
    'hott-proofs',
  ],
  engines: [
    {
      name: 'CohomologyEngine',
      description: 'Sheaf Laplacian for coherence detection',
      performance: '<5ms per check',
    },
    {
      name: 'SpectralEngine',
      description: 'Stability and spectral analysis',
      performance: '<20ms for 100x100 matrix',
    },
    {
      name: 'CausalEngine',
      description: 'Do-calculus causal inference',
      performance: '<10ms per query',
    },
    {
      name: 'QuantumEngine',
      description: 'Quantum topology operations',
      performance: '<50ms per computation',
    },
    {
      name: 'CategoryEngine',
      description: 'Category theory functors/morphisms',
      performance: '<5ms per operation',
    },
    {
      name: 'HottEngine',
      description: 'Homotopy Type Theory',
      performance: '<10ms per verification',
    },
  ],
  tools: [
    'pr_coherence_check',
    'pr_spectral_analyze',
    'pr_causal_infer',
    'pr_consensus_verify',
    'pr_quantum_topology',
    'pr_memory_gate',
  ],
  hooks: [
    'pr/pre-memory-store',
    'pr/pre-consensus',
    'pr/post-swarm-task',
    'pr/pre-rag-retrieval',
  ],
};

/**
 * Default export for convenience
 */
export default PrimeRadiantPlugin;
