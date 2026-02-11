/**
 * @claude-flow/plugin-test-intelligence
 *
 * AI-powered test intelligence plugin for Claude Flow V3.
 *
 * Features:
 * - Predictive test selection using reinforcement learning
 * - Flaky test detection and analysis
 * - Test coverage gap identification
 * - Mutation testing optimization
 * - Test case generation suggestions
 *
 * Uses RuVector WASM packages for high-performance analysis:
 * - ruvector-learning-wasm: RL-based test selection
 * - Pattern: Continuous pattern learning
 * - micro-hnsw-wasm: Code-to-test similarity matching
 */

// Types
export * from './types.js';

// MCP Tools
export {
  selectPredictiveTool,
  flakyDetectTool,
  coverageGapsTool,
  mutationOptimizeTool,
  generateSuggestTool,
  testIntelligenceTools,
} from './mcp-tools.js';

// Bridges
export { TestLearningBridge, createTestLearningBridge } from './bridges/learning-bridge.js';
export { TestSonaBridge, createTestSonaBridge } from './bridges/sona-bridge.js';

// Plugin metadata
export const pluginMetadata = {
  name: '@claude-flow/plugin-test-intelligence',
  version: '3.0.0-alpha.1',
  description: 'AI-powered test intelligence for predictive selection, flaky detection, and coverage optimization',
  category: 'testing',
  tags: ['testing', 'ci-optimization', 'machine-learning', 'coverage', 'mutation-testing'],
  author: 'Claude Flow Team',
  license: 'MIT',
  repository: 'https://github.com/ruvnet/claude-flow',
  engines: {
    'claude-flow': '>=3.0.0-alpha.1',
    node: '>=18.0.0',
  },
  capabilities: {
    mcpTools: [
      'test/select-predictive',
      'test/flaky-detect',
      'test/coverage-gaps',
      'test/mutation-optimize',
      'test/generate-suggest',
    ],
    bridges: ['learning', 'sona'],
    wasmPackages: [
      'ruvector-learning-wasm',
      'micro-hnsw-wasm',
      'sona',
    ],
  },
  performanceTargets: {
    testSelection: '<1s for 10K tests',
    flakyDetection: '<5s for 1000 test runs',
    coverageAnalysis: '<10s for 100K LOC',
    mutationOptimization: '80% score in 20% time',
    ciTimeReduction: '60-80%',
  },
};

// Plugin initialization
export interface TestIntelligencePluginOptions {
  learningConfig?: {
    algorithm?: 'q-learning' | 'ppo' | 'decision-transformer';
    learningRate?: number;
    gamma?: number;
    batchSize?: number;
  };
  sonaConfig?: {
    mode?: 'real-time' | 'balanced' | 'research' | 'edge' | 'batch';
    loraRank?: number;
    learningRate?: number;
    ewcLambda?: number;
  };
  selection?: {
    defaultStrategy?: 'fast_feedback' | 'high_coverage' | 'risk_based' | 'balanced';
    defaultConfidence?: number;
    maxTests?: number;
  };
  flaky?: {
    historyDepth?: number;
    threshold?: number;
    quarantineEnabled?: boolean;
  };
}

/**
 * Initialize the test intelligence plugin
 */
export async function initializePlugin(
  options?: TestIntelligencePluginOptions
): Promise<{
  learningBridge: InstanceType<typeof import('./bridges/learning-bridge.js').TestLearningBridge>;
  sonaBridge: InstanceType<typeof import('./bridges/sona-bridge.js').TestSonaBridge>;
  tools: typeof import('./mcp-tools.js').testIntelligenceTools;
}> {
  const { createTestLearningBridge } = await import('./bridges/learning-bridge.js');
  const { createTestSonaBridge } = await import('./bridges/sona-bridge.js');
  const { testIntelligenceTools } = await import('./mcp-tools.js');

  const learningBridge = createTestLearningBridge(options?.learningConfig);
  const sonaBridge = createTestSonaBridge(options?.sonaConfig);

  await Promise.all([
    learningBridge.init(),
    sonaBridge.init(),
  ]);

  return {
    learningBridge,
    sonaBridge,
    tools: testIntelligenceTools,
  };
}

/**
 * Plugin entry point for Claude Flow plugin loader
 */
export default {
  metadata: pluginMetadata,
  initialize: initializePlugin,
};
