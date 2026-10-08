import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DigestSchema } from '../../src/dashboard/protocol/index.js';
import { ttyApprover, printable, renderApproval, visible, LONG_TEXT } from '../../src/dashboard/approver.js';
import { collectAdrs, collectDigest } from '../../src/dashboard/collectors.js';
import { stubRuflo } from './_support/harness.js';
import { PassThrough } from 'node:stream';

const dirs: string[] = [];
const proj = () => { const d = mkdtempSync(join(tmpdir(), 'rfcol-')); dirs.push(d); mkdirSync(join(d, '.claude-flow')); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('collectDigest', () => {
  it('produces a schema-valid digest from ruflo output and calls only read tools', async () => {
    const r = stubRuflo(); const d = await collectDigest({ ruflo: r, projectDir: proj(), level: 'write' });
    expect(DigestSchema.safeParse(d).success).toBe(true);
    expect(d.level).toBe('write'); expect(d.ruflo.version).toBe('3.55.0');
    expect(d.events[0]).toMatchObject({ kind: 'mission.created' });
    const readOnly = new Set(['system_info', 'system_health', 'mission_get', 'mission_events', 'task_summary', 'swarm_status', 'agent_list', 'memory_stats']);
    expect(r.calls.every(c => readOnly.has(c.tool))).toBe(true);
  });
  it('omits swarm when ruflo reports no_swarm and survives malformed results', async () => {
    const r = stubRuflo(); r.overrides.swarm_status = { status: 'no_swarm' }; r.overrides.task_summary = 'garbage'; r.overrides.memory_stats = null;
    const d = await collectDigest({ ruflo: r, projectDir: proj(), level: 'read' });
    expect(d.swarm).toBeUndefined(); expect(d.tasks).toBeUndefined(); expect(d.memory).toBeUndefined();
    expect(DigestSchema.safeParse(d).success).toBe(true);
  });
  it('turns every failure into notes and still returns a valid digest', async () => {
    const r = stubRuflo(); for (const t of ['system_info', 'system_health', 'mission_get', 'task_summary', 'swarm_status', 'agent_list', 'memory_stats']) r.fail.add(t);
    const d = await collectDigest({ ruflo: r, projectDir: proj(), level: 'read' });
    expect(d.health.ok).toBe(false); expect(d.health.notes.length).toBeGreaterThanOrEqual(7); expect(d.ruflo.version).toBe('unknown');
  });
  it('does not touch ruflo at all outside a ruflo project, and says so', async () => {
    const r = stubRuflo(); const d = await collectDigest({ ruflo: r, projectDir: mkdtempSync(join(tmpdir(), 'rfnone-')), level: 'read' });
    dirs.push(); expect(r.calls).toEqual([]); expect(d.health.ok).toBe(false); expect(d.health.notes[0]).toContain('ruflo init');
  });
  it('caps list sizes at 100 and strings at schema limits', async () => {
    const r = stubRuflo();
    r.overrides.mission_get = { ok: true, data: { missions: Array.from({ length: 250 }, (_, i) => ({ missionId: 'msn_' + i, objective: 'o'.repeat(1000), state: 'draft', revision: i })) } };
    const d = await collectDigest({ ruflo: r, projectDir: proj(), level: 'read' });
    expect(d.missions).toHaveLength(100); expect(d.missions[0]!.objective.length).toBe(300);
  });
  it('masks secrets and control characters before they reach the digest', async () => {
    const r = stubRuflo(); r.overrides.agent_list = { agents: [{ agentId: 'a\u001b[31m', agentType: 'coder', status: 'ghp_' + 'A'.repeat(30) }], total: 1 };
    const d = await collectDigest({ ruflo: r, projectDir: proj(), level: 'read' });
    expect(JSON.stringify(d)).not.toContain('ghp_AAAA'); expect(JSON.stringify(d)).not.toContain('\u001b');
  });
});

describe('collectAdrs', () => {
  it('reads title and status from ADR markdown, skips symlinks and non-markdown', () => {
    const d = proj(); mkdirSync(join(d, 'docs/adr'), { recursive: true });
    writeFileSync(join(d, 'docs/adr/0003-pairing.md'), '# ADR-0003: Device pairing\n\nStatus: Accepted\n');
    writeFileSync(join(d, 'docs/adr/ADR-12-foo.md'), '# Foo\n\n- **Status**: Proposed\n');
    writeFileSync(join(d, 'docs/adr/notes.txt'), 'x');
    symlinkSync('/etc/passwd', join(d, 'docs/adr/0009-evil.md'));
    expect(collectAdrs(d)).toEqual([
      { id: 'ADR-12', title: 'Foo', status: 'proposed' },
      { id: '0003', title: 'ADR-0003: Device pairing', status: 'accepted' },
    ]);
  });
  it('returns [] when there is no ADR directory', () => { expect(collectAdrs(proj())).toEqual([]); });
});

describe('approver', () => {
  it('denies without a TTY', async () => {
    const a = ttyApprover(Object.assign(new PassThrough(), { isTTY: false }), new PassThrough());
    expect(await a({ cid: 'c', cmd: 'mission.create', summary: 's', level: 'write', args: {}, by: 'u' })).toBe(false);
  });
  it('accepts only an explicit yes on a TTY, and sanitises what it shows', async () => {
    for (const [answer, expected] of [['y\n', true], ['yes\n', true], ['\n', false], ['n\n', false], ['yy\n', false]] as const) {
      const input = Object.assign(new PassThrough(), { isTTY: true }); const output = new PassThrough(); let shown = '';
      output.on('data', c => { shown += c; });
      const p = ttyApprover(input, output, 2000)({ cid: 'c', cmd: 'mission.create', summary: 's', level: 'write', args: { objective: 'evil\u001b[2J\u001b]0;x\u0007 token=abcdefgh12345' }, by: 'u' });
      setTimeout(() => input.write(answer), 20);
      expect(await p).toBe(expected);
      expect(shown).not.toContain('\u001b'); expect(shown).toContain('token=abcdefgh12345'); // nothing is masked or hidden in the approval view
    }
  });
  it('times out to deny', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    expect(await ttyApprover(input, new PassThrough(), 80)({ cid: 'c', cmd: 'x', summary: 's', level: 'write', args: {}, by: 'u' })).toBe(false);
  });
  it('printable strips control characters', () => { expect(printable('a\u001bb\nc\u0085d')).toBe('a b c d'); });
});

