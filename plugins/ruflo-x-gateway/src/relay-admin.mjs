import { finalizeEvent } from 'nostr-tools/pure';
import { createHash, randomUUID } from 'node:crypto';
import { connectAuthed } from './nostr-federation.mjs';
function nip98(sk, url, method, body) {
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method], ['nonce', randomUUID()], ...(body ? [['payload', createHash('sha256').update(body).digest('hex')]] : [])], content: '' }, sk);
  return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
}
// Mint a v2 invite (caller must be relay admin/owner). Returns {code, expires_at, max_uses}.
// Single use by default (#5029): an invite is a bearer credential, and a leaked
// multi-use code admits every holder until it expires. Ask for more uses explicitly.
export const DEFAULT_INVITE_MAX_USES = 1;
export async function mintInvite(httpBase, sk, { ttlSecs = 7 * 86400, maxUses = DEFAULT_INVITE_MAX_USES } = {}) {
  const url = `${httpBase}/api/invites`, body = JSON.stringify({ ttl_secs: ttlSecs, max_uses: maxUses });
  const r = await fetch(url, { method: 'POST', headers: { Authorization: nip98(sk, url, 'POST', body), 'Content-Type': 'application/json' }, body });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || j.message || `mint failed ${r.status}`); return j;
}

// Revoke a v2 invite by `id` (uuid) or `code`. The relay decides admission, so
// revocation lives there: buzz-relay `POST /api/invites/revoke` (block/buzz#9680,
// NIP-98 signed with a payload tag) marks the row revoked and claim refuses it.
// A relay build that predates that route answers a bare 404; that is reported as
// "unsupported", distinct from the route's own JSON `invite_not_found`.
// Error text is fixed and never echoes the code, which is a bearer secret.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const V2_CODE_RE = /^v2\.[A-Za-z0-9_-]{8,256}$/;
export async function revokeInvite(httpBase, sk, { id, code } = {}) {
  if ((id === undefined) === (code === undefined)) throw new Error('exactly one of id or code is required');
  if (id !== undefined && !UUID_RE.test(String(id))) throw new Error('id must be an invite uuid');
  if (code !== undefined && !V2_CODE_RE.test(String(code))) throw new Error('code must be a v2 invite code (v1 codes cannot be revoked)');
  const url = `${httpBase}/api/invites/revoke`;
  const body = JSON.stringify(id !== undefined ? { id: String(id).toLowerCase() } : { code: String(code) });
  const r = await fetch(url, { method: 'POST', headers: { Authorization: nip98(sk, url, 'POST', body), 'Content-Type': 'application/json' },
    body, redirect: 'error', signal: AbortSignal.timeout(10000) });
  let j = null; try { j = await r.json(); } catch {}
  if (r.ok && j && typeof j.id === 'string' && Number.isSafeInteger(j.revoked_at)) return { revoked: true, id: j.id, revoked_at: j.revoked_at };
  if (r.status === 404 && j?.error === 'invite_not_found') throw new Error('invite not found');
  if (r.status === 404 || r.status === 405) throw new Error('the relay does not support invite revocation yet (POST /api/invites/revoke is missing; upgrade buzz-relay to a build with block/buzz#9680)');
  const reason = typeof j?.error === 'string' && /^[\w .,'-]{1,120}$/.test(j.error) ? j.error : `status ${r.status}`;
  throw new Error(`revoke failed: ${reason}`);
}
// Admit a pubkey as member via NIP-43 kind 9030 (caller must be admin/owner).
export async function admitMember(relayUrl, sk, pubkey, role = 'member') {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error('pubkey must be 64 hex');
  if (!['member', 'admin'].includes(role)) throw new Error('role must be member|admin');
  const ws = await connectAuthed(relayUrl, sk);
  const ev = finalizeEvent({ kind: 9030, created_at: Math.floor(Date.now() / 1000), tags: [['p', pubkey], ['role', role]], content: '' }, sk);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { ws.close(); } catch {}
      error ? reject(error) : resolve({ pubkey, role });
    };
    const timer = setTimeout(() => finish(new Error('admit timeout')), 15000);
    ws.on('message', d => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (Array.isArray(m) && m[0] === 'OK' && m[1] === ev.id) finish(m[2] === true ? null : new Error('admit rejected'));
    });
    ws.on('error', () => finish(new Error('admit connection error')));
    ws.on('close', () => finish(new Error('closed before admission acknowledgment')));
    ws.send(JSON.stringify(['EVENT', ev]));
  });
}

// Read live durable restrictions before each new automatic grant. The relay
// remains authoritative for bans created after the initial import as well.
export async function isMemberBanned(httpBase, sk, pubkey) {
  const url = `${httpBase}/moderation/restricted`;
  const r = await fetch(url, { headers: { Authorization: nip98(sk, url, 'GET') },
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('relay restrictions unavailable');
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.some(x => !x || typeof x.pubkey !== 'string' || typeof x.banned !== 'boolean')) throw new Error('invalid relay restrictions');
  return rows.some(x => x.pubkey === pubkey && x.banned);
}
