/**
 * Exact global minimum cut over an undirected weighted graph.
 *
 * Fast path: `ruvector`'s `DynamicMinCut`, a wrapper over the
 * `@ruvector/mincut-wasm` solver that ruvector ships as one of its own
 * optional dependencies. Measured on a 1,000-node / 2,000-edge graph it is
 * ~30x faster than a JS Stoer-Wagner (187 ms vs 6 s) and returns the same cut
 * value. When ruvector or its wasm solver is not installed, callers fall back
 * to their own JS implementation (`fallbackMinCut` in graph-analyzer.ts).
 *
 * The wasm solver rejects duplicate edges ("Edge already exists"), so edges are
 * folded into one undirected edge per node pair with summed weight, and
 * self-loops are dropped (they never cross a cut).
 */

export interface MinCutResult {
  cutValue: number;
  partition1: string[];
  partition2: string[];
  cutEdges: Array<[string, string]>;
}

export type MinCutBackend = 'mincut-wasm' | 'js-fallback';

interface DynamicMinCutLike {
  insertEdge(from: string, to: string, weight?: number): number;
  minCutValue(): number;
  partition(): string[][];
}

export type DynamicMinCutCtor = new () => DynamicMinCutLike;

let ctorPromise: Promise<DynamicMinCutCtor | null> | null = null;

/**
 * Resolve ruvector's `DynamicMinCut` once. Returns null (never throws) when
 * ruvector is absent or its `@ruvector/mincut-wasm` solver cannot load.
 */
export function loadWasmMinCut(): Promise<DynamicMinCutCtor | null> {
  if (!ctorPromise) {
    ctorPromise = (async () => {
      try {
        const specifier: string = 'ruvector';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional dep
        const mod: any = await import(specifier);
        const rv = mod?.DynamicMinCut ? mod : mod?.default;
        if (typeof rv?.DynamicMinCut !== 'function') return null;
        if (typeof rv.isMinCutWasmAvailable === 'function' && !rv.isMinCutWasmAvailable()) return null;
        return rv.DynamicMinCut as DynamicMinCutCtor;
      } catch {
        return null;
      }
    })();
  }
  return ctorPromise;
}

/** Test hook: forget the memoised loader result. */
export function resetMinCutLoader(): void {
  ctorPromise = null;
}

function foldEdges(edges: Array<[string, string, number]>): Map<string, [string, string, number]> {
  const folded = new Map<string, [string, string, number]>();
  for (const [u, v, rawW] of edges) {
    if (u === v) continue;
    const w = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
    const [a, b] = u < v ? [u, v] : [v, u];
    const key = `${a}\u0000${b}`;
    const prev = folded.get(key);
    if (prev) prev[2] += w;
    else folded.set(key, [a, b, w]);
  }
  return folded;
}

/**
 * Compute the exact minimum cut with the wasm solver. Returns null when the
 * solver is unavailable or the input is degenerate (fewer than two nodes, no
 * edges, or nodes with no incident edge — an isolated node is a zero-weight
 * cut that the solver never sees, so the JS fallback answers those).
 */
export async function wasmMinCut(
  nodes: string[],
  edges: Array<[string, string, number]>,
): Promise<MinCutResult | null> {
  const Ctor = await loadWasmMinCut();
  return Ctor ? minCutWith(Ctor, nodes, edges) : null;
}

/** Synchronous variant for callers that already hold the loaded solver class. */
export function minCutWith(
  Ctor: DynamicMinCutCtor,
  nodes: string[],
  edges: Array<[string, string, number]>,
): MinCutResult | null {
  if (nodes.length < 2) return null;

  const nodeSet = new Set(nodes);
  const folded = foldEdges(edges.filter(([u, v]) => nodeSet.has(u) && nodeSet.has(v)));
  if (folded.size === 0) return null;
  const touched = new Set<string>();
  for (const [a, b] of folded.values()) { touched.add(a); touched.add(b); }
  if (touched.size !== nodeSet.size) return null;

  try {
    const solver = new Ctor();
    for (const [a, b, w] of folded.values()) solver.insertEdge(a, b, w);
    const groups = solver.partition();
    const partition1 = groups[0] ?? [];
    const side = new Set(partition1);
    const partition2 = groups[1] ?? nodes.filter(n => !side.has(n));
    const cutEdges: Array<[string, string]> = [];
    for (const [u, v] of edges) {
      if (u !== v && nodeSet.has(u) && nodeSet.has(v) && side.has(u) !== side.has(v)) cutEdges.push([u, v]);
    }
    return { cutValue: solver.minCutValue(), partition1, partition2, cutEdges };
  } catch {
    return null;
  }
}

export interface SeedMinCutResult {
  /** Nodes on the seed's side of the cut, nearest (fewest hops) first. */
  seedSide: Array<{ nodeId: string; depth: number }>;
  otherSide: string[];
  cutValue: number;
  cutEdges: Array<[string, string]>;
  backend: MinCutBackend;
  /** Size of the seed's depth-bounded neighbourhood the cut was computed on. */
  subgraphNodes: number;
}

/** Above this many nodes the O(n^3) JS fallback is not attempted. */
export const JS_FALLBACK_MAX_NODES = 300;

/**
 * Minimum cut of the seed's `depth`-hop neighbourhood (edges treated as
 * undirected, at most `maxNodes` nodes). Answers "where is the weakest
 * boundary around this node, and what sits on its side of it?".
 *
 * Uses the wasm solver when available, else `fallback` (a JS exact min cut)
 * for neighbourhoods up to JS_FALLBACK_MAX_NODES nodes. Returns null when the
 * seed has no neighbours or no backend can handle the neighbourhood.
 */
export async function seedLocalMinCut(
  seed: string,
  edges: Array<[string, string, number]>,
  depth: number,
  maxNodes: number,
  fallback: (nodes: string[], edges: Array<[string, string, number]>) => MinCutResult,
): Promise<SeedMinCutResult | null> {
  const adj = new Map<string, Set<string>>();
  for (const [u, v] of edges) {
    if (u === v) continue;
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  }
  if (!adj.has(seed)) return null;

  const hops = new Map<string, number>([[seed, 0]]);
  let frontier = [seed];
  for (let d = 1; d <= depth && frontier.length > 0 && hops.size < maxNodes; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        if (hops.has(m) || hops.size >= maxNodes) continue;
        hops.set(m, d);
        next.push(m);
      }
    }
    frontier = next;
  }
  if (hops.size < 2) return null;

  const nodes = Array.from(hops.keys());
  const sub = edges.filter(([u, v]) => u !== v && hops.has(u) && hops.has(v));

  let backend: MinCutBackend = 'mincut-wasm';
  let cut = await wasmMinCut(nodes, sub);
  if (!cut) {
    if (nodes.length > JS_FALLBACK_MAX_NODES) return null;
    backend = 'js-fallback';
    cut = fallback(nodes, sub);
  }

  const seedInFirst = cut.partition1.includes(seed);
  const mine = seedInFirst ? cut.partition1 : cut.partition2;
  const other = seedInFirst ? cut.partition2 : cut.partition1;
  const seedSide = mine
    .filter(n => n !== seed)
    .map(n => ({ nodeId: n, depth: hops.get(n) ?? depth }))
    .sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId));

  return {
    seedSide,
    otherSide: other,
    cutValue: cut.cutValue,
    cutEdges: cut.cutEdges,
    backend,
    subgraphNodes: nodes.length,
  };
}
