/**
 * RuVector WASM Types
 */

import { z } from 'zod';

/**
 * WASM module status
 */
export type WasmModuleStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/**
 * Base WASM bridge interface
 */
export interface WasmBridge<T = unknown> {
  readonly name: string;
  readonly version: string;
  readonly status: WasmModuleStatus;

  init(): Promise<void>;
  destroy(): Promise<void>;
  isReady(): boolean;
  getModule(): T | null;
}

/**
 * HNSW configuration
 */
export const HnswConfigSchema = z.object({
  dimensions: z.number().min(1).max(4096).default(384),
  maxElements: z.number().min(100).max(10_000_000).default(100_000),
  efConstruction: z.number().min(10).max(500).default(200),
  M: z.number().min(4).max(64).default(16),
  efSearch: z.number().min(10).max(500).default(100),
});

export type HnswConfig = z.infer<typeof HnswConfigSchema>;

/**
 * Vector search result
 */
export interface SearchResult {
  id: string;
  score: number;
  vector?: Float32Array;
  metadata?: Record<string, unknown>;
}

/**
 * Flash attention configuration
 */
export const AttentionConfigSchema = z.object({
  headDim: z.number().min(16).max(256).default(64),
  numHeads: z.number().min(1).max(128).default(8),
  seqLength: z.number().min(1).max(32768).default(512),
  causal: z.boolean().default(true),
  dropout: z.number().min(0).max(1).default(0),
});

export type AttentionConfig = z.infer<typeof AttentionConfigSchema>;

/**
 * GNN configuration
 */
export const GnnConfigSchema = z.object({
  inputDim: z.number().min(1).max(4096).default(384),
  hiddenDim: z.number().min(16).max(2048).default(256),
  outputDim: z.number().min(1).max(4096).default(128),
  numLayers: z.number().min(1).max(10).default(3),
  aggregation: z.enum(['mean', 'sum', 'max', 'attention']).default('mean'),
});

export type GnnConfig = z.infer<typeof GnnConfigSchema>;

/**
 * Hyperbolic embedding configuration
 */
export const HyperbolicConfigSchema = z.object({
  dimensions: z.number().min(2).max(1024).default(64),
  curvature: z.number().min(-10).max(-0.01).default(-1),
  model: z.enum(['poincare', 'lorentz', 'klein']).default('poincare'),
});

export type HyperbolicConfig = z.infer<typeof HyperbolicConfigSchema>;

/**
 * Reinforcement learning configuration
 */
export const LearningConfigSchema = z.object({
  algorithm: z.enum([
    'q-learning',
    'sarsa',
    'actor-critic',
    'ppo',
    'dqn',
    'decision-transformer',
  ]).default('ppo'),
  learningRate: z.number().min(0.00001).max(1).default(0.001),
  gamma: z.number().min(0).max(1).default(0.99),
  batchSize: z.number().min(1).max(1024).default(64),
});

export type LearningConfig = z.infer<typeof LearningConfigSchema>;

/**
 * Quantum-inspired optimization configuration
 */
export const ExoticConfigSchema = z.object({
  algorithm: z.enum([
    'qaoa',
    'vqe',
    'grover',
    'quantum-annealing',
    'tensor-network',
  ]).default('qaoa'),
  numQubits: z.number().min(2).max(64).default(16),
  depth: z.number().min(1).max(100).default(4),
  shots: z.number().min(100).max(100000).default(1000),
});

export type ExoticConfig = z.infer<typeof ExoticConfigSchema>;

/**
 * Cognitive kernel configuration
 */
export const CognitiveConfigSchema = z.object({
  workingMemorySize: z.number().min(3).max(15).default(7),
  attentionSpan: z.number().min(1).max(100).default(10),
  metaCognitionEnabled: z.boolean().default(true),
  scaffoldingLevel: z.enum(['none', 'light', 'moderate', 'heavy']).default('light'),
});

export type CognitiveConfig = z.infer<typeof CognitiveConfigSchema>;

/**
 * Pattern (Self-Optimizing Pattern Architecture) configuration
 */
export const SonaConfigSchema = z.object({
  mode: z.enum(['real-time', 'balanced', 'research', 'edge', 'batch']).default('balanced'),
  loraRank: z.number().min(1).max(64).default(4),
  learningRate: z.number().min(0.00001).max(0.1).default(0.001),
  ewcLambda: z.number().min(0).max(10000).default(100),
  batchSize: z.number().min(1).max(256).default(32),
});

export type SonaConfig = z.infer<typeof SonaConfigSchema>;
