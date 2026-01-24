/**
 * @claude-flow/plugin-quantum-optimizer
 *
 * Quantum-inspired optimization plugin for Claude Flow V3.
 *
 * Provides MCP tools for:
 * - Simulated quantum annealing (QUBO, Ising, SAT, Max-Cut)
 * - QAOA variational optimization
 * - Grover-inspired search with quadratic speedup
 * - Dependency resolution using quantum optimization
 * - Task scheduling with DAG analysis
 *
 * @module @claude-flow/plugin-quantum-optimizer
 * @version 3.0.0-alpha.1
 */

// Types
export type {
  // QUBO/Optimization
  QUBOProblem,
  QUBOSolution,
  TemperatureSchedule,
  AnnealingConfig,
  AnnealingResult,
  ProblemGraph,
  QAOACircuit,
  QAOAResult,
  SearchSpace,
  AmplificationConfig,
  GroverResult,
  // Dependency
  PackageDescriptor,
  DependencyConstraints,
  DependencyResult,
  // Scheduling
  ScheduleTask,
  ScheduleResource,
  ScheduleObjective,
  ScheduledTask,
  ScheduleResult,
  // MCP
  MCPTool,
  MCPToolResult,
  MCPToolInputSchema,
  ToolContext,
  Logger,
  QuantumOptimizerConfig,
  QuantumOptimizerBridge,
} from './types.js';

// Zod Schemas
export {
  AnnealingSolveInputSchema,
  QAOAOptimizeInputSchema,
  GroverSearchInputSchema,
  DependencyResolveInputSchema,
  ScheduleOptimizeInputSchema,
  TemperatureScheduleSchema,
  successResult,
  errorResult,
  RESOURCE_LIMITS,
  ALLOWED_ORACLE_OPS,
} from './types.js';

// Bridges
export { ExoticBridge, createExoticBridge } from './bridges/exotic-bridge.js';
export { DagBridge, createDagBridge } from './bridges/dag-bridge.js';
export type { WasmModuleStatus } from './bridges/exotic-bridge.js';
export type { Dag, DagNode, DagEdge, TopologicalSortResult, CriticalPathResult } from './bridges/dag-bridge.js';

// MCP Tools
export {
  quantumOptimizerTools,
  toolHandlers,
  getTool,
  getToolNames,
  annealingSolveTool,
  qaoaOptimizeTool,
  groverSearchTool,
  dependencyResolveTool,
  scheduleOptimizeTool,
} from './mcp-tools.js';

// Re-export default
export { default } from './mcp-tools.js';

/**
 * Plugin metadata
 */
export const pluginMetadata = {
  name: '@claude-flow/plugin-quantum-optimizer',
  version: '3.0.0-alpha.1',
  description: 'Quantum-inspired optimization for combinatorial problems',
  category: 'exotic',
  author: 'rUv',
  license: 'MIT',
  repository: 'https://github.com/ruvnet/claude-flow',
  tools: [
    'quantum_annealing_solve',
    'quantum_qaoa_optimize',
    'quantum_grover_search',
    'quantum_dependency_resolve',
    'quantum_schedule_optimize',
  ],
  bridges: ['exotic-bridge', 'dag-bridge'],
  wasmPackages: [
    '@ruvector/exotic-wasm',
    '@ruvector/dag-wasm',
    '@ruvector/sparse-inference-wasm',
  ],
} as const;

/**
 * Initialize the plugin
 */
export async function initializePlugin(): Promise<void> {
  const { createExoticBridge } = await import('./bridges/exotic-bridge.js');
  const { createDagBridge } = await import('./bridges/dag-bridge.js');

  const exoticBridge = createExoticBridge();
  const dagBridge = createDagBridge();

  await Promise.all([
    exoticBridge.initialize(),
    dagBridge.initialize(),
  ]);

  console.info('[quantum-optimizer] Plugin initialized');
}

/**
 * Plugin configuration validator
 */
export function validateConfig(config: unknown): config is QuantumOptimizerConfig {
  if (!config || typeof config !== 'object') return false;

  const c = config as Record<string, unknown>;

  return (
    typeof c['annealing'] === 'object' &&
    typeof c['qaoa'] === 'object' &&
    typeof c['grover'] === 'object' &&
    typeof c['resourceLimits'] === 'object'
  );
}

/**
 * Default plugin configuration
 */
export const defaultConfig: QuantumOptimizerConfig = {
  annealing: {
    defaultReads: 1000,
    maxVariables: 10000,
    timeout: 600000,
  },
  qaoa: {
    maxDepth: 20,
    maxNodes: 1000,
    defaultShots: 1024,
  },
  grover: {
    maxSearchSpace: 1000000000,
    allowedOracleOps: ['==', '!=', '<', '>', '<=', '>=', '&&', '||', '!', '+', '-', '*', '/', '%'],
  },
  resourceLimits: {
    maxMemoryBytes: 4294967296,
    maxCpuTimeMs: 600000,
    maxIterations: 1000000,
  },
};

// Import QuantumOptimizerConfig type for the validateConfig function
import type { QuantumOptimizerConfig } from './types.js';
