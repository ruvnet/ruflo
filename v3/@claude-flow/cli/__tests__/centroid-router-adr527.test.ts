/**
 * ADR-527 — opt-in nearest-centroid agent router.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeRouteTask: vi.fn(async () => null) }));

// The query vector and model the mocked MiniLM path returns; set per test.
const mini = vi.hoisted(() => ({ vec: null as Float32Array | null, model: 'Xenova/all-MiniLM-L6-v2', degraded: false }));
vi.mock('../src/ruvector/router-embedder.js', async (orig) => {
  const actual = await orig<typeof import('../src/ruvector/router-embedder.js')>();
  return {
    ...actual,
    routerEmbedderModel: () => mini.model,
    embedForRouter: async (texts: readonly string[], kind?: 'hash' | 'minilm') => {
      if (kind === 'minilm' && mini.vec) {
        if (mini.degraded) return { vectors: texts.map((t) => actual.generateSimpleEmbedding(t)), embedder: 'hash', reason: 'minilm unavailable (test)' };
        return { vectors: texts.map(() => mini.vec as Float32Array), embedder: 'minilm' };
      }
      return actual.embedForRouter(texts, kind === 'minilm' ? 'hash' : kind);
    },
  };
});

import {
  CENTROID_SCHEMA,
  classify,
  resolveMargin,
  validateArtifact,
  __resetCentroidRouterForTests,
  type CentroidArtifact,
} from '../src/ruvector/centroid-router.js';
import { NO_MATCH_CONFIDENCE, hooksRoute, resetSemanticRouterForTests } from '../src/mcp-tools/hooks-tools.js';
import { bridgeRouteTask } from '../src/memory/memory-bridge.js';

const DIM = 384;
const axis = (k: number, w = 1): number[] => { const v = new Array(DIM).fill(0); v[k] = w; return v; };
const artifact = (over: Partial<CentroidArtifact> = {}): CentroidArtifact => ({
  schema: CENTROID_SCHEMA, embedder: 'minilm', model: 'Xenova/all-MiniLM-L6-v2', dim: DIM, margin: 0.005,
  corpusSha256: 'x', split: 'dev', labels: ['none', 'reviewer', 'tester'], support: [1, 1, 1],
  centroids: [axis(0), axis(1), axis(2)], ...over,
});
/** A unit query that scores `a` against centroid i and `b` against centroid j. */
const between = (i: number, a: number, j: number, b: number): Float32Array => {
  const v = new Float32Array(DIM); v[i] = a; v[j] = b; v[3] = Math.sqrt(Math.max(0, 1 - a * a - b * b)); return v;
};

describe('ADR-527 classify', () => {
  it('picks the most similar centroid and reports the margin', () => {
    const d = classify(artifact(), between(2, 0.8, 1, 0.3), 'minilm', 'Xenova/all-MiniLM-L6-v2', 0.005);
    expect(d).toMatchObject({ status: 'decided', label: 'tester', runnerUp: 'reviewer', margin: 0.5 });
  });

  it('falls back when the top two are closer than the margin', () => {
    const d = classify(artifact(), between(2, 0.5, 1, 0.498), 'minilm', undefined, 0.005);
    expect(d.status).toBe('fallback');
  });

  it('treats a bare model id and the Xenova id as the same model', () => {
    expect(classify(artifact(), between(2, 0.9, 1, 0.1), 'minilm', 'all-MiniLM-L6-v2', 0).status).toBe('decided');
  });

  it.each([
    ['hash embedder', 'hash', 'Xenova/all-MiniLM-L6-v2', DIM, /embedded with 'hash'/],
    ['a different runtime', 'minilm', 'ruvector/all-MiniLM-L6-v2', DIM, /differs from centroid model/],
    ['a wrong dimension', 'minilm', undefined, 768, /768-d/],
  ])('refuses a query from %s', (_n, emb, model, dim, re) => {
    const q = new Float32Array(dim); q[0] = 1;
    const d = classify(artifact(), q, emb, model, 0);
    expect(d.status).toBe('unavailable');
    expect((d as { reason: string }).reason).toMatch(re);
  });

  it('refuses an all-zero query', () => {
    expect(classify(artifact(), new Float32Array(DIM), 'minilm', undefined, 0).status).toBe('unavailable');
  });
});

