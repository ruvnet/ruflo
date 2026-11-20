/**
 * Verifier for signed MetaHarness SIM handoff envelopes
 * (`metaharness.sim.handoff.v2`, metaharness issue #524, ADR-325).
 *
 * This is an INDEPENDENT implementation of the envelope contract, not an
 * import of `@metaharness/darwin`: ADR-150 keeps MetaHarness removable, and
 * the published darwin pinned by this CLI predates the v2 helpers. The two
 * implementations are kept in lockstep by a shared signed fixture committed
 * to both repositories (`__tests__/fixtures/sim-handoff-v2`).
 *
 * Contract: Ed25519 signature over
 *   "metaharness.sim.handoff.v2\n" + canonicalJson(payload)
 * where canonicalJson sorts object keys, emits no whitespace and rejects
 * non-finite numbers. The signing key must be listed in the consumer's
 * trusted key set AND bound there to the tenant the payload names; the
 * envelope's own tenant claim never authorizes anything by itself.
 */

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export const SIM_HANDOFF_V1_SCHEMA = 'metaharness.sim.handoff.v1';
export const SIM_HANDOFF_V2_SCHEMA = 'metaharness.sim.handoff.v2';
const SIGNING_DOMAIN = SIM_HANDOFF_V2_SCHEMA + '\n';
const MAX_ENVELOPE_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 500;
const MAX_LIFETIME_MS = 30 * 24 * 3600 * 1000;
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/;
const PAYLOAD_KEYS = ['schema', 'eventId', 'keyId', 'tenant', 'createdAt', 'expiresAt', 'consent', 'retention', 'handoff'];
const HANDOFF_KEYS = ['schema', 'audience', 'trust', 'scope', 'retrieval', 'estimatedTokens', 'attempts'];
const SCOPE_KEYS = ['ownerId', 'repoId', 'interfaceId', 'modelId', 'benchmarkId', 'harnessVersion'];
const ATTEMPT_STRINGS: Record<string, number> = {
  id: 160, createdAt: 160, problemKey: 160, variantId: 160, mutationSurface: 160, diagnosis: 4000, rationale: 4000,
};
const ATTEMPT_KEYS = [
  ...Object.keys(ATTEMPT_STRINGS), 'scope', 'parentId', 'predictedDelta', 'observedDelta', 'finalScore',
  'promoted', 'evidenceIds', 'previousHash', 'hash',
];
const CONSENT = '{"promotion":"manual_review_only","purpose":"harness_optimizer","sharing":"none"}';

export interface SimTenant { owner: string; repo: string }
export interface TrustedSimKey {
  keyId: string;
  /** SPKI PEM public key. */
  publicKey: string;
  /** Tenants ("owner/repo") this key may sign for. */
  tenants: string[];
  revoked?: boolean;
  notAfter?: string;
}
export interface SimHandoffPayload {
  schema: typeof SIM_HANDOFF_V2_SCHEMA;
  eventId: string;
  keyId: string;
  tenant: SimTenant;
  createdAt: string;
  expiresAt: string;
  consent: { purpose: 'harness_optimizer'; sharing: 'none'; promotion: 'manual_review_only' };
  retention: { days: number };
  handoff: { scope: Record<string, string>; attempts: Array<Record<string, unknown>>; [k: string]: unknown };
}
export type SimVerifyFailure =
  | 'too_large' | 'malformed' | 'unsigned' | 'unknown_key' | 'key_id_mismatch' | 'revoked_key'
  | 'key_expired' | 'bad_signature' | 'unsupported_schema' | 'not_yet_valid' | 'expired'
  | 'tenant_not_authorized' | 'scope_mismatch' | 'event_id_mismatch';
