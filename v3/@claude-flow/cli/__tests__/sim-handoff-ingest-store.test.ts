/**
 * metaharness#524 — SIM handoff ingestion against the REAL CLI memory store
 * (memory-initializer storeEntry/getEntry/listEntries/deleteEntry), driven
 * through the `metaharness sim-ingest` dispatcher. Not gated on a built CLI.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';
import { runSimIngestCommand } from '../src/metaharness/sim-ingest-cli.js';
import { canonicalJson, simKeyId } from '../src/metaharness/sim-handoff-verify.js';
import { output } from '../src/output.js';
import {
  _resetMemoryRootCache, initializeMemoryDatabase, listEntries, searchEntries, storeEntry,
} from '../src/memory/memory-initializer.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sim-handoff-v2');
const trusted = JSON.parse(readFileSync(join(FIXTURE, 'trusted-keys.json'), 'utf8'));
const now = () => new Date(trusted.verifyAt);
const TENANT_A = 'tenant-a/ruvnet/metaharness';
const TENANT_B = 'tenant-b/ruvnet/metaharness';

describe('sim-ingest with the real memory store', () => {
  let root: string;
  let taskDb: string;
  const savedEnv = { db: process.env.CLAUDE_FLOW_DB_PATH, mem: process.env.CLAUDE_FLOW_MEMORY_PATH };
  const run = (op: string, flags: Record<string, unknown> = {}) =>
    runSimIngestCommand(op, { projectRoot: root, ...flags }, { now });

  beforeAll(() => {
    vi.spyOn(output, 'writeln').mockImplementation(() => undefined);
    root = mkdtempSync(join(tmpdir(), 'ruflo-sim-ingest-'));
    for (const f of ['envelope-a.json', 'envelope-b.json']) copyFileSync(join(FIXTURE, f), join(root, f));
    // Point the task-agent memory at a real db in this temp root, so the test can
    // prove SIM ingestion never writes into it.
    mkdirSync(join(root, 'task'), { recursive: true });
    taskDb = join(root, 'task', 'memory.db');
    process.env.CLAUDE_FLOW_DB_PATH = taskDb;
    process.env.CLAUDE_FLOW_MEMORY_PATH = join(root, 'task');
    _resetMemoryRootCache();
  });
  afterAll(() => {
    if (savedEnv.db === undefined) delete process.env.CLAUDE_FLOW_DB_PATH; else process.env.CLAUDE_FLOW_DB_PATH = savedEnv.db;
    if (savedEnv.mem === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH; else process.env.CLAUDE_FLOW_MEMORY_PATH = savedEnv.mem;
    _resetMemoryRootCache();
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('is disabled until a config enables it, and then creates nothing', async () => {
    expect((await run('ingest', { file: join(root, 'envelope-a.json') })).data).toEqual({ status: 'disabled' });
    expect(existsSync(join(root, '.claude-flow', 'sim', 'sim-memory.db'))).toBe(false);
    expect(existsSync(join(root, '.claude-flow', 'sim', 'audit.jsonl'))).toBe(false);
    expect((await run('status')).data).toMatchObject({ enabled: false });
  });

  it('ingests, deduplicates, isolates tenants, revokes and audits against the real store', async () => {
    expect((await initializeMemoryDatabase({ dbPath: taskDb })).success).toBe(true);
    expect((await storeEntry({ key: 'task/note', value: 'Retried failing tool call in task work', namespace: 'default', dbPath: taskDb })).success).toBe(true);
    mkdirSync(join(root, '.claude-flow', 'sim'), { recursive: true });
    writeFileSync(join(root, '.claude-flow', 'sim', 'trusted-keys.json'), JSON.stringify({ enabled: true, keys: trusted.keys }));

    const first = await run('ingest', { file: join(root, 'envelope-a.json') });
    expect(first.data).toMatchObject({ status: 'ingested', tenant: TENANT_A });
    expect((await run('ingest', { file: join(root, 'envelope-a.json') })).data).toMatchObject({ status: 'duplicate' });
    expect((await run('ingest', { file: join(root, 'envelope-b.json') })).data).toMatchObject({ status: 'ingested', tenant: TENANT_B });

    const a = (await run('query', { tenant: TENANT_A })).data as any[];
    expect(a).toHaveLength(1);
    expect(a[0].provenance).toMatchObject({ tenant: TENANT_A, schema: 'metaharness.sim.handoff.v2' });
    expect(JSON.stringify(a)).not.toContain('tenant-b');
    const b = (await run('query', { tenant: TENANT_B })).data as any[];
    expect(b.map((r) => r.provenance.tenant)).toEqual([TENANT_B]);

    // Tampered file → rejected with exit 1, nothing new stored.
    const tampered = JSON.parse(readFileSync(join(root, 'envelope-a.json'), 'utf8'));
    tampered.payload.retention.days = 3650;
    writeFileSync(join(root, 'tampered.json'), JSON.stringify(tampered));
    const bad = await run('ingest', { file: join(root, 'tampered.json') });
    expect(bad).toMatchObject({ success: false, data: { status: 'rejected', reason: 'bad_signature' } });

    // Optimizer memory lives in its own db. The task-agent db (the one the CLI
    // resolves by default here) holds no sim: rows, and an all-namespace search
    // for text that appears in the SIM evidence finds only the task note.
    expect(existsSync(join(root, '.claude-flow', 'sim', 'sim-memory.db'))).toBe(true);
    const taskRows = await listEntries({ dbPath: taskDb, limit: 1000 });
    expect(taskRows.entries.map((e) => e.namespace)).toEqual(['default']);
    const hits = await searchEntries({ query: 'Retried failing tool call', dbPath: taskDb, threshold: 0.01 });
    expect(hits.results.some((r) => r.namespace === 'default')).toBe(true);
    expect(hits.results.every((r) => !r.namespace.startsWith('sim:'))).toBe(true);
    expect(existsSync(join(root, '.swarm'))).toBe(false);

    const eventId = a[0].provenance.eventId;
    expect((await run('revoke-event', { tenant: TENANT_A, eventId })).data).toMatchObject({ status: 'revoked', deleted: true });
    expect((await run('query', { tenant: TENANT_A })).data).toEqual([]);
    expect((await run('ingest', { file: join(root, 'envelope-a.json') })).data).toMatchObject({ reason: 'revoked_event' });

    const keyB = trusted.keys.find((k: any) => k.tenants.includes(TENANT_B)).keyId;
    expect((await run('revoke-key', { keyId: keyB })).data).toMatchObject({ status: 'revoked', deleted: 1 });
    expect((await run('query', { tenant: TENANT_B })).data).toEqual([]);
    const saved = JSON.parse(readFileSync(join(root, '.claude-flow', 'sim', 'trusted-keys.json'), 'utf8'));
    expect(saved.keys.find((k: any) => k.keyId === keyB).revoked).toBe(true);

    // Put-after-delete on the real store: the same tenant-B content, re-signed by a
    // second trusted key, reclaims the revoked (soft-deleted) row.
    const k2 = generateKeyPairSync('ed25519');
    saved.keys.push({ keyId: simKeyId(k2.publicKey), publicKey: k2.publicKey.export({ type: 'spki', format: 'pem' }).toString(), tenants: [TENANT_B] });
    writeFileSync(join(root, '.claude-flow', 'sim', 'trusted-keys.json'), JSON.stringify(saved));
    const payload = JSON.parse(readFileSync(join(root, 'envelope-b.json'), 'utf8')).payload;
    payload.keyId = simKeyId(k2.publicKey);
    const value = sign(null, Buffer.from('metaharness.sim.handoff.v2\n' + canonicalJson(payload)), k2.privateKey).toString('base64');
    writeFileSync(join(root, 'b-k2.json'), JSON.stringify({ payload, signature: { alg: 'ed25519', value } }));
    expect((await run('ingest', { file: join(root, 'b-k2.json') })).data).toMatchObject({ status: 'ingested', tenant: TENANT_B });
    const reB = (await run('query', { tenant: TENANT_B })).data as any[];
    expect(reB.map((r) => r.provenance.keyId)).toEqual([simKeyId(k2.publicKey)]);

    const audit = (await run('audit')).data as any[];
    expect(audit.map((e) => `${e.action}:${e.status}`)).toEqual([
      'ingest:ingested', 'ingest:duplicate', 'ingest:ingested', 'ingest:rejected',
      'revoke-event:revoked', 'ingest:rejected', 'revoke-key:revoked', 'ingest:ingested',
    ]);
  }, 120_000);
});
