/**
 * @claude-flow/plugin-perf-optimizer
 *
 * AI-powered performance optimization plugin for Claude Flow V3.
 *
 * Features:
 * - Bottleneck detection using trace analysis
 * - Memory leak detection and analysis
 * - Database query optimization (N+1, missing indexes)
 * - JavaScript bundle optimization
 * - Configuration tuning with pattern learning
 *
 * Uses RuVector WASM packages for high-performance analysis:
 * - ruvector-sparse-inference-wasm: Efficient trace processing
 * - ruvector-fpga-transformer-wasm: Fast configuration optimization
 * - ruvector-gnn-wasm: Dependency chain analysis
 */

// Types
export * from './types.js';

// MCP Tools
export {
  bottleneckDetectTool,
  memoryAnalyzeTool,
  queryOptimizeTool,
  bundleOptimizeTool,
  configOptimizeTool,
  perfOptimizerTools,
} from './mcp-tools.js';

// Bridges
export { PerfSparseBridge, createPerfSparseBridge } from './bridges/sparse-bridge.js';
export { PerfFpgaBridge, createPerfFpgaBridge } from './bridges/fpga-bridge.js';

// Plugin metadata
export const pluginMetadata = {
  name: '@claude-flow/plugin-perf-optimizer',
  version: '3.0.0-alpha.1',
  description: 'AI-powered performance optimization for bottleneck detection, memory analysis, and configuration tuning',
  category: 'performance',
  tags: ['performance', 'optimization', 'tracing', 'memory', 'database', 'bundle'],
  author: 'Claude Flow Team',
  license: 'MIT',
  repository: 'https://github.com/ruvnet/claude-flow',
  engines: {
    'claude-flow': '>=3.0.0-alpha.1',
    node: '>=18.0.0',
  },
  capabilities: {
    mcpTools: [
      'perf/bottleneck-detect',
      'perf/memory-analyze',
      'perf/query-optimize',
      'perf/bundle-optimize',
      'perf/config-optimize',
    ],
    bridges: ['sparse', 'fpga'],
    wasmPackages: [
      'ruvector-sparse-inference-wasm',
      'ruvector-fpga-transformer-wasm',
      'ruvector-gnn-wasm',
      'micro-hnsw-wasm',
      'sona',
    ],
  },
  performanceTargets: {
    traceAnalysis: '<5s for 1M spans',
    memoryAnalysis: '<30s for 1GB heap',
    queryPatternDetection: '<1s for 10K queries',
    bundleAnalysis: '<10s for 10MB bundle',
    configOptimization: '<1min convergence',
  },
  supportedFormats: {
    tracing: ['otlp', 'jaeger', 'zipkin', 'chrome_devtools'],
    profiling: ['chrome_cpu_profile', 'nodejs_profile', 'pprof'],
    memory: ['chrome_heap_snapshot', 'nodejs_heap'],
    bundles: ['webpack_stats', 'vite_stats', 'rollup'],
  },
};

// Plugin initialization
export interface PerfOptimizerPluginOptions {
  sparseConfig?: {
    maxDimensions?: number;
    sparsityRatio?: number;
    hashBuckets?: number;
  };
  fpgaConfig?: {
    modelSize?: 'small' | 'medium' | 'large';
    searchIterations?: number;
    explorationRate?: number;
    bayesianOptimization?: boolean;
  };
  bottleneck?: {
    latencyThresholdMs?: number;
    errorRateThreshold?: number;
    cpuThreshold?: number;
    memoryThreshold?: number;
  };
  memory?: {
    leakThresholdMb?: number;
    gcPressureThreshold?: number;
    maxHeapSize?: number;
  };
  query?: {
    slowQueryThresholdMs?: number;
    maxResultSize?: number;
    indexSuggestionEnabled?: boolean;
  };
  bundle?: {
    maxSizeKb?: number;
    treeshakingEnabled?: boolean;
    codeSplittingEnabled?: boolean;
  };
}

/**
 * Initialize the performance optimizer plugin
 */
export async function initializePlugin(
  options?: PerfOptimizerPluginOptions
): Promise<{
  sparseBridge: InstanceType<typeof import('./bridges/sparse-bridge.js').PerfSparseBridge>;
  fpgaBridge: InstanceType<typeof import('./bridges/fpga-bridge.js').PerfFpgaBridge>;
  tools: typeof import('./mcp-tools.js').perfOptimizerTools;
}> {
  const { createPerfSparseBridge } = await import('./bridges/sparse-bridge.js');
  const { createPerfFpgaBridge } = await import('./bridges/fpga-bridge.js');
  const { perfOptimizerTools } = await import('./mcp-tools.js');

  const sparseBridge = createPerfSparseBridge(options?.sparseConfig);
  const fpgaBridge = createPerfFpgaBridge(options?.fpgaConfig);

  await Promise.all([
    sparseBridge.init(),
    fpgaBridge.init(),
  ]);

  return {
    sparseBridge,
    fpgaBridge,
    tools: perfOptimizerTools,
  };
}

/**
 * Plugin entry point for Claude Flow plugin loader
 */
export default {
  metadata: pluginMetadata,
  initialize: initializePlugin,
};