export type SimVerifyResult =
  | { ok: true; payload: SimHandoffPayload; keyId: string; eventId: string; tenant: string; payloadSha256: string }
  | { ok: false; reason: SimVerifyFailure; detail?: string };

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Deterministic JSON: sorted keys, no whitespace, finite numbers only. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('nesting too deep');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v, depth + 1)).join(',') + ']';
  if (plain(value)) {
    return '{' + Object.keys(value).sort().map((k) => {
      if (value[k] === undefined) throw new Error('undefined field');
      return JSON.stringify(k) + ':' + canonicalJson(value[k], depth + 1);
    }).join(',') + '}';
  }
  throw new Error('unsupported value type');
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** "ed25519:" + first 32 hex chars of sha256(raw 32-byte public key). */
export function simKeyId(publicKey: KeyObject | string): string {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('key must be Ed25519');
  const jwk = key.export({ format: 'jwk' }) as { x?: string };
  if (!jwk.x) throw new Error('cannot export public key');
  return 'ed25519:' + sha256(Buffer.from(jwk.x, 'base64url')).slice(0, 32);
}

/** "owner/repo"; owner has no slash, so the mapping is injective. Throws on bad input. */
export function simTenantId(tenant: unknown): string {
  if (!plain(tenant) || Object.keys(tenant).sort().join() !== 'owner,repo' ||
    typeof tenant.owner !== 'string' || typeof tenant.repo !== 'string' ||
    !OWNER_RE.test(tenant.owner) || !REPO_RE.test(tenant.repo)) {
    throw new Error('invalid tenant');
  }
  return tenant.owner + '/' + tenant.repo;
}

/** Parses "owner/repo[/name]" back into a tenant, rejecting anything simTenantId would not emit. */
export function parseSimTenant(id: string): SimTenant {
  const slash = typeof id === 'string' ? id.indexOf('/') : -1;
  if (slash < 1) throw new Error('invalid tenant');
  const tenant = { owner: id.slice(0, slash), repo: id.slice(slash + 1) };
  simTenantId(tenant);
  return tenant;
}

export function simEventId(tenant: SimTenant, handoff: unknown): string {
  return 'sim-evt-' + sha256(canonicalJson({ tenant, handoff })).slice(0, 40);
}

function boundedString(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}
function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
function validScope(scope: unknown, tenant: SimTenant): boolean {
  return plain(scope) && Object.keys(scope).every((k) => SCOPE_KEYS.includes(k)) &&
    SCOPE_KEYS.every((k) => boundedString(scope[k], 160)) &&
    scope.ownerId === tenant.owner && scope.repoId === tenant.repo;
}

/** Field allowlist + tenant binding for the wrapped v1 document. Unknown fields are rejected. */
function handoffProblem(handoff: unknown, tenant: SimTenant): string | null {
  if (!plain(handoff) || Object.keys(handoff).some((k) => !HANDOFF_KEYS.includes(k))) return 'handoff fields';
  if (handoff.schema !== SIM_HANDOFF_V1_SCHEMA || handoff.audience !== 'harness_optimizer' ||
    handoff.trust !== 'untrusted_evidence_only') return 'handoff must be untrusted optimizer-only v1';
  if (!['full', 'lexical', 'vector'].includes(handoff.retrieval as string)) return 'retrieval';
  if (!Number.isSafeInteger(handoff.estimatedTokens) || (handoff.estimatedTokens as number) < 0) return 'estimatedTokens';
  if (!validScope(handoff.scope, tenant)) return 'handoff scope does not match tenant';
  if (!Array.isArray(handoff.attempts) || handoff.attempts.length > MAX_ATTEMPTS) return 'attempts';
  const ids = new Set<string>();
  for (const a of handoff.attempts) {
    if (!plain(a) || Object.keys(a).some((k) => !ATTEMPT_KEYS.includes(k))) return 'attempt fields';
    for (const [k, max] of Object.entries(ATTEMPT_STRINGS)) if (!boundedString(a[k], max)) return 'attempt.' + k;
    if (isoTime(a.createdAt) === null) return 'attempt.createdAt';
    if (!validScope(a.scope, tenant)) return 'attempt scope does not match tenant';
    if (a.parentId !== null && !boundedString(a.parentId, 160)) return 'attempt.parentId';
    if (a.predictedDelta !== null && !finiteNumber(a.predictedDelta)) return 'attempt.predictedDelta';
    if (!finiteNumber(a.observedDelta) || !finiteNumber(a.finalScore) || typeof a.promoted !== 'boolean') return 'attempt numbers';
    if (!Array.isArray(a.evidenceIds) || a.evidenceIds.length > 20 || !a.evidenceIds.every((e) => boundedString(e, 256))) return 'attempt.evidenceIds';
    if (typeof a.hash !== 'string' || !/^[0-9a-f]{64}$/.test(a.hash)) return 'attempt.hash';
    if (a.previousHash !== null && !(typeof a.previousHash === 'string' && /^[0-9a-f]{64}$/.test(a.previousHash))) return 'attempt.previousHash';
    if (ids.has(a.id as string)) return 'duplicate attempt id';
    ids.add(a.id as string);
  }
  return null;
}

function isoTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) || new Date(t).toISOString() !== value ? null : t;
}
const fail = (reason: SimVerifyFailure, detail?: string): SimVerifyResult => ({ ok: false, reason, ...(detail ? { detail } : {}) });

/** Verifies shape, key, signature, then semantics. Nothing is partially accepted. */
export function verifySimHandoff(
  envelope: unknown,
  options: { trustedKeys: TrustedSimKey[]; now?: Date; maxSkewMs?: number },
): SimVerifyResult {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(envelope) ?? '', 'utf8'); } catch { return fail('malformed'); }
  if (bytes > MAX_ENVELOPE_BYTES) return fail('too_large');
  if (!plain(envelope) || !plain(envelope.payload)) return fail('malformed');
  if (Object.keys(envelope).some((k) => k !== 'payload' && k !== 'signature')) return fail('malformed', 'envelope fields');
  const sig = envelope.signature;
  if (!plain(sig) || sig.alg !== 'ed25519' || typeof sig.value !== 'string' || sig.value.length === 0) return fail('unsigned');
  const payload = envelope.payload;
  if (Object.keys(payload).some((k) => !PAYLOAD_KEYS.includes(k))) return fail('malformed', 'payload fields');
  if (payload.schema !== SIM_HANDOFF_V2_SCHEMA) return fail('unsupported_schema');
  const trusted = options.trustedKeys.find((k) => k.keyId === payload.keyId);
  if (!trusted) return fail('unknown_key');
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(trusted.publicKey);
    if (simKeyId(publicKey) !== trusted.keyId) return fail('key_id_mismatch');
  } catch { return fail('key_id_mismatch'); }
  const now = (options.now ?? new Date()).getTime();
  if (trusted.revoked) return fail('revoked_key');
  if (trusted.notAfter !== undefined) {
    const notAfter = isoTime(trusted.notAfter);
    if (notAfter === null || now > notAfter) return fail('key_expired');
  }
  let message: Buffer;
  try { message = Buffer.from(SIGNING_DOMAIN + canonicalJson(payload), 'utf8'); } catch { return fail('malformed'); }
  const signature = Buffer.from(sig.value, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== sig.value) return fail('bad_signature');
  if (!verify(null, message, publicKey, signature)) return fail('bad_signature');

  const created = isoTime(payload.createdAt);
  const expires = isoTime(payload.expiresAt);
  if (created === null || expires === null || expires <= created || expires - created > MAX_LIFETIME_MS) return fail('malformed', 'times');
  if (created > now + (options.maxSkewMs ?? 300_000)) return fail('not_yet_valid');
  if (now > expires) return fail('expired');
  try { if (canonicalJson(payload.consent) !== CONSENT) return fail('malformed', 'consent'); } catch { return fail('malformed', 'consent'); }
  const retention = payload.retention;
  if (!plain(retention) || Object.keys(retention).join() !== 'days' || !Number.isSafeInteger(retention.days) ||
    (retention.days as number) < 1 || (retention.days as number) > 3650) return fail('malformed', 'retention');
  let tenantId: string;
  try { tenantId = simTenantId(payload.tenant); } catch { return fail('malformed', 'tenant'); }
  if (!Array.isArray(trusted.tenants) || !trusted.tenants.includes(tenantId)) return fail('tenant_not_authorized');
  const tenant = payload.tenant as unknown as SimTenant;
  const problem = handoffProblem(payload.handoff, tenant);
  if (problem) return fail('scope_mismatch', problem);
  if (payload.eventId !== simEventId(tenant, payload.handoff)) return fail('event_id_mismatch');
  return {
    ok: true,
    payload: payload as unknown as SimHandoffPayload,
    keyId: trusted.keyId,
    eventId: payload.eventId as string,
    tenant: tenantId,
    payloadSha256: sha256(message),
  };
}
