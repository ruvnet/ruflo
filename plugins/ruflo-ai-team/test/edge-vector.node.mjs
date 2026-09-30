import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/store.mjs';
import { EdgeVectorMemory, EDGE_ISSUER, EDGE_RESOURCE, TEAM_RESOURCE, edgeCollectionName, edgeVectorId, edgeTokenExchange } from '../src/edge-vector-memory.mjs';
import { authenticate, tenantIdFromClaims } from '../src/auth.mjs';
import { generateKeyPair, exportJWK, SignJWT, decodeProtectedHeader } from 'jose';

const privateJwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' };
const auth = { mode: 'oauth', issuer: EDGE_ISSUER, bearerToken: 'subject' };

test('edge adapter indexes text and hydrates only the authenticated team from canonical store', async () => {
  const store = new InMemoryStore();
  const a = await store.createTeam('tenant-a', { name: 'A', objective: '', roles: [] });
  const sibling = await store.createTeam('tenant-a', { name: 'Sibling', objective: '', roles: [] });
  const b = await store.createTeam('tenant-b', { name: 'B', objective: '', roles: [] });
  const own = await store.remember('tenant-a', { teamId: a.id, key: 'own', text: 'Private launch plan' });
  const otherTeam = await store.remember('tenant-a', { teamId: sibling.id, key: 'sibling', text: 'Sibling team secret' });
  const foreign = await store.remember('tenant-b', { teamId: b.id, key: 'foreign', text: 'Other tenant secret' });
  const calls = [];
  let collectionExists = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith(`/collections/${edgeCollectionName(a.id)}/vectors`) && !collectionExists) return Response.json({}, { status: 404 });
    if (url.endsWith('/collections') && options.method === 'POST') { collectionExists = true; return Response.json({ name: edgeCollectionName(a.id) }, { status: 201 }); }
    if (url.endsWith('/query')) return Response.json({ matches: [{ id: edgeVectorId(foreign.id), distance: 0.01, metadata: { memory_id: foreign.id } }, { id: edgeVectorId(otherTeam.id), distance: 0.05, metadata: { memory_id: otherTeam.id } }, { id: edgeVectorId(own.id), distance: 0.15, metadata: { memory_id: own.id } }] });
    return Response.json({ upserted: 1 });
  };
  const exchange = async (_subject, scope) => `edge-${scope}`;
  const edge = new EdgeVectorMemory(store, { clientId: 'ruflo-ai-team', privateJwk, fetchImpl, exchange });
  assert.deepEqual(await edge.upsert('tenant-a', own, auth), { edgeIndex: 'indexed' });
  const indexed = calls.find((c) => c.url.endsWith('/vectors') && c.options.body);
  assert.deepEqual(JSON.parse(indexed.options.body).vectors, [{ id: edgeVectorId(own.id), text: own.text, metadata: { memory_id: own.id } }]);
  assert.ok(calls.every((c) => c.url.startsWith(EDGE_RESOURCE)));
  const result = await edge.search('tenant-a', { teamId: a.id, query: 'launch', limit: 5 }, auth);
  assert.equal(result.backend, 'ruvector-edge-hybrid');
  assert.equal(result.results[0].memory.id, own.id);
  assert.ok(result.results.every((m) => m.memory.teamId === a.id));
  assert.ok(!JSON.stringify(result).includes(foreign.text));
  assert.ok(!JSON.stringify(result).includes(otherTeam.text));
});

test('missing edge auth or collection is explicitly degraded, never cross-tenant', async () => {
  const store = new InMemoryStore();
  const team = await store.createTeam('t', { name: 'T', objective: '', roles: [] });
  await store.remember('t', { teamId: team.id, key: 'local', text: 'Local only' });
  const edge = new EdgeVectorMemory(store, {
    clientId: 'ruflo-ai-team', privateJwk,
    exchange: async () => { throw new Error('not provisioned'); },
    fetchImpl: async () => { throw new Error('must not call gateway'); },
  });
  const result = await edge.search('t', { teamId: team.id, query: 'Local', limit: 5 }, auth);
  assert.equal(result.backend, 'lexical-degraded');
  assert.equal(result.edgeStatus, 'unavailable_or_unprovisioned');
  assert.equal(result.results[0].memory.id, 'local');
  assert.deepEqual(await edge.upsert('t', { teamId: team.id, id: 'local', text: 'Local only', contentHash: 'a' }, auth), { edgeIndex: 'deferred', reason: 'edge_unavailable_or_unprovisioned' });
});

test('a full edge result page skips the unbounded lexical scan', async () => {
  const store = new InMemoryStore();
  const team = await store.createTeam('t', { name: 'T', objective: '', roles: [] });
  const memory = await store.remember('t', { teamId: team.id, key: 'm1', text: 'Vector result' });
  const fallback = { invalidate() {}, async search() { throw new Error('unexpected lexical scan'); } };
  const edge = new EdgeVectorMemory(store, {
    clientId: 'ruflo-ai-team', privateJwk, fallback, exchange: async () => 'edge-read',
    fetchImpl: async () => Response.json({ matches: [{ id: edgeVectorId(memory.id), distance: 0.2, metadata: { memory_id: memory.id } }] }),
  });
  const result = await edge.search('t', { teamId: team.id, query: 'Vector', limit: 1 }, auth);
  assert.equal(result.edgeStatus, 'active');
  assert.equal(result.degraded, false);
  assert.equal(result.results[0].memory.id, memory.id);
});

