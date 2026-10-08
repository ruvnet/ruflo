/** Transport-independent device end of the signed channel: emits signed frames, verifies and executes server frames. */
import { arch, platform } from 'node:os';
import {
  authorize, CommandBodySchema, MAX_ENVELOPE_BYTES, parseCommand, ReplayGuard, sanitize, signEnvelope, verifyEnvelope, COMMANDS,
  type CommandName, type Digest, type Envelope,
} from './protocol/index.js';
import { printable, type Approver } from './approver.js';
import { EXECUTORS } from './executors.js';
import type { Ruflo } from './exec.js';
import { saveServerSeq, wipeState, type AuditLog, type Config, type DeviceSeq } from './state.js';

export const MAX_COMMAND_LIFETIME_MS = 15 * 60_000;
export const CONNECTOR_VERSION = '1';

export interface ChannelDeps {
  cfg: Config; privateKey: string; home: string; seq: DeviceSeq; guard: ReplayGuard; audit: AuditLog;
  ruflo: Ruflo; approver: Approver; send: (frame: string) => void; collect: () => Promise<Digest>;
  rufloVersion?: string; now?: () => number; onRevoke?: () => void;
}
export type FrameOutcome = 'ok' | 'rejected' | 'revoked' | 'ignored';
type Status = 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'denied' | 'expired';

export class Channel {
  private queue: Promise<unknown> = Promise.resolve();
  private publishing: Promise<void> | null = null;
  private now: () => number;
  constructor(private d: ChannelDeps) { this.now = d.now ?? Date.now; }

  /** Sign and send one device->server frame. Body is sanitized (control chars stripped, secrets masked) first. */
  emit(typ: 'hello' | 'digest' | 'ack' | 'result' | 'ping' | 'revoke', body: Record<string, unknown>): Envelope {
    const env = signEnvelope(this.d.privateKey, { typ, did: this.d.cfg.deviceId, tid: this.d.cfg.tenantId, seq: this.d.seq.take(), body: sanitize(body) }, this.now());
    const frame = JSON.stringify(env);
    if (Buffer.byteLength(frame) > MAX_ENVELOPE_BYTES) throw new Error('frame exceeds size cap');
    this.d.send(frame);
    return env;
  }

  hello(): void {
    this.emit('hello', { connector: CONNECTOR_VERSION, rufloVersion: this.d.rufloVersion ?? 'unknown', platform: `${platform()}-${arch()}`, level: this.d.cfg.level, name: this.d.cfg.name });
    this.d.audit.write('hello', { deviceId: this.d.cfg.deviceId, level: this.d.cfg.level });
  }

  /** Collect and publish a digest. Concurrent calls share one collection. */
  publish(): Promise<void> {
    this.publishing ??= (async () => {
      try {
        const digest = await this.d.collect();
        const env = this.emit('digest', { digest });
        this.d.audit.write('publish', { typ: 'digest', seq: env.seq, missions: digest.missions.length, adrs: digest.adrs.length, agents: digest.swarm?.agents.length ?? 0, healthOk: digest.health.ok, notes: digest.health.notes.length });
      } finally { this.publishing = null; }
    })();
    return this.publishing;
  }

  /** Handle one raw server frame. Never throws. */
  async onFrame(raw: string): Promise<FrameOutcome> {
    const v = verifyEnvelope(raw, this.d.cfg.serverPublicKey, { did: this.d.cfg.deviceId, tid: this.d.cfg.tenantId }, this.d.guard, this.now());
    if (!v.ok) { this.d.audit.write('frame_rejected', { reason: v.reason }); return 'rejected'; }
    try { saveServerSeq(this.d.home, v.env.seq); } catch { /* best effort; the in-memory guard still protects this process */ }
    switch (v.env.typ) {
      case 'revoke':
        this.d.audit.write('revoked_by_server', { deviceId: this.d.cfg.deviceId });
        wipeState(this.d.home); this.d.onRevoke?.();
        return 'revoked';
      case 'command':
        this.queue = this.queue.then(() => this.runCommand(v.env)).catch(() => undefined);
        return 'ok';
      case 'ping': return 'ok';
      default: this.d.audit.write('frame_ignored', { typ: v.env.typ }); return 'ignored';
    }
  }

  /** Resolves when all queued commands have finished (tests, shutdown). */
  idle(): Promise<unknown> { return this.queue; }

  private report(cid: string, status: Status, extra: Record<string, unknown> = {}): void {
    const terminal = status === 'succeeded' || status === 'failed' || status === 'denied' || status === 'expired';
    this.emit(terminal ? 'result' : 'ack', { cid, status, ...extra });
  }

  private async runCommand(env: Envelope): Promise<void> {
    const b = CommandBodySchema.safeParse(env.body);
    if (!b.success) { this.d.audit.write('command_rejected', { reason: 'malformed_command' }); return; }
    const { cid, cmd, by } = b.data;
    const base = { cid, cmd: printable(cmd, 40), by: printable(by, 80) };
    const deny = (status: Status, reason: string) => { this.d.audit.write('command', { ...base, decision: status, reason }); this.report(cid, status, { error: reason }); };
    if (this.now() > b.data.expiresAt) return deny('expired', 'command_expired');
    if (b.data.expiresAt > env.ts + MAX_COMMAND_LIFETIME_MS) return deny('denied', 'expiry_too_far');
    const p = parseCommand(cmd, b.data.args);
    if (!p.ok) return deny('denied', p.reason);
    const auth = authorize(p.cmd, this.d.cfg.level, this.d.cfg.autoApprove);
    if (!auth.allowed) return deny('denied', auth.reason ?? 'not_allowed');
    if (auth.needsApproval) {
      this.report(cid, 'awaiting_approval');
      this.d.audit.write('command', { ...base, decision: 'awaiting_approval', args: p.args });
      let ok = false;
      try { ok = await this.d.approver({ cid, cmd: p.cmd, summary: COMMANDS[p.cmd].summary, level: p.level, args: p.args, by: base.by }); } catch { ok = false; }
      if (!ok) return deny('denied', 'approval_denied');
      if (this.now() > b.data.expiresAt) return deny('expired', 'command_expired_during_approval');
    }
    this.report(cid, 'running');
    this.d.audit.write('command', { ...base, decision: auth.needsApproval ? 'approved' : 'auto', args: p.args });
    try {
      const r = await EXECUTORS[p.cmd as CommandName](p.args, { ruflo: this.d.ruflo, cid, publishNow: () => this.publish() });
      this.d.audit.write('command_result', { cid, ok: r.ok });
      if (r.ok) this.report(cid, 'succeeded', { result: r.result }); else this.report(cid, 'failed', { error: r.error });
    } catch (e) {
      const msg = printable(String((e as Error)?.message ?? 'error'), 200);
      this.d.audit.write('command_result', { cid, ok: false, error: msg });
      this.report(cid, 'failed', { error: msg });
    }
  }
}
