/**
 * Legal Contracts Plugin for Claude Flow V3
 *
 * A comprehensive legal contract analysis plugin combining hyperbolic embeddings
 * for legal ontology navigation with fast vector search for clause similarity.
 *
 * Features:
 * - Clause extraction and classification
 * - Risk assessment with severity scoring
 * - Contract comparison with attention-based alignment
 * - Obligation tracking with DAG analysis
 * - Playbook matching for negotiation support
 *
 * Based on ADR-034: Legal Contract Analysis Plugin
 *
 * @module @claude-flow/plugin-legal-contracts
 */

// Export types
export * from './types.js';

// Export bridges
export { AttentionBridge, createAttentionBridge } from './bridges/attention-bridge.js';
export { DAGBridge, createDAGBridge } from './bridges/dag-bridge.js';

// Export MCP tools
export {
  clauseExtractTool,
  riskAssessTool,
  contractCompareTool,
  obligationTrackTool,
  playbookMatchTool,
  legalContractsTools,
  toolHandlers,
  createToolContext,
} from './mcp-tools.js';
export type { MCPTool, ToolContext, MCPToolResult } from './mcp-tools.js';

// Import for plugin creation
import { legalContractsTools } from './mcp-tools.js';
import { createAttentionBridge } from './bridges/attention-bridge.js';
import { createDAGBridge } from './bridges/dag-bridge.js';
import type {
  LegalContractsConfig,
  IAttentionBridge,
  IDAGBridge,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Plugin metadata
 */
export const pluginMetadata = {
  name: '@claude-flow/plugin-legal-contracts',
  version: '3.0.0-alpha.1',
  description: 'Legal contract analysis plugin for clause extraction, risk assessment, and comparison',
  author: 'Claude Flow Team',
  category: 'legal',
  keywords: ['legal', 'contracts', 'clause', 'risk', 'compliance'],
  homepage: 'https://github.com/ruvnet/claude-flow',
  repository: 'https://github.com/ruvnet/claude-flow.git',
};

/**
 * Plugin state
 */
export type PluginState = 'uninitialized' | 'initializing' | 'ready' | 'error' | 'shutdown';

/**
 * Legal Contracts Plugin Class
 */
export class LegalContractsPlugin {
  private state: PluginState = 'uninitialized';
  private config: LegalContractsConfig;
  private attentionBridge: IAttentionBridge | null = null;
  private dagBridge: IDAGBridge | null = null;

  constructor(config: Partial<LegalContractsConfig> = {}) {
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
      this.attentionBridge = createAttentionBridge(this.config.extraction.embeddingDimension);
      this.dagBridge = createDAGBridge();

      await Promise.all([
        this.attentionBridge.initialize(),
        this.dagBridge.initialize(),
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
    this.attentionBridge = null;
    this.dagBridge = null;
  }

  /**
   * Get MCP tools provided by this plugin
   */
  getMCPTools() {
    return legalContractsTools;
  }

  /**
   * Get tool context for execution
   */
  getToolContext() {
    if (!this.attentionBridge || !this.dagBridge) {
      throw new Error('Plugin not initialized');
    }

    const store = new Map<string, unknown>();

    return {
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: <T>(key: string, value: T) => { store.set(key, value); },
      bridges: {
        attention: this.attentionBridge,
        dag: this.dagBridge,
      },
    };
  }

  /**
   * Get configuration
   */
  getConfig(): LegalContractsConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LegalContractsConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      extraction: { ...this.config.extraction, ...config.extraction },
      risk: { ...this.config.risk, ...config.risk },
      comparison: { ...this.config.comparison, ...config.comparison },
      security: { ...this.config.security, ...config.security },
    };
  }
}

/**
 * Create plugin instance
 */
export function createPlugin(config?: Partial<LegalContractsConfig>): LegalContractsPlugin {
  return new LegalContractsPlugin(config);
}

/**
 * Default export
 */
export default LegalContractsPlugin;
