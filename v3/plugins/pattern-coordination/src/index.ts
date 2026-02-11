/**
 * Pattern Coordination Plugin
 *
 * Multi-agent neural coordination for swarm intelligence using
 * Pattern, GNN, and attention mechanisms.
 *
 * Features:
 * - Neural consensus protocols (pattern voting, iterative refinement, auction, contract net)
 * - GNN-based topology optimization (mesh, tree, ring, star, hybrid)
 * - Collective memory with EWC consolidation
 * - Emergent communication protocol learning
 * - Swarm behavior orchestration (flocking, foraging, formation, etc.)
 *
 * @packageDocumentation
 */

// Export types
export * from './types.js';

// Export MCP tools
export {
  neuralConsensusTool,
  topologyOptimizeTool,
  collectiveMemoryTool,
  emergentProtocolTool,
  swarmBehaviorTool,
  neuralCoordinationTools,
  toolHandlers,
  getTool,
  getToolNames,
} from './mcp-tools.js';

// Export bridges
export {
  NervousSystemBridge,
  createNervousSystemBridge,
  AttentionBridge,
  createAttentionBridge,
} from './bridges/index.js';

// Re-export bridge types
export type {
  NervousSystemConfig,
  NeuralSignal,
  CoordinationResult,
} from './bridges/nervous-system-bridge.js';

export type {
  AttentionConfig,
  AttentionOutput,
} from './bridges/attention-bridge.js';

import type { MCPTool } from './types.js';
import { neuralCoordinationTools } from './mcp-tools.js';
import { NervousSystemBridge, createNervousSystemBridge } from './bridges/nervous-system-bridge.js';
import { AttentionBridge, createAttentionBridge } from './bridges/attention-bridge.js';

/**
 * Pattern Coordination Plugin metadata
 */
export const PLUGIN_METADATA = {
  name: '@claude-flow/plugin-pattern-coordination',
  version: '3.0.0-alpha.1',
  description: 'Neural coordination plugin for multi-agent swarm intelligence',
  author: 'Claude Flow Team',
  keywords: [
    'pattern-coordination',
    'multi-agent',
    'swarm',
    'voting',
    'topology',
    'patterns',
    'gnn',
    'attention',
  ],
} as const;

/**
 * Plugin state
 */
export interface PatternCoordinationPluginState {
  initialized: boolean;
  nervousSystemBridge: NervousSystemBridge | null;
  attentionBridge: AttentionBridge | null;
}

let pluginState: PatternCoordinationPluginState = {
  initialized: false,
  nervousSystemBridge: null,
  attentionBridge: null,
};

/**
 * Initialize the neural coordination plugin
 */
export async function initializePlugin(): Promise<void> {
  if (pluginState.initialized) return;

  // Initialize bridges
  pluginState.nervousSystemBridge = createNervousSystemBridge();
  pluginState.attentionBridge = createAttentionBridge();

  await Promise.all([
    pluginState.nervousSystemBridge.init(),
    pluginState.attentionBridge.init(),
  ]);

  pluginState.initialized = true;
}

/**
 * Shutdown the neural coordination plugin
 */
export async function shutdownPlugin(): Promise<void> {
  if (!pluginState.initialized) return;

  await Promise.all([
    pluginState.nervousSystemBridge?.destroy(),
    pluginState.attentionBridge?.destroy(),
  ]);

  pluginState = {
    initialized: false,
    nervousSystemBridge: null,
    attentionBridge: null,
  };
}

/**
 * Get plugin state
 */
export function getPluginState(): PatternCoordinationPluginState {
  return { ...pluginState };
}

/**
 * Get all MCP tools provided by this plugin
 */
export function getMCPTools(): MCPTool[] {
  return neuralCoordinationTools;
}

/**
 * Plugin interface for registration with Claude Flow
 */
export const neuralCoordinationPlugin = {
  metadata: PLUGIN_METADATA,
  state: 'uninitialized' as 'uninitialized' | 'initializing' | 'ready' | 'error',

  async initialize(): Promise<void> {
    this.state = 'initializing';
    try {
      await initializePlugin();
      this.state = 'ready';
    } catch (error) {
      this.state = 'error';
      throw error;
    }
  },

  async shutdown(): Promise<void> {
    await shutdownPlugin();
    this.state = 'uninitialized';
  },

  getMCPTools(): MCPTool[] {
    return neuralCoordinationTools;
  },

  getAgentTypes(): string[] {
    return [
      'neural-coordinator',
      'topology-optimizer',
      'collective-memory-manager',
      'protocol-learner',
      'swarm-orchestrator',
    ];
  },
};

export default neuralCoordinationPlugin;
