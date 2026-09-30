import { createHash, randomUUID } from 'node:crypto';
import { calculateJwkThumbprint, importJWK, jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';
import { TenantVectorMemory } from './vector-memory.mjs';

// Fixed, operator-reviewed origins: never accept a tool-supplied URL.
export const EDGE_ISSUER = 'https://ruvector-edge-auth.cognitum-consulting-mail.workers.dev';
export const EDGE_RESOURCE = 'https://ruvector-edge-gateway.cognitum-consulting-mail.workers.dev/v1';
export const TEAM_RESOURCE = 'https://team.ruv.io/mcp';
const TOKEN_URL = `${EDGE_ISSUER}/token`;
const EDGE_JWKS = createRemoteJWKSet(new URL(`${EDGE_ISSUER}/.well-known/jwks.json`));
const ACCESS_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export function edgeCollectionName(teamId) {
  return `aitm-${createHash('sha256').update(teamId).digest('hex').slice(0, 32)}`;
}

export function edgeVectorId(memoryId) {
  return `m-${createHash('sha256').update(memoryId).digest('hex')}`;
}

export async function edgeTokenExchange(subjectToken, scope, { clientId, privateJwk, fetchImpl = fetch, verifyKey = EDGE_JWKS }) {
  if (!subjectToken || !['ruvector:read', 'ruvector:write'].includes(scope)) throw new Error('edge exchange inputs invalid');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(clientId || '')) throw new Error('edge client id invalid');
  let jwk;
  try { jwk = typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk; }
  catch { throw new Error('edge signing key invalid'); }
  if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || !jwk?.d) throw new Error('edge signing key invalid');
  const { payload: subject } = await jwtVerify(subjectToken, verifyKey, { issuer: EDGE_ISSUER, audience: TEAM_RESOURCE });
  if (subject.act || !String(subject.scope || '').split(' ').includes(scope === 'ruvector:write' ? 'team:write' : 'team:read')) throw new Error('edge subject claims invalid');
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const kid = await calculateJwkThumbprint(publicJwk, 'sha256');
  const key = await importJWK(jwk, 'ES256');
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid })
    .setIssuer(clientId).setSubject(clientId).setAudience(TOKEN_URL)
    .setIssuedAt().setExpirationTime('2m').setJti(randomUUID()).sign(key);
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: clientId, client_assertion_type: ASSERTION_TYPE, client_assertion: assertion,
    subject_token: subjectToken, subject_token_type: ACCESS_TYPE,
    requested_token_type: ACCESS_TYPE, resource: EDGE_RESOURCE, scope,
  });
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`edge exchange failed (${response.status})`);
  const token = await response.json();
  if (token.token_type !== 'Bearer' || token.issued_token_type !== ACCESS_TYPE || !token.access_token) throw new Error('edge exchange response invalid');
  // Independently reject wrong-resource or wrong-actor tokens before any data call.
  const { payload } = await jwtVerify(token.access_token, verifyKey, {
    issuer: EDGE_ISSUER, audience: EDGE_RESOURCE,
  });
  if (payload.act?.sub !== clientId || !String(payload.scope || '').split(' ').includes(scope)
    || ['sub', 'upstream_iss', 'org_id', 'workspace_id', 'family_id'].some((field) => payload[field] !== subject[field])) throw new Error('edge exchange claims invalid');
  return token.access_token;
}

