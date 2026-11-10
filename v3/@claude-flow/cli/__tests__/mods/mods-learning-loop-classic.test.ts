/**
 * ADR-512: the verified-outcome learning loop for users on classic hooks (no mod). The classic `route` and
 * `session-end` hooks replay the session transcript through the mod's own record code (bundled into
 * .claude/helpers/learning-loop.cjs) and print the mod's own lesson block.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { line, start, step } from '../../../../../plugins/ruflo-mods/hooks/loop/record';
import { lessonBlock, parseLessons, pick } from '../../../../../plugins/ruflo-mods/hooks/loop/lessons';
import { classify } from '../../../../../plugins/ruflo-mods/hooks/loop/verifier';
import { lessonsFor, promptOf, replay } from '../../../../../plugins/ruflo-mods/hooks/loop/transcript';
import { ingestVerifiedOutcomes, type SonaLike } from '../../src/memory/verified-outcomes.js';
import { SONAOptimizer } from '../../src/memory/sona-optimizer.js';
import { CRITICAL_HELPERS } from '../../src/init/helper-refresh.js';

const REPO = resolve(__dirname, '..', '..', '..', '..', '..');
const HELPERS = join(REPO, 'v3', '@claude-flow', 'cli', '.claude', 'helpers');
const SESSION = '0b6f2a52-6c1e-4d39-9a57-1f0e3c2d4b11';

/** A transcript the way Claude Code writes it: one JSON object per line. */
class Transcript {
  readonly lines: string[] = [];
  private n = 0;
  constructor(private readonly root: string) {}
  prompt(text: string, extra: Record<string, unknown> = {}) {
    this.lines.push(JSON.stringify({ type: 'user', sessionId: SESSION, timestamp: '2026-10-30T10:00:00.000Z', message: { role: 'user', content: text }, ...extra }));
    return this;
  }
  call(name: string, input: Record<string, unknown>, isError = false, toolUseResult: unknown = { stdout: '', stderr: '', interrupted: false }) {
    const id = `toolu_${++this.n}`;
    this.lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }));
    this.lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'Exit code 1' : 'ok', is_error: isError }] }, toolUseResult }));
    return this;
  }
  edit(file: string) {
    return this.call('Edit', { file_path: join(this.root, file), old_string: 'a', new_string: 'b' });
  }
  answer(text = 'done') {
    this.lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }));
    return this;
  }
  text() {
    return `${this.lines.join('\n')}\n`;
  }
}

const opts = (root: string, final: boolean, base = 0) => ({ base, session: SESSION, root, final, agentFor: () => 'coder', now: 1 });
const parse = (lines: string[]) => lines.map((l) => JSON.parse(l));

