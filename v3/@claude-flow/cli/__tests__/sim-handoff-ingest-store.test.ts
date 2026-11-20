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
import { runSimIngestCommand } from '../src/metaharness/sim-ingest-cli.js';
import { output } from '../src/output.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sim-handoff-v2');
const trusted = JSON.parse(readFileSync(join(FIXTURE, 'trusted-keys.json'), 'utf8'));
const now = () => new Date(trusted.verifyAt);
const TENANT_A = 'tenant-a/ruvnet/metaharness';
const TENANT_B = 'tenant-b/ruvnet/metaharness';

describe('sim-ingest with the real memory store', () => {
  let root: string;
  const run = (op: string, flags: Record<string, unknown> = {}) =>
    runSimIngestCommand(op, { projectRoot: root, ...flags }, { now });

  beforeAll(() => {
    vi.spyOn(output, 'writeln').mockImplementation(() => undefined);
    root = mkdtempSync(join(tmpdir(), 'ruflo-sim-ingest-'));
    for (const f of ['envelope-a.json', 'envelope-b.json']) copyFileSync(join(FIXTURE, f), join(root, f));
  });
  afterAll(() => {
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

    // Optimizer memory lives in its own db; task-agent memory is never created or touched.
    expect(existsSync(join(root, '.claude-flow', 'sim', 'sim-memory.db'))).toBe(true);
    expect(existsSync(join(root, '.swarm', 'memory.db'))).toBe(false);

    const eventId = a[0].provenance.eventId;
    expect((await run('revoke-event', { tenant: TENANT_A, eventId })).data).toMatchObject({ status: 'revoked', deleted: true });
    expect((await run('query', { tenant: TENANT_A })).data).toEqual([]);
    expect((await run('ingest', { file: join(root, 'envelope-a.json') })).data).toMatchObject({ reason: 'revoked_event' });

    const keyB = trusted.keys.find((k: any) => k.tenants.includes(TENANT_B)).keyId;
    expect((await run('revoke-key', { keyId: keyB })).data).toMatchObject({ status: 'revoked', deleted: 1 });
    expect((await run('query', { tenant: TENANT_B })).data).toEqual([]);
    const saved = JSON.parse(readFileSync(join(root, '.claude-flow', 'sim', 'trusted-keys.json'), 'utf8'));
    expect(saved.keys.find((k: any) => k.keyId === keyB).revoked).toBe(true);

    const audit = (await run('audit')).data as any[];
    expect(audit.map((e) => `${e.action}:${e.status}`)).toEqual([
      'ingest:ingested', 'ingest:duplicate', 'ingest:ingested', 'ingest:rejected',
      'revoke-event:revoked', 'ingest:rejected', 'revoke-key:revoked',
    ]);
  }, 120_000);
});
