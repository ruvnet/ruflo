#!/usr/bin/env node
/**
 * Build the ADR-529 router guard set from the ADR-391 corpus `test` split.
 *
 *   node benchmarks/router/build-guard.mjs            # write assets/agent-router/guard.minilm.json
 *   node benchmarks/router/build-guard.mjs --check    # rebuild in memory, fail if the committed file differs
 *
 * The guard is a NO-REGRESSION check for locally learned router candidates
 * (`neural router propose`). Nothing may select or tune against it: no
 * search, no weight choice, no threshold. Vectors are unit MiniLM embeddings
 * quantised to int8 (x * 127), base64-encoded. Prompt text is not stored.
 * Requires a built dist/.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, '..', '..');
const OUT = join(CLI_ROOT, 'assets', 'agent-router', 'guard.minilm.json');
const raw = readFileSync(join(HERE, 'corpus.jsonl'));
const corpusSha256 = createHash('sha256').update(raw).digest('hex');
const rows = raw.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.split === 'test').sort((a, b) => (a.id < b.id ? -1 : 1));
const { embedForRouter, routerEmbedderModel } = await import(pathToFileURL(join(CLI_ROOT, 'dist', 'src', 'ruvector', 'router-embedder.js')).href);
const emb = await embedForRouter(rows.map((r) => r.prompt), 'minilm');
if (emb.embedder !== 'minilm') {
  console.error(`MiniLM unavailable: ${emb.reason ?? 'unknown'}. The guard must be built with MiniLM.`);
  process.exit(2);
}
const q = (v) => {
  const n = Math.hypot(...v) || 1;
  return Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round((x / n) * 127)))).buffer).toString('base64');
};
const guard = {
  schema: 'ruflo.agent-router-guard/1',
  embedder: 'minilm',
  model: routerEmbedderModel() ?? 'unknown',
  dim: emb.vectors[0].length,
  corpusSha256,
  split: 'test',
  rows: rows.map((r, i) => ({ label: r.label, trap: r.trap === true, q: q(Array.from(emb.vectors[i])) })),
};
const text = JSON.stringify(guard) + '\n';
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const drift = !cur || cur.corpusSha256 !== corpusSha256 || cur.model !== guard.model || cur.rows.length !== guard.rows.length
    || cur.rows.some((r, i) => r.label !== guard.rows[i].label || r.q !== guard.rows[i].q);
  console.log(drift ? `DRIFT: ${OUT} does not match a rebuild from the corpus` : 'ok: guard matches the corpus');
  process.exit(drift ? 1 : 0);
}
writeFileSync(OUT, text);
console.log(`wrote ${OUT}: ${guard.rows.length} test rows, model ${guard.model}, ${text.length} bytes`);
process.exit(0);
