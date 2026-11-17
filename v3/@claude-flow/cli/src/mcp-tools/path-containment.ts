/**
 * Path checks for MCP tools that read or write a caller-named file.
 *
 * Paths in tool input come from whoever drives the MCP server, including a
 * model following injected instructions. A tool that writes or reads such a
 * path must keep it inside the project directory, and must not follow a
 * symlink out of it.
 */

import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isNonProjectDir } from '@claude-flow/cli-core/mcp-tools/types';
import { getProjectCwd } from './types.js';
import { existingFileIsEncrypted } from '../fs-secure.js';

function lstatOrNull(p: string) {
  try { return lstatSync(p); } catch { return null; }
}

function projectRoot(): string | null {
  const root = realpathSync(getProjectCwd());
  // A server started in a home or filesystem root has no project to contain
  // writes to; "inside the root" would mean the whole home directory.
  return isNonProjectDir(root) ? null : root;
}

function insideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  return !rel.split(sep).includes('.git');
}

/**
 * Resolve a caller-named output file inside the project. The real parent
 * directory must be inside the real project root and outside `.git`, and an
 * existing target must be a regular, non-executable file — not a symlink.
 * `extensions`, when given, lists the allowed lower-case file extensions.
 */
export function containedWritePath(p: string, extensions?: readonly string[]): string | null {
  if (!p || p.includes('\0')) return null;
  try {
    const root = projectRoot();
    if (!root) return null;
    const abs = resolve(root, p);
    if (extensions && !extensions.includes(extname(abs).toLowerCase())) return null;
    const target = join(realpathSync(dirname(abs)), basename(abs));
    if (!insideRoot(root, target)) return null;
    const existing = lstatOrNull(target);
    if (existing && (existing.isSymbolicLink() || !existing.isFile() || (existing.mode & 0o111) !== 0)) return null;
    return target;
  } catch {
    return null;
  }
}

/** Resolve a caller-named input file inside the project: a regular file, not a symlink. */
export function containedReadPath(p: string): string | null {
  if (!p || p.includes('\0')) return null;
  try {
    const root = projectRoot();
    if (!root) return null;
    const abs = resolve(root, p);
    const existing = lstatOrNull(abs);
    if (!existing || existing.isSymbolicLink() || !existing.isFile()) return null;
    const target = realpathSync(abs);
    return insideRoot(root, target) ? target : null;
  } catch {
    return null;
  }
}

const DB_EXTENSIONS = ['.db', '.sqlite', '.sqlite3'];
const SQLITE_HEADER = 'SQLite format 3\0';

/**
 * Check a caller-named memory database path. It may live outside the project
 * (the CLI's `--path` flag passes one), so this does not contain it; instead
 * it refuses anything that is not plainly a SQLite database (plaintext, or
 * encrypted at rest per ADR-096), so the memory tools cannot be pointed at and
 * overwrite an unrelated file.
 */
export function dbPathError(p: string): string | null {
  if (p.includes('\0')) return 'dbPath contains a null byte';
  if (!DB_EXTENSIONS.includes(extname(p).toLowerCase())) {
    return `dbPath must end in ${DB_EXTENSIONS.join(', ')}`;
  }
  const existing = lstatOrNull(p);
  if (!existing) return null;
  if (existing.isSymbolicLink()) return 'dbPath must not be a symlink';
  if (!existing.isFile()) return 'dbPath must be a regular file';
  if (existing.size === 0 || existingFileIsEncrypted(p) === true) return null;
  const header = Buffer.alloc(SQLITE_HEADER.length);
  let fd: number | undefined;
  try {
    fd = openSync(p, 'r');
    readSync(fd, header, 0, header.length, 0);
  } catch {
    return 'dbPath could not be read';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return header.toString('latin1') === SQLITE_HEADER ? null : 'dbPath is not a SQLite database';
}

/**
 * Marks a tool call made by the local CLI on the operator's behalf (for
 * example `ruflo memory export --output ~/backup.json`). MCP requests arrive
 * as JSON and cannot carry a symbol key, so this cannot be forged remotely.
 */
export const LOCAL_CLI_CALL: unique symbol = Symbol('ruflo.localCliCall');

export function localCliContext(): Record<string, unknown> {
  return { [LOCAL_CLI_CALL]: true } as unknown as Record<string, unknown>;
}

export function isLocalCliCall(context: unknown): boolean {
  return !!context && typeof context === 'object'
    && (context as Record<PropertyKey, unknown>)[LOCAL_CLI_CALL] === true;
}
