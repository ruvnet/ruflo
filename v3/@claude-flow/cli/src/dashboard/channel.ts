/** Transport-independent device end of the signed channel: emits signed frames, verifies and executes server frames. */
import { arch, platform } from 'node:os';
import {
  authorize, CommandBodySchema, fingerprint, MAX_ENVELOPE_BYTES, parseCommand, ReplayGuard, sanitize, signEnvelope, verifyEnvelope, COMMANDS,
  parseWatch, SECTION_VERSIONS, type CommandName, type Envelope, type SectionFrame, type SectionName,
} from './protocol/index.js';
import { hasLongText, printable, type Approver } from './approver.js';
import { EXECUTORS } from './executors.js';
import type { Ruflo } from './exec.js';
import { saveServerSeq, wipeState, type AuditLog, type Config, type DeviceSeq } from './state.js';

export const MAX_COMMAND_LIFETIME_MS = 15 * 60_000;
export const CONNECTOR_VERSION = '1';
/** Only these write-level commands may skip the local prompt under autoApprove. mission.create never may: its text can steer a later agent. */
export const AUTO_APPROVABLE: readonly CommandName[] = ['mission.pause', 'mission.resume'];

export interface ChannelDeps {
  cfg: Config; privateKey: string; home: string; seq: DeviceSeq; guard: ReplayGuard; audit: AuditLog;
  ruflo: Ruflo; approver: Approver; send: (frame: string) => void; sections: SectionPort;
  rufloVersion?: string; now?: () => number; onRevoke?: () => void;
}
/** What the channel needs from the section scheduler (kept narrow so tests can stub it). */
export interface SectionPort {
  tick(): Promise<{ collected: SectionName[]; sent: SectionName[] }>;
  refresh(name: SectionName): Promise<{ sent: boolean; rateLimited?: boolean }>;
  refreshAll(): Promise<{ sent: SectionName[]; rateLimited?: boolean }>;
  setWatch(list: readonly SectionName[]): void;
  notice(level: 'info' | 'warn' | 'error', text: string, key: string): void;
}
export type FrameOutcome = 'ok' | 'rejected' | 'revoked' | 'ignored';
type Status = 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'denied' | 'expired';

export class Channel {
  private queue: Promise<unknown> = Promise.resolve();
  private publishing: Promise<void> | null = null;
  private waiting = new Map<string, { cid: string; cmd: string; since: number }>();
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
    this.emit('hello', { connector: CONNECTOR_VERSION, sections: SECTION_VERSIONS, rufloVersion: this.d.rufloVersion ?? 'unknown', platform: `${platform()}-${arch()}`, level: this.d.cfg.level, name: this.d.cfg.name });
    this.d.audit.write('hello', { deviceId: this.d.cfg.deviceId, level: this.d.cfg.level });
  }

  /** Send one section frame (typ 'digest', body = SectionFrame). */
  emitSection(frame: SectionFrame): void {
    const env = this.emit('digest', frame as unknown as Record<string, unknown>);
    this.d.audit.write('publish', { typ: 'digest', section: frame.section, rev: frame.rev, seq: env.seq, truncated: frame.truncated });
  }

  /** Run one scheduling pass (collect what is due, send what changed). Concurrent calls share one pass. */
  publish(): Promise<void> {
    this.publishing ??= (async () => { try { await this.d.sections.tick(); } finally { this.publishing = null; } })();
    return this.publishing;
  }

  /** Commands waiting for a local answer (read by the approvals section). */
  pending(): { cid: string; cmd: string; since: number }[] { return [...this.waiting.values()]; }

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
      case 'ping': {
        if (Array.isArray((v.env.body as { watch?: unknown }).watch)) this.d.sections.setWatch(parseWatch(v.env.body));
        return 'ok';
      }
      default: this.d.audit.write('frame_ignored', { typ: v.env.typ }); return 'ignored';
    }
  }

  /** Resolves when all queued commands have finished (tests, shutdown). */
  idle(): Promise<unknown> { return this.queue; }

  /** Wire shapes follow the server: ack {cid,status: awaiting_approval|running|denied}, result {cid, ok, result?, error?}. */
  private report(cid: string, status: Status, extra: Record<string, unknown> = {}): void {
    if (status === 'awaiting_approval' || status === 'running' || status === 'denied') this.emit('ack', { cid, status, ...extra });
    else this.emit('result', { cid, ok: status === 'succeeded', ...extra });
  }

  private async runCommand(env: Envelope): Promise<void> {
    const b = CommandBodySchema.safeParse(env.body);
    if (!b.success) { this.d.audit.write('command_rejected', { reason: 'malformed_command' }); return; }
    const { cid, cmd, by } = b.data;
    const base = { cid, cmd: printable(cmd, 40), by: printable(by, 80) };
    const deny = (status: Status, reason: string) => { this.waiting.delete(cid); this.d.sections.notice('info', `${base.cmd} ${status}: ${reason}`, `cmd:${cid}`); this.d.audit.write('command', { ...base, decision: status, reason }); this.report(cid, status, { error: reason }); };
    if (this.now() > b.data.expiresAt) return deny('expired', 'command_expired');
    if (b.data.expiresAt > env.ts + MAX_COMMAND_LIFETIME_MS) return deny('denied', 'expiry_too_far');
    const p = parseCommand(cmd, b.data.args);
    if (!p.ok) return deny('denied', p.reason);
    const auth = authorize(p.cmd, this.d.cfg.level, this.d.cfg.autoApprove);
    if (!auth.allowed) return deny('denied', auth.reason ?? 'not_allowed');
    const needsApproval = auth.needsApproval || (COMMANDS[p.cmd].level !== 'read' && !AUTO_APPROVABLE.includes(p.cmd));
    if (needsApproval) {
      this.report(cid, 'awaiting_approval'); this.waiting.set(cid, { cid, cmd: p.cmd, since: this.now() });
      this.d.audit.write('command', { ...base, decision: 'awaiting_approval', args: p.args });
      let ok = false;
      try { ok = await this.d.approver({ cid, cmd: p.cmd, summary: COMMANDS[p.cmd].summary, level: p.level, args: p.args, by: base.by, baseUrl: this.d.cfg.baseUrl, serverFingerprint: fingerprint(this.d.cfg.serverPublicKey), long: hasLongText(p.args) }); } catch { ok = false; }
      this.waiting.delete(cid);
      if (!ok) return deny('denied', 'approval_denied');
      if (this.now() > b.data.expiresAt) return deny('expired', 'command_expired_during_approval');
    }
    this.report(cid, 'running');
    this.d.audit.write('command', { ...base, decision: needsApproval ? 'approved' : 'auto', args: p.args });
    try {
      const r = await EXECUTORS[p.cmd as CommandName](p.args, { ruflo: this.d.ruflo, cid, refreshAll: () => this.d.sections.refreshAll(), refreshSection: n => this.d.sections.refresh(n) });
      this.d.audit.write('command_result', { cid, ok: r.ok });
      this.d.sections.notice(r.ok ? 'info' : 'warn', `${base.cmd} ${r.ok ? 'succeeded' : `failed: ${r.error}`}`, `cmd:${cid}`);
      if (r.ok) this.report(cid, 'succeeded', { result: r.result }); else this.report(cid, 'failed', { error: r.error });
    } catch (e) {
      const msg = printable(String((e as Error)?.message ?? 'error'), 200);
      this.d.audit.write('command_result', { cid, ok: false, error: msg });
      this.d.sections.notice('warn', `${base.cmd} failed: ${msg}`, `cmd:${cid}`);
      this.report(cid, 'failed', { error: msg });
    }
  }
}
