/**
 * centroid-router.ts — opt-in nearest-centroid agent router (ADR-527).
 *
 * Each agent label has one unit-length centroid: the mean MiniLM embedding of
 * its labelled example prompts (the ADR-391 corpus dev split, built by
 * `benchmarks/router/build-centroids.mjs`). A task goes to the label whose
 * centroid is most cosine-similar. When the top two scores are closer than
 * `margin`, the caller keeps the current router's pick instead.
 *
 * The artifact records the embedding model and dimension it was built with.
 * A query embedded any other way (for example MiniLM degraded to the hash
 * embedder) is never scored against it: `classify` returns `unavailable`.
 *
 * Gate: `CLAUDE_FLOW_ROUTER_CENTROID=1`. Off by default; the current router
 * is unchanged unless the flag is set.
 *
 * @module centroid-router
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CENTROID_ROUTER_ENV = 'CLAUDE_FLOW_ROUTER_CENTROID';
export const CENTROID_MARGIN_ENV = 'CLAUDE_FLOW_ROUTER_CENTROID_MARGIN';
export const CENTROID_ARTIFACT_ENV = 'CLAUDE_FLOW_ROUTER_CENTROID_PATH';
export const CENTROID_SCHEMA = 'ruflo.agent-centroids/1';
/** Label meaning "no agent fits"; the router abstains instead of picking one. */
export const ABSTAIN_LABEL = 'none';

export interface CentroidArtifact {
  schema: typeof CENTROID_SCHEMA;
  /** Embedder kind the centroids live in. Only 'minilm' is built today. */
  embedder: 'minilm';
  /** Embedding model id reported by the local embedder when the artifact was built. */
  model: string;
  dim: number;
  /** Default top-two margin below which the caller falls back. */
  margin: number;
  /** sha256 of the corpus file the centroids were built from. */
  corpusSha256: string;
  split: string;
  labels: string[];
  /** Examples per label, aligned with `labels`. */
  support: number[];
  /** Unit-length centroids, aligned with `labels`. */
  centroids: number[][];
}

export type CentroidDecision =
  | { status: 'decided'; label: string; score: number; runnerUp: string; runnerUpScore: number; margin: number }
  | { status: 'fallback'; label: string; score: number; runnerUp: string; runnerUpScore: number; margin: number; reason: string }
  | { status: 'unavailable'; reason: string }
  /** A learned route (AgentDB or a persisted SONA pattern) answered before the centroid router ran. */
  | { status: 'bypassed'; reason: string };

export function centroidRouterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CENTROID_ROUTER_ENV] === '1';
}

/** Margin from the env when it is a finite number in [0, 1], else the artifact default. */
export function resolveMargin(artifact: Pick<CentroidArtifact, 'margin'>, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[CENTROID_MARGIN_ENV];
  if (raw !== undefined && raw.trim() !== '') {
    const m = Number(raw);
    if (Number.isFinite(m) && m >= 0 && m <= 1) return m;
  }
  return artifact.margin;
}

/** Throws with a specific message when the artifact is malformed. */
export function validateArtifact(a: unknown): CentroidArtifact {
  const x = a as Partial<CentroidArtifact> | null;
  if (!x || x.schema !== CENTROID_SCHEMA) throw new Error(`centroid artifact schema is not ${CENTROID_SCHEMA}`);
  if (x.embedder !== 'minilm') throw new Error(`centroid artifact embedder '${String(x.embedder)}' is not supported`);
  if (typeof x.model !== 'string' || !x.model) throw new Error('centroid artifact has no model id');
  if (!Number.isInteger(x.dim) || (x.dim as number) <= 0) throw new Error('centroid artifact dim is invalid');
  if (typeof x.margin !== 'number' || !(x.margin >= 0 && x.margin <= 1)) throw new Error('centroid artifact margin is invalid');
  const labels = x.labels, cents = x.centroids, support = x.support;
  if (!Array.isArray(labels) || labels.length < 2) throw new Error('centroid artifact needs at least two labels');
  if (!Array.isArray(cents) || cents.length !== labels.length) throw new Error('centroid artifact labels and centroids differ in length');
  if (!Array.isArray(support) || support.length !== labels.length) throw new Error('centroid artifact labels and support differ in length');
  for (const c of cents) {
    if (!Array.isArray(c) || c.length !== x.dim || !c.every(Number.isFinite)) {
      throw new Error(`centroid artifact has a centroid that is not ${x.dim} finite numbers`);
    }
  }
  return x as CentroidArtifact;
}