describe('ADR-527 artifact and margin', () => {
  it('rejects malformed artifacts with a specific message', () => {
    expect(() => validateArtifact({ ...artifact(), schema: 'x' })).toThrow(/schema/);
    expect(() => validateArtifact({ ...artifact(), centroids: [axis(0)] })).toThrow(/differ in length/);
    expect(() => validateArtifact({ ...artifact(), centroids: [axis(0), axis(1), [1, 2]] })).toThrow(/384 finite/);
    expect(() => validateArtifact({ ...artifact(), margin: 2 })).toThrow(/margin/);
  });

  it('takes the margin from the env only when it is a number in [0, 1]', () => {
    expect(resolveMargin({ margin: 0.005 }, { CLAUDE_FLOW_ROUTER_CENTROID_MARGIN: '0.05' })).toBe(0.05);
    expect(resolveMargin({ margin: 0.005 }, { CLAUDE_FLOW_ROUTER_CENTROID_MARGIN: 'abc' })).toBe(0.005);
    expect(resolveMargin({ margin: 0.005 }, { CLAUDE_FLOW_ROUTER_CENTROID_MARGIN: '-1' })).toBe(0.005);
  });

  it('the shipped artifact is valid, built from the dev split of the current corpus', () => {
    const shipped = validateArtifact(JSON.parse(readFileSync(new URL('../assets/agent-router/centroids.minilm.json', import.meta.url), 'utf8')));
    const corpusRaw = readFileSync(new URL('../benchmarks/router/corpus.jsonl', import.meta.url));
    expect(shipped.corpusSha256).toBe(createHash('sha256').update(corpusRaw).digest('hex'));
    expect(shipped.split).toBe('dev');
    expect(shipped.model).toBe('Xenova/all-MiniLM-L6-v2');
    const rows = corpusRaw.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { label: string; split: string });
    expect(shipped.labels).toEqual([...new Set(rows.map((r) => r.label))].sort());
    expect(shipped.support.reduce((a, b) => a + b, 0)).toBe(rows.filter((r) => r.split === 'dev').length);
    for (const c of shipped.centroids) expect(Math.abs(Math.hypot(...c) - 1)).toBeLessThan(1e-3);
  });
});

type RouteOut = {
  matched?: boolean;
  matchedPattern: string;
  primaryAgent: { type: string; confidence: number };
  routing: { method: string };
  centroid?: { status: string; label?: string; baselineAgent: string; reason?: string };
};
const route = (task: string) => hooksRoute.handler({ task }) as Promise<RouteOut>;

