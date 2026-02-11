/**
 * Gas Town Bridge Plugin - WASM Loader
 *
 * Provides lazy-loading and caching for WASM modules with graceful
 * JavaScript fallback. Includes typed wrapper functions for all WASM exports
 * and performance timing for benchmarks.
 *
 * WASM Modules:
 * - gastown-formula-wasm: TOML parsing and formula cooking (352x faster)
 * - ruvector-gnn-wasm: Graph operations and pattern network (150x faster)
 *
 * @module gastown-bridge/wasm-loader
 * @version 0.1.0
 */

import type {
  Formula,
  TopoSortResult,
  CriticalPathResult,
} from './types.js';

import {
  LRUCache,
  FormulaASTCache,
  BatchDeduplicator,
  ModulePreloader,
} from './cache.js';

import {
  LazyWasm,
  type LazyStats,
} from './memory/lazy.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Performance timing result
 */
export interface PerformanceTiming {
  /** Operation name */
  readonly operation: string;
  /** Duration in milliseconds */
  readonly durationMs: number;
  /** Whether WASM was used */
  readonly usedWasm: boolean;
  /** Timestamp when operation started */
  readonly startedAt: number;
}

/**
 * WASM module exports for gastown-formula-wasm
 */
interface FormulaWasmExports {
  /** Initialize the WASM module */
  default?: () => Promise<void>;
  /** Parse TOML content to Formula AST */
  parse_toml: (content: string) => string;
  /** Cook a formula with variable substitution */
  cook_formula: (formulaJson: string, varsJson: string) => string;
  /** Batch cook multiple formulas */
  cook_batch: (formulasJson: string, varsArrayJson: string) => string;
  /** Get WASM version */
  version: () => string;
}

/**
 * WASM module exports for ruvector-gnn-wasm
 */
interface GnnWasmExports {
  /** Initialize the WASM module */
  default?: () => Promise<void>;
  /** Topological sort of dependency graph */
  topo_sort: (nodesJson: string, edgesJson: string) => string;
  /** Detect cycles in dependency graph */
  detect_cycles: (nodesJson: string, edgesJson: string) => string;
  /** Calculate critical path */
  critical_path: (nodesJson: string, edgesJson: string, weightsJson: string) => string;
  /** Get WASM version */
  version: () => string;
}

/**
 * Graph edge representation
 */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * Node weight for critical path calculation
 */
export interface NodeWeight {
  readonly nodeId: string;
  readonly weight: number;
}

/**
 * Cycle detection result
 */
export interface CycleDetectionResult {
  readonly hasCycle: boolean;
  readonly cycleNodes: string[];
}

// ============================================================================
// Module Cache - Lazy Loading with LazyWasm
// ============================================================================

/** WASM availability flag */
let wasmAvailable: boolean | null = null;
/** Performance timings log */
const performanceLog: PerformanceTiming[] = [];

/**
 * Lazy loader for gastown-formula-wasm module.
 * Only loads WASM when first accessed, not during startup.
 * Supports idle timeout for memory cleanup.
 */
const lazyFormulaWasm = new LazyWasm<FormulaWasmExports>(
  async () => {
    if (!isWasmAvailable()) {
      throw new Error('WASM not available');
    }
    const module = await import('gastown-formula-wasm') as unknown as FormulaWasmExports;
    if (typeof module.default === 'function') {
      await module.default();
    }
    return module;
  },
  {
    name: 'gastown-formula-wasm',
    idleTimeout: 5 * 60 * 1000, // 5 minutes idle timeout for memory cleanup
    onError: (error) => {
      console.debug('[WASM Loader] gastown-formula-wasm load error:', error);
    },
  }
);

/**
 * Lazy loader for ruvector-gnn-wasm module.
 * Only loads WASM when first accessed, not during startup.
 * Supports idle timeout for memory cleanup.
 */
const lazyGnnWasm = new LazyWasm<GnnWasmExports>(
  async () => {
    if (!isWasmAvailable()) {
      throw new Error('WASM not available');
    }
    const module = await import('ruvector-gnn-wasm') as unknown as GnnWasmExports;
    if (typeof module.default === 'function') {
      await module.default();
    }
    return module;
  },
  {
    name: 'ruvector-gnn-wasm',
    idleTimeout: 5 * 60 * 1000, // 5 minutes idle timeout for memory cleanup
    onError: (error) => {
      console.debug('[WASM Loader] ruvector-gnn-wasm load error:', error);
    },
  }
);

