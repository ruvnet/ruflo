/**
 * Opt-in ingestion adapter for signed MetaHarness SIM handoffs
 * (metaharness issue #524, ADR-325; envelope contract in sim-handoff-verify.ts).
 *
 * - Disabled by default: with no config, or `enabled !== true`, every call
 *   returns `{ status: 'disabled' }` and touches neither the store nor the
 *   audit log.
 * - Least privilege: a payload is accepted only when its key is in the
 *   configured trusted set AND bound there to the tenant the payload names.
 * - Tenant isolation: every accepted event is written to the namespace
 *   `sim:<owner>/<repo>` derived from the VERIFIED tenant, and reads take a
 *   tenant and touch only that namespace. Isolation is enforced here, at the
 *   namespace level; the underlying memory store has no access control.
 * - Optimizer memory stays separate from task-agent memory: the default store
 *   writes to a dedicated database file (`.claude-flow/sim/sim-memory.db`),
 *   never `.swarm/memory.db`, so `memory search` cannot surface SIM evidence.
 * - Idempotent: the event id is content-derived and verified; redelivery of
 *   the same event is reported as `duplicate` and writes nothing.
 * - Revocation: revoking an event deletes it and leaves a tombstone so a
 *   replay cannot resurrect it; revoking a key marks it revoked in the config
 *   and deletes every event it signed. Every decision is appended to an audit
 *   log that records ids and hashes, never payload contents.
 * - No automatic promotion or external sharing: nothing here forwards evidence
 *   anywhere. Core Memory promotion stays a manual PR/issue workflow.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeFileAtomic } from '../fs-secure.js';
import {
  parseSimTenant, simKeyId, simTenantId, verifySimHandoff,
  type SimHandoffPayload, type SimVerifyFailure, type TrustedSimKey,
} from './sim-handoff-verify.js';

export interface SimIngestConfig {
  enabled: boolean;
  keys: TrustedSimKey[];
}
export interface SimStoredRow { key: string; content: string }
/** Minimal contract over the memory store; the default implementation is the real CLI store. */
export interface SimEvidenceStore {
  get(namespace: string, key: string): Promise<string | null>;
  /**
   * Must not overwrite a LIVE key unless replace=true. replace is only used
   * after get() reported the key absent, to reclaim a soft-deleted or
   * TTL-expired row that a plain insert would collide with.
   */
  put(namespace: string, key: string, value: string, tags: string[], ttlSeconds: number, replace?: boolean): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  list(namespace: string, tag?: string): Promise<SimStoredRow[]>;
}
export interface SimAuditEntry {
  at: string;
  action: 'ingest' | 'revoke-event' | 'revoke-key';
  status: string;
  reason?: string;
  eventId?: string;
  keyId?: string;
  tenant?: string;
  payloadSha256?: string;
  deleted?: number;
}
export interface SimProvenance {
  schema: 'metaharness.sim.handoff.v2';
  eventId: string;
  keyId: string;
  tenant: string;
  payloadSha256: string;
  signature: string;
  verifiedAt: string;
}
export interface SimEvidenceRecord {
  provenance: SimProvenance;
  payload: SimHandoffPayload;
}
export type SimIngestResult =
  | { status: 'disabled' }
  | { status: 'ingested' | 'duplicate'; eventId: string; tenant: string; namespace: string; keyId: string }
  | { status: 'rejected'; reason: SimVerifyFailure | 'revoked_event' | 'retention_elapsed'; detail?: string };

const EVENT_PREFIX = 'event:';
const TOMBSTONE_PREFIX = 'tombstone:';

export function simNamespace(tenantId: string): string {
  return 'sim:' + simTenantId(parseSimTenant(tenantId));
}

export interface SimIngestorOptions {
  config: SimIngestConfig | null;
  store: SimEvidenceStore;
  audit: (entry: SimAuditEntry) => void;
  now?: () => Date;
}

export class SimHandoffIngestor {
  private readonly now: () => Date;
  constructor(private readonly options: SimIngestorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return this.options.config?.enabled === true;
  }

  private keys(): TrustedSimKey[] {
    return this.options.config?.keys ?? [];
  }

  private record(entry: Omit<SimAuditEntry, 'at'>): void {
    this.options.audit({ at: this.now().toISOString(), ...entry });
  }

