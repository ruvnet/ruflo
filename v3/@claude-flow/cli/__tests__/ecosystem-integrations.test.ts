/**
 * Ecosystem integrations: each optional package must be reachable through a
 * real code path, not only declared. These tests import the real packages
 * (no mocks) — @ruvector/learning-wasm, ruvector (+ @ruvector/mincut-wasm),
 * agent-booster — and assert the accelerated path is the one that ran.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { loadWasmMinCut, wasmMinCut, seedLocalMinCut } from '../src/ruvector/mincut-bridge.js';
import { analyzeMinCutBoundaries, fallbackMinCut, getMinCutBackend } from '../src/ruvector/graph-analyzer.js';
import { fastApply } from '../src/ruvector/fast-apply.js';
import { hooksFastApply } from '../src/mcp-tools/fast-apply-tools.js';
import { agentdbGraphPathfinder } from '../src/mcp-tools/agentdb-tools.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';
import { _resetBridgeDb } from '../src/memory/graph-edge-writer.js';

type Edge = [string, string, number];

/** Two 4-cliques joined by one light bridge: min cut = 0.5, sides {a*} / {b*}. */
function twoClusters(): { nodes: string[]; edges: Edge[] } {
  const a = ['a1', 'a2', 'a3', 'a4'];
  const b = ['b1', 'b2', 'b3', 'b4'];
  const edges: Edge[] = [];
  for (const group of [a, b]) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) edges.push([group[i], group[j], 2]);
    }
  }
  edges.push(['a1', 'b1', 0.5]);
  return { nodes: [...a, ...b], edges };
}

// vitest externalizes `@ruvector/*` to a context that cannot see the pnpm
// symlinks, so (as in ruvector-training-attention-api-4610.test.ts) the
// learning-wasm path runs in a child process under tsx — the production loader.
const CLI_DIR = resolve(__dirname, '..');
function probeTraining(): Record<string, any> {
  const src = (p: string) => JSON.stringify(pathToFileURL(join(CLI_DIR, 'src', p)).href);
  const script = `
    const rt = await import(${src('services/ruvector-training.ts')});
    const idx = await import(${src('ruvector/index.ts')});
    const init = await rt.initializeTraining({ dim: 64 });
    const out = rt.forward(new Float32Array(64).fill(0.1));
    console.log('RESULT=' + JSON.stringify({ init, active: rt.getActiveBackend(),
      available: await idx.isWasmBackendAvailable(), outLen: out.length, isF32: out instanceof Float32Array }));
    process.exit(0);`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: CLI_DIR, encoding: 'utf8', timeout: 120_000 });
  const line = child.stdout.split('\n').find(l => l.startsWith('RESULT='));
  if (!line) throw new Error(`probe produced no result: ${child.stderr.slice(-800)}`);
  return JSON.parse(line.slice('RESULT='.length));
}

describe('@ruvector/learning-wasm activates the WASM MicroLoRA backend', () => {
  it('initializeTraining() selects the wasm backend, not the JS fallback', () => {
    const r = probeTraining();
    expect(r.available).toBe(true);
    expect(r.init.backend).toBe('wasm');
    expect(r.active).toBe('wasm');
    expect(r.init.features.some((f: string) => f.startsWith('MicroLoRA/WASM'))).toBe(true);
    expect(r.isF32).toBe(true);
    expect(r.outLen).toBe(64);
  });
});

describe('ruvector DynamicMinCut (@ruvector/mincut-wasm) backs graph min-cut', () => {
  it('loads the wasm solver through ruvector', async () => {
    expect(await loadWasmMinCut()).not.toBeNull();
    expect(await getMinCutBackend()).toBe('mincut-wasm');
  });

  it('finds the bridge cut and folds duplicate / reversed edges', async () => {
    const { nodes, edges } = twoClusters();
    // Duplicates in both directions would make the raw solver throw "Edge already exists".
    const noisy: Edge[] = [...edges, ['a2', 'a1', 2], ['a3', 'a3', 9]];
    const cut = await wasmMinCut(nodes, noisy);
    expect(cut).not.toBeNull();
    expect(cut!.cutValue).toBeCloseTo(0.5, 6);
    const sides = [cut!.partition1, cut!.partition2].map(s => [...s].sort().join(','));
    expect(sides.sort()).toEqual(['a1,a2,a3,a4', 'b1,b2,b3,b4']);
    expect(cut!.cutEdges).toEqual([['a1', 'b1']]);
  });

  it('agrees with the JS Stoer-Wagner fallback on a random graph', async () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const nodes = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const edges: Edge[] = [];
    for (let i = 0; i < nodes.length; i++) edges.push([nodes[i], nodes[(i + 1) % nodes.length], 1 + Math.floor(rand() * 4)]);
    for (let k = 0; k < 60; k++) {
      const u = Math.floor(rand() * 40), v = Math.floor(rand() * 40);
      if (u !== v) edges.push([nodes[u], nodes[v], 1 + Math.floor(rand() * 4)]);
    }
    const wasm = await wasmMinCut(nodes, edges);
    const js = fallbackMinCut(nodes, edges);
    expect(wasm).not.toBeNull();
    expect(wasm!.cutValue).toBeCloseTo(js.cutValue, 6);
  });

  it('analyzeMinCutBoundaries uses the wasm result', async () => {
    const { nodes, edges } = twoClusters();
    const graph = {
      nodes: new Map(nodes.map(n => [n, { id: n, path: n, name: n, type: 'file' as const, imports: [], exports: [], size: 1, complexity: 1 }])),
      edges: edges.map(([s, t, w]) => ({ source: s, target: t, type: 'import' as const, weight: w })),
    };
    const [b] = await analyzeMinCutBoundaries(graph as never, 2);
    expect(b.cutValue).toBeCloseTo(0.5, 6);
  });

  it('seedLocalMinCut returns the seed side of the weakest boundary', async () => {
    const { edges } = twoClusters();
    const r = await seedLocalMinCut('a2', edges, 3, 1000, fallbackMinCut);
    expect(r).not.toBeNull();
    expect(r!.backend).toBe('mincut-wasm');
    expect(r!.cutValue).toBeCloseTo(0.5, 6);
    expect(r!.seedSide.map(n => n.nodeId).sort()).toEqual(['a1', 'a3', 'a4']);
    expect([...r!.otherSide].sort()).toEqual(['b1', 'b2', 'b3', 'b4']);
  });
});