describe('replaying a transcript decides the turn exactly as the mod does', () => {
  const root = '/work/shop';

  it('an edit then a passing npm test is a verified success naming the edited file, like the mod record', () => {
    const t = new Transcript(root).prompt('the euro rounding is wrong on invoices').edit('src/money/half-even.js').call('Bash', { command: 'npm test' }).answer().prompt('next');
    const { lines } = replay(t.text(), opts(root, false));
    expect(lines).toHaveLength(1);
    const got = JSON.parse(lines[0]!);

    // The mod path, driven with the same calls.
    const m = start(got.id, 'the euro rounding is wrong on invoices', 'coder', got.startedAt, SESSION);
    step(m, 'Edit', true, null, null, 'src/money/half-even.js');
    step(m, 'Bash', true, classify('npm test'), true, undefined, 'npm test');
    expect(got).toEqual(JSON.parse(line(m, false, got.endedAt)));
    expect(got.outcome).toBe('verified-success');
    expect(got.files).toEqual(['src/money/half-even.js']);
    expect(got.session).toBe(SESSION);
  });

  it('a failing test after the edit is a verified failure; no verifier run is unknown', () => {
    const t = new Transcript(root)
      .prompt('fix the slug folding').edit('src/slug/fold.js').call('Bash', { command: 'npm test' }, true).answer()
      .prompt('rename a variable').edit('src/a.js').answer()
      .prompt('next');
    expect(parse(replay(t.text(), opts(root, false)).lines).map((r) => r.outcome)).toEqual(['verified-failure', 'unknown']);
  });

  it('an interrupted turn, a backgrounded test and an edited test file do not count as a clean success', () => {
    const t = new Transcript(root)
      .prompt('fix it').edit('src/x.js').call('Bash', { command: 'npm test' })
      .answer()
      .prompt('fix the lexer').edit('src/importer/lexer.js').call('Bash', { command: 'npm test' }, false, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' })
      .prompt('fix the span').edit('src/listing/span.test.js').edit('src/listing/span.js').call('Bash', { command: 'npm test' })
      .prompt('next');
    t.lines.splice(4, 0, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }));
    const records = parse(replay(t.text(), opts(root, false)).lines);
    expect(records[0].outcome).toBe('unknown');
    expect(records[1].outcome).toBe('unknown');
    expect(records[2].outcome).toBe('verified-success');
    expect(records[2].taint).toEqual(['edited-tests']);
  });

  it('a timed-out or backgrounded test has no exit status: the turn stays unknown, never a success or a failure', () => {
    // The shapes Claude Code writes (checked against real transcripts): the fields sit in toolUseResult.
    const t = new Transcript(root)
      .prompt('fix a').edit('src/a.js').call('Bash', { command: 'npm test' }, true, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1', timedOutAfterMs: 120000 })
      .prompt('fix b').edit('src/b.js').call('Bash', { command: 'npm test', run_in_background: true })
      .prompt('next');
    expect(parse(replay(t.text(), opts(root, false)).lines).map((r) => r.outcome)).toEqual(['unknown', 'unknown']);
  });

  it('subagent lines, meta lines, slash commands and results without a call are not turns or steps', () => {
    const t = new Transcript(root).prompt('fix the overlay merge').edit('src/settings/overlay.js');
    t.lines.push(JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'a subagent prompt' } }));
    t.lines.push(JSON.stringify({ type: 'user', isMeta: true, message: { content: 'caveat' } }));
    t.lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'nope', is_error: true }] } }));
    t.call('Bash', { command: 'npm test' }).prompt('/clear').prompt('<command-name>/model</command-name>').prompt('next');
    const records = parse(replay(t.text(), opts(root, false)).lines);
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe('verified-success');
    expect(records[0].steps).toEqual([{ tool: 'Edit', ok: true }, { tool: 'Bash', ok: true }]);
  });

  it('promptOf takes typed text only', () => {
    expect(promptOf({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } })).toBe('hello');
    expect(promptOf({ type: 'user', isCompactSummary: true, message: { content: 'summary' } })).toBeNull();
    expect(promptOf({ type: 'assistant', message: { content: 'hi' } })).toBeNull();
  });
});

describe('offsets: each turn is replayed once, and only when it has finished', () => {
  const root = '/work/shop';

  it('keeps the open turn, consumes it when the session ends, and gives a turn the same id on every replay', () => {
    const t = new Transcript(root).prompt('fix the slug').edit('src/slug/fold.js').call('Bash', { command: 'npm test' }).prompt('fix the money').edit('src/money/half-even.js');
    const text = t.text();
    const first = replay(text, opts(root, false));
    expect(first.lines).toHaveLength(1);
    // The open turn starts at the second prompt's byte offset, so the next read starts there.
    const second = Buffer.from(text).subarray(first.consumed).toString('utf8');
    expect(second.startsWith('{"type":"user"')).toBe(true);
    const again = replay(text, opts(root, false));
    expect(again.lines).toEqual(first.lines);

    const closing = replay(second, opts(root, true, first.consumed));
    expect(parse(closing.lines).map((r) => r.outcome)).toEqual(['unknown']);
    expect(closing.consumed).toBe(Buffer.byteLength(second));
    // The same turn read from the start of the file has the same id.
    expect(JSON.parse(replay(text, opts(root, true)).lines[1]!).id).toBe(JSON.parse(closing.lines[0]!).id);
  });

  it('never consumes a last line still being written', () => {
    const t = new Transcript(root).prompt('fix it').edit('src/x.js').call('Bash', { command: 'npm test' });
    const text = t.text().slice(0, -20);
    const { lines, consumed } = replay(text, opts(root, true));
    expect(parse(lines)[0].outcome).toBe('unknown'); // the test result is the cut line
    expect(consumed).toBeLessThan(Buffer.byteLength(text));
  });
});