export class EdgeVectorMemory {
  constructor(store, { clientId, privateJwk, exchange = edgeTokenExchange, fetchImpl = fetch, fallback = new TenantVectorMemory(store) } = {}) {
    if (!clientId || !privateJwk) throw new Error('edge adapter credentials required');
    let jwk;
    try { jwk = typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk; }
    catch { throw new Error('edge signing key invalid'); }
    if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || !jwk?.d || !jwk?.x || !jwk?.y) throw new Error('edge signing key invalid');
    this.store = store; this.clientId = clientId; this.privateJwk = privateJwk;
    this.exchange = exchange; this.fetchImpl = fetchImpl; this.fallback = fallback;
  }

  invalidate(tenantId) { this.fallback.invalidate(tenantId); }

  async #token(auth, scope) {
    if (!auth?.bearerToken || auth.mode !== 'oauth' || auth.issuer !== EDGE_ISSUER) throw new Error('edge subject token required');
    return this.exchange(auth.bearerToken, scope, { clientId: this.clientId, privateJwk: this.privateJwk, fetchImpl: this.fetchImpl });
  }

  async #request(token, path, { method = 'GET', body, key } = {}) {
    const response = await this.fetchImpl(`${EDGE_RESOURCE}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return { missing: true };
    if (!response.ok) throw new Error(`edge request failed (${response.status})`);
    const raw = await response.text();
    if (raw.length > 512 * 1024) throw new Error('edge response too large');
    return raw ? JSON.parse(raw) : {};
  }

  // Firestore remains canonical. A failed derived-index write is reported,
  // never allowed to erase the successfully stored memory.
  async upsert(tenantId, memory, auth) {
    if (auth?.issuer !== EDGE_ISSUER) return { edgeIndex: 'deferred', reason: 'legacy_oauth' };
    if (Buffer.byteLength(memory.text, 'utf8') > 8192) return { edgeIndex: 'deferred', reason: 'text_too_long' };
    try {
      const token = await this.#token(auth, 'ruvector:write');
      const collection = edgeCollectionName(memory.teamId);
      const upsert = () => this.#request(token, `/collections/${collection}/vectors`, {
        method: 'POST', body: { vectors: [{ id: edgeVectorId(memory.id), text: memory.text, metadata: { memory_id: memory.id } }] },
        key: `aitm-upsert-${createHash('sha256').update(`${memory.id}:${memory.contentHash}`).digest('hex')}`,
      });
      if ((await upsert()).missing) {
        if ((await this.#request(token, '/collections', { method: 'POST', body: { name: collection, dim: 384, metric: 'cosine', embedder: 'bge-small-en-v1.5' }, key: `aitm-create-${collection}` })).missing) throw new Error('edge collection create unavailable');
        if ((await upsert()).missing) throw new Error('edge collection unavailable');
      }
      return { edgeIndex: 'indexed' };
    } catch { return { edgeIndex: 'deferred', reason: 'edge_unavailable_or_unprovisioned' }; }
  }

  async search(tenantId, { teamId, query, limit = 5 }, auth) {
    const local = () => this.fallback.search(tenantId, { teamId, query, limit });
    if (auth?.issuer !== EDGE_ISSUER) return { ...await local(), edgeStatus: 'legacy_oauth' };
    try {
      const token = await this.#token(auth, 'ruvector:read');
      const collection = edgeCollectionName(teamId);
      const result = await this.#request(token, `/collections/${collection}/query`, {
        method: 'POST', body: { text: query, top_k: Math.min(30, limit * 3), include: ['metadata'] },
      });
      if (result.missing) return { ...await local(), edgeStatus: 'collection_missing' };
      if (!Array.isArray(result.matches)) throw new Error('edge result invalid');
      const candidateIds = result.matches.slice(0, 30).map((m) => m.metadata?.memory_id)
        .filter((id) => typeof id === 'string' && id.length <= 120);
      const memories = this.store.getMemories
        ? await this.store.getMemories(tenantId, [...new Set(candidateIds)], { teamId })
        : (await this.store.listMemories(tenantId, { teamId })).filter((m) => candidateIds.includes(m.id));
      const byId = new Map(memories.map((m) => [edgeVectorId(m.id), m]));
      const remote = result.matches.slice(0, 30).map((m) => ({
        score: Number.isFinite(m.distance) ? 1 / (1 + Math.max(0, m.distance)) : NaN,
        distance: m.distance, memory: edgeVectorId(m.metadata?.memory_id || '') === m.id ? byId.get(m.id) : undefined, source: 'ruvector-edge',
      })).filter((m) => m.memory && Number.isFinite(m.score));
      const seen = new Set(remote.map((m) => m.memory.id));
      // A full remote page needs only bounded hydration; avoid a 1,000-row
      // Firestore scan on the hot path. Sparse results still check older rows.
      const lexical = remote.length < limit
        ? (await local()).results.filter((m) => !seen.has(m.memory.id)).map((m) => ({ ...m, source: 'lexical-fallback' }))
        : [];
      return { backend: 'ruvector-edge-hybrid', degraded: lexical.length > 0, edgeStatus: 'active', results: [...remote, ...lexical].slice(0, limit) };
    } catch { return { ...await local(), edgeStatus: 'unavailable_or_unprovisioned' }; }
  }
}

export function edgeVectorMemoryFromEnv(store) {
  const clientId = process.env.RUFLO_AI_TEAM_EDGE_CLIENT_ID;
  const privateJwk = process.env.RUFLO_AI_TEAM_EDGE_PRIVATE_JWK;
  if (!clientId || !privateJwk) throw new Error('edge adapter credentials required');
  return new EdgeVectorMemory(store, { clientId, privateJwk });
}