describe('agentdb_graph-pathfinder dynamic-mincut runs the real min cut', () => {
  const req = createRequire(import.meta.url);
  let Database: any;
  let native = true;
  let root: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    try {
      Database = req('better-sqlite3');
      new Database(':memory:').close();
    } catch {
      native = false;
    }
  });

  beforeEach(() => {
    saved.CLAUDE_FLOW_MEMORY_PATH = process.env.CLAUDE_FLOW_MEMORY_PATH;
    saved.CLAUDE_FLOW_DB_PATH = process.env.CLAUDE_FLOW_DB_PATH;
    root = mkdtempSync(join(tmpdir(), 'ruflo-mincut-'));
    mkdirSync(join(root, '.swarm'), { recursive: true });
    process.env.CLAUDE_FLOW_MEMORY_PATH = join(root, '.swarm');
    delete process.env.CLAUDE_FLOW_DB_PATH;
    _resetMemoryRootCache();
    _resetBridgeDb();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetMemoryRootCache();
    _resetBridgeDb();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the seed partition and cut metadata', async () => {
    if (!native) return;
    const db = new Database(join(root, '.swarm', 'memory.db'));
    db.exec(`CREATE TABLE graph_edges (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0, confidence REAL DEFAULT 1.0, decay_rate REAL DEFAULT 0.0,
      last_reinforced TEXT, witness_id TEXT, embedding_ref TEXT, metadata TEXT, created_at TEXT NOT NULL)`);
    const ins = db.prepare('INSERT INTO graph_edges (id, source_id, target_id, relation, weight, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    twoClusters().edges.forEach(([s, t, w], i) => ins.run(`e${i}`, `entity:${s}`, `entity:${t}`, 'related', w, new Date().toISOString()));
    db.close();

    const r = await agentdbGraphPathfinder.handler({
      seedNodeId: 'entity:a2', query: 'boundary', algorithm: 'dynamic-mincut', threshold: 0,
      complexityBudget: { maxMillis: 5000 },
    }) as any;
    expect(r.success).toBe(true);
    expect(r.mincut.backend).toBe('mincut-wasm');
    expect(r.mincut.cutValue).toBeCloseTo(0.5, 6);
    expect(r.paths.map((p: any) => p.nodeId).sort()).toEqual(['entity:a1', 'entity:a3', 'entity:a4']);
  });
});

describe('agent-booster backs hooks_fast-apply', () => {
  const code = 'function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a - b;\n}\n';
  const snippet = 'function add(a: number, b: number): number {\n  return a + b;\n}';

  it('merges a code snippet with the real engine', async () => {
    const r = await fastApply({ code, edit: snippet, language: 'typescript' });
    expect(r.backend).toBe('agent-booster');
    expect(r.success).toBe(true);
    expect(r.output).toContain('function add(a: number, b: number): number');
    expect(r.output).toContain('function sub(a, b)');
  });

  it('refuses a natural-language instruction (it is an applier, not a generator)', async () => {
    const r = await fastApply({ code, edit: 'Convert all var declarations to const', language: 'javascript' });
    expect(r.backend).toBe('agent-booster');
    expect(r.success).toBe(false);
    expect(r.output).toBe(code);
  });

  describe('file mode', () => {
    let dir: string;
    let prev: string | undefined;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'ruflo-fastapply-'));
      prev = process.env.CLAUDE_FLOW_CWD;
      process.env.CLAUDE_FLOW_CWD = dir;
    });
    afterEach(() => {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
      else process.env.CLAUDE_FLOW_CWD = prev;
      rmSync(dir, { recursive: true, force: true });
    });

    it('patches a file in place and honours dryRun', async () => {
      writeFileSync(join(dir, 'math.ts'), code);
      const dry = await hooksFastApply.handler({ file: 'math.ts', edit: snippet, dryRun: true }) as any;
      expect(dry.success).toBe(true);
      expect(dry.written).toBe(false);
      expect(readFileSync(join(dir, 'math.ts'), 'utf-8')).toBe(code);

      const real = await hooksFastApply.handler({ file: 'math.ts', edit: snippet }) as any;
      expect(real.written).toBe(true);
      expect(readFileSync(join(dir, 'math.ts'), 'utf-8')).toContain('a: number, b: number');
    });

    it('rejects a path outside the project root', async () => {
      const r = await hooksFastApply.handler({ file: '../outside.ts', edit: snippet }) as any;
      expect(r.success).toBe(false);
    });
  });
});
