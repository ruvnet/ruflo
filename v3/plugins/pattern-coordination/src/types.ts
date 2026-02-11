/**
 * Pattern Coordination Plugin - Type Definitions
 *
 * Types for multi-agent neural coordination including voting mechanisms,
 * topology optimization, collective memory, emergent protocols, and swarm behavior.
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
  nervousSystemBridge?: NervousSystemBridgeInterface;
  attentionBridge?: AttentionBridgeInterface;
  config?: NeuralCoordinationConfig;
  logger?: Logger;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ============================================================================
// Agent Types
// ============================================================================

export const AgentSchema = z.object({
  id: z.string().max(100).describe('Unique agent identifier'),
  preferences: z.record(z.string(), z.number().min(-1).max(1)).optional()
    .describe('Agent preferences as key-value pairs with normalized values'),
  constraints: z.record(z.string(), z.unknown()).optional()
    .describe('Agent-specific constraints'),
  capabilities: z.array(z.string()).optional()
    .describe('Agent capabilities'),
  location: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional(),
  }).optional().describe('Agent location in 2D/3D space'),
  embedding: z.array(z.number()).optional()
    .describe('Agent state embedding vector'),
});

export type Agent = z.infer<typeof AgentSchema>;

export const AgentStateSchema = z.object({
  agentId: z.string().max(100),
  embedding: z.array(z.number()).describe('Agent state embedding'),
  vote: z.union([z.string(), z.boolean()]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// ============================================================================
// Consensus Types
// ============================================================================

export const ConsensusProtocolSchema = z.enum([
  'neural_voting',
  'iterative_refinement',
  'auction',
  'contract_net',
]);

export type ConsensusProtocol = z.infer<typeof ConsensusProtocolSchema>;

export const ProposalSchema = z.object({
  topic: z.string().max(1000).describe('Topic of the proposal'),
  options: z.array(z.object({
    id: z.string().max(100),
    value: z.unknown(),
  })).min(2).max(100).describe('Options to choose from'),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export type Proposal = z.infer<typeof ProposalSchema>;

export const NeuralConsensusInputSchema = z.object({
  proposal: ProposalSchema.describe('Proposal to reach consensus on'),
  agents: z.array(AgentSchema).min(2).max(1000)
    .describe('Agents participating in consensus'),
  protocol: ConsensusProtocolSchema.default('iterative_refinement')
    .describe('Consensus protocol to use'),
  maxRounds: z.number().int().min(1).max(1000).default(10)
    .describe('Maximum negotiation rounds'),
});

export type NeuralConsensusInput = z.infer<typeof NeuralConsensusInputSchema>;

export interface VotingBallot {
  agentId: string;
  optionId: string;
  weight: number;
  confidence: number;
}

export interface VotingResult {
  consensusReached: boolean;
  selectedOption: string | null;
  votes: VotingBallot[];
  agreementRatio: number;
  roundsUsed: number;
  divergentAgents: string[];
}

export interface NeuralConsensusOutput {
  consensusReached: boolean;
  selectedOption: string | null;
  agreementRatio: number;
  details: {
    protocol: ConsensusProtocol;
    roundsUsed: number;
    agentCount: number;
    divergentAgents: string[];
    interpretation: string;
  };
}

// ============================================================================
// Topology Types
// ============================================================================

export const TopologyObjectiveSchema = z.enum([
  'minimize_latency',
  'maximize_throughput',
  'minimize_hops',
  'fault_tolerant',
]);

export type TopologyObjective = z.infer<typeof TopologyObjectiveSchema>;

export const PreferredTopologySchema = z.enum([
  'mesh',
  'tree',
  'ring',
  'star',
  'hybrid',
]);

export type PreferredTopology = z.infer<typeof PreferredTopologySchema>;

export const TopologyConstraintsSchema = z.object({
  maxConnections: z.number().int().min(1).max(100).optional(),
  minRedundancy: z.number().min(0).max(1).optional(),
  preferredTopology: PreferredTopologySchema.optional(),
});

export type TopologyConstraints = z.infer<typeof TopologyConstraintsSchema>;

export const TopologyOptimizeInputSchema = z.object({
  agents: z.array(AgentSchema).min(2).max(1000)
    .describe('Agents to optimize topology for'),
  objective: TopologyObjectiveSchema.default('minimize_latency')
    .describe('Optimization objective'),
  constraints: TopologyConstraintsSchema.optional()
    .describe('Topology constraints'),
});

export type TopologyOptimizeInput = z.infer<typeof TopologyOptimizeInputSchema>;

export interface TopologyEdge {
  source: string;
  target: string;
  weight: number;
  latency?: number;
}

export interface TopologyResult {
  edges: TopologyEdge[];
  topology: PreferredTopology;
  metrics: {
    avgLatency: number;
    redundancy: number;
    diameter: number;
    avgDegree: number;
  };
}

export interface TopologyOptimizeOutput {
  topology: PreferredTopology;
  edges: TopologyEdge[];
  metrics: {
    avgLatency: number;
    redundancy: number;
    diameter: number;
    avgDegree: number;
  };
  details: {
    objective: TopologyObjective;
    agentCount: number;
    edgeCount: number;
    interpretation: string;
  };
}

// ============================================================================
// Collective Memory Types
// ============================================================================

export const MemoryActionSchema = z.enum([
  'store',
  'retrieve',
  'consolidate',
  'forget',
  'synchronize',
]);

export type MemoryAction = z.infer<typeof MemoryActionSchema>;

export const MemoryScopeSchema = z.enum(['global', 'team', 'pair']);

export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const ConsolidationStrategySchema = z.enum(['ewc', 'replay', 'distillation']);

export type ConsolidationStrategy = z.infer<typeof ConsolidationStrategySchema>;

export const CollectiveMemoryInputSchema = z.object({
  action: MemoryActionSchema.describe('Memory action to perform'),
  memory: z.object({
    key: z.string().max(500).optional(),
    value: z.unknown().optional(),
    importance: z.number().min(0).max(1).default(0.5),
    expiry: z.string().datetime().optional(),
  }).optional().describe('Memory entry data'),
  scope: MemoryScopeSchema.default('team').describe('Memory scope'),
  consolidationStrategy: ConsolidationStrategySchema.default('ewc')
    .describe('Consolidation strategy for memory management'),
});

export type CollectiveMemoryInput = z.infer<typeof CollectiveMemoryInputSchema>;

export interface MemoryEntry {
  key: string;
  value: unknown;
  importance: number;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  scope: MemoryScope;
}

export interface CollectiveMemoryOutput {
  action: MemoryAction;
  success: boolean;
  data?: unknown;
  details: {
    scope: MemoryScope;
    entryCount?: number;
    consolidatedCount?: number;
    interpretation: string;
  };
}

// ============================================================================
// Emergent Protocol Types
// ============================================================================

export const TaskTypeSchema = z.object({
  type: z.string().max(100),
  objectives: z.array(z.string()).max(20),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export type TaskType = z.infer<typeof TaskTypeSchema>;

export const CommunicationBudgetSchema = z.object({
  symbolsPerMessage: z.number().int().min(1).max(100).default(10),
  messagesPerRound: z.number().int().min(1).max(10).default(3),
});

export type CommunicationBudget = z.infer<typeof CommunicationBudgetSchema>;

export const EmergentProtocolInputSchema = z.object({
  task: TaskTypeSchema.describe('Cooperative task requiring communication'),
  communicationBudget: CommunicationBudgetSchema.optional()
    .describe('Budget for communication'),
  trainingEpisodes: z.number().int().min(10).max(10000).default(1000)
    .describe('Number of training episodes'),
  interpretability: z.boolean().default(true)
    .describe('Enable interpretability analysis'),
});

export type EmergentProtocolInput = z.infer<typeof EmergentProtocolInputSchema>;

export interface ProtocolSymbol {
  id: number;
  meaning: string;
  frequency: number;
  contextualMeaning: Map<string, string>;
}

export interface EmergentProtocolResult {
  symbols: ProtocolSymbol[];
  vocabulary: Map<number, string>;
  compositionRules: string[];
  successRate: number;
}

export interface EmergentProtocolOutput {
  protocolLearned: boolean;
  vocabularySize: number;
  successRate: number;
  details: {
    trainingEpisodes: number;
    symbols: Array<{ id: number; meaning: string; frequency: number }>;
    compositionRules: string[];
    interpretation: string;
  };
}

// ============================================================================
// Swarm Behavior Types
// ============================================================================

export const SwarmBehaviorTypeSchema = z.enum([
  'flocking',
  'foraging',
  'formation',
  'task_allocation',
  'exploration',
  'aggregation',
  'dispersion',
]);

export type SwarmBehaviorType = z.infer<typeof SwarmBehaviorTypeSchema>;

export const ObservabilitySchema = z.object({
  recordTrajectories: z.boolean().optional(),
  measureEmergence: z.boolean().optional(),
});

export type Observability = z.infer<typeof ObservabilitySchema>;

export const SwarmBehaviorInputSchema = z.object({
  behavior: SwarmBehaviorTypeSchema.describe('Type of swarm behavior'),
  parameters: z.record(z.string(), z.unknown()).optional()
    .describe('Behavior-specific parameters'),
  adaptiveRules: z.boolean().default(true)
    .describe('Allow neural adaptation of behavior rules'),
  observability: ObservabilitySchema.optional()
    .describe('Observability options'),
});

export type SwarmBehaviorInput = z.infer<typeof SwarmBehaviorInputSchema>;

export interface SwarmMetrics {
  cohesion: number;
  alignment: number;
  separation: number;
  emergenceScore: number;
}

export interface SwarmBehaviorResult {
  behaviorActive: boolean;
  metrics: SwarmMetrics;
  agentPositions: Array<{ id: string; x: number; y: number; z?: number }>;
  trajectories?: Array<Array<{ t: number; x: number; y: number }>>;
}

export interface SwarmBehaviorOutput {
  behaviorActive: boolean;
  metrics: {
    cohesion: number;
    alignment: number;
    separation: number;
    emergenceScore: number;
  };
  details: {
    behavior: SwarmBehaviorType;
    agentCount: number;
    adaptiveRules: boolean;
    interpretation: string;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface NeuralCoordinationConfig {
  voting: {
    defaultProtocol: ConsensusProtocol;
    maxRounds: number;
    convergenceThreshold: number;
  };
  topology: {
    defaultObjective: TopologyObjective;
    maxConnections: number;
  };
  memory: {
    defaultScope: MemoryScope;
    consolidationInterval: number;
    maxEntries: number;
  };
  swarm: {
    defaultBehavior: SwarmBehaviorType;
    adaptationRate: number;
  };
}

export const DEFAULT_CONFIG: NeuralCoordinationConfig = {
  voting: {
    defaultProtocol: 'iterative_refinement',
    maxRounds: 10,
    convergenceThreshold: 0.8,
  },
  topology: {
    defaultObjective: 'minimize_latency',
    maxConnections: 10,
  },
  memory: {
    defaultScope: 'team',
    consolidationInterval: 60000,
    maxEntries: 10000,
  },
  swarm: {
    defaultBehavior: 'flocking',
    adaptationRate: 0.1,
  },
};

// ============================================================================
// Bridge Interfaces
// ============================================================================

export interface NervousSystemBridgeInterface {
  initialized: boolean;
  propagate(signals: Float32Array[]): Promise<Float32Array[]>;
  synchronize(states: Float32Array[]): Promise<Float32Array>;
  coordinate(agents: Agent[]): Promise<{ assignments: Map<string, string> }>;
}

export interface AttentionBridgeInterface {
  initialized: boolean;
  flashAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array
  ): Float32Array;
  multiHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array
  ): Float32Array;
  computeWeights(
    query: Float32Array,
    keys: Float32Array[]
  ): number[];
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
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