let _cache: { path: string; artifact: CentroidArtifact | null; error: string | null } | null = null;

function defaultArtifactPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ruvector → assets, dist/src/ruvector → assets (package root)
  const candidates = [
    resolvePath(here, '..', '..', 'assets', 'agent-router', 'centroids.minilm.json'),
    resolvePath(here, '..', '..', '..', 'assets', 'agent-router', 'centroids.minilm.json'),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

/** Load (and cache) the artifact. Returns the error instead of throwing. */
export function loadCentroidArtifact(env: NodeJS.ProcessEnv = process.env): { artifact: CentroidArtifact | null; error: string | null; path: string } {
  const path = env[CENTROID_ARTIFACT_ENV] || defaultArtifactPath();
  if (_cache && _cache.path === path) return _cache;
  try {
    if (!existsSync(path)) throw new Error(`centroid artifact not found at ${path}`);
    _cache = { path, artifact: validateArtifact(JSON.parse(readFileSync(path, 'utf8'))), error: null };
  } catch (err) {
    _cache = { path, artifact: null, error: err instanceof Error ? err.message : String(err) };
  }
  return _cache;
}

/**
 * Score one query embedding.
 * @param query   the query vector (any length; normalised here)
 * @param queryEmbedder the embedder that actually produced `query`
 * @param queryModel    the model id that produced it, when known
 */
export function classify(
  artifact: CentroidArtifact,
  query: ArrayLike<number>,
  queryEmbedder: string,
  queryModel: string | undefined,
  margin: number,
): CentroidDecision {
  if (queryEmbedder !== artifact.embedder) {
    return { status: 'unavailable', reason: `query embedded with '${queryEmbedder}', centroids are '${artifact.embedder}'` };
  }
  if (queryModel !== undefined && normaliseModel(queryModel) !== normaliseModel(artifact.model)) {
    return { status: 'unavailable', reason: `query model '${queryModel}' differs from centroid model '${artifact.model}'` };
  }
  if (query.length !== artifact.dim) {
    return { status: 'unavailable', reason: `query is ${query.length}-d, centroids are ${artifact.dim}-d` };
  }
  let norm = 0;
  for (let i = 0; i < query.length; i++) norm += query[i] * query[i];
  norm = Math.sqrt(norm);
  if (!(norm > 0)) return { status: 'unavailable', reason: 'query embedding is all zeros' };
  let best = -1, second = -1, bestScore = -Infinity, secondScore = -Infinity;
  for (let k = 0; k < artifact.centroids.length; k++) {
    const c = artifact.centroids[k];
    let dot = 0;
    for (let i = 0; i < c.length; i++) dot += c[i] * query[i];
    const s = dot / norm;
    if (s > bestScore) { second = best; secondScore = bestScore; best = k; bestScore = s; }
    else if (s > secondScore) { second = k; secondScore = s; }
  }
  const out = {
    label: artifact.labels[best], score: round(bestScore),
    runnerUp: artifact.labels[second], runnerUpScore: round(secondScore),
    margin: round(bestScore - secondScore),
  };
  if (bestScore - secondScore < margin) {
    return { status: 'fallback', ...out, reason: `top two within margin ${margin}` };
  }
  return { status: 'decided', ...out };
}

/** 'Xenova/all-MiniLM-L6-v2' and 'all-MiniLM-L6-v2' name the same model; other runtimes keep their prefix. */
function normaliseModel(m: string): string {
  return m.replace(/^Xenova\//i, '').toLowerCase();
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** Test hook. */
export function __resetCentroidRouterForTests(): void {
  _cache = null;
}
