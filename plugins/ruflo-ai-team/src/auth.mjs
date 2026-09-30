import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const SCOPES = Object.freeze({ read: 'team:read', write: 'team:write', run: 'team:run' });

const cachedJwks = new Map();
const jwksFor = (uri) => {
  if (!cachedJwks.has(uri)) cachedJwks.set(uri, createRemoteJWKSet(new URL(uri)));
  return cachedJwks.get(uri);
};

export function protectedResourceMetadata({ resource, issuer, legacyIssuer }) {
  return {
    resource,
    authorization_servers: legacyIssuer ? [issuer, legacyIssuer] : [issuer],
    scopes_supported: Object.values(SCOPES),
    bearer_methods_supported: ['header'],
    resource_documentation: resource.replace(/\/mcp$/, '/'),
  };
}

export function challengeHeader(metadataUrl, { error, description, scope } = {}) {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`];
  if (error) parts.push(`error="${String(error).replace(/["\\]/g, '')}"`);
  if (description) parts.push(`error_description="${String(description).replace(/["\\]/g, '').slice(0, 180)}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return parts.join(', ');
}

function tokenFrom(req) {
  const raw = String(req?.headers?.authorization || '');
  if (raw.length > 8192) return { error: 'authorization header is too large' };
  if (raw.slice(0, 6).toLowerCase() !== 'bearer' || !/^\s/.test(raw.slice(6))) return {};
  const token = raw.slice(6).trim();
  return token ? { token } : {};
}

export function tenantIdFromClaims(payload, issuer) {
  // Edge tenancy is the verified (upstream issuer, org, workspace) tuple.
  // Hashing org_id alone would co-mingle two workspaces in Firestore.
  const edge = issuer === 'https://ruvector-edge-auth.cognitum-consulting-mail.workers.dev';
  const source = edge
    ? (payload.upstream_iss && payload.org_id && payload.workspace_id
      ? JSON.stringify([payload.upstream_iss, payload.org_id, payload.workspace_id]) : undefined)
    : (payload.tenant_id ?? payload.org_id ?? payload.workspace_id ?? payload.sub);
  if (!source) return undefined;
  return `t_${createHash('sha256').update(String(source)).digest('hex').slice(0, 24)}`;
}

export async function authenticate(req, config, verify = jwtVerify) {
  const parsed = tokenFrom(req);
  if (parsed.error) return { mode: 'denied', error: 'invalid_request', description: parsed.error };
  if (!parsed.token) return { mode: 'anonymous', scopes: [] };
  let verified;
  let lastError;
  for (const candidate of [{ issuer: config.issuer, jwksUri: config.jwksUri }, ...(config.legacyIssuer ? [{ issuer: config.legacyIssuer, jwksUri: config.legacyJwksUri }] : [])]) {
    try {
      const result = await verify(parsed.token, jwksFor(candidate.jwksUri), {
        issuer: candidate.issuer, audience: config.audience, clockTolerance: 30,
      });
      verified = { payload: result.payload, issuer: candidate.issuer };
      break;
    } catch (error) { lastError = error; }
  }
  if (!verified) return { mode: 'denied', error: 'invalid_token', description: String(lastError?.message || 'token verification failed').slice(0, 180) };
  try {
    const { payload, issuer } = verified;
    const tenantId = tenantIdFromClaims(payload, issuer);
    if (!tenantId) return { mode: 'denied', error: 'invalid_token', description: 'token has no tenant-bound subject' };
    const rawScopes = payload.scope ?? payload.scp ?? [];
    const scopes = Array.isArray(rawScopes) ? rawScopes.map(String) : String(rawScopes).split(/\s+/).filter(Boolean);
    return {
      mode: 'oauth', tenantId, scopes, issuer,
      subjectHash: createHash('sha256').update(String(payload.sub || '')).digest('hex').slice(0, 16),
      // Never returned by a tool or persisted; only the opt-in edge adapter
      // may exchange this audience-bound subject token for a /v1 token.
      bearerToken: parsed.token,
    };
  } catch { return { mode: 'denied', error: 'invalid_token', description: 'token claims invalid' }; }
}

export const hasScope = (auth, scope) => auth?.mode === 'oauth' && auth.scopes.includes(scope);
