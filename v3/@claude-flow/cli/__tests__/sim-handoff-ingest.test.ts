/**
 * metaharness#524 — opt-in, signed, tenant-scoped SIM handoff ingestion.
 * Adversarial tests against an in-memory store that counts every call.
 * The signed fixture is produced by @metaharness/darwin (bench/sim-handoff-fixture.mjs)
 * and committed verbatim to both repositories.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson, simEventId, simKeyId, verifySimHandoff, type TrustedSimKey,
} from '../src/metaharness/sim-handoff-verify.js';
import {
  SimHandoffIngestor, simNamespace, type SimAuditEntry, type SimEvidenceStore, type SimIngestConfig,
} from '../src/metaharness/sim-ingest.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sim-handoff-v2');
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURE, name), 'utf8'));
const trustedFile = read('trusted-keys.json') as { verifyAt: string; keys: TrustedSimKey[] };
const NOW = new Date(trustedFile.verifyAt);
const TENANT_A = 'tenant-a/ruvnet/metaharness';
const TENANT_B = 'tenant-b/ruvnet/metaharness';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

class MemoryStore implements SimEvidenceStore {
  rows = new Map<string, { value: string; tags: string[] }>();
  calls = 0;
  writes = 0;
  /** Simulates a backend whose tag filter is ignored, to prove deletes confirm the signer. */
  ignoreTagFilter = false;
  private id = (ns: string, key: string) => ns + '\u0000' + key;
  async get(ns: string, key: string) { this.calls++; return this.rows.get(this.id(ns, key))?.value ?? null; }
  async put(ns: string, key: string, value: string, tags: string[], _ttl: number, replace = false) {
    this.calls++; this.writes++;
    if (!replace && this.rows.has(this.id(ns, key))) throw new Error('UNIQUE constraint failed');
    this.rows.set(this.id(ns, key), { value, tags });
  }
  async delete(ns: string, key: string) { this.calls++; this.writes++; return this.rows.delete(this.id(ns, key)); }
  async list(ns: string, tag?: string) {
    this.calls++;
    return [...this.rows].filter(([k, r]) => k.startsWith(ns + '\u0000') && (!tag || this.ignoreTagFilter || r.tags.includes(tag)))
      .map(([k, r]) => ({ key: k.slice(ns.length + 1), content: r.value }));
  }
}

function setup(config: SimIngestConfig | null, now = NOW) {
  const store = new MemoryStore();
  const audit: SimAuditEntry[] = [];
  const ingestor = new SimHandoffIngestor({ config, store, audit: (e) => audit.push(e), now: () => now });
  return { store, audit, ingestor };
}
const enabled = (keys: TrustedSimKey[] = clone(trustedFile.keys)): SimIngestConfig => ({ enabled: true, keys });
function keyPair() { return generateKeyPairSync('ed25519'); }
function trust(publicKey: KeyObject, tenants: string[]): TrustedSimKey {
  return { keyId: simKeyId(publicKey), publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), tenants };
}
function rawSign(payload: unknown, privateKey: KeyObject) {
  const value = sign(null, Buffer.from('metaharness.sim.handoff.v2\n' + canonicalJson(payload)), privateKey).toString('base64');
  return { payload, signature: { alg: 'ed25519', value } };
}
/** Re-key a fixture payload to a runtime key, so tests can sign adversarial variants. */
function resign(envelope: any, privateKey: KeyObject, publicKey: KeyObject, mutate: (p: any) => void = () => {}) {
  const payload = clone(envelope.payload);
  payload.keyId = simKeyId(publicKey);
  mutate(payload);
  return rawSign(payload, privateKey);
}

let envA: any;
let envB: any;
beforeEach(() => { envA = read('envelope-a.json'); envB = read('envelope-b.json'); });

