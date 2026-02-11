/**
 * Healthcare Clinical Decision Support Plugin
 *
 * A HIPAA-compliant clinical decision support plugin that combines
 * ultra-fast vector search for medical literature retrieval with
 * graph pattern networks for patient pathway analysis.
 *
 * Features:
 * - Patient similarity search using HNSW (150x faster)
 * - Drug interaction detection using GNN
 * - Clinical pathway recommendations
 * - Medical literature semantic search
 * - Ontology navigation (ICD-10, SNOMED-CT, LOINC, RxNorm)
 *
 * HIPAA Compliance:
 * - All patient data processed locally in WASM sandbox
 * - No PHI transmitted externally
 * - Complete audit logging
 * - Role-based access control
 *
 * @packageDocumentation
 * @module @claude-flow/plugin-healthcare-clinical
 */

// Export all types
export * from './types.js';

// Export MCP tools
export {
  healthcareTools,
  toolHandlers,
  getTool,
  getToolNames,
  patientSimilarityTool,
  drugInteractionsTool,
  clinicalPathwaysTool,
  literatureSearchTool,
  ontologyNavigateTool,
} from './mcp-tools.js';

// Export bridges
export {
  HealthcareHNSWBridge,
  createHNSWBridge,
  PatientEmbeddingGenerator,
} from './bridges/hnsw-bridge.js';

export {
  HealthcareGNNBridge,
  createGNNBridge,
} from './bridges/gnn-bridge.js';

// Import for plugin definition
import { healthcareTools } from './mcp-tools.js';
import { HealthcareHNSWBridge } from './bridges/hnsw-bridge.js';
import { HealthcareGNNBridge } from './bridges/gnn-bridge.js';
import type { HealthcareConfig, HealthcareBridge, Logger } from './types.js';
import { DEFAULT_HEALTHCARE_CONFIG } from './types.js';

/**
 * Plugin metadata
 */
export const pluginMetadata = {
  name: '@claude-flow/plugin-healthcare-clinical',
  version: '3.0.0-alpha.1',
  description: 'HIPAA-compliant clinical decision support with patient similarity, drug interactions, and clinical pathways',
  author: 'rUv',
  license: 'MIT',
  category: 'healthcare',
  tags: ['healthcare', 'clinical', 'hipaa', 'fhir', 'patient-similarity', 'drug-interactions'],
  wasmPackages: [
    'micro-hnsw-wasm',
    'ruvector-gnn-wasm',
    'ruvector-hyperbolic-hnsw-wasm',
    'ruvector-sparse-inference-wasm',
  ],
};

/**
 * Healthcare Clinical Plugin class
 */
export class HealthcareClinicalPlugin {
  private config: HealthcareConfig;
  private logger: Logger;
  private bridge: HealthcareBridge;
  private initialized = false;

  constructor(config?: Partial<HealthcareConfig>, logger?: Logger) {
    this.config = { ...DEFAULT_HEALTHCARE_CONFIG, ...config };
    this.logger = logger ?? {
      debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[healthcare-plugin] ${msg}`, meta),
      info: (msg: string, meta?: Record<string, unknown>) => console.info(`[healthcare-plugin] ${msg}`, meta),
      warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[healthcare-plugin] ${msg}`, meta),
      error: (msg: string, meta?: Record<string, unknown>) => console.error(`[healthcare-plugin] ${msg}`, meta),
    };
    this.bridge = {
      hnsw: undefined,
      gnn: undefined,
      initialized: false,
    };
  }

  /**
   * Initialize the plugin
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.logger.info('Initializing Healthcare Clinical Plugin');

    try {
      // Initialize HNSW bridge
      const hnswBridge = new HealthcareHNSWBridge(this.config.hnsw, this.logger);
      await hnswBridge.initialize();
      this.bridge.hnsw = hnswBridge;

      // Initialize GNN bridge
      const gnnBridge = new HealthcareGNNBridge(this.config.gnn, this.logger);
      await gnnBridge.initialize();
      this.bridge.gnn = gnnBridge;

      this.bridge.initialized = true;
      this.initialized = true;

      this.logger.info('Healthcare Clinical Plugin initialized successfully', {
        hnswReady: hnswBridge.initialized,
        gnnReady: gnnBridge.initialized,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Healthcare Clinical Plugin', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get all MCP tools
   */
  getTools() {
    return healthcareTools;
  }

  /**
   * Get the bridge for tool execution
   */
  getBridge(): HealthcareBridge {
    return this.bridge;
  }

  /**
   * Get plugin configuration
   */
  getConfig(): HealthcareConfig {
    return this.config;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.bridge.hnsw) {
      (this.bridge.hnsw as HealthcareHNSWBridge).destroy();
    }
    if (this.bridge.gnn) {
      (this.bridge.gnn as HealthcareGNNBridge).destroy();
    }
    this.bridge.initialized = false;
    this.initialized = false;
    this.logger.info('Healthcare Clinical Plugin destroyed');
  }
}

/**
 * Create a new Healthcare Clinical Plugin instance
 */
export function createHealthcarePlugin(
  config?: Partial<HealthcareConfig>,
  logger?: Logger
): HealthcareClinicalPlugin {
  return new HealthcareClinicalPlugin(config, logger);
}

/**
 * Default export for plugin loader
 */
export default {
  metadata: pluginMetadata,
  tools: healthcareTools,
  createPlugin: createHealthcarePlugin,
  HealthcareClinicalPlugin,
};
