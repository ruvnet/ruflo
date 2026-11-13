/**
 * CommonJS companion helpers that `hook-handler.cjs` requires but that are not
 * in the signed critical set (#3555).
 *
 * They are CommonJS, so they ship as `.cjs`: a `.js` copy cannot load in a
 * `"type":"module"` project. Installs made before the rename have only the
 * `.js` copies, which the refreshed hook-handler no longer requires, so the
 * refresh writes any missing `.cjs` companion from the CLI's own compiled
 * generators (the trust root; no external file to verify). Stale `.js` copies
 * are left in place and ignored. Existing `.cjs` files are preserved during
 * startup refresh; an explicit init upgrade replaces them from the generators.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';

export const COMMONJS_COMPANION_HELPERS = ['session.cjs', 'memory.cjs'] as const;

/** Missing is distinct from unreadable, a symlink (including dangling), or another file type. */
function companionState(target: string): 'missing' | 'regular' | 'unsafe' {
  try {
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink() ? 'regular' : 'unsafe';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe';
  }
}

/** The project/user root can itself be an alias; its helper directories may not be links. */
function safeHelpersDirectory(helpersDir: string): boolean {
  try {
    for (const directory of [path.dirname(helpersDir), helpersDir]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    }
    return true;
  } catch { return false; }
}

export async function ensureCommonJsCompanions(helpersDir: string, force = false): Promise<string[]> {
  helpersDir = path.resolve(helpersDir);
  if (!safeHelpersDirectory(helpersDir)) return [];
  const missing = COMMONJS_COMPANION_HELPERS.filter((name) => {
    const state = companionState(path.join(helpersDir, name));
    return state === 'missing' || (force && state === 'regular');
  });
  if (missing.length === 0) return [];
  const gen = await import('./helpers-generator.js');
  const content: Record<(typeof COMMONJS_COMPANION_HELPERS)[number], () => string> = {
    'session.cjs': gen.generateSessionManager,
    'memory.cjs': gen.generateMemoryHelper,
  };
  const written: string[] = [];
  for (const name of missing) {
    const target = path.join(helpersDir, name);
    const temporary = path.join(helpersDir, `.${name}.${randomUUID()}.tmp`);
    let created = false;
    try {
      // The import above yields: recheck before writing, and again before publication.
      if (!safeHelpersDirectory(helpersDir)) continue;
      const state = companionState(target);
      if (state === 'unsafe' || (!force && state === 'regular')) continue;
      const descriptor = fs.openSync(temporary, 'wx', 0o755);
      created = true;
      try {
        fs.writeFileSync(descriptor, content[name](), { encoding: 'utf-8' });
        fs.fchmodSync(descriptor, 0o755);
      } finally { fs.closeSync(descriptor); }
      if (!safeHelpersDirectory(helpersDir)) continue;
      const finalState = companionState(target);
      if (finalState === 'unsafe' || (!force && finalState === 'regular')) continue;
      fs.renameSync(temporary, target);
      written.push(name);
    } catch { /* best-effort: hook-handler degrades gracefully without it */ }
    finally {
      if (created) {
        try { fs.unlinkSync(temporary); } catch { /* renamed or already removed */ }
      }
    }
  }
  return written;
}