describe('cross-repo lockstep: fixture produced by @metaharness/darwin', () => {
  it('verifies with the independent ruflo verifier using public keys only', () => {
    expect(JSON.stringify(trustedFile)).not.toMatch(/PRIVATE KEY/);
    for (const [env, tenant] of [[envA, TENANT_A], [envB, TENANT_B]] as const) {
      const r = verifySimHandoff(env, { trustedKeys: trustedFile.keys, now: NOW });
      expect(r).toMatchObject({ ok: true, tenant });
      if (r.ok) expect(r.eventId).toBe(simEventId(env.payload.tenant, env.payload.handoff));
    }
  });
});

describe('disabled by default', () => {
  it('with no config or enabled=false, nothing touches the store or audit log', async () => {
    for (const config of [null, { ...enabled(), enabled: false }]) {
      const { store, audit, ingestor } = setup(config);
      expect(await ingestor.ingest(envA)).toEqual({ status: 'disabled' });
      expect(await ingestor.query(TENANT_A)).toEqual({ status: 'disabled' });
      expect(await ingestor.revokeEvent(TENANT_A, envA.payload.eventId)).toEqual({ status: 'disabled' });
      expect(await ingestor.revokeKey(trustedFile.keys[0].keyId)).toEqual({ status: 'disabled' });
      expect(store.calls).toBe(0);
      expect(audit).toEqual([]);
    }
  });
});

