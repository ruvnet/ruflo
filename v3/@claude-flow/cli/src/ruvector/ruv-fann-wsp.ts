/**
 * ruv-fann-wsp.ts — optional ruv-FANN weight-space tooling (ADR-528).
 *
 * Wraps three exact-pinned optional dependencies:
 *   - `ruv-fann-wsp`            fingerprint, inspect, sensitivity
 *   - `ruv-fann-wsp-invariants` finite-domain output-bound checks
 *   - `ruv-fann-wsp-lifecycle`  bounded-patch regression gates
 *
 * They share the `ruv-fann` core and `ruv-fann-wasm` runtime that agentdb and
 * @metaharness/darwin already install, so they add no native code and no
 * install scripts. The `ruv-fann` 0.3.0 facade is deliberately NOT used: it
 * pulls esbuild (an install script) and a native RVF binding into every
 * install for capabilities ruflo does not call.
 *
 * Every entry point loads the packages lazily. When they are absent the
 * caller gets `{ available: false, reason }`; nothing else in the CLI
 * imports this module, so cold start and routing are unchanged.
 *
 * Results are hash-bound evidence, not authority: nothing here promotes,
 * writes or reroutes on its own.
 *
 * @module ruv-fann-wsp
 */

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CentroidArtifact } from './centroid-router.js';

export const WSP_PACKAGES = ['ruv-fann-wsp', 'ruv-fann-wsp-invariants', 'ruv-fann-wsp-lifecycle'] as const;
export type WspPackage = (typeof WSP_PACKAGES)[number];

/** Upper bound for any JSON file this module reads (models, suites, patches). */
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
/** INVARIANT_LIMITS.maxCases in ruv-fann-wsp-invariants 0.1.0. */
export const MAX_CASES_PER_SUITE = 16;
/** Centroids are stored rounded, so a centroid scores slightly below 1 against itself. */
export const SELF_SCORE_TOLERANCE = 1e-5;

export interface DenseLayer {
  inputs: number;
  outputs: number;
  /** Row-major [outputs, inputs]. */
  weights: number[];
  bias?: number[] | null;
  activation: string;
  steepness: number;
}
export interface DenseModel {
  schema: 'ruv-fann.dense-layers/1';
  layers: DenseLayer[];
}
export interface InvariantCase {
  name: string;
  inputs: number[];
  rows: number;
  minimum?: number[];
  maximum?: number[];
  expected?: number[];
  tolerance?: number;
}
export interface InvariantSuite {
  schema: 'ruv-fann.invariants/1';
  cases: InvariantCase[];
}

export interface WspModules {
  wsp: Record<string, any>;
  invariants: Record<string, any>;
  lifecycle: Record<string, any>;
}
export type WspLoad = { available: true; modules: WspModules } | { available: false; reason: string };
export type Importer = (specifier: string) => Promise<Record<string, any>>;

// A non-literal specifier keeps tsc from resolving the optional packages at
// build time; they are ESM-only, so `require` cannot load them.
const defaultImporter: Importer = (specifier) => import(specifier);

let _load: Promise<WspLoad> | null = null;

