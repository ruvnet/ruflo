/**
 * #4746 (review follow-up): EVERY file the mod writes under `.claude-flow`
 * goes through the link guard, not only the heartbeat and the snapshot.
 *
 * One session drives each hook entry point that writes: session.start (the
 * heartbeat), prompt.submit + tool.call + turn.complete (edit records, the
 * learning-loop ledger, guidance observations, context-delegation metrics),
 * a budget refusal (the console toast ring), session.compact (a snapshot)
 * and session.end (cost attribution). The harness stats the way the live
 * engine does (`liveLinkStat`): a symlinked `.claude-flow` reads as a dir with
 * `isLink`, so the mod treats the project as initialized and every write path
 * is reached. A control run against a real `.claude-flow` proves each path
 * writes; the symlinked run must leave the outside directory byte-identical.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { GuidanceCompiler } from '../../../guidance/src/compiler';
import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { HEARTBEAT_PATH } from '../../../../../plugins/ruflo-mods/hooks/session';
import { PROJECTION_PATH } from '../../../../../plugins/ruflo-mods/hooks/guidance/projection';
import { PENDING_PATH } from '../../../../../plugins/ruflo-mods/hooks/learn/insights';
import { VERIFIED_PATH } from '../../../../../plugins/ruflo-mods/hooks/loop/record';
import { METRICS_PATH } from '../../../../../plugins/ruflo-mods/hooks/context-delegate/stats';
import { ATTRIBUTION_PATH } from '../../../../../plugins/ruflo-mods/hooks/cost/attribution';
import { CONSOLE_DIR, TOAST_DIR } from '../../../../../plugins/ruflo-mods/hooks/toast/policy';
import { slotPath } from '../../../../../plugins/ruflo-mods/hooks/compact-snapshot/snapshot';
import { buildModProjection } from '../../src/guidance/mod-projection';
import { loadMod, realWorld, type World } from './harness';

const SOURCE = '# Project guidance\n## Testing\n- TEST-001: Always run parser tests when changing a parser.\n';
const REVISION = '8ce24908c51c26aa859308bdb2e7e819e4f9fc88';
const OPTIONS = { learningLoop: true, guidanceLearning: true, guidanceContext: true, contextDelegation: 'observe', routeContext: false };
const REFUSAL = 'API Error: 400 {"error":{"message":"Authentication Error, ExceededTokenBudget: Current spend for token: 7.2e-05; Max Budget for Token: 2e-07","type":"budget_exceeded","param":null,"code":"400"}}';
const BIG = Array.from({ length: 1200 }, (_, i) => `export const pad_${i} = ${i}; // filler line for a large module`).join('\n') + '\n';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project and a sibling directory standing in for "anywhere outside the project". */
function layout(): { project: string; outside: string; world: World } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-mods-every-write-')));
  roots.push(root);
  const project = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(project, 'src', 'config.ts'), BIG);
  const world = realWorld(project);
  world.liveLinkStat = true;
  return { project, outside, world };
}

