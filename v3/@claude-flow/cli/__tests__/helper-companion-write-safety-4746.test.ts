import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCommonJsCompanions, COMMONJS_COMPANION_HELPERS } from '../src/init/helper-companions.js';
import { generateMemoryHelper, generateSessionManager } from '../src/init/helpers-generator.js';

const roots: string[] = [];
const content = { 'session.cjs': generateSessionManager, 'memory.cjs': generateMemoryHelper };
vi.mock('fs', async () => ({ ...await vi.importActual<typeof import('node:fs')>('node:fs') }));

const fileSymlinksSupported = (() => {
  const probe = fs.mkdtempSync(join(tmpdir(), 'ruflo-link-probe-'));
  try {
    fs.symlinkSync(join(probe, 'missing'), join(probe, 'link'));
    return true;
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  } finally { fs.rmSync(probe, { recursive: true, force: true }); }
})();

function project(): { root: string; helpers: string; outside: string } {
  const root = fs.mkdtempSync(join(tmpdir(), 'ruflo-companions-'));
  roots.push(root);
  const helpers = join(root, 'project', '.claude', 'helpers');
  const outside = join(root, 'outside');
  fs.mkdirSync(helpers, { recursive: true });
  fs.mkdirSync(outside);
  return { root, helpers, outside };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('companion helper publication', () => {
  it('generates complete companions and preserves existing regular files unless forced', async () => {
    const { helpers } = project();
    expect(await ensureCommonJsCompanions(helpers)).toEqual([...COMMONJS_COMPANION_HELPERS]);
    for (const name of COMMONJS_COMPANION_HELPERS) {
      expect(fs.readFileSync(join(helpers, name), 'utf8')).toBe(content[name]());
    }
    fs.writeFileSync(join(helpers, 'session.cjs'), 'user-edited');
    expect(await ensureCommonJsCompanions(helpers)).toEqual([]);
    expect(fs.readFileSync(join(helpers, 'session.cjs'), 'utf8')).toBe('user-edited');
    expect(await ensureCommonJsCompanions(helpers, true)).toEqual([...COMMONJS_COMPANION_HELPERS]);
    expect(fs.readFileSync(join(helpers, 'session.cjs'), 'utf8')).toBe(content['session.cjs']());
    expect(fs.readdirSync(helpers).sort()).toEqual([...COMMONJS_COMPANION_HELPERS].sort());
  });

  it.skipIf(!fileSymlinksSupported).each(COMMONJS_COMPANION_HELPERS)('never follows a dangling %s symlink', async name => {
    const { helpers, outside } = project();
    const destination = join(outside, 'missing.cjs');
    fs.symlinkSync(destination, join(helpers, name));
    const written = await ensureCommonJsCompanions(helpers);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.lstatSync(join(helpers, name)).isSymbolicLink()).toBe(true);
    expect(written).not.toContain(name);
    expect(written).toHaveLength(1);
  });

  it.skipIf(!fileSymlinksSupported).each(COMMONJS_COMPANION_HELPERS)('does not overwrite a live %s symlink on forced refresh', async name => {
    const { helpers, outside } = project();
    const destination = join(outside, 'existing.cjs');
    fs.writeFileSync(destination, 'outside-owned');
    fs.symlinkSync(destination, join(helpers, name));
    expect(await ensureCommonJsCompanions(helpers, true)).not.toContain(name);
    expect(fs.readFileSync(destination, 'utf8')).toBe('outside-owned');
    expect(fs.lstatSync(join(helpers, name)).isSymbolicLink()).toBe(true);
  });

  it.each(['helpers', '.claude'])('refuses a symlinked %s directory', async component => {
    const { helpers, outside } = project();
    const target = component === 'helpers' ? helpers : join(helpers, '..');
    fs.rmSync(target, { recursive: true });
    if (component === '.claude') fs.mkdirSync(join(outside, 'helpers'));
    fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await ensureCommonJsCompanions(helpers, true)).toEqual([]);
    expect(fs.readdirSync(component === 'helpers' ? outside : join(outside, 'helpers'))).toEqual([]);
  });

  it('replaces hard-linked regular targets without altering the linked file', async () => {
    const { helpers, outside } = project();
    const destination = join(outside, 'existing.cjs');
    fs.writeFileSync(destination, 'outside-owned');
    fs.linkSync(destination, join(helpers, 'session.cjs'));
    expect(await ensureCommonJsCompanions(helpers, true)).toContain('session.cjs');
    expect(fs.readFileSync(destination, 'utf8')).toBe('outside-owned');
    expect(fs.readFileSync(join(helpers, 'session.cjs'), 'utf8')).toBe(content['session.cjs']());
  });

  it('leaves non-file targets intact and still installs the other companion', async () => {
    const { helpers } = project();
    fs.mkdirSync(join(helpers, 'session.cjs'));
    expect(await ensureCommonJsCompanions(helpers, true)).toEqual(['memory.cjs']);
    expect(fs.statSync(join(helpers, 'session.cjs')).isDirectory()).toBe(true);
  });

  it.each(['writeFileSync', 'fchmodSync', 'renameSync'] as const)('keeps prior content and cleans temps when %s fails', async operation => {
    const { helpers } = project();
    fs.writeFileSync(join(helpers, 'session.cjs'), 'prior');
    vi.spyOn(fs, operation).mockImplementation(() => { throw new Error('fixture-publication-failure'); });
    expect(await ensureCommonJsCompanions(helpers, true)).toEqual([]);
    expect(fs.readFileSync(join(helpers, 'session.cjs'), 'utf8')).toBe('prior');
    expect(fs.readdirSync(helpers)).toEqual(['session.cjs']);
  });

  it('treats an unreadable destination as unsafe, not absent', async () => {
    const { helpers } = project();
    const lstat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...args: any[]) => {
      if (target === join(helpers, 'session.cjs')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return lstat(target, ...args as []);
    });
    expect(await ensureCommonJsCompanions(helpers, true)).toEqual(['memory.cjs']);
    expect(fs.existsSync(join(helpers, 'session.cjs'))).toBe(false);
  });

  it('preserves a regular file that appears after candidate selection', async () => {
    const { helpers } = project();
    const target = join(helpers, 'session.cjs');
    const lstat = fs.lstatSync;
    let checks = 0;
    vi.spyOn(fs, 'lstatSync').mockImplementation((candidate, ...args: any[]) => {
      if (candidate === target && ++checks === 2) fs.writeFileSync(target, 'concurrent regular file');
      return lstat(candidate, ...args as []);
    });
    expect(await ensureCommonJsCompanions(helpers)).toEqual(['memory.cjs']);
    expect(fs.readFileSync(target, 'utf8')).toBe('concurrent regular file');
  });

  it.skipIf(!fileSymlinksSupported)('refuses a target link planted before publication and removes its temp', async () => {
    const { helpers, outside } = project();
    const target = join(helpers, 'session.cjs');
    const destination = join(outside, 'missing.cjs');
    const chmod = fs.fchmodSync;
    vi.spyOn(fs, 'fchmodSync').mockImplementationOnce((descriptor, mode) => {
      fs.symlinkSync(destination, target);
      return chmod(descriptor, mode);
    });
    expect(await ensureCommonJsCompanions(helpers, true)).toEqual(['memory.cjs']);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(helpers).sort()).toEqual([...COMMONJS_COMPANION_HELPERS].sort());
  });

  it.skipIf(process.platform === 'win32')('sets executable permissions before publishing', async () => {
    const { helpers } = project();
    await ensureCommonJsCompanions(helpers);
    for (const name of COMMONJS_COMPANION_HELPERS) expect(fs.statSync(join(helpers, name)).mode & 0o777).toBe(0o755);
  });
});