function isMissingModule(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/** Load all three packages once. Never throws. */
export function loadWsp(importer: Importer = defaultImporter): Promise<WspLoad> {
  if (importer !== defaultImporter) return doLoad(importer);
  if (!_load) _load = doLoad(importer);
  return _load;
}

async function doLoad(importer: Importer): Promise<WspLoad> {
  const mods: Partial<Record<WspPackage, Record<string, any>>> = {};
  for (const name of WSP_PACKAGES) {
    try {
      mods[name] = await importer(name);
    } catch (err) {
      const why = isMissingModule(err) ? 'is not installed' : `failed to load: ${err instanceof Error ? err.message : String(err)}`;
      return { available: false, reason: `${name} ${why} (optional dependency of @claude-flow/cli)` };
    }
  }
  return {
    available: true,
    modules: { wsp: mods['ruv-fann-wsp']!, invariants: mods['ruv-fann-wsp-invariants']!, lifecycle: mods['ruv-fann-wsp-lifecycle']! },
  };
}

/** Package root of `name` at or above `dir`, or null. */
function packageRootAbove(dir: string, name: string): { root: string; version: string } | null {
  for (let i = 0; i < 4; i++) {
    try {
      const pkg = JSON.parse(readFileSync(resolvePath(dir, 'package.json'), 'utf8'));
      if (pkg && pkg.name === name && typeof pkg.version === 'string') return { root: dir, version: pkg.version };
    } catch { /* keep walking */ }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Installed version of each package, or null. `ruv-fann` is not a direct
 * dependency, so it is looked up where ruv-fann-wsp resolves it: nested
 * under it (pnpm, npm conflicts) or beside it (flat npm).
 */
export function wspVersions(): Record<WspPackage | 'ruv-fann', string | null> {
  const out = {} as Record<WspPackage | 'ruv-fann', string | null>;
  let wspRoot: string | null = null;
  for (const name of WSP_PACKAGES) {
    out[name] = null;
    try {
      const found = packageRootAbove(dirname(fileURLToPath(import.meta.resolve(name))), name);
      if (found) {
        out[name] = found.version;
        if (name === 'ruv-fann-wsp') wspRoot = found.root;
      }
    } catch { /* not installed */ }
  }
  out['ruv-fann'] = null;
  if (wspRoot) {
    for (const dir of [resolvePath(wspRoot, 'node_modules', 'ruv-fann'), resolvePath(wspRoot, '..', 'ruv-fann')]) {
      const found = packageRootAbove(dir, 'ruv-fann');
      if (found && found.root === dir) { out['ruv-fann'] = found.version; break; }
    }
  }
  return out;
}

/**
 * The centroid router as a one-layer Linear ruv-FANN model. Output k is the
 * dot product with centroid k, which is the router's cosine score for a
 * unit-length query, so the model ranks labels exactly as `classify` does.
 */
export function centroidToDenseModel(artifact: CentroidArtifact): DenseModel {
  const weights: number[] = [];
  for (const c of artifact.centroids) for (const v of c) weights.push(v);
  return {
    schema: 'ruv-fann.dense-layers/1',
    layers: [{
      inputs: artifact.dim,
      outputs: artifact.labels.length,
      weights,
      bias: new Array(artifact.labels.length).fill(0),
      activation: 'Linear',
      steepness: 1,
    }],
  };
}

function caseName(prefix: string, label: string, i: number): string {
  const safe = label.replace(/[^A-Za-z0-9_.-]/g, '_');
  return `${prefix}${i}-${safe}`.slice(0, 64);
}

/**
 * Self-routing invariants: fed its own centroid, each label must score
 * 1 ± tolerance and every other label at most `1 - minGap`. A failure means
 * two labels are (near-)duplicates or the artifact is corrupt — the router
 * could not separate them even on their own means.
 *
 * Returned as several suites when there are more labels than one suite allows.
 */
export function centroidSelfRoutingSuites(
  artifact: CentroidArtifact,
  opts: { tolerance?: number; minGap?: number } = {},
): InvariantSuite[] {
  const tol = opts.tolerance ?? SELF_SCORE_TOLERANCE;
  const minGap = opts.minGap ?? 0.05;
  if (!(tol >= 0 && tol < 0.5)) throw new RangeError('tolerance must be in [0, 0.5)');
  if (!(minGap > 0 && minGap < 1)) throw new RangeError('minGap must be in (0, 1)');
  const n = artifact.labels.length;
  const cases: InvariantCase[] = artifact.centroids.map((c, i) => ({
    name: caseName('self-', artifact.labels[i], i),
    inputs: c.slice(),
    rows: 1,
    // Unit vectors: every score is within [-1, 1]; pad by tol for rounding.
    minimum: Array.from({ length: n }, (_, j) => (j === i ? 1 - tol : -1 - tol)),
    maximum: Array.from({ length: n }, (_, j) => (j === i ? 1 + tol : 1 - minGap)),
  }));
  const suites: InvariantSuite[] = [];
  for (let i = 0; i < cases.length; i += MAX_CASES_PER_SUITE) {
    suites.push({ schema: 'ruv-fann.invariants/1', cases: cases.slice(i, i + MAX_CASES_PER_SUITE) });
  }
  return suites;
}

/**
 * Read a JSON file the user named. Refuses non-regular files (FIFOs, devices,
 * directories), symlinks that leave nothing to read, and anything larger
 * than MAX_INPUT_BYTES, before reading it into memory.
 */
export function readJsonInput(path: string, what: string, maxBytes = MAX_INPUT_BYTES): unknown {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw new Error(`${what}: a file path is required`);
  }
  const real = realpathSync(resolvePath(path));
  const st = lstatSync(real);
  if (!st.isFile()) throw new Error(`${what}: ${path} is not a regular file`);
  if (st.size > maxBytes) throw new Error(`${what}: ${path} is ${st.size} bytes; limit is ${maxBytes}`);
  const text = readFileSync(real, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${what}: ${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Shape check before handing a user model to WSP (which validates fully). */
export function assertDenseModel(x: unknown, what = 'model'): DenseModel {
  const m = x as Partial<DenseModel> | null;
  if (!m || typeof m !== 'object' || m.schema !== 'ruv-fann.dense-layers/1' || !Array.isArray(m.layers) || m.layers.length === 0) {
    throw new Error(`${what}: expected a ruv-fann.dense-layers/1 model with at least one layer`);
  }
  return m as DenseModel;
}

export interface SelfRoutingResult {
  accepted: boolean;
  modelHash: string;
  labels: number;
  suites: number;
  checks: number;
  violations: Array<{ case: string; output: string; constraint: string; actual: number; bound: number }>;
  backend: string;
  ms: number;
}

/** Run the self-routing invariants against a centroid artifact. */
export async function checkCentroidSelfRouting(
  mods: WspModules,
  artifact: CentroidArtifact,
  opts: { tolerance?: number; minGap?: number } = {},
): Promise<SelfRoutingResult> {
  const t0 = performance.now();
  const model = centroidToDenseModel(artifact);
  const suites = centroidSelfRoutingSuites(artifact, opts);
  let accepted = true, checks = 0, backend = '', modelHash = '';
  const violations: SelfRoutingResult['violations'] = [];
  for (const suite of suites) {
    const r = await mods.invariants.checkModelInvariants(model, suite);
    accepted &&= r.accepted === true;
    checks += r.checks;
    backend = r.backend;
    modelHash = r.modelHash;
    for (const v of r.violations) {
      violations.push({ case: v.case, output: artifact.labels[v.output] ?? String(v.output), constraint: v.constraint, actual: v.actual, bound: v.bound });
    }
  }
  return { accepted, modelHash, labels: artifact.labels.length, suites: suites.length, checks, violations, backend, ms: Math.round(performance.now() - t0) };
}

/** Test hook. */
export function __resetWspForTests(): void {
  _load = null;
}
