#!/usr/bin/env node
/**
 * NPX Cache Repair
 *
 * Fixes the ENOTEMPTY error that occurs when npx's cache gets corrupted
 * from interrupted installs. This is a known npm bug affecting npm 10.x
 * on Node 22+ particularly in remote/CI environments.
 *
 * Usage:
 *   - Imported by bin entry points before main logic
 *   - Can also be run standalone: node bin/npx-repair.js
 */
import { readdirSync, readFileSync, rmSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Remove stale .{name}-{hash} rename artifacts from npx cache dirs.
 * These are leftover from npm's atomic rename strategy when interrupted.
 */
export function repairNpxCache() {
  const npxCacheRoot = join(homedir(), '.npm', '_npx');
  if (!existsSync(npxCacheRoot)) return;

  let cleaned = 0;
  try {
    const cacheDirs = readdirSync(npxCacheRoot);
    for (const dir of cacheDirs) {
      const nmDir = join(npxCacheRoot, dir, 'node_modules');
      if (!existsSync(nmDir)) continue;

      try {
        const entries = readdirSync(nmDir);
        for (const entry of entries) {
          // Stale rename targets look like: .package-name-XxXxXxXx
          if (entry.startsWith('.') && entry.includes('-') && /[A-Za-z]{8}$/.test(entry)) {
            const fullPath = join(nmDir, entry);
            try {
              const stat = statSync(fullPath);
              if (stat.isDirectory()) {
                rmSync(fullPath, { recursive: true, force: true });
                cleaned++;
              }
            } catch {
              // ignore individual failures
            }
          }
        }
      } catch {
        // can't read this cache dir, skip
      }
    }
  } catch {
    // npx cache root not readable, nothing to do
  }

  return cleaned;
}

/**
 * Remove corrupted _cacache integrity entries for claude-flow/ruflo packages.
 * Fixes ECOMPROMISED by clearing stale integrity hashes so npm re-fetches.
 */
export function repairCacheIntegrity() {
  const indexDir = join(homedir(), '.npm', '_cacache', 'index-v5');
  if (!existsSync(indexDir)) return 0;

  let cleaned = 0;
  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        const fp = join(dir, entry);
        try {
          const s = statSync(fp);
          if (s.isDirectory()) {
            walk(fp);
          } else {
            const content = readFileSync(fp, 'utf-8');
            if (content.includes('claude-flow') || content.includes('ruflo')) {
              unlinkSync(fp);
              cleaned++;
            }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip unreadable dir */ }
  }
  walk(indexDir);
  return cleaned;
}

/**
 * Remove a specific corrupted npx cache entry by hash.
 */
export function removeNpxCacheEntry(hash) {
  const target = join(homedir(), '.npm', '_npx', hash);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    return true;
  }
  return false;
}

/**
 * Full cache nuke — removes all npx cache entries.
 * Use as last resort when repair isn't enough.
 */
export function nukeNpxCache() {
  const npxCacheRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxCacheRoot)) {
    rmSync(npxCacheRoot, { recursive: true, force: true });
    return true;
  }
  return false;
}

// Run standalone
if (process.argv[1] && process.argv[1].includes('npx-repair')) {
  const arg = process.argv[2];
  if (arg === '--nuke') {
    console.error('[npx-repair] Removing entire npx cache...');
    nukeNpxCache();
    console.error('[npx-repair] Done.');
  } else {
    const cleaned = repairNpxCache();
    const intFixed = repairCacheIntegrity();
    if (cleaned > 0) {
      console.error(`[npx-repair] Cleaned ${cleaned} stale cache entries.`);
    }
    if (intFixed > 0) {
      console.error(`[npx-repair] Removed ${intFixed} corrupted integrity entries.`);
    }
  }
}