describe('lessons: the classic hook shows what the mod shows', () => {
  it('lessonsFor is the mod block for the same file and prompt, and nothing for a bad file', () => {
    const file = JSON.stringify({ version: 1, gate: 0.6, belowGate: 0, lessons: [
      { id: 'L-0123456789', kind: 'lesson', agent: 'coder', keywords: ['euro', 'rounding', 'invoice'], confidence: 0.7, successes: 3, failures: 0, evidence: 'npm test', files: ['src/money/half-even.js'] },
      { id: 'L-abcdefabcd', kind: 'lesson', agent: 'coder', keywords: ['slug', 'accent', 'fold'], confidence: 0.7, successes: 3, failures: 0, evidence: 'npm test' },
    ] });
    const prompt = 'the euro rounding on the invoice is off by a cent';
    const block = lessonsFor(prompt, file);
    expect(block).toBe(lessonBlock(pick(parseLessons(file), prompt)));
    expect(block).toContain('`src/money/half-even.js`');
    expect(lessonsFor(prompt, '{not json')).toBe('');
    expect(lessonsFor('write a poem', file)).toBe('');
  });
});

describe('the classic hooks run the loop (hook-handler.cjs + learning-loop.cjs)', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const project = () => {
    dir = mkdtempSync(join(tmpdir(), 'classic-loop-'));
    mkdirSync(join(dir, '.claude', 'helpers'), { recursive: true });
    mkdirSync(join(dir, '.claude-flow', 'data'), { recursive: true });
    for (const f of ['hook-handler.cjs', 'router.cjs', 'learning-loop.cjs']) copyFileSync(join(HELPERS, f), join(dir, '.claude', 'helpers', f));
    // A fresh spawn stamp: the hook must not start a real CLI from a test.
    writeFileSync(join(dir, '.claude-flow', 'data', 'verified-ingest.spawned'), '0');
    return dir;
  };
  const hook = (sub: string, input: Record<string, unknown>, env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [join(dir, '.claude', 'helpers', 'hook-handler.cjs'), sub], {
      cwd: dir, input: JSON.stringify(input), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, RUFLO_MODS_OWNS: '', RUFLO_LEARNING_LOOP: '', RUFLO_HOOK_DEDUP_DIR: join(dir, '.dedup'), ...env },
    });
    expect(r.status).toBe(0);
    return r.stdout;
  };
  const records = () => {
    const p = join(dir, '.claude-flow', 'data', 'verified-trajectories.jsonl');
    return existsSync(p) ? parse(readFileSync(p, 'utf8').trim().split('\n')) : [];
  };

  it('route records the finished turn, session-end the last one, each once; PreCompact leaves the open turn open', () => {
    project();
    const path = join(dir, 'transcript.jsonl');
    const t = new Transcript(dir).prompt('fix the euro rounding').edit('src/money.js').call('Bash', { command: 'npm test' }).answer();
    writeFileSync(path, t.prompt('now fix the slug folding').text());
    const input = { session_id: SESSION, transcript_path: path, prompt: 'now fix the slug folding' };
    hook('route', input);
    hook('route', input);
    expect(records().map((r) => r.outcome)).toEqual(['verified-success']);

    writeFileSync(path, t.edit('src/slug.js').text());
    hook('session-end', { ...input, hook_event_name: 'PreCompact' });
    expect(records()).toHaveLength(1);
    writeFileSync(path, t.call('Bash', { command: 'npm test' }, true).text());
    hook('session-end', { ...input, hook_event_name: 'SessionEnd' });
    hook('session-end', { ...input, hook_event_name: 'SessionEnd', x: 1 });
    expect(records().map((r) => r.outcome)).toEqual(['verified-success', 'verified-failure']);
  });

  it('records nothing when the mod records the turns, or the loop is off', () => {
    project();
    const path = join(dir, 'transcript.jsonl');
    writeFileSync(path, new Transcript(dir).prompt('fix it').edit('src/a.js').call('Bash', { command: 'npm test' }).prompt('next').text());
    const input = { session_id: SESSION, transcript_path: path, prompt: 'next' };
    hook('route', input, { RUFLO_MODS_OWNS: 'post-edit,learning-loop' });
    hook('session-end', { ...input, hook_event_name: 'SessionEnd' }, { RUFLO_MODS_OWNS: 'learning-loop' });
    hook('route', input, { RUFLO_LEARNING_LOOP: '0' });
    writeFileSync(join(dir, '.claude-flow', 'config.json'), JSON.stringify({ learningLoop: { enabled: false } }));
    hook('route', input);
    expect(records()).toEqual([]);
  });

  it('end to end: three verified fixes recorded by classic hooks train a lesson the next prompt shows', async () => {
    project();
    const sessions = ['11111111-aaaa-4bbb-8ccc-000000000001', '22222222-aaaa-4bbb-8ccc-000000000002', '33333333-aaaa-4bbb-8ccc-000000000003'];
    const prompts = ['the invoice money formatting is wrong for euros', 'the invoice money formatting is wrong for euros', 'the invoice money formatting is wrong for euros'];
    for (const [i, session] of sessions.entries()) {
      const path = join(dir, `t${i}.jsonl`);
      writeFileSync(path, new Transcript(dir).prompt(prompts[i]!).edit('src/money.js').call('Bash', { command: 'npm test' }).answer().text());
      hook('session-end', { session_id: session, transcript_path: path, hook_event_name: 'SessionEnd' });
    }
    expect(records().map((r) => r.outcome)).toEqual(['verified-success', 'verified-success', 'verified-success']);

    const sona = new SONAOptimizer({ persistencePath: relative(process.cwd(), join(dir, '.swarm', 'sona-patterns.json')) });
    const result = await ingestVerifiedOutcomes({ root: dir, sona: sona as unknown as SonaLike, force: true });
    expect(result.ingested.rejected).toBe(0);
    expect(result.lessons).toBe(1);

    const out = hook('route', { session_id: 'next', transcript_path: join(dir, 'none.jsonl'), prompt: 'money formatting for euros is off again on the invoice' });
    expect(out).toContain('edited `src/money.js`: look there first');
    expect(hook('route', { session_id: 'next', prompt: 'write a haiku about autumn' })).not.toContain('look there first');
  });
});

describe('the helper ships and stays built from the mod source', () => {
  it('every helper list names learning-loop.cjs, and both copies of the bundle and the hook handler match', () => {
    expect(CRITICAL_HELPERS).toContain('learning-loop.cjs');
    for (const f of ['scripts/sign-helpers.mjs', 'scripts/verify-helpers.mjs', 'src/init/executor.ts']) {
      expect(readFileSync(join(REPO, 'v3', '@claude-flow', 'cli', f), 'utf8')).toContain("'learning-loop.cjs'");
    }
    for (const f of ['learning-loop.cjs', 'hook-handler.cjs']) {
      expect(readFileSync(join(REPO, '.claude', 'helpers', f), 'utf8')).toBe(readFileSync(join(HELPERS, f), 'utf8'));
    }
  });

  it('the committed bundle is what the build script makes from the mod source', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'plugins', 'ruflo-mods', 'scripts', 'build-learning-loop-helper.mjs'), '--check'], { encoding: 'utf8' });
    if (/esbuild is not installed/.test(r.stderr)) return; // the mod-guidance job runs it with esbuild
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