describe('ADR-527 hooks_route integration', () => {
  const ENV = ['CLAUDE_FLOW_ROUTER_CENTROID', 'CLAUDE_FLOW_ROUTER_CENTROID_PATH', 'CLAUDE_FLOW_ROUTER_CENTROID_MARGIN', 'CLAUDE_FLOW_ROUTER_EMBEDDER', 'CLAUDE_FLOW_DISABLE_NATIVE_ROUTER', 'CLAUDE_FLOW_ROUTER_TYPESAFE'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    const dir = mkdtempSync(join(tmpdir(), 'adr527-'));
    const p = join(dir, 'centroids.json');
    writeFileSync(p, JSON.stringify(artifact()));
    process.env.CLAUDE_FLOW_ROUTER_CENTROID_PATH = p;
    process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'hash';
    process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER = '1';
    delete process.env.CLAUDE_FLOW_ROUTER_TYPESAFE;
    delete process.env.CLAUDE_FLOW_ROUTER_CENTROID_MARGIN;
    mini.vec = null; mini.degraded = false; mini.model = 'Xenova/all-MiniLM-L6-v2';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    __resetCentroidRouterForTests();
    resetSemanticRouterForTests();
  });
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    vi.restoreAllMocks();
  });

  it('leaves routing untouched when the flag is off', async () => {
    delete process.env.CLAUDE_FLOW_ROUTER_CENTROID;
    mini.vec = between(2, 0.9, 1, 0.1);
    const r = await route('write unit tests for the parser');
    expect(r.centroid).toBeUndefined();
    expect(r.routing.method).not.toBe('centroid');
  });

  it('routes to the nearest centroid and keeps the current pick as baselineAgent', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    mini.vec = between(2, 0.9, 1, 0.1);
    const r = await route('write unit tests for the parser');
    expect(r.primaryAgent.type).toBe('tester');
    expect(r.routing.method).toBe('centroid');
    expect(r.matchedPattern).toBe('centroid:tester');
    expect(r.centroid).toMatchObject({ status: 'decided', label: 'tester' });
    // #3567: a real match ranks above a no-match even at a low cosine.
    expect(r.primaryAgent.confidence).toBeGreaterThan(NO_MATCH_CONFIDENCE);
    expect(typeof r.centroid?.baselineAgent).toBe('string');
  });

  it('abstains when the nearest centroid is "none"', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    mini.vec = between(0, 0.9, 1, 0.1);
    const r = await route('what is the weather like today');
    expect(r.matchedPattern).toBe('centroid-abstain');
    expect(r.matched).toBe(false);
    expect(r.primaryAgent.confidence).toBe(NO_MATCH_CONFIDENCE);
  });

  it('keeps a weak but decided match above the no-match confidence', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    mini.vec = between(2, 0.12, 1, 0.02);
    const r = await route('write unit tests for the parser');
    expect(r.centroid).toMatchObject({ status: 'decided', label: 'tester' });
    expect(r.primaryAgent.confidence).toBeGreaterThan(NO_MATCH_CONFIDENCE);
  });

  it('keeps the current router on a near-tie and says so', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    mini.vec = between(2, 0.5, 1, 0.499);
    const r = await route('write unit tests for the parser');
    expect(r.centroid?.status).toBe('fallback');
    expect(r.routing.method).not.toBe('centroid');
    expect(r.primaryAgent.type).toBe(r.centroid?.baselineAgent);
  });

  it('keeps the current router when MiniLM degrades to the hash embedder', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    mini.vec = between(2, 0.9, 1, 0.1); mini.degraded = true;
    const r = await route('write unit tests for the parser');
    expect(r.centroid?.status).toBe('unavailable');
    expect(r.centroid?.reason).toMatch(/hash/);
    expect(r.routing.method).not.toBe('centroid');
  });

  it('reports "bypassed" when a learned AgentDB route answers first', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    mini.vec = between(2, 0.9, 1, 0.1);
    vi.mocked(bridgeRouteTask).mockResolvedValueOnce({ route: 'review', agents: ['reviewer'], confidence: 0.9, controller: 'semanticRouter' } as never);
    const r = await route('write unit tests for the parser');
    expect(r.primaryAgent.type).toBe('reviewer');
    expect(r.centroid).toMatchObject({ status: 'bypassed', baselineAgent: 'reviewer' });
  });

  it('adds nothing to a learned route when the flag is off', async () => {
    delete process.env.CLAUDE_FLOW_ROUTER_CENTROID;
    vi.mocked(bridgeRouteTask).mockResolvedValueOnce({ route: 'review', agents: ['reviewer'], confidence: 0.9, controller: 'semanticRouter' } as never);
    expect((await route('write unit tests for the parser')).centroid).toBeUndefined();
  });

  it('reports a missing artifact instead of throwing', async () => {
    process.env.CLAUDE_FLOW_ROUTER_CENTROID = '1';
    process.env.CLAUDE_FLOW_ROUTER_CENTROID_PATH = '/nonexistent/centroids.json';
    mini.vec = between(2, 0.9, 1, 0.1);
    const r = await route('write unit tests for the parser');
    expect(r.centroid).toMatchObject({ status: 'unavailable' });
    expect(r.centroid?.reason).toMatch(/not found/);
  });
});