  async ingest(envelope: unknown): Promise<SimIngestResult> {
    if (!this.enabled) return { status: 'disabled' };
    const verifiedAt = this.now();
    const result = verifySimHandoff(envelope, { trustedKeys: this.keys(), now: verifiedAt });
    if (!result.ok) {
      this.record({ action: 'ingest', status: 'rejected', reason: result.reason });
      return { status: 'rejected', reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) };
    }
    const namespace = simNamespace(result.tenant);
    const base = { eventId: result.eventId, keyId: result.keyId, tenant: result.tenant, payloadSha256: result.payloadSha256 };
    if (await this.options.store.get(namespace, TOMBSTONE_PREFIX + result.eventId) !== null) {
      this.record({ action: 'ingest', status: 'rejected', reason: 'revoked_event', ...base });
      return { status: 'rejected', reason: 'revoked_event' };
    }
    // Retention runs from the producer's createdAt, not from delivery: a replay
    // after retention has elapsed must not re-store the evidence.
    const retentionEnd = Date.parse(result.payload.createdAt) + result.payload.retention.days * 86_400_000;
    const ttlSeconds = Math.ceil((retentionEnd - verifiedAt.getTime()) / 1000);
    if (ttlSeconds <= 0) {
      this.record({ action: 'ingest', status: 'rejected', reason: 'retention_elapsed', ...base });
      return { status: 'rejected', reason: 'retention_elapsed' };
    }
    const done = { eventId: result.eventId, tenant: result.tenant, namespace, keyId: result.keyId };
    if (await this.options.store.get(namespace, EVENT_PREFIX + result.eventId) !== null) {
      this.record({ action: 'ingest', status: 'duplicate', ...base });
      return { status: 'duplicate', ...done };
    }
    const provenance: SimProvenance = {
      schema: 'metaharness.sim.handoff.v2', ...base,
      signature: (envelope as { signature: { value: string } }).signature.value,
      verifiedAt: verifiedAt.toISOString(),
    };
    const value = JSON.stringify({ provenance, payload: result.payload } satisfies SimEvidenceRecord);
    const tags = ['sim-handoff', 'sim-key:' + result.keyId, 'sim-event:' + result.eventId];
    try {
      await this.options.store.put(namespace, EVENT_PREFIX + result.eventId, value, tags, ttlSeconds);
    } catch (error) {
      // A concurrent delivery of the same event may win the insert race.
      if (await this.options.store.get(namespace, EVENT_PREFIX + result.eventId) !== null) {
        this.record({ action: 'ingest', status: 'duplicate', ...base });
        return { status: 'duplicate', ...done };
      }
      // Not live, yet the insert collided: a soft-deleted (revoked-key) or
      // expired row still holds the key. The tombstone check above already
      // ran, so reclaiming it is safe.
      await this.options.store.put(namespace, EVENT_PREFIX + result.eventId, value, tags, ttlSeconds, true);
    }
    this.record({ action: 'ingest', status: 'ingested', ...base });
    return { status: 'ingested', ...done };
  }

  /**
   * Returns one tenant's evidence with provenance. Each stored record is
   * re-verified against the CURRENT key set (at its ingestion time), so a
   * record signed by a since-revoked or removed key is never returned even if
   * its deletion failed.
   */
  async query(tenantId: string): Promise<SimEvidenceRecord[] | { status: 'disabled' }> {
    if (!this.enabled) return { status: 'disabled' };
    const namespace = simNamespace(tenantId);
    const rows = await this.options.store.list(namespace, 'sim-handoff');
    const out: SimEvidenceRecord[] = [];
    for (const row of rows) {
      if (!row.key.startsWith(EVENT_PREFIX)) continue;
      let record: SimEvidenceRecord;
      try { record = JSON.parse(row.content) as SimEvidenceRecord; } catch { continue; }
      const check = verifySimHandoff(
        { payload: record.payload, signature: { alg: 'ed25519', value: record.provenance?.signature } },
        { trustedKeys: this.keys(), now: new Date(record.provenance?.verifiedAt ?? 0) },
      );
      if (check.ok && check.tenant === tenantId && EVENT_PREFIX + check.eventId === row.key) {
        out.push({ provenance: record.provenance, payload: check.payload });
      }
    }
    return out.sort((a, b) => a.provenance.eventId.localeCompare(b.provenance.eventId));
  }

  async revokeEvent(tenantId: string, eventId: string): Promise<{ status: 'disabled' } | { status: 'revoked'; deleted: boolean }> {
    if (!this.enabled) return { status: 'disabled' };
    if (!/^sim-evt-[0-9a-f]{40}$/.test(eventId)) throw new Error('invalid event id');
    const namespace = simNamespace(tenantId);
    const deleted = await this.options.store.delete(namespace, EVENT_PREFIX + eventId);
    if (await this.options.store.get(namespace, TOMBSTONE_PREFIX + eventId) === null) {
      await this.options.store.put(namespace, TOMBSTONE_PREFIX + eventId,
        JSON.stringify({ eventId, revokedAt: this.now().toISOString() }), ['sim-tombstone'], 0);
    }
    this.record({ action: 'revoke-event', status: 'revoked', eventId, tenant: tenantId, deleted: deleted ? 1 : 0 });
    return { status: 'revoked', deleted };
  }

  /** Marks a key revoked in the returned config and deletes every event it signed in its bound tenants. */
  async revokeKey(keyId: string): Promise<{ status: 'disabled' } | { status: 'revoked'; deleted: number; config: SimIngestConfig }> {
    if (!this.enabled) return { status: 'disabled' };
    const key = this.keys().find((k) => k.keyId === keyId);
    if (!key) throw new Error('unknown key id');
    let deleted = 0;
    for (const tenant of key.tenants) {
      const namespace = simNamespace(tenant);
      for (const row of await this.options.store.list(namespace, 'sim-key:' + keyId)) {
        if (!row.key.startsWith(EVENT_PREFIX)) continue;
        // Do not trust the store's tag filter alone: confirm the signer.
        let signer: unknown;
        try { signer = (JSON.parse(row.content) as SimEvidenceRecord).provenance?.keyId; } catch { continue; }
        if (signer === keyId && await this.options.store.delete(namespace, row.key)) deleted++;
      }
    }
    const config: SimIngestConfig = {
      enabled: true,
      keys: this.keys().map((k) => (k.keyId === keyId ? { ...k, revoked: true } : k)),
    };
    this.options.config!.keys = config.keys;
    this.record({ action: 'revoke-key', status: 'revoked', keyId, deleted });
    return { status: 'revoked', deleted, config };
  }
}

