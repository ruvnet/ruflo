/**
 * `writeWithoutLinks` (files.ts): the one guarded write for the mods'
 * `.claude-flow` files (#4746). The engine's `$.fs` has no `lstat` or
 * `realpath`, but its `stat` reports a link (`isLink`, plus the target's
 * kind) instead of following it silently — so the guard walks every path
 * component below the project root and refuses the write when any of them
 * is a link, is the wrong kind, or cannot be statted. These tests drive the
 * guard with a fake host shaped like the live engine's answers.
 */
import { describe, it, expect } from 'vitest';

import { writeWithoutLinks, type WriteHost } from '../../../../../plugins/ruflo-mods/hooks/files';

type Entry = { kind?: string; isLink?: boolean; error?: Error };
const enoent = () => Object.assign(new Error("ENOENT: no such file or directory"), { code: 'ENOENT' });

function host(entries: Record<string, Entry>, missing: 'enoent' | 'refuse' = 'enoent') {
  const writes: { path: string; text: string }[] = [];
  const stats: string[] = [];
  const fs: WriteHost = {
    stat: async (path: string) => {
      stats.push(path);
      const entry = entries[path];
      if (!entry) {
        if (missing === 'enoent') throw enoent();
        throw new Error('EACCES: permission denied');
      }
      if (entry.error) throw entry.error;
      return { kind: entry.kind ?? 'file', size: 1, mtimeMs: 1, isLink: entry.isLink ?? false } as never;
    },
    write: async (path: string, text: string) => {
      writes.push({ path, text });
    },
  };
  return { fs, writes, stats };
}

const ROOT = '/work';
const PATH = '/work/.claude-flow/mods/session.json';
const DIRS = {
  '/work/.claude-flow': { kind: 'dir' },
  '/work/.claude-flow/mods': { kind: 'dir' },
};

describe('writeWithoutLinks', () => {
  it('writes when the folders and the target are all missing', async () => {
    const { fs, writes, stats } = host({});
    await writeWithoutLinks(fs, ROOT, PATH, 'hello');
    expect(writes).toEqual([{ path: PATH, text: 'hello' }]);
    // The first missing component ends the walk: nothing below it can exist.
    expect(stats).toEqual(['/work/.claude-flow']);
  });

  it('overwrites an existing regular file', async () => {
    const { fs, writes } = host({ ...DIRS, [PATH]: { kind: 'file' } });
    await writeWithoutLinks(fs, ROOT, PATH, 'hello');
    expect(writes).toEqual([{ path: PATH, text: 'hello' }]);
  });

  it('refuses a linked .claude-flow dir (the live engine reports the target kind plus isLink)', async () => {
    const { fs, writes } = host({ '/work/.claude-flow': { kind: 'dir', isLink: true } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/is a link/);
    expect(writes).toEqual([]);
  });

  it('refuses a linked intermediate dir', async () => {
    const { fs, writes } = host({ '/work/.claude-flow': { kind: 'dir' }, '/work/.claude-flow/mods': { kind: 'dir', isLink: true } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/is a link/);
    expect(writes).toEqual([]);
  });

  it('refuses a linked target', async () => {
    const { fs, writes } = host({ ...DIRS, [PATH]: { kind: 'file', isLink: true } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/is a link/);
    expect(writes).toEqual([]);
  });

  it('refuses a target that exists but is not a regular file', async () => {
    const { fs, writes } = host({ ...DIRS, [PATH]: { kind: 'dir' } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/not a regular file/);
    expect(writes).toEqual([]);
  });

  it('refuses an intermediate component that exists but is not a dir', async () => {
    const { fs, writes } = host({ '/work/.claude-flow': { kind: 'file' } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/not a folder/);
    expect(writes).toEqual([]);
  });

  it('refuses a path outside the root', async () => {
    const { fs, writes } = host({});
    await expect(writeWithoutLinks(fs, ROOT, '/work/../outside/x.json', 'hello')).rejects.toThrow(/outside the project/);
    await expect(writeWithoutLinks(fs, ROOT, '/etc/x.json', 'hello')).rejects.toThrow(/outside the project/);
    expect(writes).toEqual([]);
  });

  it('refuses when a stat fails with anything but ENOENT (fail closed)', async () => {
    const { fs, writes } = host({ '/work/.claude-flow': { error: Object.assign(new Error('EACCES'), { code: 'EACCES' }) } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/cannot be checked/);
    expect(writes).toEqual([]);
  });

  it("refuses a 'symlink' kind even when isLink is not set", async () => {
    const { fs, writes } = host({ ...DIRS, [PATH]: { kind: 'symlink', isLink: false } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/is a link/);
    expect(writes).toEqual([]);
  });

  it('does not stat the project root itself (the root may legitimately be an alias)', async () => {
    const { fs, stats } = host({ '/work/.claude-flow': { kind: 'dir', isLink: true } });
    await expect(writeWithoutLinks(fs, ROOT, PATH, 'hello')).rejects.toThrow(/is a link/);
    expect(stats).not.toContain('/work');
  });
});