// ============================================================================
// Performance Caches - LRU with O(1) operations
// ============================================================================

/** LRU cache for parsed formulas (max 1000 entries) */
const formulaParseCache = new LRUCache<string, Formula>({
  maxEntries: 1000,
  ttlMs: 10 * 60 * 1000, // 10 min TTL
});

/** LRU cache for cooked formulas */
const cookCache = new LRUCache<string, Formula>({
  maxEntries: 500,
  ttlMs: 5 * 60 * 1000, // 5 min TTL
});

/** LRU cache for topo sort results */
const topoSortCache = new LRUCache<string, TopoSortResult>({
  maxEntries: 200,
  ttlMs: 2 * 60 * 1000, // 2 min TTL
});

/** Formula AST cache using WeakMap-like behavior */
const astCache = new FormulaASTCache(500);

/** Batch deduplicator for concurrent parse requests */
const parseDedup = new BatchDeduplicator<Formula>();

/** Batch deduplicator for concurrent cook requests */
const cookDedup = new BatchDeduplicator<Formula>();

/** Batch deduplicator for concurrent graph operations */
const graphDedup = new BatchDeduplicator<TopoSortResult>();

/** Module preloader for idle-time loading */
const modulePreloader = new ModulePreloader();

// ============================================================================
// Hash Functions for Cache Keys
// ============================================================================

/**
 * FNV-1a hash for content strings (fast, low collision)
 */
