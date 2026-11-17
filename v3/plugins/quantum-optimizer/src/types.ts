/**
 * Quantum Optimizer Plugin - Type Definitions
 *
 * Types for quantum-inspired optimization including QUBO problems,
 * annealing parameters, QAOA circuits, and Grover search.
 */

import { z } from 'zod';

// ============================================================================
// QUBO Problem Types
// ============================================================================

/**
 * Quadratic Unconstrained Binary Optimization problem
 */
export interface QUBOProblem {
  /** Problem type identifier */
  readonly type: 'qubo' | 'ising' | 'sat' | 'max_cut' | 'tsp' | 'dependency';
  /** Number of binary variables */
  readonly variables: number;
  /** Linear coefficients (diagonal of Q matrix) */
  readonly linear: Float32Array;
  /** Quadratic coefficients (upper triangular of Q matrix, flattened) */
  readonly quadratic: Float32Array;
  /** Optional constraint violations penalty */
  readonly penalty?: number;
}

/**
 * QUBO solution
 */
export interface QUBOSolution {
  /** Binary assignment (0 or 1 for each variable) */
  readonly assignment: Uint8Array;
  /** Energy/cost of the solution */
  readonly energy: number;
  /** Whether this is optimal (or best found) */
  readonly optimal: boolean;
  /** Number of iterations/reads performed */
  readonly iterations: number;
  /** Confidence in optimality */
  readonly confidence: number;
}

// ============================================================================
// Annealing Types
// ============================================================================

/**
 * Temperature schedule for annealing
 */
export interface TemperatureSchedule {
  /** Initial temperature */
  readonly initial: number;
  /** Final temperature */
  readonly final: number;
  /** Schedule type */
  readonly type: 'linear' | 'exponential' | 'logarithmic' | 'adaptive';
}

/**
 * Annealing configuration
 */
export interface AnnealingConfig {
  /** Number of independent runs */
  readonly numReads: number;
  /** Total annealing time (abstract units) */
  readonly annealingTime: number;
  /** Chain strength for embedding */
  readonly chainStrength: number;
  /** Temperature schedule */
  readonly temperature: TemperatureSchedule;
  /** Embedding strategy */
  readonly embedding: 'auto' | 'minor' | 'pegasus' | 'chimera';
}

/**
 * Annealing result
 */
export interface AnnealingResult {
  /** Best solution found */
  readonly solution: QUBOSolution;
  /** All solutions found (sorted by energy) */
  readonly samples: QUBOSolution[];
  /** Energy histogram */
  readonly energyHistogram: Map<number, number>;
  /** Timing information */
  readonly timing: {
    readonly totalMs: number;
    readonly annealingMs: number;
    readonly embeddingMs: number;
  };
}

// ============================================================================
// QAOA Types
// ============================================================================

/**
 * Problem graph for QAOA
 */
export interface ProblemGraph {
  /** Number of nodes */
  readonly nodes: number;
  /** Edges as [source, target] pairs */
  readonly edges: ReadonlyArray<readonly [number, number]>;
  /** Edge weights (optional) */
  readonly weights?: Float32Array;
}

/**
 * QAOA circuit configuration
 */
export interface QAOACircuit {
  /** Circuit depth (p parameter) */
  readonly depth: number;
  /** Classical optimizer */
  readonly optimizer: 'cobyla' | 'bfgs' | 'adam' | 'nelder-mead';
  /** Initial parameter strategy */
  readonly initialParams: 'random' | 'heuristic' | 'transfer' | 'fourier';
  /** Number of measurement shots */
  readonly shots: number;
}

/**
 * QAOA result
 */
export interface QAOAResult {
  /** Best solution found */
  readonly solution: QUBOSolution;
  /** Optimal variational parameters (gamma, beta) */
  readonly parameters: {
    readonly gamma: Float32Array;
    readonly beta: Float32Array;
  };
  /** Approximation ratio (solution / optimal) */
  readonly approximationRatio: number;
  /** Convergence history */
  readonly convergence: Float32Array;
}

// ============================================================================
// Grover Search Types
// ============================================================================

/**
 * Search space configuration
 */
export interface SearchSpace {
  /** Size of search space (N) */
  readonly size: number;
  /** Oracle predicate definition (safe expression) */
  readonly oracle: string;
  /** Structure of search space */
  readonly structure: 'unstructured' | 'database' | 'tree' | 'graph';
}

/**
 * Amplification configuration
 */
export interface AmplificationConfig {
  /** Amplification method */
  readonly method: 'standard' | 'fixed_point' | 'robust';
  /** Boost factor for robust amplification */
  readonly boostFactor?: number;
}

/**
 * Grover search result
 */
export interface GroverResult {
  /** Found solution(s) */
  readonly solutions: Uint8Array[];
  /** Number of oracle queries */
  readonly queries: number;
  /** Theoretical optimal queries (pi/4 * sqrt(N/M)) */
  readonly optimalQueries: number;
  /** Success probability */
  readonly successProbability: number;
}

