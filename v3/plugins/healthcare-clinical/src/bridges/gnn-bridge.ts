/**
 * GNN Bridge - Healthcare Clinical Plugin
 *
 * Provides Graph Neural Network capabilities for clinical pathway
 * analysis and drug interaction detection. Integrates with
 * ruvector-gnn-wasm for efficient graph-based reasoning.
 *
 * Use Cases:
 * - Clinical pathway recommendations
 * - Drug interaction network analysis
 * - Comorbidity pattern detection
 * - Treatment outcome prediction
 */

import type {
  GNNBridge,
  GNNConfig,
  GNNNode,
  GNNEdge,
  GNNPathResult,
  GNNInteractionResult,
  DrugInteraction,
  InteractionSeverity,
  ClinicalPathway,
  Logger,
} from '../types.js';

/**
 * Default logger
 */
const defaultLogger: Logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[gnn-bridge] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => console.info(`[gnn-bridge] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[gnn-bridge] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[gnn-bridge] ${msg}`, meta),
};

/**
 * WASM module interface for ruvector-gnn-wasm
 */
interface GNNWasmModule {
  create_graph(numNodes: number, numEdges: number, featureDim: number): number;
  add_node(graphPtr: number, nodeId: number, features: Float32Array): boolean;
  add_edge(graphPtr: number, source: number, target: number, edgeType: number, weight: number): boolean;
  forward(graphPtr: number, nodeFeatures: Float32Array): Float32Array;
  predict_path(graphPtr: number, startNode: number, endNode: number, maxHops: number): Uint32Array;
  analyze_subgraph(graphPtr: number, nodeIds: Uint32Array): Float32Array;
  free_graph(graphPtr: number): void;
  memory: { buffer: ArrayBuffer };
}

/**
 * Drug interaction graph with known interactions
 */
class DrugInteractionGraph {
  private interactions: Map<string, DrugInteraction[]> = new Map();
  private readonly severityOrder: InteractionSeverity[] = ['contraindicated', 'major', 'moderate', 'minor'];

  constructor() {
    this.loadKnownInteractions();
  }

  /**
   * Load known drug interactions
   * In production, this would load from a clinical database
   */
  private loadKnownInteractions(): void {
    // Sample known drug-drug interactions
    const knownInteractions: DrugInteraction[] = [
      {
        drug1: 'warfarin',
        drug2: 'aspirin',
        severity: 'major',
        description: 'Increased risk of bleeding when warfarin is combined with aspirin',
        mechanism: 'Both drugs affect blood clotting through different mechanisms',
        clinicalEffect: 'Enhanced anticoagulation, increased bleeding risk',
        management: 'Monitor INR closely, consider alternative antiplatelet agent',
      },
      {
        drug1: 'metformin',
        drug2: 'contrast_dye',
        severity: 'major',
        description: 'Risk of lactic acidosis with iodinated contrast media',
        mechanism: 'Contrast-induced nephropathy may impair metformin clearance',
        clinicalEffect: 'Potential for severe metabolic acidosis',
        management: 'Hold metformin 48 hours before and after contrast administration',
      },
      {
        drug1: 'simvastatin',
        drug2: 'clarithromycin',
        severity: 'contraindicated',
        description: 'Significantly increased risk of myopathy and rhabdomyolysis',
        mechanism: 'Clarithromycin inhibits CYP3A4, increasing simvastatin levels',
        clinicalEffect: 'Muscle damage, potential kidney failure',
        management: 'Avoid combination, use azithromycin if macrolide needed',
      },
      {
        drug1: 'lisinopril',
        drug2: 'potassium',
        severity: 'moderate',
        description: 'Increased risk of hyperkalemia',
        mechanism: 'ACE inhibitors reduce aldosterone, preserving potassium',
        clinicalEffect: 'Elevated serum potassium levels',
        management: 'Monitor potassium levels regularly',
      },
      {
        drug1: 'ssri',
        drug2: 'maoi',
        severity: 'contraindicated',
        description: 'Risk of serotonin syndrome',
        mechanism: 'Combined serotonergic activity',
        clinicalEffect: 'Potentially fatal serotonin toxicity',
        management: 'Allow 2-week washout period between drugs',
      },
    ];

    for (const interaction of knownInteractions) {
      const key1 = this.getInteractionKey(interaction.drug1, interaction.drug2);
      const key2 = this.getInteractionKey(interaction.drug2, interaction.drug1);

      if (!this.interactions.has(key1)) {
        this.interactions.set(key1, []);
      }
      this.interactions.get(key1)!.push(interaction);

      if (!this.interactions.has(key2)) {
        this.interactions.set(key2, []);
      }
      this.interactions.get(key2)!.push({
        ...interaction,
        drug1: interaction.drug2,
        drug2: interaction.drug1,
      });
    }
  }