// ---------------------------------------------------------------------------
// File-backed defaults: config, audit log, and the real memory store.

export function simIngestDir(projectRoot: string): string {
  return join(resolve(projectRoot), '.claude-flow', 'sim');
}

/** Loads and validates the trusted-key config. Missing file → null (adapter disabled). */
export function loadSimIngestConfig(path: string): SimIngestConfig | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SimIngestConfig>;
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.keys)) throw new Error('sim-ingest: config needs a keys array');
  for (const key of parsed.keys) {
    if (typeof key?.publicKey !== 'string' || simKeyId(key.publicKey) !== key.keyId) {
      throw new Error('sim-ingest: keyId does not match its public key: ' + String(key?.keyId));
    }
    if (!Array.isArray(key.tenants) || key.tenants.length === 0) throw new Error('sim-ingest: key ' + key.keyId + ' has no tenants');
    for (const tenant of key.tenants) simNamespace(tenant);
  }
  return { enabled: parsed.enabled === true, keys: parsed.keys };
}

export function saveSimIngestConfig(path: string, config: SimIngestConfig): void {
  writeFileAtomic(path, Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8'), { mode: 0o600 });
}

export function fileAuditLog(path: string): (entry: SimAuditEntry) => void {
  return (entry) => {
    mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
    appendFileSync(path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  };
}

/** The real CLI memory store, pinned to a dedicated SIM database file. */
export function memoryInitializerStore(dbPath: string): SimEvidenceStore {
  const load = async () => {
    const mem = await import('../memory/memory-initializer.js');
    if (!existsSync(dbPath)) {
      mkdirSync(resolve(dbPath, '..'), { recursive: true, mode: 0o700 });
      const init = await mem.initializeMemoryDatabase({ dbPath });
      if (!init.success) throw new Error('sim-ingest: could not initialize ' + dbPath + ': ' + (init.error ?? 'unknown'));
    }
    return mem;
  };
  return {
    async get(namespace, key) {
      const r = await (await load()).getEntry({ key, namespace, dbPath });
      return r.found && r.entry ? r.entry.content : null;
    },
    async put(namespace, key, value, tags, ttlSeconds, replace = false) {
      const r = await (await load()).storeEntry({
        key, value, namespace, tags, dbPath, upsert: replace, generateEmbeddingFlag: false,
        provenanceType: 'tool_result', ...(ttlSeconds > 0 ? { ttl: ttlSeconds } : {}),
      });
      if (!r.success) throw new Error('sim-ingest: store failed: ' + (r.error ?? 'unknown'));
    },
    async delete(namespace, key) {
      return (await (await load()).deleteEntry({ key, namespace, dbPath })).deleted;
    },
    async list(namespace, tag) {
      const r = await (await load()).listEntries({
        namespace, dbPath, includeContent: true, limit: 10_000, ...(tag ? { tags: [tag] } : {}),
      });
      if (!r.success) return [];
      return r.entries.filter((e) => e.namespace === namespace).map((e) => ({ key: e.key, content: e.content ?? '' }));
    },
  };
}

/** Wires the file-backed defaults under `<projectRoot>/.claude-flow/sim/`. */
export function openSimIngestor(projectRoot: string, deps: { store?: SimEvidenceStore; now?: () => Date } = {}): {
  ingestor: SimHandoffIngestor; configPath: string; auditPath: string; dbPath: string;
} {
  const dir = simIngestDir(projectRoot);
  const configPath = join(dir, 'trusted-keys.json');
  const auditPath = join(dir, 'audit.jsonl');
  const dbPath = join(dir, 'sim-memory.db');
  const ingestor = new SimHandoffIngestor({
    config: loadSimIngestConfig(configPath),
    store: deps.store ?? memoryInitializerStore(dbPath),
    audit: fileAuditLog(auditPath),
    now: deps.now,
  });
  return { ingestor, configPath, auditPath, dbPath };
}