describe('approval prompt shows everything (M6)', () => {
  const base = { cid: 'c', cmd: 'mission.create', summary: 's', level: 'write', by: 'u', baseUrl: 'https://flo.example.com', serverFingerprint: 'abcd1234abcd1234abcd1234abcd1234' };
  const tty = () => Object.assign(new PassThrough(), { isTTY: true });
  async function drive(args: Record<string, unknown>, answers: string[], timeout = 3000) {
    const input = tty(); const output = new PassThrough(); let shown = '';
    output.on('data', c => { shown += c; });
    const p = ttyApprover(input, output, timeout)({ ...base, args });
    for (const a of answers) await new Promise<void>(r => setTimeout(() => { input.write(a); r(); }, 30));
    return { ok: await p, shown };
  }
  it('header carries the dashboard URL and server-key fingerprint', () => {
    const text = renderApproval({ ...base, args: { objective: 'x' } }).join('\n');
    expect(text).toContain('https://flo.example.com'); expect(text).toContain('abcd1234abcd1234abcd1234abcd1234');
  });
  it('renders a 2000 character objective in full, wrapped, with newlines made visible', () => {
    const obj = 'A'.repeat(900) + '\nSECRET-TAIL-INSTRUCTION ' + 'B'.repeat(1000);
    const text = renderApproval({ ...base, args: { objective: obj } }).join('\n');
    expect(text).toContain('SECRET-TAIL-INSTRUCTION'); expect(text.match(/A/g)!.length).toBeGreaterThanOrEqual(900); expect(text.match(/B/g)!.length).toBeGreaterThanOrEqual(1000);
    expect(text).toContain(visible('\n')); expect(text).toContain('(1925 chars)');
  });
  it('long text: must page through everything, then type exactly yes; a plain y denies', async () => {
    const args = { objective: 'x'.repeat(2000) };
    const paged = await drive(args, ['\n', 'yes\n']);
    expect(paged.ok).toBe(true); expect(paged.shown).toContain('-- more'); expect(paged.shown).toContain('shown in full');
    expect((await drive(args, ['\n', 'y\n'])).ok).toBe(false);
    expect((await drive(args, ['q\n'])).ok).toBe(false);
  });
  it('short arguments keep the simple y/N prompt', async () => {
    expect((await drive({ objective: 'short' }, ['y\n'])).ok).toBe(true);
  });
});
