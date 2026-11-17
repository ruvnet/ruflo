/**
 * Self-service federation join with a local key: public registration or a private invite.
 *
 * Decentralized by design: the user generates/holds THEIR OWN Nostr key locally,
 * registers with a NIP-98-signed request (no admin in the user flow), proves
 * membership with NIP-42, and announces themselves. The gateway never signs for them.
 *
 * `nostr-tools` is an optional dependency (secp256k1/Schnorr is not in node:crypto):
 * when absent the tool degrades with an install hint instead of throwing at load.
 */
import type { MCPTool } from './types.js';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';

// Host configuration precedes defaults. Caller key overrides stay under ~/.ruflo;
// a caller relayWs must match the configured relay. relayHttp keeps ADR-125 precedence.
const HTTP_BASE = (o?: string) => (o || process.env.RUFLO_X_RELAY_HTTP || 'https://relay.ruv.io').replace(/\/$/, '');
const RELAY_WS = (o?: string) => o || process.env.RUFLO_X_RELAY_WS || 'wss://relay.ruv.io';
const KEY_FILE = () => process.env.RUFLO_NOSTR_KEY_FILE || join(homedir(), '.ruflo', 'nostr.key');
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));

function callerKeyFile(value: unknown): string {
  // Host configuration is trusted; an MCP argument cannot select a different host file.
  if (value === undefined) return KEY_FILE();
  if (typeof value !== 'string' || !value) throw new Error('keyFile must name a file under ~/.ruflo');
  const root = resolve(homedir(), '.ruflo');
  const target = resolve(value);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('keyFile must name a file under ~/.ruflo');
  }
  for (let current = target; ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('keyFile must not follow symlinks');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (relative(root, current) === '') break;
  }
  return target;
}

function configuredRelay(value: unknown): string {
  const configured = new URL(RELAY_WS());
  if (value !== undefined && typeof value !== 'string') throw new Error('relayWs must be the configured relay URL');
  const requested = new URL(value === undefined ? configured.href : value as string);
  const localTestRelay = Boolean(process.env.RUFLO_X_RELAY_WS)
    && configured.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname);
  if ((!localTestRelay && configured.protocol !== 'wss:') || requested.href !== configured.href
      || requested.username || requested.password || requested.hash) {
    throw new Error('relayWs must use wss and match the configured relay (explicit loopback ws configuration is allowed)');
  }
  return requested.href;
}

type NostrTools = { generateSecretKey: () => Uint8Array; getPublicKey: (sk: Uint8Array) => string; finalizeEvent: (t: Record<string, unknown>, sk: Uint8Array) => Record<string, unknown> & { id: string } };
async function loadNostrTools(): Promise<NostrTools | null> {
  try { return (await import('nostr-tools/pure')) as unknown as NostrTools; } catch { return null; }
}
export function loadOrCreateKey(nt: NostrTools, file = KEY_FILE()): { sk: Uint8Array; pubkey: string; created: boolean } {
  if (existsSync(file)) { const sk = unhex(readFileSync(file, 'utf8').trim()); return { sk, pubkey: nt.getPublicKey(sk), created: false }; }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const sk = nt.generateSecretKey(); writeFileSync(file, hex(sk), { mode: 0o600, flag: 'wx' });
  return { sk, pubkey: nt.getPublicKey(sk), created: true };
}
export function nip98Header(nt: NostrTools, sk: Uint8Array, url: string, method: string, body?: string): string {
  const ev = nt.finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method], ...(body ? [['payload', createHash('sha256').update(body).digest('hex')]] : [])], content: '' }, sk);
  return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
}
// NIP-42: connect, answer the challenge, resolve true/false (never throws on refusal).
export async function verifyMembership(nt: NostrTools, sk: Uint8Array, relayWs: string): Promise<{ ok: boolean; reason?: string }> {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve) => {
    const ws = new WebSocket(relayWs, { perMessageDeflate: false, maxPayload: 64 * 1024 });
    let done = false, authId: string | undefined;
    const fin = (r: { ok: boolean; reason?: string }) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* */ } resolve(r); };
    const timer = setTimeout(() => fin({ ok: false, reason: 'timeout' }), 15000);
    ws.on('message', (d: Buffer) => {
      let m: any; try { m = JSON.parse(d.toString()); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === 'AUTH' && typeof m[1] === 'string' && m[1].length <= 1024 && !authId) {
        const ev = nt.finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', relayWs], ['challenge', m[1]]], content: '' }, sk);
        authId = ev.id; ws.send(JSON.stringify(['AUTH', ev]));
      } else if (m[0] === 'OK' && authId && m[1] === authId) fin({ ok: m[2] === true, reason: m[3] });
    });
    ws.on('error', (e: Error) => fin({ ok: false, reason: e.message }));
    ws.on('close', () => fin({ ok: false, reason: 'closed before authentication' }));
  });
}

