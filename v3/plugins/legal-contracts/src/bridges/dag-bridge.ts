/**
 * DAG Bridge for Obligation Tracking
 *
 * Provides directed acyclic graph operations for obligation dependency
 * tracking using ruvector-dag-wasm for high-performance graph algorithms.
 *
 * Features:
 * - Obligation dependency graph construction
 * - Critical path analysis
 * - Topological sorting
 * - Cycle detection
 * - Float/slack calculation
 *
 * Based on ADR-034: Legal Contract Analysis Plugin
 *
 * @module v3/plugins/legal-contracts/bridges/dag-bridge
 */

import type {
  IDAGBridge,
  Obligation,
  ObligationTrackingResult,
  ObligationNode,
} from '../types.js';

/**
 * WASM module interface for DAG operations
 */
interface DAGWasmModule {
  /** Build adjacency list from edge list */
  dag_build(edges: Uint32Array, nodeCount: number): number;

  /** Topological sort */
  dag_topological_sort(graphPtr: number): Uint32Array;

  /** Detect cycles */
  dag_detect_cycles(graphPtr: number): Uint32Array;

  /** Find critical path */
  dag_critical_path(
    graphPtr: number,
    weights: Float32Array
  ): Uint32Array;

  /** Calculate longest path */
  dag_longest_path(
    graphPtr: number,
    weights: Float32Array
  ): Float32Array;

  /** Free graph */
  dag_free(graphPtr: number): void;

  /** Memory management */
  alloc(size: number): number;
  dealloc(ptr: number, size: number): void;
  memory: WebAssembly.Memory;
}

/**
 * Edge type for dependency graph
 */
type EdgeType = 'depends_on' | 'blocks' | 'triggers';

/**
 * DAG Bridge Implementation
 */
export class DAGBridge implements IDAGBridge {
  private wasmModule: DAGWasmModule | null = null;
  private initialized = false;

  /**
   * Initialize the WASM module
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import of WASM module
      // In production, this would load from @claude-flow/ruvector-upstream
      this.wasmModule = await this.loadWasmModule();
      this.initialized = true;
    } catch (error) {
      // Fallback to pure JS implementation if WASM not available
      console.warn('WASM DAG module not available, using JS fallback');
      this.wasmModule = null;
      this.initialized = true;
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Build obligation dependency graph
   */
  async buildDependencyGraph(
    obligations: Obligation[]
  ): Promise<ObligationTrackingResult['graph']> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Create node lookup
    const nodeMap = new Map<string, number>();
    obligations.forEach((obl, index) => {
      nodeMap.set(obl.id, index);
    });

    // Build edges from dependencies
    const edges: Array<{
      from: string;
      to: string;
      type: EdgeType;
    }> = [];

    for (const obligation of obligations) {
      // depends_on edges (this obligation depends on others)
      for (const depId of obligation.dependsOn) {
        if (nodeMap.has(depId)) {
          edges.push({
            from: depId,
            to: obligation.id,
            type: 'depends_on',
          });
        }
      }

      // blocks edges (this obligation blocks others)
      for (const blockId of obligation.blocks) {
        if (nodeMap.has(blockId)) {
          edges.push({
            from: obligation.id,
            to: blockId,
            type: 'blocks',
          });
        }
      }
    }

    // Find critical path
    const criticalPathIds = await this.findCriticalPathInternal(
      obligations,
      nodeMap,
      edges
    );

    // Calculate dates and float
    const { earliestStart, latestFinish, floatDays } = await this.calculateSchedule(
      obligations,
      nodeMap,
      edges
    );

    // Build nodes
    const nodes: ObligationNode[] = obligations.map(obligation => {
      return {
        obligation,
        dependencies: obligation.dependsOn,
        dependents: obligation.blocks,
        onCriticalPath: criticalPathIds.has(obligation.id),
        earliestStart: earliestStart.get(obligation.id),
        latestFinish: latestFinish.get(obligation.id),
        floatDays: floatDays.get(obligation.id),
      };
    });

