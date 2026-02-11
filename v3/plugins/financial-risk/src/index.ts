/**
 * Financial Risk Analysis Plugin
 *
 * A high-performance financial risk analysis plugin combining
 * sparse inference for efficient market signal processing with
 * graph pattern networks for transaction network analysis.
 *
 * Features:
 * - Portfolio risk analysis (VaR, CVaR, Sharpe, Sortino)
 * - Transaction anomaly detection using GNN
 * - Market regime classification
 * - Regulatory compliance checking (Basel III, MiFID II, AML)
 * - Stress testing with historical and hypothetical scenarios
 *
 * Compliance:
 * - SOX and MiFID II compliant audit logging
 * - Deterministic execution for reproducibility
 * - Role-based access control
 * - Rate limiting for fair resource allocation
 *
 * @packageDocumentation
 * @module @claude-flow/plugin-financial-risk
 */

// Export all types
export * from './types.js';

// Export MCP tools
export {
  financialTools,
  toolHandlers,
  getTool,
  getToolNames,
  portfolioRiskTool,
  anomalyDetectTool,
  marketRegimeTool,
  complianceCheckTool,
  stressTestTool,
} from './mcp-tools.js';

// Export bridges
export {
  FinancialEconomyBridge,
  createEconomyBridge,
  PortfolioRiskCalculator,
} from './bridges/economy-bridge.js';

export {
  FinancialSparseBridge,
  createSparseBridge,
  AnomalyDetector,
  MarketRegimeClassifier,
} from './bridges/sparse-bridge.js';

// Import for plugin definition
import { financialTools } from './mcp-tools.js';
import { FinancialEconomyBridge } from './bridges/economy-bridge.js';
import { FinancialSparseBridge } from './bridges/sparse-bridge.js';
import type { FinancialConfig, FinancialBridge, Logger } from './types.js';
import { DEFAULT_FINANCIAL_CONFIG } from './types.js';

/**
 * Plugin metadata
 */
export const pluginMetadata = {
  name: '@claude-flow/plugin-financial-risk',
  version: '3.0.0-alpha.1',
  description: 'High-performance financial risk analysis with portfolio risk, anomaly detection, and compliance checking',
  author: 'rUv',
  license: 'MIT',
  category: 'finance',
  tags: ['finance', 'risk', 'portfolio', 'var', 'anomaly-detection', 'compliance', 'basel3', 'mifid2'],
  wasmPackages: [
    'micro-hnsw-wasm',
    'ruvector-sparse-inference-wasm',
    'ruvector-gnn-wasm',
    'ruvector-economy-wasm',
    'ruvector-learning-wasm',
  ],
};

/**
 * Financial Risk Plugin class
 */
export class FinancialRiskPlugin {
  private config: FinancialConfig;
  private logger: Logger;
  private bridge: FinancialBridge;
  private initialized = false;

  constructor(config?: Partial<FinancialConfig>, logger?: Logger) {
    this.config = { ...DEFAULT_FINANCIAL_CONFIG, ...config };
    this.logger = logger ?? {
      debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[financial-plugin] ${msg}`, meta),
      info: (msg: string, meta?: Record<string, unknown>) => console.info(`[financial-plugin] ${msg}`, meta),
      warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[financial-plugin] ${msg}`, meta),
      error: (msg: string, meta?: Record<string, unknown>) => console.error(`[financial-plugin] ${msg}`, meta),
    };
    this.bridge = {
      economy: undefined,
      sparse: undefined,
      initialized: false,
    };
  }

  /**
   * Initialize the plugin
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logger.info('Initializing Financial Risk Plugin');

    try {
      // Initialize Economy bridge
      const economyBridge = new FinancialEconomyBridge(
        { randomSeed: this.config.risk.defaultConfidenceLevel },
        this.logger
      );
      await economyBridge.initialize();
      this.bridge.economy = economyBridge;

      // Initialize Sparse bridge
      const sparseBridge = new FinancialSparseBridge(
        { sparsityThreshold: this.config.anomaly.defaultThreshold },
        this.logger
      );
      await sparseBridge.initialize();
      this.bridge.sparse = sparseBridge;

      this.bridge.initialized = true;
      this.initialized = true;

      this.logger.info('Financial Risk Plugin initialized successfully', {
        economyReady: economyBridge.initialized,
        sparseReady: sparseBridge.initialized,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Financial Risk Plugin', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all MCP tools
   */
  getTools() {
    return financialTools;
  }

  /**
   * Get the bridge for tool execution
   */
  getBridge(): FinancialBridge {
    return this.bridge;
  }

  /**
   * Get plugin configuration
   */
  getConfig(): FinancialConfig {
    return this.config;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.bridge.economy) {
      (this.bridge.economy as FinancialEconomyBridge).destroy();
    }
    if (this.bridge.sparse) {
      (this.bridge.sparse as FinancialSparseBridge).destroy();
    }
    this.bridge.initialized = false;
    this.initialized = false;
    this.logger.info('Financial Risk Plugin destroyed');
  }
}

/**
 * Create a new Financial Risk Plugin instance
 */
export function createFinancialPlugin(
  config?: Partial<FinancialConfig>,
  logger?: Logger
): FinancialRiskPlugin {
  return new FinancialRiskPlugin(config, logger);
}

/**
 * Default export for plugin loader
 */
export default {
  metadata: pluginMetadata,
  tools: financialTools,
  createPlugin: createFinancialPlugin,
  FinancialRiskPlugin,
};
