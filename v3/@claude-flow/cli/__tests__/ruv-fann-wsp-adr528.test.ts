/**
 * ADR-528 — optional ruv-FANN weight-space tooling.
 *
 * Runs against the real ruv-fann-wsp / invariants / lifecycle packages when they are installed
 * (optional dependencies; skipped where they are not) and against an
 * importer that reports them missing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadWsp, __resetWspForTests, centroidToDenseModel, centroidSelfRoutingSuites, checkCentroidSelfRouting,
  readJsonInput, assertDenseModel, wspVersions, MAX_CASES_PER_SUITE, type WspModules,
} from '../src/ruvector/ruv-fann-wsp.js';
import { loadCentroidArtifact, classify, type CentroidArtifact } from '../src/ruvector/centroid-router.js';

function artifact(centroids: number[][], labels = centroids.map((_, i) => `a${i}`)): CentroidArtifact {
  return {
    schema: 'ruflo.agent-centroids/1', embedder: 'minilm', model: 'all-MiniLM-L6-v2', dim: centroids[0].length,
    margin: 0, corpusSha256: 'x', split: 'dev', labels, support: labels.map(() => 1), centroids,
  };
}

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

async function mods(): Promise<WspModules> {
  const l = await loadWsp();
  if (!l.available) throw new Error(l.reason);
  return l.modules;
}

// The three packages are optionalDependencies and the repo-root `npm ci` job (ci.yml Test Suite) does not install them.
// Tests that need the real packages are gated on REAL; the loader contract below is covered with stub importers.
const REAL = (await loadWsp()).available;

beforeEach(() => __resetWspForTests());

describe('loadWsp', () => {
  // The three packages are optionalDependencies. The repo-root `npm ci` job (ci.yml "Test Suite") does not install
  // them, so there the contract is the explicit "not installed" report, not a successful load; the
  // missing-package tests below cover that path with an injected importer.
  it('loads all three optional packages when they are installed', async ({ skip }) => {
    const l = await loadWsp();
    if (!l.available) {
      expect(l.reason).toMatch(/is not installed \(optional dependency of @claude-flow\/cli\)/);
      skip();
    }
    expect(l.available).toBe(true);
  });

  it('reports a missing package instead of throwing', async () => {
    const missing = async (s: string) => {
      if (s === 'ruv-fann-wsp-lifecycle') throw Object.assign(new Error(`Cannot find package '${s}'`), { code: 'ERR_MODULE_NOT_FOUND' });
      return {}; // stand-in module for the other two packages: only the failing one matters here
    };
    const l = await loadWsp(missing);
    expect(l).toEqual({ available: false, reason: 'ruv-fann-wsp-lifecycle is not installed (optional dependency of @claude-flow/cli)' });
  });

  it('reports a package that fails to load for another reason', async () => {
    const l = await loadWsp(async () => { throw new SyntaxError('bad token'); });
    expect(l.available).toBe(false);
    if (!l.available) expect(l.reason).toContain('failed to load: bad token');
  });

  it.skipIf(!REAL)('resolves versions, including the shared ruv-fann core', () => {
    const v = wspVersions();
    expect(v['ruv-fann-wsp']).toBe('0.2.0');
    expect(v['ruv-fann-wsp-invariants']).toBe('0.1.0');
    expect(v['ruv-fann-wsp-lifecycle']).toBe('0.1.0');
    expect(v['ruv-fann']).toMatch(/^0\.1\./);
  });
});

describe.skipIf(!REAL)('centroidToDenseModel', () => {
  it('ranks labels exactly as the centroid router does', async () => {
    const shipped = loadCentroidArtifact({});
    expect(shipped.error).toBeNull();
    const a = shipped.artifact!;
    const m = await mods();
    const model = centroidToDenseModel(a);
    // Deterministic pseudo-random unit queries.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
    const queries = Array.from({ length: 25 }, () => unit(Array.from({ length: a.dim }, rnd)));
    // One batched WASM pass through ruv-FANN: Linear layer, so outputs are the preactivations.
    const trace = await m.wsp.traceWeightModel(model, { inputs: queries.flat(), rows: queries.length });
    const outs: number[] = trace.layers[0].activations;
    const n = a.labels.length;
    for (let q = 0; q < queries.length; q++) {
      const query = queries[q];
      const out = outs.slice(q * n, (q + 1) * n);
      const top = out.indexOf(Math.max(...out));
      const d = classify(a, query, 'minilm', undefined, 0);
      expect(d.status).toBe('decided');
      if (d.status === 'decided') expect(a.labels[top]).toBe(d.label);
    }
    expect((await m.wsp.inspectWeightModel(model)).parameterCount).toBe(a.labels.length * (a.dim + 1));
  });
});

describe('self-routing invariants', () => {
  it.skipIf(!REAL)('pass on the shipped centroid router', async () => {
    const r = await checkCentroidSelfRouting(await mods(), loadCentroidArtifact({}).artifact!);
    expect(r.accepted).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.checks).toBe(r.labels * r.labels * 2);
  });

  it.skipIf(!REAL)('catch two near-duplicate labels', async () => {
    const a = artifact([unit([1, 0, 0]), unit([0, 1, 0]), unit([0.99, 0.01, 0])], ['x', 'y', 'x-copy']);
    const r = await checkCentroidSelfRouting(await mods(), a);
    expect(r.accepted).toBe(false);
    expect(r.violations.some((v) => v.output === 'x-copy' && v.constraint === 'maximum')).toBe(true);
  });

  it.skipIf(!REAL)('catch a corrupt (non-unit) centroid', async () => {
    const a = artifact([[2, 0, 0], unit([0, 1, 0]), unit([0, 0, 1])]);
    const r = await checkCentroidSelfRouting(await mods(), a);
    expect(r.accepted).toBe(false);
  });

  it('split more labels than one suite allows', () => {
    const n = MAX_CASES_PER_SUITE + 3;
    const a = artifact(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
    const suites = centroidSelfRoutingSuites(a);
    expect(suites.map((s) => s.cases.length)).toEqual([MAX_CASES_PER_SUITE, 3]);
  });

  it('reject an out-of-range gap', () => {
    const a = artifact([unit([1, 0]), unit([0, 1])]);
    expect(() => centroidSelfRoutingSuites(a, { minGap: 0 })).toThrow(RangeError);
    expect(() => centroidSelfRoutingSuites(a, { minGap: 1 })).toThrow(RangeError);
  });
});

describe.skipIf(!REAL)('regression gate', () => {
  it('accepts a small bias edit and rejects a large one', async () => {
    const m = await mods();
    const a = loadCentroidArtifact({}).artifact!;
    const model = centroidToDenseModel(a);
    const n = a.labels.length;
    const baseHash = await m.wsp.fingerprintModel(model);
    const suites = [{
      name: 'onehot',
      dataset: { inputs: a.centroids.flat(), targets: Array.from({ length: n * n }, (_, k) => (Math.floor(k / n) === k % n ? 1 : 0)), rows: n },
      policy: { maxMSE: 1, maxRegressionMSE: 0.001 },
    }];
    const edit = (value: number) => ({ schema: 'ruv-fann.weight-patch/1', baseHash, edits: [{ layer: 0, parameter: 'bias', index: 0, value }] });
    expect((await m.lifecycle.runRegressionGate({ model, patch: edit(0.001), suites })).accepted).toBe(true);
    expect((await m.lifecycle.runRegressionGate({ model, patch: edit(5), suites })).accepted).toBe(false);
  });
});

describe('readJsonInput', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wsp-adr528-'));

  it('reads a small JSON file', () => {
    const p = join(dir, 'ok.json');
    writeFileSync(p, '{"a":1}');
    expect(readJsonInput(p, 'x')).toEqual({ a: 1 });
  });

  it('refuses directories, oversize files, bad JSON and NUL paths', () => {
    mkdirSync(join(dir, 'd'), { recursive: true });
    expect(() => readJsonInput(join(dir, 'd'), 'x')).toThrow(/not a regular file/);
    const big = join(dir, 'big.json');
    writeFileSync(big, ' '.repeat(64));
    expect(() => readJsonInput(big, 'x', 32)).toThrow(/limit is 32/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{');
    expect(() => readJsonInput(bad, 'x')).toThrow(/not valid JSON/);
    expect(() => readJsonInput('a\0b', 'x')).toThrow(/file path is required/);
  });

  it('checks the target of a symlink, not the link', () => {
    const link = join(dir, 'link.json');
    try { symlinkSync(join(dir, 'd'), link); } catch { return; }
    expect(() => readJsonInput(link, 'x')).toThrow(/not a regular file/);
  });

  it('assertDenseModel rejects other shapes', () => {
    expect(() => assertDenseModel({ schema: 'nope', layers: [] })).toThrow(/dense-layers/);
    expect(() => assertDenseModel(null)).toThrow(/dense-layers/);
  });
});
