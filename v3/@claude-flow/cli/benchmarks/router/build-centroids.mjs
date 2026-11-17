#!/usr/bin/env node
/**
 * Build the ADR-527 agent centroids from the ADR-391 corpus.
 *
 *   node benchmarks/router/build-centroids.mjs            # write assets/agent-router/centroids.minilm.json
 *   node benchmarks/router/build-centroids.mjs --check    # rebuild in memory, fail if the committed file differs
 *
 * Only the `dev` split is used. The `test` split stays a held-out regression
 * set; it must never feed the centroids or the margin. Requires a built dist/.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, '..', '..');
const CORPUS = join(HERE, 'corpus.jsonl');
const OUT = join(CLI_ROOT, 'assets', 'agent-router', 'centroids.minilm.json');
// Chosen on dev 5-fold CV (ADR-527): CV accuracy fell as the margin grew, so this
// is the smallest grid value that still sends near-ties to the current router.
const DEFAULT_MARGIN = 0.005;

const raw = readFileSync(CORPUS);
const corpusSha256 = createHash('sha256').update(raw).digest('hex');
const rows = raw.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.split === 'dev');
const { embedForRouter, routerEmbedderModel } = await import(pathToFileURL(join(CLI_ROOT, 'dist', 'src', 'ruvector', 'router-embedder.js')).href);
const emb = await embedForRouter(rows.map((r) => r.prompt), 'minilm');
if (emb.embedder !== 'minilm') {
  console.error(`MiniLM unavailable: ${emb.reason ?? 'unknown'}. Centroids must be built with MiniLM.`);
  process.exit(2);
}
const dim = emb.vectors[0].length;
const labels = [...new Set(rows.map((r) => r.label))].sort();
const centroids = [], support = [];
for (const l of labels) {
  const sum = new Float64Array(dim);
  let n = 0;
  rows.forEach((r, i) => { if (r.label === l) { n++; for (let j = 0; j < dim; j++) sum[j] += emb.vectors[i][j]; } });
  const norm = Math.hypot(...sum) || 1;
  centroids.push(Array.from(sum, (x) => Math.round((x / norm) * 1e6) / 1e6));
  support.push(n);
}
const artifact = {
  schema: 'ruflo.agent-centroids/1',
  embedder: 'minilm',
  model: routerEmbedderModel() ?? 'unknown',
  dim,
  margin: DEFAULT_MARGIN,
  corpusSha256,
  split: 'dev',
  labels,
  support,
  centroids,
};
const text = JSON.stringify(artifact) + '\n';
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const a = cur ? JSON.parse(cur) : null;
  const drift = !a || a.corpusSha256 !== corpusSha256 || a.model !== artifact.model || a.labels.join() !== labels.join()
    || a.centroids.some((c, k) => c.some((x, j) => Math.abs(x - centroids[k][j]) > 1e-4));
  console.log(drift ? `DRIFT: ${OUT} does not match a rebuild from the corpus` : 'ok: centroids match the corpus');
  process.exit(drift ? 1 : 0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log(`wrote ${OUT}: ${labels.length} labels, ${rows.length} dev rows, model ${artifact.model}, ${text.length} bytes`);
process.exit(0);
