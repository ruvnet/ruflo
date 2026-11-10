import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiTeamService } from '../src/server.mjs';
import { InMemoryStore } from '../src/store.mjs';
import { TenantVectorMemory } from '../src/vector-memory.mjs';
import { AnonRateLimiter } from '../src/rate-limit.mjs';

const verifyToken = async (token, _j, o) => {
  if (token === 'bad') throw new Error('bad signature');
  return { payload: { iss: 'https://auth.cognitum.one', aud: o.audience, sub: `${token}-user`, tenant_id: token, scope: 'team:read team:write team:run' } };
};
async function fixture(extra = {}) {
  const store = new InMemoryStore(); const events = [];
  const service = await createAiTeamService({ store, vectorMemory: new TenantVectorMemory(store), verifyToken, port: 0, log: (e) => events.push(e), ...extra });
  const port = await service.listen(0);
  return { ...service, events, base: `http://127.0.0.1:${port}` };
}
const rpc = async (base, body, token, headers = {}) => {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  const raw = await r.text(); const line = raw.split('\n').find((x) => x.startsWith('data: '));
  return { status: r.status, retryAfter: r.headers.get('retry-after'), body: line || raw.startsWith('{') ? JSON.parse(line ? line.slice(6) : raw) : raw };
};
const call = (base, name, args, token = 'acme') => rpc(base, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token);
const val = (r) => JSON.parse(r.body.result.content[0].text);

test('the funnel is logged once per stage with a hashed tenant and no content', async (t) => {
  const f = await fixture(); t.after(() => f.server.close());
  const team = val(await call(f.base, 'team_create', { name: 'Secret Project', objective: 'private goal' }));
  const run = val(await call(f.base, 'run_create', { teamId: team.id, objective: 'ship it' }));
  const task = val(await call(f.base, 'task_create', { runId: run.id, title: 't', description: 'd', assigneeRole: 'r' }));
  await call(f.base, 'task_update', { taskId: task.id, status: 'complete' });
  await call(f.base, 'run_complete', { runId: run.id });
  const stages = f.events.filter((e) => e.event === 'ai_team_activation').map((e) => e.stage);
  assert.deepEqual(stages, ['team_created', 'run_started', 'run_completed']);
  const all = JSON.stringify(f.events);
  assert.ok(!all.includes('acme') && !all.includes('Secret Project') && !all.includes('private goal'), 'no tenant id or content in the log');
  assert.match(f.events[0].tenant, /^[0-9a-f]{16}$/);
});

test('failed or refused calls are not counted as activation', async (t) => {
  const f = await fixture(); t.after(() => f.server.close());
  await call(f.base, 'run_create', { teamId: 'team_nope', objective: 'x' });
  await call(f.base, 'team_create', { name: 'n', objective: 'o', templateId: 'no-such-template' });
  assert.deepEqual(f.events.filter((e) => e.event === 'ai_team_activation'), []);
});

test('anonymous discovery is rate limited per client, authenticated calls are not', async (t) => {
  const f = await fixture({ anonRpm: 5 }); t.after(() => f.server.close());
  const list = (ip) => rpc(f.base, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null, { 'x-forwarded-for': ip });
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await list('203.0.113.9')).status);
  assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
  assert.ok(codes.slice(5).every((c) => c === 429));
  const blocked = await list('203.0.113.9'); assert.ok(Number(blocked.retryAfter) >= 1);
  assert.equal((await list('198.51.100.7')).status, 200, 'another client is unaffected');
  for (let i = 0; i < 20; i++) assert.equal((await call(f.base, 'team_list', {}, 'acme')).status, 200, 'OAuth calls are never throttled here');
  assert.equal((await fetch(`${f.base}/health`)).status, 200, 'health checks are never throttled');
});

test('a spoofed leading X-Forwarded-For entry does not buy a fresh bucket', async (t) => {
  const f = await fixture({ anonRpm: 3 }); t.after(() => f.server.close());
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await rpc(f.base, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null, { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.50` })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429, 429]);
});

test('limiter: window resets, and its table stays bounded', () => {
  let now = 0; const limiter = new AnonRateLimiter({ perMinute: 2, maxKeys: 3, now: () => now });
  assert.equal(limiter.take('a').ok, true); assert.equal(limiter.take('a').ok, true); assert.equal(limiter.take('a').ok, false);
  now += 61_000; assert.equal(limiter.take('a').ok, true);
  for (const k of ['b', 'c', 'd', 'e']) limiter.take(k);
  assert.ok(limiter.size <= 3);
});
