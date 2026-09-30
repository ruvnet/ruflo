import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Manual, user-authorized first-use provisioning check. Never print tokens.
const ISSUER = 'https://ruvector-edge-auth.cognitum-consulting-mail.workers.dev';
const RESOURCE = 'https://ruvector-edge-gateway.cognitum-consulting-mail.workers.dev/v1';
const shouldClaim = process.env.RUFLO_AI_TEAM_E2E_CLAIM_EDGE === '1';
const checkRevocation = process.env.RUFLO_AI_TEAM_E2E_REVOKE_REFRESH === '1';
const scopes = `ruvector:read ruvector:write${checkRevocation ? ' offline_access' : ''}`;
const b64u = (value) => Buffer.from(value).toString('base64url');
const verifier = b64u(randomBytes(48));
const state = b64u(randomBytes(32));
const challenge = b64u(createHash('sha256').update(verifier).digest());
const metadataResponse = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`);
if (!metadataResponse.ok) throw new Error(`metadata ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
if (metadata.issuer !== ISSUER) throw new Error('issuer mismatch');

let resolveCode;
const codePromise = new Promise((resolve) => { resolveCode = resolve; });
let timer;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') return res.writeHead(404).end();
  const valid = url.searchParams.get('state') === state && !!url.searchParams.get('code');
  res.writeHead(valid ? 200 : 400, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
  res.end(valid ? 'Edge tenant check authorized. Return to Codex.' : 'Authorization failed. Return to Codex.');
  resolveCode(valid ? url.searchParams.get('code') : null);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirect = `http://127.0.0.1:${server.address().port}/callback`;

try {
  const registrationResponse = await fetch(metadata.registration_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirect], client_name: 'RuFlo AI Team Edge tenant validation',
      token_endpoint_auth_method: 'none', grant_types: checkRevocation ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
      response_types: ['code'], scope: scopes }),
  });
  if (!registrationResponse.ok) throw new Error(`registration ${registrationResponse.status}`);
  const registration = await registrationResponse.json();
  if (!registration.client_id || !String(registration.scope).includes('ruvector:write')) throw new Error('registration scope invalid');
  const authUrl = new URL(metadata.authorization_endpoint);
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: registration.client_id,
    redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state,
    resource: RESOURCE, scope: scopes })) authUrl.searchParams.set(key, value);
  console.log(`OPEN_FOR_USER_LOGIN ${authUrl}`);
  const code = await Promise.race([codePromise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('login timed out')), 600_000);
  })]);
  if (!code) throw new Error('OAuth callback invalid');
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registration.client_id,
      code, redirect_uri: redirect, code_verifier: verifier, resource: RESOURCE }),
  });
  if (!tokenResponse.ok) throw new Error(`token ${tokenResponse.status}`);
  const token = await tokenResponse.json();
  if (!token.access_token || !String(token.scope).includes('ruvector:write')) throw new Error('token scope invalid');
  const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  const { payload } = await jwtVerify(token.access_token, jwks, { issuer: ISSUER, audience: RESOURCE });
  if (!payload.org_id || !payload.workspace_id || payload.act) throw new Error('tenant claims invalid');
  const tenantFingerprint = createHash('sha256').update(`${payload.upstream_iss}|${payload.org_id}|${payload.workspace_id}`).digest('hex').slice(0, 16);
  const request = async (path, method = 'GET') => {
    const response = await fetch(`${RESOURCE}${path}`, { method,
      headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(8000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${path} ${response.status}:${body.code || 'unknown'}`);
    return body;
  };
  const before = await request('/me');
  if (before.org_id !== payload.org_id || before.workspace_id !== payload.workspace_id) throw new Error('me tenant mismatch');
  if (!before.claimed && !shouldClaim) {
    console.log(JSON.stringify({ tenantFingerprint, claimed: false, action: 'claim_not_authorized' }));
    process.exitCode = 2;
  } else {
    if (!before.claimed) await request('/tenant:claim', 'POST');
    const after = await request('/me');
    if (!after.claimed || after.role !== 'owner') throw new Error('tenant owner claim failed');
    const usage = await request('/usage');
    console.log(JSON.stringify({ tenantFingerprint, claimedBefore: before.claimed, claimedAfter: after.claimed,
      role: after.role, usage }));
    if (checkRevocation) {
      if (!token.refresh_token) throw new Error('offline_access did not return a refresh token');
      const revokeResponse = await fetch(metadata.revocation_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token.refresh_token, client_id: registration.client_id,
          token_type_hint: 'refresh_token' }),
      });
      if (revokeResponse.status !== 200) throw new Error(`revoke ${revokeResponse.status}`);
      const retryResponse = await fetch(metadata.token_endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.client_id,
          refresh_token: token.refresh_token, resource: RESOURCE }),
      });
      const retry = await retryResponse.json().catch(() => ({}));
      if (retryResponse.status !== 400 || retry.error !== 'invalid_grant') {
        throw new Error(`revoked refresh unexpectedly usable: ${retryResponse.status}:${retry.error || 'unknown'}`);
      }
      console.log(JSON.stringify({ refreshRevocation: 'passed', accessTokenRevocation: 'not_supported_jwt_expires' }));
    }
  }
} finally {
  clearTimeout(timer);
  server.close();
}