    return { nodes, edges };
  }

  /**
   * Find critical path through obligations
   */
  async findCriticalPath(
    graph: ObligationTrackingResult['graph']
  ): Promise<string[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Extract obligations from nodes
    const obligations = graph.nodes.map(n => n.obligation);
    const nodeMap = new Map<string, number>();
    obligations.forEach((obl, index) => {
      nodeMap.set(obl.id, index);
    });

    const criticalIds = await this.findCriticalPathInternal(
      obligations,
      nodeMap,
      graph.edges
    );

    // Return in topological order
    const sorted = await this.topologicalSort(obligations);
    return sorted
      .filter(o => criticalIds.has(o.id))
      .map(o => o.id);
  }

  /**
   * Perform topological sort of obligations
   */
  async topologicalSort(obligations: Obligation[]): Promise<Obligation[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (obligations.length === 0) {
      return [];
    }

    // Create node lookup
    const nodeMap = new Map<string, number>();
    const indexMap = new Map<number, Obligation>();
    obligations.forEach((obl, index) => {
      nodeMap.set(obl.id, index);
      indexMap.set(index, obl);
    });

    // Build adjacency list
    const adj: number[][] = obligations.map(() => []);
    const inDegree = new Array(obligations.length).fill(0);

    for (const obligation of obligations) {
      const fromIndex = nodeMap.get(obligation.id);
      if (fromIndex === undefined) continue;

      for (const depId of obligation.blocks) {
        const toIndex = nodeMap.get(depId);
        if (toIndex !== undefined) {
          adj[fromIndex]?.push(toIndex);
          inDegree[toIndex] = (inDegree[toIndex] ?? 0) + 1;
        }
      }
    }

    // Kahn's algorithm
    const queue: number[] = [];
    for (let i = 0; i < inDegree.length; i++) {
      if (inDegree[i] === 0) {
        queue.push(i);
      }
    }

    const sorted: Obligation[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const obligation = indexMap.get(current);
      if (obligation) {
        sorted.push(obligation);
      }

      for (const neighbor of adj[current] ?? []) {
        inDegree[neighbor] = (inDegree[neighbor] ?? 1) - 1;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If not all nodes are in sorted, there's a cycle
    if (sorted.length !== obligations.length) {
      console.warn('Cycle detected in obligation dependencies');
    }

    return sorted;
  }

  /**
   * Detect cycles in dependency graph
   */
  async detectCycles(
    graph: ObligationTrackingResult['graph']
  ): Promise<string[][]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const obligations = graph.nodes.map(n => n.obligation);

    // Create node lookup
    const nodeMap = new Map<string, number>();
    const indexMap = new Map<number, string>();
    obligations.forEach((obl, index) => {
      nodeMap.set(obl.id, index);
      indexMap.set(index, obl.id);
    });

    // Build adjacency list
    const adj: number[][] = obligations.map(() => []);

    for (const edge of graph.edges) {
      const fromIndex = nodeMap.get(edge.from);
      const toIndex = nodeMap.get(edge.to);
      if (fromIndex !== undefined && toIndex !== undefined) {
        adj[fromIndex]?.push(toIndex);
      }
    }

    // Find cycles using DFS
    const cycles: string[][] = [];
    const visited = new Array(obligations.length).fill(false);
    const recStack = new Array(obligations.length).fill(false);
    const parent = new Array(obligations.length).fill(-1);

    const findCycle = (node: number, path: number[]): void => {
      visited[node] = true;
      recStack[node] = true;
      path.push(node);

      for (const neighbor of adj[node] ?? []) {
        if (!visited[neighbor]) {
          parent[neighbor] = node;
          findCycle(neighbor, [...path]);
        } else if (recStack[neighbor]) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart >= 0) {
            const cycle = path.slice(cycleStart).map(i => indexMap.get(i) ?? '');
            cycles.push(cycle);
          }
        }
      }

      recStack[node] = false;
    };

    for (let i = 0; i < obligations.length; i++) {
      if (!visited[i]) {
        findCycle(i, []);
      }
    }

    return cycles;
  }

  /**
   * Calculate slack/float for each obligation
   */
  async calculateFloat(
    graph: ObligationTrackingResult['graph'],
    projectEnd: Date
  ): Promise<Map<string, number>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const obligations = graph.nodes.map(n => n.obligation);
    const nodeMap = new Map<string, number>();
    obligations.forEach((obl, index) => {
      nodeMap.set(obl.id, index);
    });

    const { floatDays } = await this.calculateSchedule(
      obligations,
      nodeMap,
      graph.edges,
      projectEnd
    );

    return floatDays;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Load WASM module dynamically
   */
  private async loadWasmModule(): Promise<DAGWasmModule> {
    // In production, this would load from @claude-flow/ruvector-upstream
    // For now, throw to trigger JS fallback
    throw new Error('WASM module loading not implemented');
  }

  /**
   * Find critical path internally
   */
  private async findCriticalPathInternal(
    obligations: Obligation[],
    nodeMap: Map<string, number>,
    edges: Array<{ from: string; to: string; type: EdgeType }>
  ): Promise<Set<string>> {
    const criticalIds = new Set<string>();

    // Build adjacency list and weights
    const adj: Map<number, number[]> = new Map();
    const weights: Map<number, number> = new Map();

    for (let i = 0; i < obligations.length; i++) {
      adj.set(i, []);
      // Use estimated duration as weight (default 1 day)
      const obligation = obligations[i];
      weights.set(i, this.estimateDuration(obligation));
    }

    for (const edge of edges) {
      const fromIndex = nodeMap.get(edge.from);
      const toIndex = nodeMap.get(edge.to);
      if (fromIndex !== undefined && toIndex !== undefined) {
        adj.get(fromIndex)?.push(toIndex);
      }
    }

    // Find longest path using dynamic programming
    const sorted = await this.topologicalSort(obligations);
    const dist: Map<number, number> = new Map();
    const predecessor: Map<number, number> = new Map();

    // Initialize distances
    for (let i = 0; i < obligations.length; i++) {
      dist.set(i, 0);
    }

    // Process in topological order
    for (const obligation of sorted) {
      const u = nodeMap.get(obligation.id);
      if (u === undefined) continue;

      for (const v of adj.get(u) ?? []) {
        const newDist = (dist.get(u) ?? 0) + (weights.get(v) ?? 1);
        if (newDist > (dist.get(v) ?? 0)) {
          dist.set(v, newDist);
          predecessor.set(v, u);
        }
      }
    }

    // Find the end node with maximum distance
    let maxDist = 0;
    let endNode = 0;
    for (const [node, d] of dist) {
      if (d > maxDist) {
        maxDist = d;
        endNode = node;
      }
    }

    // Trace back critical path
    let current: number | undefined = endNode;
    while (current !== undefined) {
      const obligation = obligations[current];
      if (obligation) {
        criticalIds.add(obligation.id);
      }
      current = predecessor.get(current);
    }

    return criticalIds;
  }

  /**
   * Calculate schedule (earliest start, latest finish, float)
   */
  private async calculateSchedule(
    obligations: Obligation[],
    nodeMap: Map<string, number>,
    edges: Array<{ from: string; to: string; type: EdgeType }>,
    projectEnd?: Date
  ): Promise<{
    earliestStart: Map<string, Date>;
    latestFinish: Map<string, Date>;
    floatDays: Map<string, number>;
  }> {
    const now = new Date();
    const endDate = projectEnd ?? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const earliestStart = new Map<string, Date>();
    const latestFinish = new Map<string, Date>();
    const floatDays = new Map<string, number>();

    // Build adjacency lists
    const successors: Map<string, string[]> = new Map();
    const predecessors: Map<string, string[]> = new Map();

    for (const obligation of obligations) {
      successors.set(obligation.id, []);
      predecessors.set(obligation.id, []);
    }

    for (const edge of edges) {
      successors.get(edge.from)?.push(edge.to);
      predecessors.get(edge.to)?.push(edge.from);
    }

    // Forward pass - calculate earliest start
    const sorted = await this.topologicalSort(obligations);
    for (const obligation of sorted) {
      const preds = predecessors.get(obligation.id) ?? [];
      let earliest = obligation.dueDate ?? now;

      for (const predId of preds) {
        const predObl = obligations.find(o => o.id === predId);
        const predEarliest = earliestStart.get(predId);
        if (predEarliest && predObl) {
          const predEnd = new Date(
            predEarliest.getTime() + this.estimateDuration(predObl) * 24 * 60 * 60 * 1000
          );
          if (predEnd > earliest) {
            earliest = predEnd;
          }
        }
      }

      earliestStart.set(obligation.id, earliest);
    }

    // Backward pass - calculate latest finish
    const reverseSorted = [...sorted].reverse();
    for (const obligation of reverseSorted) {
      const succs = successors.get(obligation.id) ?? [];
      let latest = endDate;

      for (const succId of succs) {
        const succLatest = latestFinish.get(succId);
        if (succLatest && succLatest < latest) {
          latest = new Date(
            succLatest.getTime() - this.estimateDuration(obligation) * 24 * 60 * 60 * 1000
          );
        }
      }

      latestFinish.set(obligation.id, latest);
    }

    // Calculate float
    for (const obligation of obligations) {
      const es = earliestStart.get(obligation.id);
      const lf = latestFinish.get(obligation.id);

      if (es && lf) {
        const duration = this.estimateDuration(obligation);
        const latestStart = new Date(lf.getTime() - duration * 24 * 60 * 60 * 1000);
        const floatMs = latestStart.getTime() - es.getTime();
        floatDays.set(obligation.id, Math.max(0, floatMs / (24 * 60 * 60 * 1000)));
      } else {
        floatDays.set(obligation.id, 0);
      }
    }

    return { earliestStart, latestFinish, floatDays };
  }

  /**
   * Estimate duration in days for an obligation
   */
  private estimateDuration(obligation: Obligation | undefined): number {
    if (!obligation) return 1;

    // Default durations by type
    const typeDurations: Record<string, number> = {
      payment: 1,
      delivery: 7,
      notification: 3,
      approval: 5,
      compliance: 30,
      reporting: 5,
      confidentiality: 0,
      performance: 14,
      insurance: 7,
      renewal: 30,
      termination: 30,
    };

    return typeDurations[obligation.type] ?? 7;
  }
}

/**
 * Create and export default bridge instance
 */
export function createDAGBridge(): IDAGBridge {
  return new DAGBridge();
}

export default DAGBridge;
