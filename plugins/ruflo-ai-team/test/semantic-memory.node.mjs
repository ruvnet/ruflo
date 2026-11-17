import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitumEmbedder, embedderFromEnv } from '../src/embedder.mjs';
import { TenantVectorMemory } from '../src/vector-memory.mjs';
import { InMemoryStore } from '../src/store.mjs';

const DIMS = 384;
// Concept axes: words in the same group embed to the same direction, so "release broke"
// is close to "deploy failure" with zero shared tokens (a keyword hash cannot see that).
const CONCEPTS = [['deploy', 'release', 'ship', 'rollout'], ['failure', 'broke', 'crash', 'outage'], ['invoice', 'billing', 'payment']];
function conceptVector(text) {
  const v = new Array(DIMS).fill(0);
  for (const token of String(text).toLowerCase().match(/[a-z]+/g) || []) CONCEPTS.forEach((group, axis) => { if (group.includes(token)) v[axis] += 1; });
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
function fakeFetch({ calls = [], fail = false, shape } = {}) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (fail) throw new Error('network down');
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const data = inputs.map((t, index) => ({ index, embedding: conceptVector(t) }));
    return new Response(JSON.stringify(shape ? shape(data) : { data, usage: { total_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const embedder = (opts = {}) => new CognitumEmbedder({ apiKey: 'cog_test_key', url: 'https://api.cognitum.one/v1/embeddings', fetchImpl: fakeFetch(opts), ...opts.config });

async function seeded(emb) {
  const store = new InMemoryStore();
  const team = await store.createTeam('t1', { name: 'n', objective: 'o', roles: ['a'] });
  await store.remember('t1', { teamId: team.id, text: 'deploy failure last friday rolled back', key: 'm1' });
  await store.remember('t1', { teamId: team.id, text: 'invoice payment terms are net 30', key: 'm2' });
  return { store, team, memory: new TenantVectorMemory(store, { embedder: emb }) };
}

test('semantic search finds a memory that shares no tokens with the query', async () => {
  const { team, memory } = await seeded(embedder());
  const out = await memory.search('t1', { teamId: team.id, query: 'release broke', limit: 2 });
  assert.equal(out.backend, 'cognitum-embed');
  assert.equal(out.degraded, false);
  assert.equal(out.results[0].memory.id, 'm1');
  assert.ok(out.results[0].score > 0.9 && out.results[1].score < 0.1);
});

test('without a key the lexical fallback is used and labelled', async () => {
  const { team, memory } = await seeded(null);
  const out = await memory.search('t1', { teamId: team.id, query: 'release broke' });
  assert.equal(out.backend, 'lexical-degraded');
  assert.equal(out.degraded, true);
});

test('an embeddings outage degrades to lexical instead of failing the search', async () => {
  const { team, memory } = await seeded(embedder({ fail: true }));
  const out = await memory.search('t1', { teamId: team.id, query: 'deploy failure' });
  assert.equal(out.backend, 'lexical-degraded');
  assert.equal(out.degraded, true);
  assert.equal(out.results[0].memory.id, 'm1');
});

test('vectors are persisted once and never returned to the caller', async () => {
  const calls = [];
  const { team, memory, store } = await seeded(embedder({ calls }));
  const first = await memory.search('t1', { teamId: team.id, query: 'release broke' });
  assert.ok(!('embedding' in first.results[0].memory), 'embedding must not leak into results');
  const stored = (await store.listMemories('t1', { teamId: team.id })).find((m) => m.id === 'm1');
  assert.equal(stored.embeddingModel, 'cognitum-embed');
  assert.equal(stored.embedding.length, DIMS);
  memory.invalidate('t1');
  calls.length = 0;
  await memory.search('t1', { teamId: team.id, query: 'ship crash' });
  assert.equal(calls.length, 1, 'only the query is embedded; stored memories already have vectors');
  assert.equal(calls[0].body.input.length === 1 || typeof calls[0].body.input === 'string', true);
});

test('editing a memory drops its stale vector', async () => {
  const { store, team } = await seeded(embedder());
  const memory = new TenantVectorMemory(store, { embedder: embedder() });
  await memory.search('t1', { teamId: team.id, query: 'x' });
  await store.remember('t1', { teamId: team.id, text: 'invoice billing moved', key: 'm1' });
  const edited = (await store.listMemories('t1', { teamId: team.id })).find((m) => m.id === 'm1');
  assert.equal(edited.embedding, undefined);
  assert.equal(edited.embeddingModel, 'feature-hash-256');
});

test('setEmbedding refuses a vector computed for text that has since changed', async () => {
  const store = new InMemoryStore();
  const team = await store.createTeam('t1', { name: 'n', objective: 'o', roles: ['a'] });
  const old = await store.remember('t1', { teamId: team.id, text: 'old text', key: 'k' });
  await store.remember('t1', { teamId: team.id, text: 'new text', key: 'k' });
  const ok = await store.setEmbedding('t1', 'k', { vector: conceptVector('old'), model: 'cognitum-embed', contentHash: old.contentHash });
  assert.equal(ok, false);
  assert.equal((await store.listMemories('t1'))[0].embedding, undefined);
});

test('request carries the bearer key, model and bounded batches; the key never appears in errors', async () => {
  const calls = [];
  const emb = embedder({ calls });
  const out = await emb.embed(['a', 'b']);
  assert.equal(out.length, 2);
  assert.equal(calls[0].headers.authorization, 'Bearer cog_test_key');
  assert.equal(calls[0].body.model, 'cognitum-embed');
  const bad = embedder({ fail: true });
  await assert.rejects(() => bad.embed(['a']), (e) => { assert.ok(!String(e.message).includes('cog_test_key')); return true; });
});

test('malformed responses are rejected', async () => {
  for (const shape of [() => ({}), (d) => ({ data: d.slice(0, 0) }), (d) => ({ data: d.map((x) => ({ ...x, embedding: x.embedding.slice(0, 10) })) }), (d) => ({ data: d.map((x) => ({ ...x, embedding: x.embedding.map(() => NaN) })) })]) {
    await assert.rejects(() => embedder({ shape }).embed(['a']));
  }
});

test('after a failure the embedder backs off instead of hammering the API', async () => {
  const calls = []; let clock = 1000;
  const emb = embedder({ calls, fail: true, config: { now: () => clock, cooldownMs: 30_000 } });
  await assert.rejects(() => emb.embed(['a']));
  assert.equal(emb.available, false);
  await assert.rejects(() => emb.embed(['a']));
  assert.equal(calls.length, 1);
  clock += 31_000;
  assert.equal(emb.available, true);
});

test('embedderFromEnv: no key means off; only Cognitum https hosts (or loopback) are accepted', () => {
  assert.equal(embedderFromEnv({}), null);
  assert.ok(embedderFromEnv({ RUFLO_AI_TEAM_EMBEDDINGS_KEY: 'k' }));
  assert.throws(() => embedderFromEnv({ RUFLO_AI_TEAM_EMBEDDINGS_KEY: 'k', RUFLO_AI_TEAM_EMBEDDINGS_URL: 'https://evil.example/v1/embeddings' }), /host/i);
  assert.throws(() => embedderFromEnv({ RUFLO_AI_TEAM_EMBEDDINGS_KEY: 'k', RUFLO_AI_TEAM_EMBEDDINGS_URL: 'http://api.cognitum.one/v1/embeddings' }), /https/i);
  assert.throws(() => embedderFromEnv({ RUFLO_AI_TEAM_EMBEDDINGS_KEY: 'k', RUFLO_AI_TEAM_EMBEDDINGS_URL: 'https://cognitum.one.evil.example/x' }), /host/i);
  assert.ok(embedderFromEnv({ RUFLO_AI_TEAM_EMBEDDINGS_KEY: 'k', RUFLO_AI_TEAM_EMBEDDINGS_URL: 'http://127.0.0.1:9/v1/embeddings' }));
});

test('memory_remember embeds on write and memory_search answers semantically end to end', async (t) => {
  const { createAiTeamService } = await import('../src/server.mjs');
  const store = new InMemoryStore();
  const calls = [];
  const vectorMemory = new TenantVectorMemory(store, { embedder: embedder({ calls }) });
  const verifyToken = async (_t, _j, o) => ({ payload: { iss: 'https://auth.cognitum.one', aud: o.audience, sub: 'u', tenant_id: 'tt', scope: 'team:read team:write team:run' } });
  const service = await createAiTeamService({ store, vectorMemory, verifyToken, port: 0 });
  const port = await service.listen(0); t.after(() => service.server.close());
  const base = `http://127.0.0.1:${port}`;
  const call = async (name, args) => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer x' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const raw = await r.text(); const line = raw.split('\n').find((x) => x.startsWith('data: '));
    return JSON.parse(JSON.parse(line ? line.slice(6) : raw).result.content[0].text);
  };
  const team = await call('team_create', { name: 'n', objective: 'o' });
  await call('memory_remember', { teamId: team.id, key: 'a', text: 'deploy failure last friday' });
  assert.equal(calls.length, 1, 'embedded once on write');
  const found = await call('memory_search', { teamId: team.id, query: 'release broke' });
  assert.match(JSON.stringify(found), /cognitum-embed/);
  assert.equal(calls.length, 2, 'search embeds only the query');
});