  /**
   * Check for drug interactions
   */
  checkInteractions(medications: string[], severityFilter: string = 'all'): DrugInteraction[] {
    const results: DrugInteraction[] = [];
    const normalized = medications.map(m => m.toLowerCase().trim());

    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const drug1 = normalized[i]!;
        const drug2 = normalized[j]!;
        const key = this.getInteractionKey(drug1, drug2);

        const interactions = this.interactions.get(key);
        if (interactions) {
          for (const interaction of interactions) {
            if (severityFilter === 'all' || this.meetsSeverityFilter(interaction.severity, severityFilter)) {
              results.push(interaction);
            }
          }
        }
      }
    }

    // Sort by severity
    results.sort((a, b) => {
      return this.severityOrder.indexOf(a.severity) - this.severityOrder.indexOf(b.severity);
    });

    return results;
  }

  private getInteractionKey(drug1: string, drug2: string): string {
    return [drug1.toLowerCase(), drug2.toLowerCase()].sort().join('::');
  }

  private meetsSeverityFilter(severity: InteractionSeverity, filter: string): boolean {
    if (filter === 'all') return true;
    const filterIndex = this.severityOrder.indexOf(filter as InteractionSeverity);
    const severityIndex = this.severityOrder.indexOf(severity);
    return severityIndex <= filterIndex;
  }
}

/**
 * Clinical pathway graph for treatment recommendations
 */
class ClinicalPathwayGraph {
  private pathways: Map<string, ClinicalPathway> = new Map();

  constructor() {
    this.loadStandardPathways();
  }

  /**
   * Load standard clinical pathways
   * In production, load from clinical guideline database
   */
  private loadStandardPathways(): void {
    const samplePathways: ClinicalPathway[] = [
      {
        id: 'dm2-management',
        name: 'Type 2 Diabetes Management',
        diagnosis: 'E11',
        version: '2024.1',
        evidenceLevel: 'systematic-review',
        steps: [
          {
            id: 'dm2-1',
            name: 'Initial Assessment',
            description: 'Complete metabolic panel, HbA1c, lipid panel',
            type: 'assessment',
            timing: 'Day 1',
          },
          {
            id: 'dm2-2',
            name: 'Lifestyle Modification',
            description: 'Diet counseling, exercise prescription',
            type: 'intervention',
            timing: 'Weeks 1-12',
            prerequisites: ['dm2-1'],
          },
          {
            id: 'dm2-3',
            name: 'Metformin Initiation',
            description: 'Start metformin if HbA1c > 6.5%',
            type: 'decision',
            timing: 'Week 1',
            prerequisites: ['dm2-1'],
          },
          {
            id: 'dm2-4',
            name: 'Glycemic Monitoring',
            description: 'Regular HbA1c monitoring every 3 months',
            type: 'monitoring',
            timing: 'Ongoing',
            prerequisites: ['dm2-2', 'dm2-3'],
          },
        ],
      },
      {
        id: 'htn-management',
        name: 'Hypertension Management',
        diagnosis: 'I10',
        version: '2024.1',
        evidenceLevel: 'rct',
        steps: [
          {
            id: 'htn-1',
            name: 'Blood Pressure Confirmation',
            description: 'Confirm elevated BP with multiple readings',
            type: 'assessment',
            timing: 'Days 1-7',
          },
          {
            id: 'htn-2',
            name: 'Risk Stratification',
            description: 'Assess cardiovascular risk factors',
            type: 'assessment',
            timing: 'Day 1',
          },
          {
            id: 'htn-3',
            name: 'Lifestyle Modification',
            description: 'DASH diet, sodium restriction, exercise',
            type: 'intervention',
            timing: 'Weeks 1-8',
            prerequisites: ['htn-1', 'htn-2'],
          },
          {
            id: 'htn-4',
            name: 'ACE Inhibitor or ARB',
            description: 'First-line pharmacotherapy',
            type: 'decision',
            timing: 'Week 1-2',
            prerequisites: ['htn-2'],
          },
        ],
      },
    ];

    for (const pathway of samplePathways) {
      this.pathways.set(pathway.diagnosis, pathway);
      this.pathways.set(pathway.id, pathway);
    }
  }

