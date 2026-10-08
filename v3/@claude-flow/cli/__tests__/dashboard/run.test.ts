import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DigestSchema, generateKeyPair, randomToken } from '../../src/dashboard/protocol/index.js';
import { backoffDelay, BACKOFF_MAX_MS, BACKOFF_MIN_MS, loadRunnable, validateConnectUrl } from '../../src/dashboard/run.js';
import { AUDIT_FILE, CONFIG_FILE, KEY_FILE, loadServerSeq } from '../../src/dashboard/state.js';
import { unlink } from '../../src/dashboard/unlink.js';
import { Rig } from './_support/harness.js';

let rig: Rig | undefined;
afterEach(async () => { await rig?.cleanup(); rig = undefined; });
const audit = (r: Rig) => readFileSync(join(r.home, AUDIT_FILE), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
const results = (r: Rig, cid: string) => r.srv.received.filter(e => (e.typ === 'ack' || e.typ === 'result') && e.body.cid === cid).map(e => e.typ === 'ack' ? e.body.status : e.body.ok ? 'succeeded' : /expired/.test(String(e.body.error)) ? 'expired' : 'failed');
const cmdBody = (frame: string) => (JSON.parse(frame) as { body: { cid: string } }).body.cid;
const HOSTILE = 'rm -' + 'rf /';

describe('hello + digest publication', () => {
  it('sends a signed hello then a schema-valid, masked digest, with increasing seq', async () => {
    rig = await Rig.create();
    const run = rig.start(undefined, 100);
    const hello = await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    expect(hello.body).toMatchObject({ connector: '1', level: 'read', name: 'test box' });
    const dig = await rig.srv.waitFor(() => rig!.srv.byTyp('digest')[1]); // second digest => periodic timer works
    expect(DigestSchema.safeParse(dig.body).success).toBe(true);
    const d = dig.body as { ruflo: { version: string }; missions: { objective: string }[]; tasks: { done: number }; swarm: { agents: unknown[] }; memory: { entries: number }; health: { ok: boolean } };
    expect(d.ruflo.version).toBe('3.55.0');
    expect(d.missions[0]!.objective).toContain('[masked]');
    expect(JSON.stringify(dig)).not.toContain('sk-abcdefghijklmnopqrstuv');
    expect(d.tasks.done).toBe(1); expect(d.swarm.agents).toHaveLength(1); expect(d.memory.entries).toBe(12); expect(d.health.ok).toBe(true);
    const seqs = rig.srv.received.map(e => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(rig.srv.rejected).toEqual([]);
    run.stop(); expect(await run.done).toBe('stopped');
    expect(audit(rig).some(a => a.kind === 'publish')).toBe(true);
  });

  it('keeps seq strictly increasing across a restart', async () => {
    rig = await Rig.create();
    let run = rig.start(); await rig.srv.waitFor(() => rig!.srv.byTyp('digest')[0]); run.stop(); await run.done;
    const before = Math.max(...rig.srv.received.map(e => e.seq));
    run = rig.start(); await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[1]); run.stop(); await run.done;
    const second = rig.srv.byTyp('hello')[1]!;
    expect(second.seq).toBeGreaterThan(before);
    expect(rig.srv.rejected).toEqual([]);
  });

  it('a failing collector becomes a health note, not a crash', async () => {
    rig = await Rig.create(); rig.ruflo.fail.add('memory_stats');
    const run = rig.start();
    const dig = await rig.srv.waitFor(() => rig!.srv.byTyp('digest')[0]);
    const d = dig.body as { health: { ok: boolean; notes: string[] }; memory?: unknown };
    expect(d.memory).toBeUndefined(); expect(d.health.ok).toBe(false); expect(d.health.notes.join()).toContain('memory_stats');
    run.stop(); await run.done;
  });
});

describe('server commands', () => {
  it('runs a read command (memory.search) with no approval and reports ack+result', async () => {
    rig = await Rig.create(); const run = rig.start();
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const f = rig.srv.command('memory.search', { query: 'auth patterns', limit: 3 }); rig.srv.broadcast(f);
    const cid = cmdBody(f);
    await rig.srv.waitFor(() => results(rig!, cid).includes('succeeded'));
    expect(results(rig, cid)).toEqual(['running', 'succeeded']);
    expect(rig.ruflo.calls.find(c => c.tool === 'memory_search')?.params).toEqual({ query: 'auth patterns', limit: 3 });
    run.stop(); await run.done;
  });

  it('refuses forged (wrong key), replayed, expired, wrong-tenant and non-allowlisted commands without executing', async () => {
    rig = await Rig.create(); const run = rig.start();
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const wrongKey = generateKeyPair().privateKey;
    const good = rig.srv.command('state.refresh');
    rig.srv.broadcast(rig.srv.command('state.refresh', {}, { key: wrongKey }));                         // forged
    rig.srv.broadcast(rig.srv.command('state.refresh', {}, { tid: 'tnt_' + randomToken(18) }));         // wrong tenant (signed by server key)
    rig.srv.broadcast(rig.srv.command('state.refresh', {}, { ts: Date.now() - 10 * 60_000 }));          // stale envelope
    rig.srv.broadcast(good);
    await rig.srv.waitFor(() => results(rig!, cmdBody(good)).includes('succeeded'));
    const publishedAfterGood = rig.srv.byTyp('digest').length;
    rig.srv.broadcast(good);                                                                              // replay of the exact frame
    const expiredCid = 'cmd_' + randomToken(16);
    rig.srv.broadcast(rig.srv.command('state.refresh', {}, { expiresAt: Date.now() - 1000, cid: expiredCid }));
    const rogue = rig.srv.command('terminal.execute', { command: HOSTILE });
    rig.srv.broadcast(rogue);
    await rig.srv.waitFor(() => results(rig!, expiredCid).length > 0 && results(rig!, cmdBody(rogue)).length > 0);
    expect(results(rig, expiredCid)).toEqual(['expired']);
    expect(results(rig, cmdBody(rogue))).toEqual(['denied']);
    expect(rig.srv.byTyp('result').filter(e => e.body.cid === cmdBody(good))).toHaveLength(1); // replay not re-run
    expect(rig.srv.byTyp('digest').length).toBe(publishedAfterGood);
    const reasons = audit(rig).filter(a => a.kind === 'frame_rejected').map(a => a.reason);
    expect(reasons).toContain('bad_signature'); expect(reasons).toContain('replay'); expect(reasons).toContain('wrong_binding');
    expect(rig.ruflo.calls.some(c => c.tool.includes('terminal'))).toBe(false);
    run.stop(); await run.done;
  });

  it('rejects arguments outside the allowlist schema (swarm cap, agent type)', async () => {
    rig = await Rig.create({}, 'full'); const run = rig.start(async () => true);
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const a = rig.srv.command('swarm.init', { maxAgents: 50 }); const b = rig.srv.command('agent.spawn', { type: 'root-shell' });
    rig.srv.broadcast(a); rig.srv.broadcast(b);
    await rig.srv.waitFor(() => results(rig!, cmdBody(a)).length && results(rig!, cmdBody(b)).length);
    expect(results(rig, cmdBody(a))).toEqual(['denied']); expect(results(rig, cmdBody(b))).toEqual(['denied']);
    expect(rig.ruflo.calls.map(c => c.tool)).not.toContain('swarm_init');
    run.stop(); await run.done;
  });

  it('refuses a command above the local level', async () => {
    rig = await Rig.create({}, 'read'); const run = rig.start(async () => true);
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const f = rig.srv.command('mission.stop', { missionId: 'msn_' + 'a'.repeat(24) }); rig.srv.broadcast(f);
    await rig.srv.waitFor(() => results(rig!, cmdBody(f)).length);
    expect(results(rig, cmdBody(f))).toEqual(['denied']);
    expect(rig.srv.byTyp('ack').at(-1)!.body.error).toBe('level_read_below_manage');
    expect(rig.ruflo.calls.some(c => c.tool === 'mission_request_action')).toBe(false);
    run.stop(); await run.done;
  });

  it('write command with no TTY/approver is denied; with approval it runs, creating a DRAFT only', async () => {
    rig = await Rig.create({}, 'write');
    let run = rig.start(); // default approver = tty approver; vitest has no TTY on stdin
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const args = { requestId: 'req-0000001', objective: 'Plan the thing' };
    const f1 = rig.srv.command('mission.create', args); rig.srv.broadcast(f1);
    await rig.srv.waitFor(() => results(rig!, cmdBody(f1)).includes('denied'));
    expect(results(rig, cmdBody(f1))).toEqual(['awaiting_approval', 'denied']);
    expect(rig.ruflo.calls.some(c => c.tool === 'mission_create')).toBe(false);
    run.stop(); await run.done;

    const seen: string[] = [];
    run = rig.start(async req => { seen.push(req.cmd); return true; });
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[1]);
    const f2 = rig.srv.command('mission.create', args); rig.srv.broadcast(f2);
    await rig.srv.waitFor(() => results(rig!, cmdBody(f2)).includes('succeeded'));
    expect(results(rig, cmdBody(f2))).toEqual(['awaiting_approval', 'running', 'succeeded']);
    expect(seen).toEqual(['mission.create']);
    expect(rig.ruflo.calls.find(c => c.tool === 'mission_create')?.params).toEqual({ objective: 'Plan the thing', requestId: 'req-0000001' });
    run.stop(); await run.done;
  });

  it('autoApprove covers write but never manage/full', async () => {
    rig = await Rig.create({}, 'full'); rig.setConfig({ autoApprove: true });
    const asked: string[] = [];
    const run = rig.start(async r => { asked.push(r.cmd); return false; });
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const w = rig.srv.command('mission.create', { requestId: 'req-0000002', objective: 'auto one' }); rig.srv.broadcast(w);
    await rig.srv.waitFor(() => results(rig!, cmdBody(w)).includes('succeeded'));
    const m = rig.srv.command('swarm.init', { maxAgents: 6 }); rig.srv.broadcast(m);
    await rig.srv.waitFor(() => results(rig!, cmdBody(m)).includes('denied'));
    expect(asked).toEqual(['swarm.init']);
    expect(rig.ruflo.calls.some(c => c.tool === 'swarm_init')).toBe(false);
    run.stop(); await run.done;
  });

  it('manage commands execute through the fixed tool mapping after approval (pause, spawn cap)', async () => {
    rig = await Rig.create({}, 'manage');
    const run = rig.start(async () => true);
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const mid = 'msn_' + 'a'.repeat(24);
    rig.ruflo.overrides.mission_get = { ok: true, data: { record: { missionId: mid, revision: 7 } } };
    const p = rig.srv.command('mission.pause', { missionId: mid }); rig.srv.broadcast(p);
    await rig.srv.waitFor(() => results(rig!, cmdBody(p)).includes('succeeded'));
    expect(rig.ruflo.calls.find(c => c.tool === 'mission_request_action')?.params).toMatchObject({ missionId: mid, action: 'pause', expectedRevision: 7, requestId: cmdBody(p) });
    rig.ruflo.overrides.agent_list = { agents: [], total: 6 };
    const s = rig.srv.command('agent.spawn', { type: 'coder' }); rig.srv.broadcast(s);
    await rig.srv.waitFor(() => results(rig!, cmdBody(s)).includes('failed'));
    expect(rig.srv.byTyp('result').at(-1)!.body.error).toBe('swarm_agent_cap_reached');
    run.stop(); await run.done;
  });

  it('state.refresh publishes a fresh digest on demand', async () => {
    rig = await Rig.create(); const run = rig.start();
    await rig.srv.waitFor(() => rig!.srv.byTyp('digest')[0]);
    const n = rig.srv.byTyp('digest').length;
    rig.srv.broadcast(rig.srv.command('state.refresh'));
    await rig.srv.waitFor(() => rig!.srv.byTyp('digest').length > n);
    run.stop(); await run.done;
  });

  it('writes every command decision to the audit log without secrets', async () => {
    rig = await Rig.create({}, 'write'); const run = rig.start(async () => true);
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const f = rig.srv.command('mission.create', { requestId: 'req-0000003', objective: 'deploy with token=abcdef123456789' }); rig.srv.broadcast(f);
    await rig.srv.waitFor(() => results(rig!, cmdBody(f)).includes('succeeded'));
    run.stop(); await run.done;
    const text = readFileSync(join(rig.home, AUDIT_FILE), 'utf8');
    expect(text).toContain('"decision":"approved"'); expect(text).not.toContain('abcdef123456789');
    expect(text).not.toContain(readFileSync(join(rig.home, KEY_FILE), 'utf8').trim());
  });
});