test('edge collection and vector names cannot contain user-controlled path segments', () => {
  assert.match(edgeCollectionName('../other?'), /^aitm-[a-f0-9]{32}$/);
  assert.match(edgeVectorId('../../x'), /^m-[a-f0-9]{64}$/);
});

test('edge tenant identity separates workspaces and rejects incomplete claims', () => {
  const issuer = 'https://ruvector-edge-auth.cognitum-consulting-mail.workers.dev';
  const claims = { upstream_iss: 'https://auth.cognitum.one', org_id: 'org', workspace_id: 'one', sub: 'same-user' };
  assert.notEqual(tenantIdFromClaims(claims, issuer), tenantIdFromClaims({ ...claims, workspace_id: 'two' }, issuer));
  assert.equal(tenantIdFromClaims({ ...claims, workspace_id: '' }, issuer), undefined);
});

test('edge primary and Cognitum legacy tokens remain separate verified tenants', async () => {
  const legacy = 'https://auth.cognitum.one';
  const config = { issuer: EDGE_ISSUER, jwksUri: `${EDGE_ISSUER}/.well-known/jwks.json`, legacyIssuer: legacy, legacyJwksUri: `${legacy}/.well-known/jwks.json`, audience: TEAM_RESOURCE };
  const verify = async (token, _key, options) => {
    if ((token === 'old' ? legacy : EDGE_ISSUER) !== options.issuer) throw new Error('issuer mismatch');
    return { payload: token === 'old'
      ? { sub: 'user', tenant_id: 'old-tenant', scope: 'team:read' }
      : { sub: 'user', upstream_iss: legacy, org_id: 'org', workspace_id: 'space', scope: 'team:read' } };
  };
  const old = await authenticate({ headers: { authorization: 'Bearer old' } }, config, verify);
  const fresh = await authenticate({ headers: { authorization: 'Bearer edge' } }, config, verify);
  assert.equal(old.issuer, legacy);
  assert.equal(fresh.issuer, EDGE_ISSUER);
  assert.notEqual(old.tenantId, fresh.tenantId);
  const store = new InMemoryStore();
  const team = await store.createTeam(old.tenantId, { name: 'Existing', objective: '', roles: [] });
  const memory = await store.remember(old.tenantId, { teamId: team.id, text: 'Existing memory' });
  const edge = new EdgeVectorMemory(store, { clientId: 'ruflo-ai-team', privateJwk, exchange: async () => { throw new Error('must not exchange legacy token'); } });
  assert.deepEqual(await edge.upsert(old.tenantId, memory, old), { edgeIndex: 'deferred', reason: 'legacy_oauth' });
  assert.equal((await edge.search(old.tenantId, { teamId: team.id, query: 'Existing', limit: 3 }, old)).edgeStatus, 'legacy_oauth');
});

test('RFC 8693 exchange signs private_key_jwt and refuses a changed tenant', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  const claims = { sub: 'es1_test', upstream_iss: 'https://auth.cognitum.one', org_id: 'o', workspace_id: 'w', family_id: 'f', scope: 'team:read team:write' };
  const subject = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setIssuer(EDGE_ISSUER).setAudience(TEAM_RESOURCE).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const minted = async (workspace = 'w') => new SignJWT({ ...claims, workspace_id: workspace, scope: 'ruvector:read', act: { sub: 'ruflo-ai-team' } })
    .setProtectedHeader({ alg: 'ES256' }).setIssuer(EDGE_ISSUER).setAudience(EDGE_RESOURCE).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let seen;
  const fetchImpl = async (url, options) => {
    assert.equal(url, `${EDGE_ISSUER}/token`);
    const form = new URLSearchParams(options.body);
    seen = form;
    assert.equal(decodeProtectedHeader(form.get('client_assertion')).alg, 'ES256');
    return Response.json({ access_token: await minted(), token_type: 'Bearer', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token' });
  };
  const config = { clientId: 'ruflo-ai-team', privateJwk: jwk, fetchImpl, verifyKey: publicKey };
  const issued = await edgeTokenExchange(subject, 'ruvector:read', config);
  assert.equal(typeof issued, 'string');
  assert.equal(seen.get('subject_token'), subject);
  assert.equal(seen.get('resource'), EDGE_RESOURCE);
  assert.equal(seen.get('scope'), 'ruvector:read');
  await assert.rejects(edgeTokenExchange(subject, 'ruvector:read', { ...config, fetchImpl: async () => Response.json({ access_token: await minted('other'), token_type: 'Bearer', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token' }) }), /claims invalid/);
});
