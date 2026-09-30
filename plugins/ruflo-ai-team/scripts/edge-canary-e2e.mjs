import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const ISSUER = 'https://ruvector-edge-auth.cognitum-consulting-mail.workers.dev';
const RESOURCE = 'https://team.ruv.io/mcp';
const ENDPOINTS = new Set([
  'https://team.ruv.io/mcp',
  'https://edge-canary---ruflo-ai-team-63rzcdswba-uc.a.run.app/mcp',
  'https://edge-next---ruflo-ai-team-63rzcdswba-uc.a.run.app/mcp',
]);
const endpoint = process.env.RUFLO_AI_TEAM_E2E_ENDPOINT || 'https://team.ruv.io/mcp';
if (!ENDPOINTS.has(endpoint)) throw new Error('E2E endpoint is not allowlisted');
const b64u = (b) => Buffer.from(b).toString('base64url');
const verifier = b64u(randomBytes(48));
const challenge = b64u(createHash('sha256').update(verifier).digest());
const state = b64u(randomBytes(32));
const nonce = b64u(randomBytes(32));

const metadataResponse = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`);
if (!metadataResponse.ok) throw new Error(`metadata ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
if (metadata.issuer !== ISSUER) throw new Error('issuer mismatch');

let resolveCode;
const codePromise = new Promise((resolve) => { resolveCode = resolve; });
let loginTimer;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') return res.writeHead(404).end();
  const valid = url.searchParams.get('state') === state && !!url.searchParams.get('code');
  res.writeHead(valid ? 200 : 400, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
  res.end(valid ? 'AI Team canary authorization received. Return to Codex.' : 'Authorization failed. Return to Codex.');
  resolveCode(valid ? url.searchParams.get('code') : null);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirect = `http://127.0.0.1:${server.address().port}/callback`;

try {
  const registrationResponse = await fetch(metadata.registration_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'RuFlo AI Team canary validation',
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'],
      response_types: ['code'], scope: 'team:read team:write' }),
  });
  if (!registrationResponse.ok) throw new Error(`registration ${registrationResponse.status}`);
  const registration = await registrationResponse.json();
  if (!registration.client_id || !String(registration.scope).includes('team:write')) throw new Error('registration scope invalid');
  const authUrl = new URL(metadata.authorization_endpoint);
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: registration.client_id,
    redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state,
    nonce, resource: RESOURCE, scope: 'team:read team:write' })) authUrl.searchParams.set(key, value);
  console.log(`OPEN_FOR_USER_LOGIN ${authUrl}`);
  const code = await Promise.race([codePromise, new Promise((_, reject) => {
    loginTimer = setTimeout(() => reject(new Error('login timed out')), 600_000);
  })]);
  if (!code) throw new Error('OAuth callback invalid');
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.client_id,
      code, redirect_uri: redirect, code_verifier: verifier, resource: RESOURCE }),
  });
  if (!tokenResponse.ok) throw new Error(`token ${tokenResponse.status}`);
  const token = await tokenResponse.json();
  if (!token.access_token || !String(token.scope).includes('team:write')) throw new Error('token scope invalid');
  const call = async (name, args, { allowError = false } = {}) => {
    const response = await fetch(endpoint, { method: 'POST', headers: {
      authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    const raw = await response.text();
    const line = raw.split('\n').find((s) => s.startsWith('data: '));
    const rpc = JSON.parse(line ? line.slice(6) : raw);
    if (rpc.result?.isError && !allowError) throw new Error(`${name} MCP error`);
    return { isError: Boolean(rpc.result?.isError), data: JSON.parse(rpc.result.content[0].text) };
  };
  const denyTeamId = process.env.RUFLO_AI_TEAM_E2E_DENY_TEAM_ID;
  if (denyTeamId) {
    if (!/^team_[0-9a-f-]{36}$/.test(denyTeamId)) throw new Error('denial team id invalid');
    const denied = await call('team_get', { teamId: denyTeamId }, { allowError: true });
    if (!denied.isError || denied.data.error !== 'not_found') {
      console.error(JSON.stringify({ crossWorkspaceDenied: false, isError: denied.isError,
        errorCode: typeof denied.data.error === 'string' ? denied.data.error : null,
        firstTeamVisible: denied.data.id === denyTeamId }));
      throw new Error('cross-workspace team denial failed');
    }
  }
  const { data: team } = await call('team_create', { name: `Edge canary ${new Date().toISOString().slice(0, 10)}`,
    objective: 'Verify tenant-scoped edge memory indexing and retrieval.' });
  if (!team.id) throw new Error('team create missing id');
  const unique = `Canary ruvector memory ${randomUUID()} blue lighthouse`;
  const { data: remembered } = await call('memory_remember', { teamId: team.id, key: `edge-${randomUUID()}`, text: unique });
  if (remembered.edgeIndex !== 'indexed') throw new Error(`edge indexing ${remembered.edgeIndex}:${remembered.reason || ''}`);
  const { data: fenced } = await call('memory_search', { teamId: team.id, query: 'blue lighthouse', limit: 5 });
  const match = fenced.data.match(/^BEGIN_UNTRUSTED_[^\n]+\n([\s\S]+)\nEND_UNTRUSTED_/);
  if (!match) throw new Error('search fence missing');
  const search = JSON.parse(match[1]);
  if (search.edgeStatus !== 'active' || search.backend !== 'ruvector-edge-hybrid'
    || !search.results.some((r) => r.memory.id === remembered.id)) throw new Error('edge retrieval failed');
  console.log(JSON.stringify({ ok: true, endpoint, crossWorkspaceDenied: Boolean(denyTeamId), teamId: team.id, edgeIndex: remembered.edgeIndex,
    backend: search.backend, edgeStatus: search.edgeStatus, resultCount: search.results.length }));
} finally {
  clearTimeout(loginTimer);
  server.close();
}
