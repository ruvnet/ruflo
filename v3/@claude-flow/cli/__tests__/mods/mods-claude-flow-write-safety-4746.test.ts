/**
 * #4746 (remainder): the mods' `.claude-flow` writes must not follow symlinks.
 *
 * The session heartbeat (session.ts) and the pre-compaction snapshot
 * (compact-snapshot/index.ts) wrote through `$.fs.write` with no link check,
 * so a symlinked `.claude-flow` tree in a cloned project could steer those
 * writes outside the project. These tests drive the real mod through the
 * harness against real directories and real symlinks, and assert nothing
 * outside the project is ever written.
 *
 * One shape cannot be reproduced through this harness: a symlinked
 * `.claude-flow` directory itself. The harness stats with `lstat`, which
 * reports a link-to-dir as kind `other`, so the mod already stands down
 * before writing; the live engine reports the target's kind plus `isLink`
 * (see plugins/ruflo-console/tests/mods-section.spec.ts), which is the shape
 * the guard's own tests (mods-write-without-links-4746.test.ts) cover. The
 * symlinked-`.claude-flow` cases below are pins for the harness outcome.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { HEARTBEAT_PATH } from '../../../../../plugins/ruflo-mods/hooks/session';
import { MAX_SNAPSHOTS, slotPath } from '../../../../../plugins/ruflo-mods/hooks/compact-snapshot/snapshot';
import { loadMod, realWorld, type World } from './harness';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function projectWithOutside(): { project: string; outside: string; world: World } {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-mods-write-safety-'));
  roots.push(root);
  const project = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(project, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { project, outside, world: realWorld(project) };
}

async function boot(world: World) {
  const mod = loadMod(register, world, {});
  await mod.create();
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}
type Mod = Awaited<ReturnType<typeof boot>>;

const msg = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [], handle: `h-${Math.random()}` });

async function compact(mod: Mod) {
  return mod.dispatch(
    'session.compact',
    { trigger: 'manual', messages: [msg('user', 'please fix bug 0'), msg('assistant', 'looking at it')] },
    () => ({ messages: [msg('user', 'summary')] }),
  );
}

describe('session heartbeat', () => {
  it('writes the heartbeat in a normal project', async () => {
    const { project, world } = projectWithOutside();
    mkdirSync(join(project, '.claude-flow'), { recursive: true });
    await boot(world);
    const heartbeat = JSON.parse(readFileSync(join(project, HEARTBEAT_PATH), 'utf8'));
    expect(heartbeat.startedAt).toEqual(expect.any(String));
    expect(heartbeat.owned).toEqual(expect.any(Array));
  });

  it('never writes through a symlinked session.json target', async () => {
    const { project, outside, world } = projectWithOutside();
    const target = join(outside, 'target.json');
    writeFileSync(target, 'outside-owned');
    mkdirSync(join(project, '.claude-flow', 'mods'), { recursive: true });
    symlinkSync(target, join(project, HEARTBEAT_PATH));
    await boot(world);
    expect(readFileSync(target, 'utf8')).toBe('outside-owned');
    expect(lstatSync(join(project, HEARTBEAT_PATH)).isSymbolicLink()).toBe(true);
  });

  it('never writes through a symlinked mods dir', async () => {
    const { project, outside, world } = projectWithOutside();
    mkdirSync(join(project, '.claude-flow'), { recursive: true });
    symlinkSync(outside, join(project, '.claude-flow', 'mods'), 'dir');
    await boot(world);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('a symlinked .claude-flow dir writes nothing outside (pin: the harness lstat already stands the mod down)', async () => {
    const { project, outside, world } = projectWithOutside();
    symlinkSync(outside, join(project, '.claude-flow'), 'dir');
    await boot(world);
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('compaction snapshots', () => {
  it('writes one snapshot in a normal project', async () => {
    const { project, world } = projectWithOutside();
    mkdirSync(join(project, '.claude-flow'), { recursive: true });
    const mod = await boot(world);
    await compact(mod);
    const snap = join(project, slotPath(0));
    expect(existsSync(snap)).toBe(true);
    const head = JSON.parse(readFileSync(snap, 'utf8').split('\n')[0]);
    expect(head).toMatchObject({ kind: 'ruflo-compact-snapshot', messages: 2, kept: 2 });
  });

  it('never writes through a symlinked slot when rotating', async () => {
    const { project, outside, world } = projectWithOutside();
    const dir = join(project, '.claude-flow', 'sessions', 'compactions');
    mkdirSync(dir, { recursive: true });
    const target = join(outside, 'target.jsonl');
    writeFileSync(target, 'outside-owned');
    // The link is created first, so its mtime is the oldest: rotation picks it.
    symlinkSync(target, join(project, slotPath(0)));
    for (let n = 1; n < MAX_SNAPSHOTS; n++) {
      writeFileSync(join(project, slotPath(n)), '{"v":1}\n');
    }
    const mod = await boot(world);
    const result = await compact(mod);
    expect(result).toEqual({ messages: [expect.objectContaining({ text: 'summary' })] });
    expect(readFileSync(target, 'utf8')).toBe('outside-owned');
    expect(lstatSync(join(project, slotPath(0))).isSymbolicLink()).toBe(true);
    expect(world.logs.some((l) => l.includes('compaction snapshot not written'))).toBe(true);
  });

  it('never writes through a symlinked compactions dir', async () => {
    const { project, outside, world } = projectWithOutside();
    mkdirSync(join(project, '.claude-flow', 'sessions'), { recursive: true });
    symlinkSync(outside, join(project, '.claude-flow', 'sessions', 'compactions'), 'dir');
    const mod = await boot(world);
    const result = await compact(mod);
    expect(result).toEqual({ messages: [expect.objectContaining({ text: 'summary' })] });
    expect(readdirSync(outside)).toEqual([]);
    expect(world.logs.some((l) => l.includes('compaction snapshot not written'))).toBe(true);
  });

  it('a symlinked .claude-flow dir writes nothing outside (pin: the harness lstat already stands the mod down)', async () => {
    const { project, outside, world } = projectWithOutside();
    symlinkSync(outside, join(project, '.claude-flow'), 'dir');
    const mod = await boot(world);
    const result = await compact(mod);
    expect(result).toEqual({ messages: [expect.objectContaining({ text: 'summary' })] });
    expect(readdirSync(outside)).toEqual([]);
  });
});