function hashContent(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Hash for cook operation key (formula + vars)
 */
function hashCookKey(formula: Formula, vars: Record<string, string>): string {
  const varsStr = Object.entries(vars).sort().map(([k, v]) => `${k}=${v}`).join('|');
  return `${formula.name}:${formula.version}:${hashContent(varsStr)}`;
}

/**
 * Hash for graph operation key (nodes + edges)
 */
function hashGraphKey(nodes: string[], edges: GraphEdge[]): string {
  const nodesStr = nodes.sort().join(',');
  const edgesStr = edges.map(e => `${e.from}->${e.to}`).sort().join(',');
  return hashContent(`${nodesStr}|${edgesStr}`);
}

// ============================================================================
// WASM Availability Check
// ============================================================================

/**
 * Check if WASM is available in the current environment.
 *
 * @returns True if WASM is supported, false otherwise
 *
 * @example
 * ```typescript
 * if (isWasmAvailable()) {
 *   console.log('WASM acceleration enabled');
 * } else {
 *   console.log('Using JavaScript fallback');
 * }
 * ```
 */
export function isWasmAvailable(): boolean {
  if (wasmAvailable !== null) {
    return wasmAvailable;
  }

  try {
    // Check for WebAssembly global
    if (typeof WebAssembly === 'undefined') {
      wasmAvailable = false;
      return false;
    }

    // Check for required WebAssembly features
    const hasInstantiate = typeof WebAssembly.instantiate === 'function';
    const hasCompile = typeof WebAssembly.compile === 'function';
    const hasModule = typeof WebAssembly.Module === 'function';

    wasmAvailable = hasInstantiate && hasCompile && hasModule;
    return wasmAvailable;
  } catch {
    wasmAvailable = false;
    return false;
  }
}

// ============================================================================
// Performance Timing
// ============================================================================

/**
 * Record a performance timing
 */
function recordTiming(
  operation: string,
  startTime: number,
  usedWasm: boolean
): PerformanceTiming {
  const timing: PerformanceTiming = {
    operation,
    durationMs: performance.now() - startTime,
    usedWasm,
    startedAt: startTime,
  };
  performanceLog.push(timing);

  // Keep only last 1000 entries
  if (performanceLog.length > 1000) {
    performanceLog.shift();
  }

  return timing;
}

/**
 * Get performance log for benchmarking.
 *
 * @returns Array of performance timing records
 *
 * @example
 * ```typescript
 * const timings = getPerformanceLog();
 * const avgWasmTime = timings
 *   .filter(t => t.usedWasm)
 *   .reduce((acc, t) => acc + t.durationMs, 0) / timings.length;
 * ```
 */
export function getPerformanceLog(): readonly PerformanceTiming[] {
  return [...performanceLog];
}

/**
 * Clear performance log.
 */
export function clearPerformanceLog(): void {
  performanceLog.length = 0;
}

// ============================================================================
// WASM Module Loaders - Using LazyWasm for deferred loading
// ============================================================================

/**
 * Lazy-load the gastown-formula-wasm module.
 * Uses LazyWasm for true lazy loading - only loads when first accessed.
 * Includes idle timeout for automatic memory cleanup.
 *
 * @returns The loaded WASM module exports, or null if unavailable
 *
 * @example
 * ```typescript
 * const formulaWasm = await loadFormulaWasm();
 * if (formulaWasm) {
 *   const result = formulaWasm.parse_toml(tomlContent);
 * }
 * ```
 */
export async function loadFormulaWasm(): Promise<FormulaWasmExports | null> {
  if (!isWasmAvailable()) {
    return null;
  }

  try {
    return await lazyFormulaWasm.get();
  } catch (error) {
    // Module not available, will use JS fallback
    console.debug('[WASM Loader] gastown-formula-wasm not available:', error);
    return null;
  }
}

/**
 * Lazy-load the ruvector-gnn-wasm module.
 * Uses LazyWasm for true lazy loading - only loads when first accessed.
 * Includes idle timeout for automatic memory cleanup.
 *
 * @returns The loaded WASM module exports, or null if unavailable
 *
 * @example
 * ```typescript
 * const gnnWasm = await loadGnnWasm();
 * if (gnnWasm) {
 *   const result = gnnWasm.topo_sort(nodesJson, edgesJson);
 * }
 * ```
 */
export async function loadGnnWasm(): Promise<GnnWasmExports | null> {
  if (!isWasmAvailable()) {
    return null;
  }

  try {
    return await lazyGnnWasm.get();
  } catch (error) {
    // Module not available, will use JS fallback
    console.debug('[WASM Loader] ruvector-gnn-wasm not available:', error);
    return null;
  }
}

/**
 * Check if formula WASM module is currently loaded.
 * Does not trigger loading.
 */
export function isFormulaWasmLoaded(): boolean {
  return lazyFormulaWasm.isLoaded();
}

/**
 * Check if GNN WASM module is currently loaded.
 * Does not trigger loading.
 */
export function isGnnWasmLoaded(): boolean {
  return lazyGnnWasm.isLoaded();
}

/**
 * Get lazy loading statistics for WASM modules.
 */
export function getWasmLazyStats(): {
  formulaWasm: LazyStats;
  gnnWasm: LazyStats;
} {
  return {
    formulaWasm: lazyFormulaWasm.getStats(),
    gnnWasm: lazyGnnWasm.getStats(),
  };
}

// ============================================================================
// JavaScript Fallback Implementations
// ============================================================================

/**
 * JavaScript fallback for TOML parsing.
 * Simple implementation for basic formula parsing.
 */
function parseTomlFallback(content: string): Formula {
  // Basic TOML parsing fallback
  // In production, use a proper TOML parser like @iarna/toml
  const lines = content.split('\n');
  const result: Record<string, unknown> = {};
  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    // Section header
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value: unknown = kvMatch[2].trim();

      // Parse value type
      if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (/^\d+$/.test(value as string)) {
        value = parseInt(value as string, 10);
      } else if (/^\d+\.\d+$/.test(value as string)) {
        value = parseFloat(value as string);
      } else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
        value = (value as string).slice(1, -1);
      }

      if (currentSection) {
        (result[currentSection] as Record<string, unknown>)[key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  // Transform to Formula shape
  return {
    name: (result['name'] as string) || 'unknown',
    description: (result['description'] as string) || '',
    type: (result['type'] as Formula['type']) || 'workflow',
    version: (result['version'] as number) || 1,
    steps: result['steps'] as Formula['steps'],
    legs: result['legs'] as Formula['legs'],
    vars: result['vars'] as Formula['vars'],
    metadata: result['metadata'] as Formula['metadata'],
  };
}

/**
 * JavaScript fallback for variable substitution in formula.
 */
function cookFormulaFallback(
  formula: Formula,
  vars: Record<string, string>
): Formula {
  const substituteVars = (text: string): string => {
    let result = text;
    for (const [key, value] of Object.entries(vars)) {
      // Replace {{var}} and ${var} patterns
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    return result;
  };

  const substituteObject = <T>(obj: T): T => {
    if (typeof obj === 'string') {
      return substituteVars(obj) as T;
    }
    if (Array.isArray(obj)) {
      return obj.map(substituteObject) as T;
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = substituteObject(value);
      }
      return result as T;
    }
    return obj;
  };

  return {
    ...substituteObject(formula),
    cookedAt: new Date(),
    cookedVars: vars,
    originalName: formula.name,
  } as Formula;
}

/**
 * JavaScript fallback for topological sort.
 * Uses Kahn's algorithm.
 */
function topoSortFallback(
  nodes: string[],
  edges: GraphEdge[]
): TopoSortResult {
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node, 0);
    graph.set(node, []);
  }

  // Build graph
  for (const edge of edges) {
    graph.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // Find nodes with no incoming edges
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of graph.get(node) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Check for cycle
  const hasCycle = sorted.length !== nodes.length;
  const cycleNodes = hasCycle
    ? nodes.filter((n) => !sorted.includes(n))
    : undefined;

  return {
    sorted,
    hasCycle,
    cycleNodes,
  };
}

/**
 * JavaScript fallback for cycle detection.
 * Uses DFS with coloring.
 */
function detectCyclesFallback(
  nodes: string[],
  edges: GraphEdge[]
): CycleDetectionResult {
  const graph = new Map<string, string[]>();
  const WHITE = 0; // Unvisited
  const GRAY = 1; // In current path
  const BLACK = 2; // Visited

  // Initialize
  for (const node of nodes) {
    graph.set(node, []);
  }

  // Build graph
  for (const edge of edges) {
    graph.get(edge.from)?.push(edge.to);
  }

  const colors = new Map<string, number>();
  for (const node of nodes) {
    colors.set(node, WHITE);
  }

  const cycleNodes: string[] = [];

  const dfs = (node: string, path: string[]): boolean => {
    colors.set(node, GRAY);
    path.push(node);

    for (const neighbor of graph.get(node) || []) {
      if (colors.get(neighbor) === GRAY) {
        // Found cycle - extract cycle nodes
        const cycleStart = path.indexOf(neighbor);
        cycleNodes.push(...path.slice(cycleStart));
        return true;
      }
      if (colors.get(neighbor) === WHITE) {
        if (dfs(neighbor, path)) {
          return true;
        }
      }
    }

    colors.set(node, BLACK);
    path.pop();
    return false;
  };

  for (const node of nodes) {
    if (colors.get(node) === WHITE) {
      if (dfs(node, [])) {
        break;
      }
    }
  }

  return {
    hasCycle: cycleNodes.length > 0,
    cycleNodes: [...new Set(cycleNodes)],
  };
}

/**
 * JavaScript fallback for critical path calculation.
 * Uses longest path algorithm on DAG.
 */
function criticalPathFallback(
  nodes: string[],
  edges: GraphEdge[],
  weights: NodeWeight[]
): CriticalPathResult {
  // First, do topological sort
  const topoResult = topoSortFallback(nodes, edges);

  if (topoResult.hasCycle) {
    return {
      path: [],
      totalDuration: 0,
      slack: new Map(),
    };
  }

  const weightMap = new Map<string, number>();
  for (const w of weights) {
    weightMap.set(w.nodeId, w.weight);
  }

  const graph = new Map<string, string[]>();
  const reverseGraph = new Map<string, string[]>();

  for (const node of nodes) {
    graph.set(node, []);
    reverseGraph.set(node, []);
  }

  for (const edge of edges) {
    graph.get(edge.from)?.push(edge.to);
    reverseGraph.get(edge.to)?.push(edge.from);
  }

  // Forward pass: calculate earliest start times
  const earliest = new Map<string, number>();
  for (const node of topoResult.sorted) {
    let maxPredecessor = 0;
    for (const pred of reverseGraph.get(node) || []) {
      const predEnd = (earliest.get(pred) || 0) + (weightMap.get(pred) || 0);
      maxPredecessor = Math.max(maxPredecessor, predEnd);
    }
    earliest.set(node, maxPredecessor);
  }

  // Backward pass: calculate latest start times
  const latest = new Map<string, number>();
  const reverseSorted = [...topoResult.sorted].reverse();
  const totalDuration = Math.max(
    ...nodes.map((n) => (earliest.get(n) || 0) + (weightMap.get(n) || 0))
  );

  for (const node of reverseSorted) {
    const successors = graph.get(node) || [];
    if (successors.length === 0) {
      latest.set(node, totalDuration - (weightMap.get(node) || 0));
    } else {
      let minSuccessor = Infinity;
      for (const succ of successors) {
        minSuccessor = Math.min(minSuccessor, latest.get(succ) || 0);
      }
      latest.set(node, minSuccessor - (weightMap.get(node) || 0));
    }
  }

  // Calculate slack and find critical path
  const slack = new Map<string, number>();
  const criticalNodes: string[] = [];

  for (const node of nodes) {
    const nodeSlack = (latest.get(node) || 0) - (earliest.get(node) || 0);
    slack.set(node, nodeSlack);
    if (nodeSlack === 0) {
      criticalNodes.push(node);
    }
  }

  // Order critical nodes by topological order
  const path = topoResult.sorted.filter((n) => criticalNodes.includes(n));

  return {
    path,
    totalDuration,
    slack,
  };
}

// ============================================================================
// Public API - Formula Operations
// ============================================================================

/**
 * Parse TOML formula content to a Formula object.
 * Uses WASM if available (352x faster), falls back to JavaScript.
 *
 * @param content - TOML string content to parse
 * @returns Parsed Formula object
 *
 * @example
 * ```typescript
 * const formula = await parseFormula(`
 * name = "my-workflow"
 * type = "workflow"
 * version = 1
 *
 * [[steps]]
 * id = "step-1"
 * title = "First step"
 * `);
 * ```
 */
export async function parseFormula(content: string): Promise<Formula> {
  const startTime = performance.now();
  const cacheKey = hashContent(content);

  // Check LRU cache first (O(1) lookup)
  const cached = formulaParseCache.get(cacheKey);
  if (cached) {
    recordTiming('parseFormula:cache-hit', startTime, false);
    return cached;
  }

  // Use batch deduplication for concurrent requests
  return parseDedup.dedupe(cacheKey, async () => {
    const wasmModule = await loadFormulaWasm();

    if (wasmModule) {
      try {
        const resultJson = wasmModule.parse_toml(content);
        const result = JSON.parse(resultJson) as Formula;
        formulaParseCache.set(cacheKey, result);
        recordTiming('parseFormula', startTime, true);
        return result;
      } catch (error) {
        console.warn('[WASM Loader] parse_toml failed, using fallback:', error);
      }
    }

    // JavaScript fallback
    const result = parseTomlFallback(content);
    formulaParseCache.set(cacheKey, result);
    recordTiming('parseFormula', startTime, false);
    return result;
  });
}

/**
 * Cook a formula by substituting variables.
 * Uses WASM if available (352x faster), falls back to JavaScript.
 *
 * @param formula - Formula to cook
 * @param vars - Variables to substitute
 * @returns Cooked formula with variables substituted
 *
 * @example
 * ```typescript
 * const cooked = await cookFormula(formula, {
 *   projectName: 'my-project',
 *   author: 'developer'
 * });
 * ```
 */
export async function cookFormula(
  formula: Formula,
  vars: Record<string, string>
): Promise<Formula> {
  const startTime = performance.now();
  const cacheKey = hashCookKey(formula, vars);

  // Check LRU cache first (O(1) lookup)
  const cached = cookCache.get(cacheKey);
  if (cached) {
    recordTiming('cookFormula:cache-hit', startTime, false);
    return cached;
  }

  // Use batch deduplication for concurrent requests
  return cookDedup.dedupe(cacheKey, async () => {
    const wasmModule = await loadFormulaWasm();

    if (wasmModule) {
      try {
        const resultJson = wasmModule.cook_formula(
          JSON.stringify(formula),
          JSON.stringify(vars)
        );
        const result = JSON.parse(resultJson) as Formula;
        cookCache.set(cacheKey, result);
        recordTiming('cookFormula', startTime, true);
        return result;
      } catch (error) {
        console.warn('[WASM Loader] cook_formula failed, using fallback:', error);
      }
    }

    // JavaScript fallback
    const result = cookFormulaFallback(formula, vars);
    cookCache.set(cacheKey, result);
    recordTiming('cookFormula', startTime, false);
    return result;
  });
}

/**
 * Batch cook multiple formulas with corresponding variables.
 * Uses WASM if available (352x faster), falls back to JavaScript.
 *
 * @param formulas - Array of formulas to cook
 * @param varsArray - Array of variable objects (one per formula)
 * @returns Array of cooked formulas
 *
 * @example
 * ```typescript
 * const cooked = await cookBatch(
 *   [formula1, formula2],
 *   [{ name: 'a' }, { name: 'b' }]
 * );
 * ```
 */
export async function cookBatch(
  formulas: Formula[],
  varsArray: Record<string, string>[]
): Promise<Formula[]> {
  const startTime = performance.now();

  if (formulas.length !== varsArray.length) {
    throw new Error('formulas and varsArray must have the same length');
  }

  const wasmModule = await loadFormulaWasm();

  if (wasmModule) {
    try {
      const resultJson = wasmModule.cook_batch(
        JSON.stringify(formulas),
        JSON.stringify(varsArray)
      );
      const result = JSON.parse(resultJson) as Formula[];
      recordTiming('cookBatch', startTime, true);
      return result;
    } catch (error) {
      console.warn('[WASM Loader] cook_batch failed, using fallback:', error);
    }
  }

  // JavaScript fallback
  const results = await Promise.all(
    formulas.map((formula, i) => cookFormula(formula, varsArray[i]))
  );
  recordTiming('cookBatch', startTime, false);
  return results;
}

// ============================================================================
// Public API - Graph Operations
// ============================================================================

/**
 * Perform topological sort on a dependency graph.
 * Uses WASM if available (150x faster), falls back to JavaScript.
 *
 * @param nodes - Array of node identifiers
 * @param edges - Array of edges (from -> to dependencies)
 * @returns Topological sort result with sorted order and cycle detection
 *
 * @example
 * ```typescript
 * const result = await topoSort(
 *   ['a', 'b', 'c'],
 *   [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
 * );
 * console.log(result.sorted); // ['a', 'b', 'c']
 * ```
 */
export async function topoSort(
  nodes: string[],
  edges: GraphEdge[]
): Promise<TopoSortResult> {
  const startTime = performance.now();
  const cacheKey = hashGraphKey(nodes, edges);

  // Check LRU cache first (O(1) lookup)
  const cached = topoSortCache.get(cacheKey);
  if (cached) {
    recordTiming('topoSort:cache-hit', startTime, false);
    return cached;
  }

  // Use batch deduplication for concurrent requests
  return graphDedup.dedupe(cacheKey, async () => {
    const wasmModule = await loadGnnWasm();

    if (wasmModule) {
      try {
        const resultJson = wasmModule.topo_sort(
          JSON.stringify(nodes),
          JSON.stringify(edges)
        );
        const result = JSON.parse(resultJson) as TopoSortResult;
        topoSortCache.set(cacheKey, result);
        recordTiming('topoSort', startTime, true);
        return result;
      } catch (error) {
        console.warn('[WASM Loader] topo_sort failed, using fallback:', error);
      }
    }

    // JavaScript fallback
    const result = topoSortFallback(nodes, edges);
    topoSortCache.set(cacheKey, result);
    recordTiming('topoSort', startTime, false);
    return result;
  });
}

/**
 * Detect cycles in a dependency graph.
 * Uses WASM if available (150x faster), falls back to JavaScript.
 *
 * @param nodes - Array of node identifiers
 * @param edges - Array of edges (from -> to dependencies)
 * @returns Cycle detection result
 *
 * @example
 * ```typescript
 * const result = await detectCycles(
 *   ['a', 'b', 'c'],
 *   [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
 * );
 * console.log(result.hasCycle); // true
 * console.log(result.cycleNodes); // ['a', 'b']
 * ```
 */
export async function detectCycles(
  nodes: string[],
  edges: GraphEdge[]
): Promise<CycleDetectionResult> {
  const startTime = performance.now();

  const wasmModule = await loadGnnWasm();

  if (wasmModule) {
    try {
      const resultJson = wasmModule.detect_cycles(
        JSON.stringify(nodes),
        JSON.stringify(edges)
      );
      const result = JSON.parse(resultJson) as CycleDetectionResult;
      recordTiming('detectCycles', startTime, true);
      return result;
    } catch (error) {
      console.warn('[WASM Loader] detect_cycles failed, using fallback:', error);
    }
  }

  // JavaScript fallback
  const result = detectCyclesFallback(nodes, edges);
  recordTiming('detectCycles', startTime, false);
  return result;
}

/**
 * Calculate the critical path through a weighted dependency graph.
 * Uses WASM if available (150x faster), falls back to JavaScript.
 *
 * @param nodes - Array of node identifiers
 * @param edges - Array of edges (from -> to dependencies)
 * @param weights - Array of node weights (durations)
 * @returns Critical path result with path, duration, and slack times
 *
 * @example
 * ```typescript
 * const result = await criticalPath(
 *   ['a', 'b', 'c'],
 *   [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
 *   [
 *     { nodeId: 'a', weight: 5 },
 *     { nodeId: 'b', weight: 3 },
 *     { nodeId: 'c', weight: 2 }
 *   ]
 * );
 * console.log(result.path); // ['a', 'b', 'c']
 * console.log(result.totalDuration); // 10
 * ```
 */
export async function criticalPath(
  nodes: string[],
  edges: GraphEdge[],
  weights: NodeWeight[]
): Promise<CriticalPathResult> {
  const startTime = performance.now();

  const wasmModule = await loadGnnWasm();

  if (wasmModule) {
    try {
      const resultJson = wasmModule.critical_path(
        JSON.stringify(nodes),
        JSON.stringify(edges),
        JSON.stringify(weights)
      );
      const parsed = JSON.parse(resultJson);
      // Convert slack array back to Map
      const result: CriticalPathResult = {
        path: parsed.path,
        totalDuration: parsed.totalDuration,
        slack: new Map(Object.entries(parsed.slack).map(([k, v]) => [k, v as number])),
      };
      recordTiming('criticalPath', startTime, true);
      return result;
    } catch (error) {
      console.warn('[WASM Loader] critical_path failed, using fallback:', error);
    }
  }

  // JavaScript fallback
  const result = criticalPathFallback(nodes, edges, weights);
  recordTiming('criticalPath', startTime, false);
  return result;
}

// ============================================================================
// Module Management
// ============================================================================

/**
 * Preload all WASM modules.
 * Call this during initialization for best performance.
 *
 * @returns Object indicating which modules were loaded
 *
 * @example
 * ```typescript
 * const status = await preloadWasmModules();
 * console.log(status);
 * // { formulaWasm: true, gnnWasm: true }
 * ```
 */
export async function preloadWasmModules(): Promise<{
  formulaWasm: boolean;
  gnnWasm: boolean;
}> {
  const [formulaResult, gnnResult] = await Promise.all([
    loadFormulaWasm(),
    loadGnnWasm(),
  ]);

  return {
    formulaWasm: formulaResult !== null,
    gnnWasm: gnnResult !== null,
  };
}

/**
 * Get WASM module versions.
 *
 * @returns Object with version strings, or null if module not loaded
 */
export async function getWasmVersions(): Promise<{
  formulaWasm: string | null;
  gnnWasm: string | null;
}> {
  const formulaModule = await loadFormulaWasm();
  const gnnModule = await loadGnnWasm();

  return {
    formulaWasm: formulaModule?.version?.() ?? null,
    gnnWasm: gnnModule?.version?.() ?? null,
  };
}

/**
 * Reset the WASM module cache.
 * Clears lazy loader cache and forces reload on next access.
 * Useful for testing or when modules need to be reloaded.
 */
export function resetWasmCache(): void {
  // Clear the lazy loaders' internal cache
  lazyFormulaWasm.clearCache();
  lazyGnnWasm.clearCache();
  wasmAvailable = null;
}

/**
 * Schedule idle-time preloading of WASM modules.
 * Uses requestIdleCallback in browser, setImmediate in Node.
 * Does not block the main thread.
 *
 * @example
 * ```typescript
 * // Call during app initialization
 * scheduleIdlePreload();
 * ```
 */
export function scheduleIdlePreload(): void {
  // Register WASM modules for preloading
  modulePreloader.register('gastown-formula-wasm', async () => {
    return loadFormulaWasm();
  }, 10); // High priority

  modulePreloader.register('ruvector-gnn-wasm', async () => {
    return loadGnnWasm();
  }, 5); // Medium priority

  // Start preloading during idle time
  modulePreloader.startPreload().catch((error) => {
    console.debug('[WASM Loader] Idle preload error:', error);
  });
}

/**
 * Get cache statistics for performance monitoring.
 *
 * @returns Object with cache stats for each cache type
 *
 * @example
 * ```typescript
 * const stats = getCacheStats();
 * console.log(`Parse cache: ${stats.parseCache.entries} entries`);
 * console.log(`Cook cache hit rate: ${stats.cookCache.hitRate}`);
 * ```
 */
export function getCacheStats(): {
  parseCache: { entries: number; sizeBytes: number; hitRate: number };
  cookCache: { entries: number; sizeBytes: number; hitRate: number };
  topoSortCache: { entries: number; sizeBytes: number; hitRate: number };
  astCache: { entries: number; sizeBytes: number };
  preloader: { queued: number; loaded: number; errors: number; isPreloading: boolean };
  deduplicator: { parsePending: number; cookPending: number; graphPending: number };
} {
  const parseCacheStats = formulaParseCache.stats();
  const cookCacheStats = cookCache.stats();
  const topoSortCacheStats = topoSortCache.stats();
  const astCacheStats = astCache.stats();
  const preloaderStatus = modulePreloader.status();

  return {
    parseCache: {
      entries: parseCacheStats.entries,
      sizeBytes: parseCacheStats.sizeBytes,
      hitRate: parseCacheStats.hitRate,
    },
    cookCache: {
      entries: cookCacheStats.entries,
      sizeBytes: cookCacheStats.sizeBytes,
      hitRate: cookCacheStats.hitRate,
    },
    topoSortCache: {
      entries: topoSortCacheStats.entries,
      sizeBytes: topoSortCacheStats.sizeBytes,
      hitRate: topoSortCacheStats.hitRate,
    },
    astCache: {
      entries: astCacheStats.entries,
      sizeBytes: astCacheStats.sizeBytes,
    },
    preloader: preloaderStatus,
    deduplicator: {
      parsePending: parseDedup.pendingCount,
      cookPending: cookDedup.pendingCount,
      graphPending: graphDedup.pendingCount,
    },
  };
}

/**
 * Clear all result caches.
 * Useful for testing or when formulas have been modified.
 */
export function clearAllCaches(): void {
  formulaParseCache.clear();
  cookCache.clear();
  topoSortCache.clear();
  astCache.clear();
  parseDedup.clear();
  cookDedup.clear();
  graphDedup.clear();
}

// ============================================================================
// Export Summary
// ============================================================================

export default {
  // Availability
  isWasmAvailable,

  // Formula operations
  loadFormulaWasm,
  parseFormula,
  cookFormula,
  cookBatch,

  // Graph operations
  loadGnnWasm,
  topoSort,
  detectCycles,
  criticalPath,

  // Module management
  preloadWasmModules,
  getWasmVersions,
  resetWasmCache,

  // Lazy loading status
  isFormulaWasmLoaded,
  isGnnWasmLoaded,
  getWasmLazyStats,

  // Performance optimization
  scheduleIdlePreload,
  getCacheStats,
  clearAllCaches,

  // Performance logging
  getPerformanceLog,
  clearPerformanceLog,
};
