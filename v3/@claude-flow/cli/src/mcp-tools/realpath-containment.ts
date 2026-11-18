/**
 * Project-root containment for MCP tools that read or write files.
 * Shared by hooks_codemod and hooks_fast-apply (moved out of hooks-tools.ts).
 */
import * as nodeFs from 'fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'path';

// Canonicalize a path that may not exist yet: realpath the nearest existing
// ancestor and re-attach the missing tail, so a symlinked parent still
// resolves to its real location (mirrors @claude-flow/security's
// canonicalizeSync, which is not exported).
export function realpathNearest(p: string): string {
  try {
    return nodeFs.realpathSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  const parent = dirname(p);
  if (parent === p) return p;
  return join(realpathNearest(parent), basename(p));
}

// CWE-59 (#4346): containment must compare real paths on BOTH sides — a
// symlink inside the project pointing outside it must not pass, and a
// symlinked project root (e.g. macOS /var -> /private/var) must not make
// every path fail. Fails closed if canonicalization throws (ELOOP, EACCES).
export function isInsideRealRoot(realRoot: string, abs: string): boolean {
  let real: string;
  try {
    real = realpathNearest(abs);
  } catch {
    return false;
  }
  const rel = relative(realRoot, real);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}