  /**
   * Find pathway by diagnosis code
   */
  findPathway(diagnosis: string): ClinicalPathway | undefined {
    // Try exact match first
    let pathway = this.pathways.get(diagnosis);
    if (pathway) return pathway;

    // Try ICD-10 category match (first 3 characters)
    const category = diagnosis.substring(0, 3);
    pathway = this.pathways.get(category);
    if (pathway) return pathway;

    // Search by diagnosis prefix
    for (const [key, value] of this.pathways) {
      if (diagnosis.startsWith(key) || key.startsWith(diagnosis)) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Get all available pathways
   */
  getAllPathways(): ClinicalPathway[] {
    const seen = new Set<string>();
    const results: ClinicalPathway[] = [];

    for (const pathway of this.pathways.values()) {
      if (!seen.has(pathway.id)) {
        seen.add(pathway.id);
        results.push(pathway);
      }
    }

    return results;
  }
}

/**
 * Healthcare GNN Bridge implementation
 */
export class HealthcareGNNBridge implements GNNBridge {
  private wasmModule: GNNWasmModule | null = null;
  private graphPtr: number = 0;
  private config: GNNConfig;
  private logger: Logger;
  private nodes: Map<string, GNNNode> = new Map();
  private edges: GNNEdge[] = [];
  private nodeIdToIndex: Map<string, number> = new Map();
  private drugInteractionGraph: DrugInteractionGraph;
  private clinicalPathwayGraph: ClinicalPathwayGraph;

  public initialized = false;

  constructor(config?: Partial<GNNConfig>, logger?: Logger) {
    this.config = {
      hiddenDimensions: config?.hiddenDimensions ?? 256,
      numLayers: config?.numLayers ?? 3,
      dropout: config?.dropout ?? 0.1,
      aggregationType: config?.aggregationType ?? 'mean',
    };
    this.logger = logger ?? defaultLogger;
    this.drugInteractionGraph = new DrugInteractionGraph();
    this.clinicalPathwayGraph = new ClinicalPathwayGraph();
  }

  /**
   * Initialize the GNN bridge
   */
  async initialize(config?: GNNConfig): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    try {
      const wasmPath = await this.resolveWasmPath();
      if (wasmPath) {
        this.wasmModule = await this.loadWasmModule(wasmPath);
        this.logger.info('GNN WASM module initialized', {
          hiddenDimensions: this.config.hiddenDimensions,
          numLayers: this.config.numLayers,
        });
      } else {
        this.logger.warn('WASM module not available, using fallback implementation');
      }

      this.initialized = true;
    } catch (error) {
      this.logger.warn('Failed to initialize WASM, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.initialized = true;
    }
  }

  /**
   * Load a graph into the GNN
   */
  async loadGraph(nodes: GNNNode[], edges: GNNEdge[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('GNN bridge not initialized');
    }

    // Clear existing graph
    this.nodes.clear();
    this.edges = [];
    this.nodeIdToIndex.clear();

    // Index nodes
    let idx = 0;
    for (const node of nodes) {
      this.nodes.set(node.id, node);
      this.nodeIdToIndex.set(node.id, idx++);
    }

    // Store edges
    this.edges = edges;

    if (this.wasmModule) {
      // Create WASM graph
      const featureDim = nodes[0]?.features.length ?? 128;
      this.graphPtr = this.wasmModule.create_graph(nodes.length, edges.length, featureDim);

      // Add nodes
      for (const node of nodes) {
        const nodeIdx = this.nodeIdToIndex.get(node.id)!;
        this.wasmModule.add_node(this.graphPtr, nodeIdx, new Float32Array(node.features));
      }

      // Add edges
      for (const edge of edges) {
        const sourceIdx = this.nodeIdToIndex.get(edge.source);
        const targetIdx = this.nodeIdToIndex.get(edge.target);
        if (sourceIdx !== undefined && targetIdx !== undefined) {
          this.wasmModule.add_edge(this.graphPtr, sourceIdx, targetIdx, 0, edge.weight ?? 1.0);
        }
      }
    }

    this.logger.info('Graph loaded', { nodes: nodes.length, edges: edges.length });
  }

  /**
   * Predict optimal pathway between nodes
   */
  async predictPathway(
    startNode: string,
    endNode: string,
    constraints?: Record<string, unknown>
  ): Promise<GNNPathResult> {
    if (!this.initialized) {
      throw new Error('GNN bridge not initialized');
    }

    const startTime = performance.now();

    if (this.wasmModule && this.graphPtr) {
      const startIdx = this.nodeIdToIndex.get(startNode);
      const endIdx = this.nodeIdToIndex.get(endNode);

      if (startIdx !== undefined && endIdx !== undefined) {
        const maxHops = (constraints?.maxHops as number) ?? 10;
        const pathIndices = this.wasmModule.predict_path(this.graphPtr, startIdx, endIdx, maxHops);

        const path = Array.from(pathIndices)
          .map(idx => this.getNodeIdByIndex(idx))
          .filter((id): id is string => id !== undefined);

        return {
          path,
          confidence: 0.85,
          alternativePaths: [],
          riskScore: 0.2,
        };
      }
    }

    // Fallback: BFS path finding
    const path = this.bfsPath(startNode, endNode, constraints);
    const duration = performance.now() - startTime;

    this.logger.debug('Pathway predicted', { startNode, endNode, pathLength: path.length, durationMs: duration });

    return {
      path,
      confidence: path.length > 0 ? 0.75 : 0,
      alternativePaths: [],
      riskScore: this.calculatePathRisk(path),
    };
  }

  /**
   * Analyze interactions between nodes
   */
  async analyzeInteractions(nodeIds: string[]): Promise<GNNInteractionResult> {
    if (!this.initialized) {
      throw new Error('GNN bridge not initialized');
    }

    // Use drug interaction graph for medication analysis
    const drugInteractions = this.drugInteractionGraph.checkInteractions(nodeIds);

    const interactions = drugInteractions.map(di => ({
      nodes: [di.drug1, di.drug2],
      type: 'drug-drug',
      strength: this.severityToStrength(di.severity),
      direction: 'bidirectional',
    }));

    const riskFactors = drugInteractions
      .filter(di => di.severity === 'major' || di.severity === 'contraindicated')
      .map(di => `${di.drug1} + ${di.drug2}: ${di.description}`);

    const recommendations = drugInteractions.map(di => di.management ?? 'Monitor closely');

    return {
      interactions,
      riskFactors,
      recommendations: [...new Set(recommendations)],
    };
  }

  /**
   * Get clinical pathway for a diagnosis
   */
  getClinicalPathway(diagnosis: string): ClinicalPathway | undefined {
    return this.clinicalPathwayGraph.findPathway(diagnosis);
  }

  /**
   * Check drug interactions
   */
  checkDrugInteractions(medications: string[], severityFilter: string = 'all'): DrugInteraction[] {
    return this.drugInteractionGraph.checkInteractions(medications, severityFilter);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.wasmModule && this.graphPtr) {
      this.wasmModule.free_graph(this.graphPtr);
    }
    this.nodes.clear();
    this.edges = [];
    this.nodeIdToIndex.clear();
    this.initialized = false;
  }

  // Private methods

  private async resolveWasmPath(): Promise<string | null> {
    try {
      const module = await import('ruvector-gnn-wasm');
      return module.default ?? null;
    } catch {
      return null;
    }
  }

  private async loadWasmModule(wasmPath: string): Promise<GNNWasmModule> {
    const module = await import(wasmPath);
    await module.default();
    return module as GNNWasmModule;
  }

  private getNodeIdByIndex(index: number): string | undefined {
    for (const [id, idx] of this.nodeIdToIndex) {
      if (idx === index) return id;
    }
    return undefined;
  }

  private bfsPath(start: string, end: string, constraints?: Record<string, unknown>): string[] {
    const visited = new Set<string>();
    const queue: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }];
    const excludeNodes = new Set((constraints?.excludeNodes as string[]) ?? []);
    const maxHops = (constraints?.maxHops as number) ?? 10;

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.node === end) {
        return current.path;
      }

      if (current.path.length > maxHops) continue;
      if (visited.has(current.node)) continue;

      visited.add(current.node);

      // Find adjacent nodes
      for (const edge of this.edges) {
        let neighbor: string | null = null;
        if (edge.source === current.node) neighbor = edge.target;
        if (edge.target === current.node) neighbor = edge.source;

        if (neighbor && !visited.has(neighbor) && !excludeNodes.has(neighbor)) {
          queue.push({ node: neighbor, path: [...current.path, neighbor] });
        }
      }
    }

    return [];
  }

  private calculatePathRisk(path: string[]): number {
    if (path.length === 0) return 1.0;

    let risk = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const edge = this.edges.find(
        e => (e.source === path[i] && e.target === path[i + 1]) ||
             (e.target === path[i] && e.source === path[i + 1])
      );
      if (edge && edge.weight !== undefined) {
        risk += 1 - edge.weight;
      }
    }

    return Math.min(risk / path.length, 1.0);
  }

  private severityToStrength(severity: InteractionSeverity): number {
    switch (severity) {
      case 'contraindicated': return 1.0;
      case 'major': return 0.8;
      case 'moderate': return 0.5;
      case 'minor': return 0.2;
      default: return 0.5;
    }
  }
}

/**
 * Create a new GNN bridge instance
 */
export function createGNNBridge(config?: Partial<GNNConfig>, logger?: Logger): HealthcareGNNBridge {
  return new HealthcareGNNBridge(config, logger);
}

export default HealthcareGNNBridge;
