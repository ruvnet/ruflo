#!/usr/bin/env node
/**
 * Safe NPX launcher with automatic ENOTEMPTY recovery.
 *
 * When run via npx, this script:
 *   1. Repairs stale npx cache entries (pre-flight)
 *   2. Proxies to the real CLI/MCP entry point
 *
 * This is designed to run AFTER npx has already resolved and installed
 * the package — it prevents the NEXT run from hitting ENOTEMPTY by
 * cleaning up stale artifacts left from THIS run or prior interrupted runs.
 *
 * For the case where npx itself fails (can't even get to this script),
 * use bin/claude-flow-mcp.sh which wraps the entire npx invocation.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Clean stale .package-XxXx rename artifacts from ALL npx cache dirs
function repairNpxCache() {
  const npxRoot = join(homedir(), '.npm', '_npx');
  if (!existsSync(npxRoot)) return 0;

  let cleaned = 0;
  try {
    for (const dir of readdirSync(npxRoot)) {
      const nm = join(npxRoot, dir, 'node_modules');
      if (!existsSync(nm)) continue;
      try {
        for (const entry of readdirSync(nm)) {
          if (entry.startsWith('.') && entry.includes('-') && /[A-Za-z]{8}$/.test(entry)) {
            try {
              const p = join(nm, entry);
              if (statSync(p).isDirectory()) {
                rmSync(p, { recursive: true, force: true });
                cleaned++;
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return cleaned;
}

// Always run repair on startup
repairNpxCache();
