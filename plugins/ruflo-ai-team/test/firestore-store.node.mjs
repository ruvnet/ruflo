import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore, InMemoryStore } from '../src/store.mjs';

// Minimal Firestore double. Like the real thing it applies limit() AFTER ordering,
// and with no orderBy returns documents in document-id order, not creation order.
function fakeFirestore({ noCompositeIndex = false } = {}) {
  const data = new Map();
  const query = (path, filters = [], order = null, max = Infinity) => ({
    where: (field, op, value) => query(path, [...filters, { field, op, value }], order, max),
    orderBy: (field, dir = 'asc') => query(path, filters, { field, dir }, max),
    limit: (n) => query(path, filters, order, n),
    async get() {
      if (noCompositeIndex && order && filters.length) throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index.'), { code: 9 });
      let rows = [...(data.get(path)?.entries() ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
      for (const f of filters) {
        if (f.op === '==') rows = rows.filter((r) => r[f.field] === f.value);
        else if (f.op === 'in') { assert.ok(f.value.length <= 30, 'Firestore allows at most 30 values in an "in" filter'); rows = rows.filter((r) => f.value.includes(r[f.field])); }
        else throw new Error(`unsupported op ${f.op}`);
      }
      if (order) { rows = rows.filter((r) => r[order.field] !== undefined).sort((a, b) => (a[order.field] < b[order.field] ? -1 : a[order.field] > b[order.field] ? 1 : 0)); if (order.dir === 'desc') rows.reverse(); }
      return { docs: rows.slice(0, max).map((v) => ({ data: () => v })) };
    },
  });
  const collection = (path) => ({
    ...query(path),
    doc: (id) => ({
      async set(v) { if (!data.has(path)) data.set(path, new Map()); data.get(path).set(id, structuredClone(v)); },
      async get() { const v = data.get(path)?.get(id); return { exists: v !== undefined, data: () => (v === undefined ? undefined : structuredClone(v)) }; },
      collection: (name) => collection(`${path}/${id}/${name}`),
    }),
  });
  return { collection };
}

test('listRuns returns the newest runs once a tenant has more than the page size', async () => {
  const store = new FirestoreStore(fakeFirestore());
  const team = await store.createTeam('t1', { name: 'T', objective: 'o', roles: [] });
  const ids = [];
  for (let i = 0; i < 105; i++) { const run = await store.createRun('t1', { teamId: team.id, objective: `run ${i}`, budgetUnits: 1 }); await store.updateRun('t1', run.id, { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }); ids.push(run.id); }
  const listed = await store.listRuns('t1');
  assert.equal(listed.length, 100);
  assert.equal(listed[0].id, ids[104], 'newest run comes first');
  assert.ok(!listed.some((r) => r.id === ids[0]), 'the oldest runs are the ones left out');
});

test('evidence keeps every audit event of the run however much other audit history exists', async () => {
  const store = new FirestoreStore(fakeFirestore());
  const team = await store.createTeam('t1', { name: 'T', objective: 'o', roles: [] });
  const other = await store.createTeam('t1', { name: 'Other', objective: 'o', roles: [] });
  for (let i = 0; i < 1100; i++) await store.updateTeam('t1', other.id, { name: `n${i}` });
  const run = await store.createRun('t1', { teamId: team.id, objective: 'r', budgetUnits: 1 });
  const tasks = [];
  for (let i = 0; i < 35; i++) tasks.push(await store.createTask('t1', { runId: run.id, title: `t${i}`, description: 'd', assigneeRole: 'x' }));
  const bundle = await store.evidence('t1', run.id);
  const targets = new Set([run.id, team.id, ...tasks.map((t) => t.id)]);
  assert.ok(bundle.audit.every((e) => targets.has(e.targetId)), 'only audit events about this run');
  assert.ok(bundle.audit.some((e) => e.eventType === 'run.created'), 'run.created survives');
  assert.equal(bundle.audit.filter((e) => e.eventType === 'task.created').length, 35, 'all task events survive (more than one in-filter chunk)');
  assert.ok(bundle.audit.every((e, i, a) => i === 0 || a[i - 1].at <= e.at), 'audit is chronological');
});

test('both stores list runs newest first', async () => {
  const mem = new InMemoryStore();
  const team = await mem.createTeam('t', { name: 'T', objective: 'o', roles: [] });
  const a = await mem.createRun('t', { teamId: team.id, objective: 'a', budgetUnits: 1 });
  const b = await mem.createRun('t', { teamId: team.id, objective: 'b', budgetUnits: 1 });
  assert.deepEqual((await mem.listRuns('t')).map((r) => r.id), [b.id, a.id]);
});

async function seedMemories(store, n) {
  const team = await store.createTeam('t1', { name: 'T', objective: 'o', roles: [] });
  const ids = [];
  for (let i = 0; i < n; i++) {
    const m = await store.remember('t1', { teamId: team.id, text: `memory ${i}`, key: `m${String(i).padStart(3, '0')}` });
    // Backdate so creation order is the opposite of document-id order for half the rows.
    await store.db.collection('ruflo_ai_team_tenants').doc('t1').collection('memories').doc(m.id).set({ ...m, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
    ids.push(m.id);
  }
  return { team, ids };
}

test('listMemories keeps the newest memories when a team has more than the cap', async () => {
  const store = new FirestoreStore(fakeFirestore());
  const { team, ids } = await seedMemories(store, 12);
  const listed = await store.listMemories('t1', { teamId: team.id, limit: 5 });
  assert.deepEqual(listed.map((m) => m.id), ids.slice(-5).reverse(), 'newest five, newest first');
});

test('listMemories still answers when the composite index is not deployed yet', async () => {
  const store = new FirestoreStore(fakeFirestore({ noCompositeIndex: true }));
  const { team } = await seedMemories(store, 12);
  const listed = await store.listMemories('t1', { teamId: team.id, limit: 5 });
  assert.equal(listed.length, 5, 'falls back to an unordered read instead of failing the tool call');
});

test('listMemories without a team filter needs no composite index', async () => {
  const store = new FirestoreStore(fakeFirestore({ noCompositeIndex: true }));
  const { ids } = await seedMemories(store, 12);
  const listed = await store.listMemories('t1', { limit: 5 });
  assert.deepEqual(listed.map((m) => m.id), ids.slice(-5).reverse());
});