describe('same-tenant retrieval with provenance', () => {
  it('stores verified evidence under sim:<owner>/<repo> and returns it with provenance', async () => {
    const { store, ingestor } = setup(enabled());
    const r = await ingestor.ingest(envA);
    expect(r).toMatchObject({ status: 'ingested', tenant: TENANT_A, namespace: 'sim:' + TENANT_A, eventId: envA.payload.eventId });
    const records = await ingestor.query(TENANT_A) as any[];
    expect(records).toHaveLength(1);
    expect(records[0].provenance).toMatchObject({
      schema: 'metaharness.sim.handoff.v2', eventId: envA.payload.eventId, keyId: envA.payload.keyId,
      tenant: TENANT_A, signature: envA.signature.value, verifiedAt: NOW.toISOString(),
    });
    expect(records[0].provenance.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(records[0].payload.handoff.attempts.map((a: any) => a.id).sort()).toEqual(['a-fail', 'a-win']);
    expect([...store.rows.keys()].every((k) => k.startsWith('sim:' + TENANT_A + '\u0000'))).toBe(true);
  });
});

describe('zero cross-tenant results', () => {
  it('each tenant only ever reads its own namespace', async () => {
    const { ingestor } = setup(enabled());
    await ingestor.ingest(envA);
    await ingestor.ingest(envB);
    const a = await ingestor.query(TENANT_A) as any[];
    const b = await ingestor.query(TENANT_B) as any[];
    expect(a.map((r) => r.provenance.tenant)).toEqual([TENANT_A]);
    expect(b.map((r) => r.provenance.tenant)).toEqual([TENANT_B]);
    expect(JSON.stringify(a)).not.toContain('tenant-b');
    expect(JSON.stringify(b)).not.toContain('tenant-a');
    expect(await ingestor.query('tenant-c/ruvnet/metaharness')).toEqual([]);
  });

  it('a key bound to tenant B cannot write tenant A, even with a valid signature', async () => {
    const keys = clone(trustedFile.keys).map((k) => ({ ...k, tenants: [TENANT_B] }));
    const { store, audit, ingestor } = setup(enabled(keys));
    expect(await ingestor.ingest(envA)).toMatchObject({ status: 'rejected', reason: 'tenant_not_authorized' });
    expect(store.writes).toBe(0);
    expect(audit.at(-1)).toMatchObject({ action: 'ingest', status: 'rejected', reason: 'tenant_not_authorized' });
  });

  it('forged inner scope in a validly signed envelope is rejected', async () => {
    const { publicKey, privateKey } = keyPair();
    const { store, ingestor } = setup(enabled([trust(publicKey, [TENANT_A])]));
    const forged = resign(envA, privateKey, publicKey, (p) => { p.handoff.attempts[0].scope.ownerId = 'tenant-b'; });
    expect(await ingestor.ingest(forged)).toMatchObject({ status: 'rejected', reason: 'scope_mismatch' });
    // Envelope claims B while records are A: tenant check fails before any write.
    const claimB = resign(envA, privateKey, publicKey, (p) => { p.tenant.owner = 'tenant-b'; });
    expect(await ingestor.ingest(claimB)).toMatchObject({ status: 'rejected', reason: 'tenant_not_authorized' });
    // Smuggled grader artifacts are refused, not stripped.
    const smuggled = resign(envA, privateKey, publicKey, (p) => { p.handoff.attempts[0].hiddenTests = ['x']; });
    expect(await ingestor.ingest(smuggled)).toMatchObject({ status: 'rejected', reason: 'scope_mismatch' });
    expect(store.writes).toBe(0);
  });

  it('tenant ids cannot escape or alias a namespace', async () => {
    const { ingestor } = setup(enabled());
    for (const bad of ['../tenant-a', 'tenant-a', '/x', 'a/b/c/d', 'sim:tenant-a/x', 'a b/c']) {
      await expect(ingestor.query(bad)).rejects.toThrow(/tenant/);
    }
    expect(simNamespace(TENANT_A)).toBe('sim:tenant-a/ruvnet/metaharness');
  });
});

describe('idempotent delivery', () => {
  it('repeat delivery and a re-signed copy of the same content write once', async () => {
    const { publicKey, privateKey } = keyPair();
    const keys = [...clone(trustedFile.keys), trust(publicKey, [TENANT_A])];
    const { store, ingestor } = setup(enabled(keys));
    expect((await ingestor.ingest(envA)).status).toBe('ingested');
    expect((await ingestor.ingest(clone(envA))).status).toBe('duplicate');
    const resigned = resign(envA, privateKey, publicKey, (p) => { p.createdAt = '2026-11-20T00:30:00.000Z'; });
    expect(await ingestor.ingest(resigned)).toMatchObject({ status: 'duplicate', eventId: envA.payload.eventId });
    expect([...store.rows.keys()].filter((k) => k.includes('event:'))).toHaveLength(1);
    expect(await ingestor.query(TENANT_A)).toHaveLength(1);
  });
});

describe('malformed, unsigned, tampered, unknown, expired, revoked → reject', () => {
  it('rejects each failure mode with a typed reason and writes nothing', async () => {
    const { store, ingestor } = setup(enabled());
    const tampered = clone(envA);
    tampered.payload.handoff.attempts[0].diagnosis = tampered.payload.handoff.attempts[0].diagnosis.replace(/.$/, '?');
    const badSig = clone(envA);
    const sig = Buffer.from(badSig.signature.value, 'base64'); sig[10] ^= 0x01;
    badSig.signature.value = sig.toString('base64');
    const cases: Array<[unknown, string]> = [
      [tampered, 'bad_signature'],
      [badSig, 'bad_signature'],
      [{ payload: envA.payload }, 'unsigned'],
      [{ payload: envA.payload, signature: { alg: 'none', value: '' } }, 'unsigned'],
      [envA.payload.handoff, 'malformed'],
      ['garbage', 'malformed'],
      [{ ...clone(envA), extra: true }, 'malformed'],
      [{ ...clone(envA), payload: { ...envA.payload, schema: 'metaharness.sim.handoff.v1' } }, 'unsupported_schema'],
      [{ ...clone(envA), payload: { ...envA.payload, keyId: 'ed25519:' + '0'.repeat(32) } }, 'unknown_key'],
    ];
    for (const [input, reason] of cases) {
      expect(await ingestor.ingest(input), reason).toMatchObject({ status: 'rejected', reason });
    }
    expect(store.writes).toBe(0);
    expect((await setup(enabled(), new Date('2027-01-01T00:00:00.000Z')).ingestor.ingest(envA))).toMatchObject({ reason: 'expired' });
    const revoked = clone(trustedFile.keys).map((k) => ({ ...k, revoked: true }));
    expect(await setup(enabled(revoked)).ingestor.ingest(envA)).toMatchObject({ reason: 'revoked_key' });
  });
});

describe('revocation and audit', () => {
  it('revoking an event deletes it and a replay cannot resurrect it', async () => {
    const { ingestor, audit } = setup(enabled());
    await ingestor.ingest(envA);
    expect(await ingestor.revokeEvent(TENANT_A, envA.payload.eventId)).toEqual({ status: 'revoked', deleted: true });
    expect(await ingestor.query(TENANT_A)).toEqual([]);
    expect(await ingestor.ingest(envA)).toMatchObject({ status: 'rejected', reason: 'revoked_event' });
    await expect(ingestor.revokeEvent(TENANT_A, 'event:../x')).rejects.toThrow(/event id/);
    expect(audit.map((e) => `${e.action}:${e.status}`)).toEqual(['ingest:ingested', 'revoke-event:revoked', 'ingest:rejected']);
    // The audit log carries ids and hashes, never evidence content.
    expect(JSON.stringify(audit)).not.toMatch(/Retried|diagnosis|rationale/);
  });

  it('revoking a key deletes every event it signed, only in its tenants, and blocks new ones', async () => {
    const { ingestor } = setup(enabled());
    await ingestor.ingest(envA);
    await ingestor.ingest(envB);
    const r = await ingestor.revokeKey(envA.payload.keyId);
    expect(r).toMatchObject({ status: 'revoked', deleted: 1 });
    if (r.status === 'revoked') expect(r.config.keys.find((k) => k.keyId === envA.payload.keyId)?.revoked).toBe(true);
    expect(await ingestor.query(TENANT_A)).toEqual([]);
    expect(await ingestor.query(TENANT_B)).toHaveLength(1);
    expect(await ingestor.ingest(envA)).toMatchObject({ reason: 'revoked_key' });
  });

  it("revoking one key of a tenant keeps the other key's events, even if the tag filter is ignored", async () => {
    const { publicKey, privateKey } = keyPair();
    const { store, ingestor } = setup(enabled([...clone(trustedFile.keys), trust(publicKey, [TENANT_A])]));
    store.ignoreTagFilter = true;
    await ingestor.ingest(envA);
    const other = resign(envA, privateKey, publicKey, (p) => {
      p.handoff.attempts[0].rationale = 'a different, second-key experience';
      p.eventId = simEventId(p.tenant, p.handoff);
    });
    expect((await ingestor.ingest(other)).status).toBe('ingested');
    expect(await ingestor.revokeKey(envA.payload.keyId)).toMatchObject({ status: 'revoked', deleted: 1 });
    const left = await ingestor.query(TENANT_A) as any[];
    expect(left.map((r) => r.provenance.keyId)).toEqual([simKeyId(publicKey)]);
  });

  it('retention runs from createdAt: a replay after retention elapsed is not re-stored', async () => {
    const { publicKey, privateKey } = keyPair();
    const short = resign(envA, privateKey, publicKey, (p) => { p.retention.days = 1; });
    const late = new Date(Date.parse(envA.payload.createdAt) + 2 * 86_400_000);
    const { store, ingestor } = setup(enabled([trust(publicKey, [TENANT_A])]), late);
    expect(await ingestor.ingest(short)).toMatchObject({ status: 'rejected', reason: 'retention_elapsed' });
    expect(store.writes).toBe(0);
  });

  it('query re-verifies stored rows, so a key removed from config hides its evidence', async () => {
    const config = enabled();
    const { ingestor } = setup(config);
    await ingestor.ingest(envA);
    config.keys = config.keys.filter((k) => k.keyId !== envA.payload.keyId);
    expect(await ingestor.query(TENANT_A)).toEqual([]);
  });
});
