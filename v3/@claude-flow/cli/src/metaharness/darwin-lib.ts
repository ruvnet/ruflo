/**
 * In-process access to @metaharness/darwin (ADR-526).
 *
 * darwin is a regular dependency of the CLI, so the long-lived MCP server can
 * import it once and answer `metaharness_bench --op verify` and every
 * `metaharness_gepa` op without spawning `node bench.mjs` → `node darwin/cli.js`
 * per call. Each function returns the same {exitCode, json} pair the plugin
 * script would have produced, so callers keep the existing
 * {success, data, degraded, exitCode} contract.
 *
 * Graceful degradation (ADR-150 rule 3) still holds: if the import fails, every
 * function returns null and the caller falls back to the subprocess path.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DarwinResult {
  exitCode: number;
  /** Parsed payload, or null where the script would have printed only to stderr. */
  json: unknown;
}

type DarwinRoot = {
  bench: {
    loadSuite(path: string): Promise<{ id: string; version: string; tasks: unknown[] }>;
    verifySuite(suite: unknown): { ok: boolean; actual: string };
  };
};

type DarwinGepa = {
  loadGenome(read: typeof readFileSync, path: string): unknown;
  loadCand6Genome(): unknown;
  validateGenome(genome: unknown): unknown[];
  buildSystemFromGenome(genome: unknown, ext?: string, glob?: string): string;
  analyzeTranscript(entries: unknown[]): unknown;
  CAND6_GENOME_PATH: string;
};

// The specifiers are held in variables so a missing package degrades at
// runtime instead of failing the CLI's own type-check or bundling.
const ROOT_SPEC = '@metaharness/darwin';
const GEPA_SPEC = '@metaharness/darwin/gepa';

let rootPromise: Promise<DarwinRoot | null> | null = null;
let gepaPromise: Promise<DarwinGepa | null> | null = null;

export function loadDarwin(): Promise<DarwinRoot | null> {
  rootPromise ??= import(ROOT_SPEC).then((m) => m as DarwinRoot, () => null);
  return rootPromise;
}

export function loadDarwinGepa(): Promise<DarwinGepa | null> {
  gepaPromise ??= import(GEPA_SPEC).then((m) => m as DarwinGepa, () => null);
  return gepaPromise;
}

/** Test hook: forget the cached modules. */
export function resetDarwinCache(): void {
  rootPromise = null;
  gepaPromise = null;
}

/**
 * `bench verify <suite>` in-process. Mirrors plugins/ruflo-metaharness/scripts/bench.mjs:
 * exit 2 + no payload for a missing path, exit 1 when the suite fails to load
 * (darwin's loadSuite throws on tamper) or its hash does not match, exit 0 otherwise.
 * Returns null when darwin cannot be imported.
 */
export async function benchVerify(suitePath: string): Promise<DarwinResult | null> {
  const darwin = await loadDarwin();
  if (!darwin) return null;
  if (!suitePath || !existsSync(resolve(suitePath))) return { exitCode: 2, json: null };

  const start = Date.now();
  const file = resolve(suitePath);
  try {
    const suite = await darwin.bench.loadSuite(file);
    const check = darwin.bench.verifySuite(suite);
    const tasks = Array.isArray(suite.tasks) ? suite.tasks.length : 0;
    const data = {
      op: 'verify',
      suiteId: suite.id,
      version: suite.version,
      tasks,
      hashOk: check.ok,
      hash: check.actual,
      // Same line the darwin CLI prints, so readers of the old shape keep working.
      stdoutTail: `Suite ${suite.id}@${suite.version}: ${tasks} tasks, hash ${check.ok ? 'OK' : 'MISMATCH'} (${String(check.actual).slice(0, 12)}…)\n`,
      durationMs: Date.now() - start,
    };
    return { exitCode: check.ok ? 0 : 1, json: { success: check.ok, data, generatedAt: new Date().toISOString() } };
  } catch (e) {
    const data = { op: 'verify', error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    return { exitCode: 1, json: { success: false, data, generatedAt: new Date().toISOString() } };
  }
}

export interface GepaInput {
  op: string;
  path?: string;
  transcript?: string;
  ext?: string;
  glob?: string;
  alertOnInvalid?: boolean;
}

const GEPA_OPS = ['genome', 'validate', 'render', 'analyze'];

function readJson(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { ok: false };
  }
}

/**
 * GEPA genome ops in-process. Mirrors plugins/ruflo-metaharness/scripts/gepa.mjs,
 * including its exit codes: 2 for input errors (no payload), 1 for an invalid
 * genome with alertOnInvalid, 0 otherwise. Returns null when darwin/gepa cannot
 * be imported.
 */
export async function gepaOp(input: GepaInput): Promise<DarwinResult | null> {
  if (!GEPA_OPS.includes(input.op)) return { exitCode: 2, json: null };
  const gepa = await loadDarwinGepa();
  if (!gepa) return null;

  const start = Date.now();
  let out: Record<string, unknown>;
  try {
    const loadGenome = (): { genome: unknown; source: string } | null => {
      if (input.path) {
        if (!existsSync(input.path)) return null;
        return { genome: gepa.loadGenome(readFileSync, input.path), source: input.path };
      }
      return { genome: gepa.loadCand6Genome(), source: gepa.CAND6_GENOME_PATH };
    };

    if (input.op === 'genome') {
      const loaded = loadGenome();
      if (!loaded) return { exitCode: 2, json: null };
      const errors = gepa.validateGenome(loaded.genome);
      out = { op: 'genome', source: loaded.source, valid: errors.length === 0, errors, genome: loaded.genome };
    } else if (input.op === 'validate') {
      let raw: unknown;
      if (input.path) {
        if (!existsSync(input.path)) return { exitCode: 2, json: null };
        const r = readJson(input.path);
        if (!r.ok) return { exitCode: 2, json: null };
        raw = r.value;
      } else {
        raw = gepa.loadCand6Genome();
      }
      const errors = gepa.validateGenome(raw);
      out = { op: 'validate', source: input.path ?? gepa.CAND6_GENOME_PATH, valid: errors.length === 0, errors };
    } else if (input.op === 'render') {
      const loaded = loadGenome();
      if (!loaded) return { exitCode: 2, json: null };
      const system = gepa.buildSystemFromGenome(loaded.genome, input.ext, input.glob);
      out = { op: 'render', source: loaded.source, chars: system.length, system };
    } else {
      if (!input.transcript || !existsSync(input.transcript)) return { exitCode: 2, json: null };
      const r = readJson(input.transcript);
      if (!r.ok || !Array.isArray(r.value)) return { exitCode: 2, json: null };
      out = { op: 'analyze', source: input.transcript, entries: r.value.length, analysis: gepa.analyzeTranscript(r.value) };
    }
  } catch {
    // gepa.mjs exits 2 on any thrown error (its main().catch handler).
    return { exitCode: 2, json: null };
  }

  out.durationMs = Date.now() - start;
  const exitCode = input.alertOnInvalid && out.valid === false ? 1 : 0;
  return { exitCode, json: out };
}
