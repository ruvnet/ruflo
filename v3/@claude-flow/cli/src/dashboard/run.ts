/** Outbound-only wss session loop: hello, periodic digests, server frames, jittered reconnect, clean shutdown. */
import { resolve as resolvePath } from 'node:path';
import WebSocket from 'ws';
import { ReplayGuard } from './protocol/index.js';
import { ttyApprover, type Approver } from './approver.js';
import { Channel } from './channel.js';
import { collectDigest } from './collectors.js';
import { resolveRufloCommand, RufloClient, type Ruflo } from './exec.js';
import { AuditLog, DeviceSeq, loadConfig, loadKey, loadServerSeq, normalizeBaseUrl, StateError, type Config } from './state.js';

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;
export const DIGEST_INTERVAL_MS = 10_000;
export const STABLE_AFTER_MS = 30_000;

/** Exponential 1s..60s with up-to-25% positive jitter (never below 1s, never above 60s). */
export function backoffDelay(attempt: number, rnd: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt));
  return Math.min(BACKOFF_MAX_MS, Math.round(base * (1 + 0.25 * rnd())));
}

/** The connect URL must be wss (ws only for loopback) and on the same host as the paired base URL. */
export function validateConnectUrl(connectUrl: string, baseUrl: string): string {
  let u: URL;
  try { u = new URL(connectUrl); } catch { throw new StateError('bad_url', 'connect URL is invalid'); }
  const base = new URL(normalizeBaseUrl(baseUrl));
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && loopback)) throw new StateError('insecure_url', 'connect URL must be wss');
  if (u.host !== base.host) throw new StateError('bad_url', 'connect URL host differs from the paired dashboard host');
  return u.toString();
}

export interface RunOptions {
  home: string; projectDir?: string; ruflo?: Ruflo; approver?: Approver; intervalMs?: number; signal?: AbortSignal;
  log?: (line: string) => void; random?: () => number; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export type RunEnd = 'stopped' | 'revoked';

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>(res => {
  const t = setTimeout(done, ms); function done() { clearTimeout(t); signal?.removeEventListener('abort', done); res(); }
  signal?.addEventListener('abort', done, { once: true });
});

/** Refuses to start unless linked, enabled and level != off. */
export function loadRunnable(home: string): { cfg: Config; privateKey: string } {
  const cfg = loadConfig(home);
  if (!cfg) throw new StateError('not_linked', 'not linked: run `ruflo dashboard link --url <dashboard>` first');
  if (!cfg.enabled) throw new StateError('disabled', 'dashboard connector is disabled: run `ruflo dashboard enable`');
  if (cfg.level === 'off') throw new StateError('level_off', 'control level is "off"; raise it with `ruflo dashboard set --level read`');
  return { cfg, privateKey: loadKey(home) };
}

export async function runConnector(o: RunOptions): Promise<RunEnd> {
  const log = o.log ?? (() => undefined);
  const { cfg, privateKey } = loadRunnable(o.home);
  const url = validateConnectUrl(cfg.connectUrl, cfg.baseUrl);
  const projectDir = resolvePath(o.projectDir ?? cfg.projectDir ?? process.cwd());
  const ruflo = o.ruflo ?? new RufloClient(resolveRufloCommand(cfg.rufloCommand), projectDir);
  const approver = o.approver ?? ttyApprover();
  const audit = new AuditLog(o.home, o.now);
  const seq = new DeviceSeq(o.home);
  const guard = new ReplayGuard();
  guard.setLastSeq(cfg.deviceId, loadServerSeq(o.home));
  const sleep = o.sleep ?? defaultSleep;
  let attempt = 0;
  audit.write('run_start', { deviceId: cfg.deviceId, level: cfg.level, autoApprove: cfg.autoApprove });

  while (!o.signal?.aborted) {
    const started = Date.now();
    let end: RunEnd | 'closed';
    try { end = await session(); } catch (e) { log(`connection error: ${(e as Error).message}`); end = 'closed'; }
    if (end === 'revoked') { audit.write('run_end', { reason: 'revoked' }); return 'revoked'; }
    if (o.signal?.aborted) break;
    if (Date.now() - started > STABLE_AFTER_MS) attempt = 0;
    const delay = backoffDelay(attempt++, o.random);
    log(`disconnected; reconnecting in ${delay} ms`);
    await sleep(delay, o.signal);
  }
  audit.write('run_end', { reason: 'stopped' });
  return 'stopped';

  function session(): Promise<RunEnd | 'closed'> {
    return new Promise(resolve => {
      const ws = new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 512 * 1024, followRedirects: false });
      let timer: NodeJS.Timeout | undefined, alive = true, revoked = false, settled = false;
      const settle = (r: RunEnd | 'closed') => { if (settled) return; settled = true; clearInterval(timer); o.signal?.removeEventListener('abort', onAbort); try { ws.terminate(); } catch { /* closed */ } resolve(r); };
      const onAbort = () => { try { ws.close(1001, 'shutdown'); } catch { /* closed */ } setTimeout(() => settle('closed'), 1500).unref(); };
      const ch = new Channel({
        cfg, privateKey, home: o.home, seq, guard, audit, ruflo, approver, now: o.now,
        send: f => { if (ws.readyState === WebSocket.OPEN) ws.send(f); },
        collect: () => collectDigest({ ruflo, projectDir, level: cfg.level, now: o.now }),
        onRevoke: () => { revoked = true; },
      });
      o.signal?.addEventListener('abort', onAbort, { once: true });
      ws.on('open', () => {
        log('connected');
        try { ch.hello(); void ch.publish().catch(e => log(`digest failed: ${(e as Error).message}`)); } catch (e) { log(`hello failed: ${(e as Error).message}`); }
        timer = setInterval(() => {
          if (!alive) return void ws.terminate();
          alive = false; ws.ping();
          void ch.publish().catch(e => log(`digest failed: ${(e as Error).message}`));
        }, o.intervalMs ?? DIGEST_INTERVAL_MS);
        timer.unref?.();
      });
      ws.on('pong', () => { alive = true; });
      ws.on('message', async data => {
        alive = true;
        const out = await ch.onFrame(data.toString('utf8'));
        if (out === 'revoked') settle('revoked');
      });
      ws.on('unexpected-response', (_req, res) => { log(`server refused connection (${res.statusCode})`); settle('closed'); });
      ws.on('error', e => log(`socket error: ${e.message}`));
      ws.on('close', () => { void ch.idle().finally(() => settle(revoked ? 'revoked' : 'closed')); });
    });
  }
}
