/**
 * Code Intelligence Plugin for Claude Flow V3
 *
 * A comprehensive code intelligence plugin combining graph pattern networks
 * for code structure analysis with ultra-fast vector search for semantic
 * code similarity.
 *
 * Features:
 * - Semantic code search
 * - Architecture analysis and drift detection
 * - Refactoring impact prediction using GNN
 * - Module splitting suggestions using MinCut
 * - Pattern learning from code history
 *
 * Based on ADR-035: Advanced Code Intelligence Plugin
 *
 * @module @claude-flow/plugin-code-intelligence
 */

// Export types
export * from './types.js';

// Export bridges
export { GNNBridge, createGNNBridge } from './bridges/gnn-bridge.js';
export { MinCutBridge, createMinCutBridge } from './bridges/mincut-bridge.js';

// Export MCP tools
export {
  semanticSearchTool,
  architectureAnalyzeTool,
  refactorImpactTool,
  splitSuggestTool,
  learnPatternsTool,
  codeIntelligenceTools,
  toolHandlers,
  createToolContext,
} from './mcp-tools.js';
export type { MCPTool, ToolContext, MCPToolResult } from './mcp-tools.js';

// Import for plugin creation
import { codeIntelligenceTools } from './mcp-tools.js';
import { createGNNBridge } from './bridges/gnn-bridge.js';
import { createMinCutBridge } from './bridges/mincut-bridge.js';
import type {
  CodeIntelligenceConfig,
  IGNNBridge,
  IMinCutBridge,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Plugin metadata
 */
export const pluginMetadata = {
  name: '@claude-flow/plugin-code-intelligence',
  version: '3.0.0-alpha.1',
  description: 'Advanced code intelligence plugin for semantic search, architecture analysis, and refactoring',
  author: 'Claude Flow Team',
  category: 'code-intelligence',
  keywords: ['code', 'intelligence', 'semantic-search', 'architecture', 'refactoring'],
  homepage: 'https://github.com/ruvnet/claude-flow',
  repository: 'https://github.com/ruvnet/claude-flow.git',
};

/**
 * Plugin state
 */
export type PluginState = 'uninitialized' | 'initializing' | 'ready' | 'error' | 'shutdown';

/**
 * Code Intelligence Plugin Class
 */
export class CodeIntelligencePlugin {
  private state: PluginState = 'uninitialized';
  private config: CodeIntelligenceConfig;
  private gnnBridge: IGNNBridge | null = null;
  private mincutBridge: IMinCutBridge | null = null;

  constructor(config: Partial<CodeIntelligenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get plugin metadata
   */
  getMetadata() {
    return pluginMetadata;
  }

  /**
   * Get current state
   */
  getState(): PluginState {
    return this.state;
  }

  /**
   * Initialize the plugin
   */
  async initialize(): Promise<void> {
    if (this.state === 'ready') return;

    this.state = 'initializing';

    try {
      // Initialize WASM bridges
      this.gnnBridge = createGNNBridge(this.config.search.embeddingDimension);
      this.mincutBridge = createMinCutBridge();

      await Promise.all([
        this.gnnBridge.initialize(),
        this.mincutBridge.initialize(),
      ]);

      this.state = 'ready';
    } catch (error) {
      this.state = 'error';
      throw error;
    }
  }

  /**
   * Shutdown the plugin
   */
  async shutdown(): Promise<void> {
    this.state = 'shutdown';
    this.gnnBridge = null;
    this.mincutBridge = null;
  }

  /**
   * Get MCP tools provided by this plugin
   */
  getMCPTools() {
    return codeIntelligenceTools;
  }

  /**
   * Get tool context for execution
   */
  getToolContext() {
    if (!this.gnnBridge || !this.mincutBridge) {
      throw new Error('Plugin not initialized');
    }

    const store = new Map<string, unknown>();

    const blockedPatterns = this.config.security.blockedPatterns.map(
      p => new RegExp(p)
    );

    return {
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: <T>(key: string, value: T) => { store.set(key, value); },
      bridges: {
        gnn: this.gnnBridge,
        mincut: this.mincutBridge,
      },
      config: {
        allowedRoots: this.config.security.allowedRoots,
        blockedPatterns,
        maskSecrets: this.config.security.maskSecrets,
      },
    };
  }

  /**
   * Get configuration
   */
  getConfig(): CodeIntelligenceConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CodeIntelligenceConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      search: { ...this.config.search, ...config.search },
      architecture: { ...this.config.architecture, ...config.architecture },
      refactoring: { ...this.config.refactoring, ...config.refactoring },
      security: { ...this.config.security, ...config.security },
    };
  }
}

/**
 * Create plugin instance
 */
export function createPlugin(config?: Partial<CodeIntelligenceConfig>): CodeIntelligencePlugin {
  return new CodeIntelligencePlugin(config);
}

/**
 * Default export
 */
export default CodeIntelligencePlugin;
