/**
 * Cognitive Kernel Plugin
 *
 * Cognitive augmentation for LLM reasoning with working memory,
 * attention control, meta-cognition, scaffolding, and cognitive load management.
 *
 * Features:
 * - Working memory slot management (Miller's 7 +/- 2)
 * - Attention control (focus, diffuse, selective, divided, sustained)
 * - Meta-cognitive monitoring and reflection
 * - Cognitive scaffolding (decomposition, analogy, Socratic, etc.)
 * - Cognitive load theory optimization
 * - Pattern integration for continuous learning
 *
 * @packageDocumentation
 */

// Export types
export * from './types.js';

// Export MCP tools
export {
  workingMemoryTool,
  attentionControlTool,
  metaMonitorTool,
  scaffoldTool,
  cognitiveLoadTool,
  cognitiveKernelTools,
  toolHandlers,
  getTool,
  getToolNames,
} from './mcp-tools.js';

// Export bridges
export {
  CognitiveBridge,
  createCognitiveBridge,
  SonaBridge,
  createSonaBridge,
} from './bridges/index.js';

// Re-export bridge types
export type {
  CognitiveConfig,
  AttentionState,
} from './bridges/cognitive-bridge.js';

export type {
  SonaConfig,
  SonaTrajectory,
  SonaStep,
  LoRAWeights,
  EWCState,
  SonaPrediction,
} from './bridges/sona-bridge.js';

import type { MCPTool } from './types.js';
import { cognitiveKernelTools } from './mcp-tools.js';
import { CognitiveBridge, createCognitiveBridge } from './bridges/cognitive-bridge.js';
import { SonaBridge, createSonaBridge } from './bridges/sona-bridge.js';

/**
 * Cognitive Kernel Plugin metadata
 */
export const PLUGIN_METADATA = {
  name: '@claude-flow/plugin-cognitive-kernel',
  version: '3.0.0-alpha.1',
  description: 'Cognitive kernel plugin for LLM augmentation',
  author: 'Claude Flow Team',
  keywords: [
    'cognitive-kernel',
    'working-memory',
    'attention',
    'meta-cognition',
    'scaffolding',
    'sona',
    'cognitum',
  ],
} as const;

/**
 * Plugin state
 */
export interface CognitiveKernelPluginState {
  initialized: boolean;
  cognitiveBridge: CognitiveBridge | null;
  sonaBridge: SonaBridge | null;
}

let pluginState: CognitiveKernelPluginState = {
  initialized: false,
  cognitiveBridge: null,
  sonaBridge: null,
};

/**
 * Initialize the cognitive kernel plugin
 */
export async function initializePlugin(): Promise<void> {
  if (pluginState.initialized) return;

  // Initialize bridges
  pluginState.cognitiveBridge = createCognitiveBridge();
  pluginState.sonaBridge = createSonaBridge();

  await Promise.all([
    pluginState.cognitiveBridge.init(),
    pluginState.sonaBridge.init(),
  ]);

  pluginState.initialized = true;
}

/**
 * Shutdown the cognitive kernel plugin
 */
export async function shutdownPlugin(): Promise<void> {
  if (!pluginState.initialized) return;

  await Promise.all([
    pluginState.cognitiveBridge?.destroy(),
    pluginState.sonaBridge?.destroy(),
  ]);

  pluginState = {
    initialized: false,
    cognitiveBridge: null,
    sonaBridge: null,
  };
}

/**
 * Get plugin state
 */
export function getPluginState(): CognitiveKernelPluginState {
  return { ...pluginState };
}

/**
 * Get all MCP tools provided by this plugin
 */
export function getMCPTools(): MCPTool[] {
  return cognitiveKernelTools;
}

/**
 * Plugin interface for registration with Claude Flow
 */
export const cognitiveKernelPlugin = {
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
    return cognitiveKernelTools;
  },

  getAgentTypes(): string[] {
    return [
      'cognitive-controller',
      'working-memory-manager',
      'attention-director',
      'meta-cognitive-monitor',
      'scaffold-generator',
      'cognitive-load-optimizer',
    ];
  },
};

export default cognitiveKernelPlugin;