function secureBase(value: string): string {
  const u = new URL(value);
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))
      || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('gateway must be an HTTPS origin (HTTP allowed only for loopback tests)');
  return u.origin;
}

export const xFederationJoinTools: MCPTool[] = [{
  name: 'x_federation_join',
  description:
    'Join the federation with YOUR OWN local key, without an invite when public registration is enabled. Reuses ~/.ruflo/nostr.key (0600), proves key ownership with NIP-98, and verifies membership with NIP-42. Use when a user wants to join as themselves. Publishing as the gateway is wrong for personal identity. Optional private invite codes remain supported; never share keys or codes in chat.',
  inputSchema: { type: 'object', properties: {
    code: { type: 'string', description: 'Optional private invite code (v2.…), for invite-only relays.' },
    gatewayUrl: { type: 'string', description: 'Public registration gateway origin; defaults to https://x.ruv.io.' },
    relayHttp: { type: 'string', description: 'Relay HTTPS base for the claim; takes precedence over RUFLO_X_RELAY_HTTP.' },
    relayWs: { type: 'string', description: 'Relay wss URL for NIP-42; must match RUFLO_X_RELAY_WS or the default relay.' },
    keyFile: { type: 'string', description: 'Caller-selected file under ~/.ruflo (no symlinks). Omit to use host RUFLO_NOSTR_KEY_FILE or ~/.ruflo/nostr.key.' } }, required: [] },
  handler: async (input) => {
    const i = input as { code?: string; gatewayUrl?: string; relayHttp?: string; relayWs?: string; keyFile?: string };
    // Validate input before the optional-dependency check so a bad code fails fast and identically
    // whether or not nostr-tools is present.
    if (i.code !== undefined && !/^v2\.[A-Za-z0-9._-]{8,}$/.test(i.code)) throw new Error('invite code must look like v2.<token>');
    const registrationBase = i.code ? undefined : secureBase(i.gatewayUrl || process.env.RUFLO_X_GATEWAY_URL || 'https://x.ruv.io');
    const keyFile = callerKeyFile(i.keyFile);
    const relayWs = configuredRelay(i.relayWs);
    const nt = await loadNostrTools();
    if (!nt) return { degraded: true, reason: 'nostr-tools not installed', hint: 'npm i -g nostr-tools  (secp256k1 signing is not in node:crypto)' };
    const { sk, pubkey, created } = loadOrCreateKey(nt, keyFile);
    // Existing members need no new grant. In particular never downgrade/re-admit
    // their key just because they run join again.
    if (!i.code) {
      const existing = await verifyMembership(nt, sk, relayWs);
      if (existing.ok) return { ok: true, pubkey, keyCreated: created, membershipVerified: true, alreadyMember: true };
    }
    const url = i.code ? `${secureBase(HTTP_BASE(i.relayHttp))}/api/invites/claim` : `${registrationBase}/api/registration`;
    const body = i.code ? JSON.stringify({ code: i.code }) : '{}';
    let r: Response;
    try {
      r = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: nip98Header(nt, sk, url, 'POST', body), 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(20_000) });
    } catch {
      const check = await verifyMembership(nt, sk, relayWs);
      if (check.ok) return { ok: true, pubkey, keyCreated: created, membershipVerified: true };
      throw new Error('Admission response unavailable and relay membership unverified. Keep your local key and retry; do not create another identity.');
    }
    const claim = (await r.json().catch(() => ({}))) as { role?: string; error?: string; message?: string };
    if (!r.ok) {
      // A lost acknowledgment can follow a successful grant. Check with the
      // relay before declaring failure; never silently generate a second key.
      const check = await verifyMembership(nt, sk, relayWs);
      if (check.ok) return { ok: true, pubkey, keyCreated: created, membershipVerified: true };
      throw new Error(`join rejected (${r.status}): ${claim.error ?? claim.message ?? 'unknown'}`);
    }
    const auth = await verifyMembership(nt, sk, relayWs);
    return { ok: auth.ok, pubkey, keyCreated: created, role: claim.role ?? 'member', membershipVerified: auth.ok, ...(auth.ok ? {} : { reason: auth.reason }),
      next: 'Publish kind-1 events tagged ["t","ruflo-swarm"] — or run `ruflo federation sync` to read the swarm.' };
  },
}];