describe('revoke / unlink / gating', () => {
  it('a signed revoke wipes key + config and ends the run; a forged revoke does nothing', async () => {
    rig = await Rig.create(); const run = rig.start();
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    rig.srv.broadcast(rig.srv.frame('revoke', { reason: 'x' }, { key: generateKeyPair().privateKey }));
    await new Promise(r => setTimeout(r, 150));
    expect(existsSync(join(rig.home, KEY_FILE))).toBe(true);
    rig.srv.broadcast(rig.srv.frame('revoke', { reason: 'admin' }));
    expect(await run.done).toBe('revoked');
    expect(existsSync(join(rig.home, KEY_FILE))).toBe(false); expect(existsSync(join(rig.home, CONFIG_FILE))).toBe(false);
    expect(() => loadRunnable(rig!.home)).toThrowError(/not linked/);
  });

  it('persists the server sequence so a restarted connector rejects replays', async () => {
    rig = await Rig.create(); let run = rig.start();
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    const f = rig.srv.command('state.refresh'); rig.srv.broadcast(f);
    await rig.srv.waitFor(() => rig!.srv.byTyp('result').length > 0);
    run.stop(); await run.done;
    expect(loadServerSeq(rig.home)).toBeGreaterThan(0);
    run = rig.start(); await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[1]);
    const before = rig.srv.byTyp('result').length;
    rig.srv.broadcast(f); await new Promise(r => setTimeout(r, 200));
    expect(rig.srv.byTyp('result').length).toBe(before);
    run.stop(); await run.done;
  });

  it('unlink notifies the server (signed) and deletes key + config', async () => {
    rig = await Rig.create();
    const r = await unlink(rig.home);
    expect(r).toEqual({ wasLinked: true, notified: true });
    const rev = await rig.srv.waitFor(() => rig!.srv.byTyp('revoke')[0]);
    expect(rev.body.reason).toBe('unlink');
    expect(existsSync(join(rig.home, KEY_FILE))).toBe(false); expect(existsSync(join(rig.home, CONFIG_FILE))).toBe(false);
    expect(await unlink(rig.home)).toEqual({ wasLinked: false, notified: false });
  });

  it('unlink still wipes local state when the server is unreachable', async () => {
    rig = await Rig.create(); await rig.srv.stop();
    expect(await unlink(rig.home, 800)).toEqual({ wasLinked: true, notified: false });
    expect(existsSync(join(rig.home, KEY_FILE))).toBe(false);
    rig.srv.stop = async () => undefined;
  });

  it('run refuses when not linked, disabled, or level off', async () => {
    rig = await Rig.create();
    rig.setConfig({ enabled: false }); expect(() => loadRunnable(rig!.home)).toThrowError(/disabled/);
    rig.setConfig({ enabled: true, level: 'off' }); expect(() => loadRunnable(rig!.home)).toThrowError(/"off"/);
    rig.setConfig({ level: 'read' }); expect(loadRunnable(rig.home).cfg.level).toBe('read');
    expect(() => loadRunnable(join(rig!.root, 'nowhere'))).toThrowError(/not linked/);
  });

  it('reconnects after the server drops the socket', async () => {
    rig = await Rig.create(); const run = rig.start();
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[0]);
    for (const s of rig.srv.sockets) s.terminate();
    await rig.srv.waitFor(() => rig!.srv.byTyp('hello')[1]);
    expect(rig.srv.rejected).toEqual([]);
    run.stop(); await run.done;
  });
});

