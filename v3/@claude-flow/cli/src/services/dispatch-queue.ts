/**
 * Location of the MCP worker-dispatch queue (#1845).
 *
 * The queue lives in the user's state directory, keyed by project, not under
 * the project root: a queue entry starts a worker, and a cloned repository
 * controls every file under its root, so it could otherwise ship entries.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export function dispatchQueueDir(projectRoot: string): string {
  let root = resolve(projectRoot);
  try {
    // .native also canonicalises letter case on case-insensitive filesystems,
    // so the dispatching process and the daemon agree on the key.
    root = realpathSync.native(root);
  } catch {
    // A project that does not exist yet keeps its resolved path.
  }
  // An empty or relative override would resolve against the working
  // directory, i.e. back inside the project; only an absolute one counts.
  const override = process.env.RUFLO_AI_BUDGET_DIR;
  const base = override && isAbsolute(override) ? override : join(homedir(), '.claude-flow');
  const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return join(base, 'daemon-queue', key);
}