// ============================================================================
// Dependency Resolution Types
// ============================================================================

/**
 * Package descriptor for dependency resolution
 */
export interface PackageDescriptor {
  /** Package name */
  readonly name: string;
  /** Version string */
  readonly version: string;
  /** Dependencies as name -> version constraint */
  readonly dependencies: Record<string, string>;
  /** Conflicting packages */
  readonly conflicts: ReadonlyArray<string>;
  /** Package size in KB */
  readonly size?: number;
  /** Known vulnerabilities */
  readonly vulnerabilities?: ReadonlyArray<string>;
}

/**
 * Dependency resolution constraints
 */
export interface DependencyConstraints {
  /** Optimization objective */
  readonly minimize: 'versions' | 'size' | 'vulnerabilities' | 'depth';
  /** Existing lockfile constraints */
  readonly lockfile?: Record<string, string>;
  /** Include peer dependencies */
  readonly includePeer: boolean;
  /** Maximum resolution time in ms */
  readonly timeout: number;
}

/**
 * Dependency resolution result
 */
export interface DependencyResult {
  /** Resolved package versions */
  readonly resolved: Record<string, string>;
  /** Installation order */
  readonly order: ReadonlyArray<string>;
  /** Conflicts that were resolved */
  readonly resolvedConflicts: ReadonlyArray<{
    readonly packages: [string, string];
    readonly resolution: string;
  }>;
  /** Total size if calculated */
  readonly totalSize?: number;
  /** Remaining vulnerabilities */
  readonly vulnerabilities?: ReadonlyArray<string>;
}

// ============================================================================
// Schedule Optimization Types
// ============================================================================

/**
 * Task for scheduling
 */
export interface ScheduleTask {
  /** Unique task ID */
  readonly id: string;
  /** Task duration in time units */
  readonly duration: number;
  /** Prerequisite task IDs */
  readonly dependencies: ReadonlyArray<string>;
  /** Required resources */
  readonly resources: ReadonlyArray<string>;
  /** Optional deadline */
  readonly deadline?: number;
  /** Priority (higher = more important) */
  readonly priority?: number;
}

/**
 * Resource for scheduling
 */
export interface ScheduleResource {
  /** Unique resource ID */
  readonly id: string;
  /** Maximum concurrent usage */
  readonly capacity: number;
  /** Cost per time unit */
  readonly cost: number;
  /** Availability windows */
  readonly availability?: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
  }>;
}

/**
 * Schedule optimization objective
 */
export type ScheduleObjective = 'makespan' | 'cost' | 'utilization' | 'weighted';

/**
 * Scheduled task assignment
 */
export interface ScheduledTask {
  /** Task ID */
  readonly taskId: string;
  /** Start time */
  readonly start: number;
  /** End time */
  readonly end: number;
  /** Assigned resources */
  readonly resources: ReadonlyArray<string>;
}

/**
 * Schedule optimization result
 */
export interface ScheduleResult {
  /** Scheduled tasks */
  readonly schedule: ReadonlyArray<ScheduledTask>;
  /** Total makespan */
  readonly makespan: number;
  /** Total cost */
  readonly cost: number;
  /** Resource utilization per resource */
  readonly utilization: Record<string, number>;
  /** Critical path */
  readonly criticalPath: ReadonlyArray<string>;
  /** Optimization score */
  readonly score: number;
}

// ============================================================================
// Zod Schemas for MCP Tool Validation
// ============================================================================

export const TemperatureScheduleSchema = z.object({
  initial: z.number().min(0.001).max(1000).default(100),
  final: z.number().min(0.0001).max(100).default(0.01),
  type: z.enum(['linear', 'exponential', 'logarithmic', 'adaptive']).default('exponential'),
});

export const AnnealingSolveInputSchema = z.object({
  problem: z.object({
    type: z.enum(['qubo', 'ising', 'sat', 'max_cut', 'tsp', 'dependency']),
    variables: z.number().int().min(1).max(10000),
    constraints: z.array(z.unknown()).max(100000).optional(),
    objective: z.record(z.string(), z.number().finite()).optional(),
    linear: z.array(z.number()).optional(),
    quadratic: z.array(z.number()).optional(),
  }),
  parameters: z.object({
    numReads: z.number().int().min(1).max(10000).default(1000),
    annealingTime: z.number().min(1).max(1000).default(20),
    chainStrength: z.number().min(0.1).max(100).default(1.0),
    temperature: TemperatureScheduleSchema.optional(),
  }).optional(),
  embedding: z.enum(['auto', 'minor', 'pegasus', 'chimera']).default('auto'),
});

export type AnnealingSolveInput = z.infer<typeof AnnealingSolveInputSchema>;

