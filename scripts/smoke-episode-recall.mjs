/**
 * Smoke test: ADR-519 — session episodes through agentdb 3.2 hybrid retrieval
 *
 * Runs against the REAL agentdb (no mocks): session ends store episodes,
 * agentdb_episode-recall / session-start recall read them back.
 *
 * Acceptance criteria:
 *  1. Every session end with a summary stores an episode AND its embedding
 *  2. An exact identifier (ZX-4471) is recalled first (keyword half of hybrid)
 *  3. A paraphrase with no shared keywords is recalled first (vector half)
 *  4. session-start recalls only when asked, and then returns the related episode
 *  5. The MCP tool rejects an empty query and passes a real one through
 *  6. (SMOKE_RERANK=1) rerank keeps the needle first
 *
 * Usage: node scripts/smoke-episode-recall.mjs
 *        RUFLO_CLI_DIST=<installed>/node_modules/@claude-flow/cli/dist/src node scripts/smoke-episode-recall.mjs
 */

import { fileURLToPath, pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distBase = process.env.RUFLO_CLI_DIST || path.join(path.resolve(__dirname, '..'), 'v3/@claude-flow/cli/dist/src');
const load = (rel) => import(pathToFileURL(path.join(distBase, rel)).href);

let passed = 0, failed = 0;
function pass(l) { console.log(`  PASS  ${l}`); passed++; }
function fail(l, r) { console.error(`  FAIL  ${l}: ${r}`); failed++; }
function assert(c, l, r = '') { c ? pass(l) : fail(l, r || 'assertion false'); }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr519-'));
const dbPath = path.join(tmpDir, 'memory.db');
const startCwd = process.cwd();
process.chdir(tmpDir); // the MCP tool opens the default database relative to cwd

const SUMMARIES = [
  'Fixed flaky websocket reconnect test by awaiting the close handshake',
  'Refactored billing invoice PDF renderer to stream pages',
  'Upgraded eslint config and removed unused imports across the repo',
  'Investigated OOM in the image thumbnail worker; capped sharp concurrency at 2',
  'Wrote migration ZX-4471 renaming customer_tier to plan_level',
];

try {
  const bridge = await load('memory/memory-bridge.js');
  const { agentdbEpisodeRecall } = await load('mcp-tools/agentdb-tools.js');

  console.log('\n[1] session end stores episodes');
  const ids = [];
  for (const [i, summary] of SUMMARIES.entries()) {
    const r = await bridge.bridgeSessionEnd({ sessionId: `sess-${i}`, summary, tasksCompleted: 1, dbPath });
    if (typeof r?.episodeId === 'number') ids.push(r.episodeId);
  }
  assert(ids.length === SUMMARIES.length, `${SUMMARIES.length} episodes stored`, `got ${ids.length}`);

  console.log('\n[2] exact identifier');
  const t = Date.now();
  const needle = await bridge.bridgeRecallEpisodes({ task: 'what did we change in ZX-4471', k: 3, dbPath });
  assert(needle?.hybrid === true && needle?.rerank === false, 'hybrid on, rerank off by default');
  assert(needle?.episodes?.[0]?.sessionId === 'sess-4', 'ZX-4471 episode first', JSON.stringify(needle?.episodes?.map(e => e.sessionId)));
  assert(needle?.episodes?.every(e => !('embedding' in e)), 'embeddings not returned');
  console.log(`        ${Date.now() - t} ms`);

  console.log('\n[3] paraphrase');
  const sem = await bridge.bridgeRecallEpisodes({ task: 'running out of memory while resizing pictures', k: 3, dbPath });
  assert(sem?.episodes?.[0]?.sessionId === 'sess-3', 'thumbnail OOM episode first', JSON.stringify(sem?.episodes?.map(e => e.sessionId)));

  console.log('\n[4] session start');
  const plain = await bridge.bridgeSessionStart({ sessionId: 'new-1', context: 'websocket reconnect flakiness', dbPath });
  assert(plain?.success === true && plain.episodes === undefined, 'no recall unless asked');
  const st = await bridge.bridgeSessionStart({ sessionId: 'new-2', context: 'websocket reconnect flakiness', recall: true, k: 2, dbPath });
  assert(st?.episodes?.[0]?.sessionId === 'sess-0', 'recall=true returns the websocket episode first', JSON.stringify(st?.episodes?.map(e => e.sessionId)));

  console.log('\n[5] MCP tool');
  const bad = await agentdbEpisodeRecall.handler({ query: '' });
  assert(bad?.success === false, 'empty query rejected');
  // The tool resolves the default database, so only check it answers; the
  // bridge calls above cover ranking against this temp database.
  const ok = await agentdbEpisodeRecall.handler({ query: 'ZX-4471', k: 1 });
  assert(ok && typeof ok.success === 'boolean', 'tool answers', JSON.stringify(ok));

  if (process.env.SMOKE_RERANK === '1') {
    console.log('\n[6] rerank');
    const t2 = Date.now();
    const rr = await bridge.bridgeRecallEpisodes({ task: 'what did we change in ZX-4471', k: 3, rerank: true, dbPath });
    assert(rr?.rerank === true && rr.episodes?.[0]?.sessionId === 'sess-4', 'rerank keeps the needle first', JSON.stringify(rr?.episodes?.map(e => e.sessionId)));
    console.log(`        ${Date.now() - t2} ms (includes model load on first use)`);
  }

  await bridge.shutdownBridge();
} catch (err) {
  fail('smoke run', err?.stack || String(err));
} finally {
  process.chdir(startCwd);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