describe('backoff + url rules', () => {
  it('stays within 1s..60s, grows, and caps', () => {
    for (let a = 0; a < 20; a++) for (const r of [0, 0.5, 0.999999]) { const d = backoffDelay(a, () => r); expect(d).toBeGreaterThanOrEqual(BACKOFF_MIN_MS); expect(d).toBeLessThanOrEqual(BACKOFF_MAX_MS); }
    expect(backoffDelay(0, () => 0)).toBe(1000); expect(backoffDelay(3, () => 0)).toBe(8000); expect(backoffDelay(30, () => 1)).toBe(60_000);
    expect(backoffDelay(5, () => 0)).toBeGreaterThan(backoffDelay(2, () => 0));
  });
  it('connect URL must be wss (ws on loopback only) on the paired host', () => {
    expect(validateConnectUrl('wss://flo.example.com/connect', 'https://flo.example.com')).toContain('wss://');
    expect(validateConnectUrl('ws://127.0.0.1:9/connect', 'http://127.0.0.1:9')).toContain('ws://');
    expect(() => validateConnectUrl('ws://flo.example.com/connect', 'https://flo.example.com')).toThrow();
    expect(() => validateConnectUrl('wss://other.example.com/connect', 'https://flo.example.com')).toThrow();
  });
});