export const QAOAOptimizeInputSchema = z.object({
  problem: z.object({
    type: z.enum(['max_cut', 'portfolio', 'scheduling', 'routing']),
    graph: z.object({
      nodes: z.number().int().min(1).max(1000),
      edges: z.array(z.tuple([z.number().int(), z.number().int()])).max(100000),
      weights: z.array(z.number()).optional(),
    }),
  }),
  circuit: z.object({
    depth: z.number().int().min(1).max(20).default(3),
    optimizer: z.enum(['cobyla', 'bfgs', 'adam', 'nelder-mead']).default('cobyla'),
    initialParams: z.enum(['random', 'heuristic', 'transfer', 'fourier']).default('heuristic'),
  }).optional(),
  shots: z.number().int().min(100).max(100000).default(1024),
});

export type QAOAOptimizeInput = z.infer<typeof QAOAOptimizeInputSchema>;

export const GroverSearchInputSchema = z.object({
  searchSpace: z.object({
    size: z.number().int().min(1).max(1_000_000_000),
    oracle: z.string().max(10000),
    structure: z.enum(['unstructured', 'database', 'tree', 'graph']),
  }),
  targets: z.number().int().min(1).max(1000).default(1),
  iterations: z.enum(['optimal', 'fixed', 'adaptive']).default('optimal'),
  amplification: z.object({
    method: z.enum(['standard', 'fixed_point', 'robust']).default('standard'),
    boostFactor: z.number().min(1).max(10).optional(),
  }).optional(),
});

export type GroverSearchInput = z.infer<typeof GroverSearchInputSchema>;

export const DependencyResolveInputSchema = z.object({
  packages: z.array(z.object({
    name: z.string().max(200),
    version: z.string().max(50),
    dependencies: z.record(z.string(), z.string()).default({}),
    conflicts: z.array(z.string()).default([]),
    size: z.number().optional(),
    vulnerabilities: z.array(z.string()).optional(),
  })).min(1).max(10000),
  constraints: z.object({
    minimize: z.enum(['versions', 'size', 'vulnerabilities', 'depth']).default('versions'),
    lockfile: z.record(z.string(), z.string()).optional(),
    includePeer: z.boolean().default(true),
    timeout: z.number().int().min(1000).max(300000).default(30000),
  }).optional(),
  solver: z.enum(['quantum_annealing', 'qaoa', 'hybrid']).default('hybrid'),
});

export type DependencyResolveInput = z.infer<typeof DependencyResolveInputSchema>;

export const ScheduleOptimizeInputSchema = z.object({
  tasks: z.array(z.object({
    id: z.string().max(100),
    duration: z.number().min(0).max(1000000),
    dependencies: z.array(z.string()).default([]),
    resources: z.array(z.string()).default([]),
    deadline: z.number().optional(),
    priority: z.number().optional(),
  })).min(1).max(10000),
  resources: z.array(z.object({
    id: z.string().max(100),
    capacity: z.number().int().min(1).max(1000),
    cost: z.number().min(0).max(1000000),
    availability: z.array(z.object({
      start: z.number().min(0),
      end: z.number().min(0),
    })).optional(),
  })).min(1).max(1000),
  objective: z.enum(['makespan', 'cost', 'utilization', 'weighted']).default('makespan'),
  weights: z.object({
    makespan: z.number().default(1),
    cost: z.number().default(1),
    utilization: z.number().default(1),
  }).optional(),
});

export type ScheduleOptimizeInput = z.infer<typeof ScheduleOptimizeInputSchema>;

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

export interface QuantumOptimizerConfig {
  annealing: {
    defaultReads: number;
    maxVariables: number;
    timeout: number;
  };
  qaoa: {
    maxDepth: number;
    maxNodes: number;
    defaultShots: number;
  };
  grover: {
    maxSearchSpace: number;
    allowedOracleOps: string[];
  };
  resourceLimits: {
    maxMemoryBytes: number;
    maxCpuTimeMs: number;
    maxIterations: number;
  };
}

export interface QuantumOptimizerBridge {
  initialized: boolean;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  solveQubo(problem: QUBOProblem, config: AnnealingConfig): Promise<AnnealingResult>;
  runQaoa(graph: ProblemGraph, circuit: QAOACircuit): Promise<QAOAResult>;
  groverSearch(space: SearchSpace, config: AmplificationConfig): Promise<GroverResult>;
}

export interface ToolContext {
  bridge?: QuantumOptimizerBridge;
  config?: QuantumOptimizerConfig;
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

export const RESOURCE_LIMITS = {
  MAX_VARIABLES: 10000,
  MAX_ITERATIONS: 1000000,
  MAX_MEMORY_BYTES: 4294967296, // 4GB
  MAX_CPU_TIME_MS: 600000, // 10 minutes
  MAX_CIRCUIT_DEPTH: 20,
  MAX_QUBITS: 50,
  PROGRESS_CHECK_INTERVAL_MS: 10000,
  MIN_PROGRESS_THRESHOLD: 0.001,
} as const;

export const ALLOWED_ORACLE_OPS = [
  '==', '!=', '<', '>', '<=', '>=',
  '&&', '||', '!',
  '+', '-', '*', '/', '%',
  '.', // property access
] as const;