/** What the mod needs to find under `.claude-flow` (wherever it really lives) for every write path to fire. */
function seedState(dir: string): void {
  mkdirSync(join(dir, CONSOLE_DIR.replace(/^\.claude-flow\//, '')), { recursive: true });
  const projection = join(dir, PROJECTION_PATH.replace(/^\.claude-flow\//, ''));
  mkdirSync(join(projection, '..'), { recursive: true });
  writeFileSync(projection, JSON.stringify(buildModProjection(new GuidanceCompiler().compile(SOURCE), REVISION)));
}

/** Every file below `dir` with its bytes, so "unchanged" covers new, rewritten and appended files alike. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** `create: false` skips engine.create, so the toast writer session.start binds is the one in use (no `$.ruflo` noun beneath). */
async function driveEveryWrite(world: World, create = true): Promise<void> {
  const mod = loadMod(register, world, OPTIONS);
  if (create) await mod.create();
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e: { cwd: string }) => ({ cwd: e.cwd }));
  await mod.dispatch('prompt.submit', { text: 'explore the config and find the retry limit', wait: false, origin: { kind: 'composer' } }, (e: unknown) => e);
  const file = join(world.root, 'src', 'config.ts');
  await mod.dispatch('tool.call', { tool: 'Read', tool_use_id: 'r1', file_path: file }, () => ({
    result: { type: 'text', file: { filePath: file, content: BIG, numLines: 1201, startLine: 1, totalLines: 1201 } },
  }));
  await mod.dispatch('tool.call', { tool: 'Edit', tool_use_id: 'e1', file_path: file }, () => ({ result: 'ok' }));
  await mod.dispatch('tool.call', { tool: 'Bash', tool_use_id: 'b1', command: 'npm test' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }));
  await mod.dispatch('session.measure', { context: {}, rateLimits: [], cost: { usd: 0.5 }, changed: ['cost'] }, (e: { changed: unknown }) => ({ changed: e.changed }));
  await mod.dispatch('turn.complete', { turnId: 't1', reason: 'answer', answer: 'done', durationMs: 5, isAborted: false }, () => ({ text: 'done' }));
  await mod.dispatch('turn.complete', { turnId: 't2', reason: 'error', answer: REFUSAL, durationMs: 1, isAborted: false }, () => ({ text: REFUSAL }));
  const msg = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [], handle: `h-${role}` });
  await mod.dispatch('session.compact', { trigger: 'manual', messages: [msg('user', 'please fix bug 0'), msg('assistant', 'looking at it')] }, () => ({ messages: [msg('user', 'summary')] }));
  await mod.dispatch('session.end', { reason: 'other', sessionId: 's1', resume: {} }, () => ({ sessionId: 's1' }));
  // The toast ring and the snapshot are written beside the hook: let them settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Each write path, relative to `.claude-flow`. */
const EXPECTED = [HEARTBEAT_PATH, PENDING_PATH, VERIFIED_PATH, METRICS_PATH, ATTRIBUTION_PATH, slotPath(0)].map((p) => p.replace(/^\.claude-flow\//, ''));

describe('#4746: every .claude-flow write is link-guarded', () => {
  it('control: in a real .claude-flow each write path writes', async () => {
    const { project, world } = layout();
    const state = join(project, '.claude-flow');
    seedState(state);
    await driveEveryWrite(world);
    const written = Object.keys(tree(state));
    for (const path of EXPECTED) expect(written, path).toContain(path);
    expect(written.some((p) => p.startsWith('mods/guidance/observations/')), 'guidance observations').toBe(true);
    expect(written.some((p) => p.startsWith(TOAST_DIR.replace(/^\.claude-flow\//, '') + '/')), 'toast ring').toBe(true);
  });

  it('a symlinked .claude-flow -> outside dir: nothing outside the project is created or changed', async () => {
    const { project, outside, world } = layout();
    seedState(outside);
    symlinkSync(outside, join(project, '.claude-flow'), 'dir');
    const before = tree(outside);
    await driveEveryWrite(world);
    expect(tree(outside)).toEqual(before);
  });

  it('a symlinked .claude-flow without engine.create (the toast writer session.start binds): nothing outside is written', async () => {
    const { project, outside, world } = layout();
    seedState(outside);
    symlinkSync(outside, join(project, '.claude-flow'), 'dir');
    const before = tree(outside);
    await driveEveryWrite(world, false);
    expect(tree(outside)).toEqual(before);
  });

  it('a symlinked parent of .claude-flow subfolders (data/, cost/, metrics/) is refused too', async () => {
    const { project, outside, world } = layout();
    const state = join(project, '.claude-flow');
    seedState(state);
    for (const sub of ['data', 'cost', 'metrics', 'sessions']) {
      mkdirSync(join(outside, sub), { recursive: true });
      symlinkSync(join(outside, sub), join(state, sub), 'dir');
    }
    const before = tree(outside);
    await driveEveryWrite(world);
    expect(tree(outside)).toEqual(before);
  });
});
