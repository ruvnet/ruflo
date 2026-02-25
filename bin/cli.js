#!/usr/bin/env node
/**
 * Claude Flow CLI - Umbrella entry point
 * Proxies to @claude-flow/cli bin for cross-platform compatibility.
 *
 * Includes pre-flight npx cache repair to prevent ENOTEMPTY errors
 * in remote/CI environments (known npm 10.x bug).
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Repair stale npx cache entries and corrupted integrity before loading
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const mod = await import(pathToFileURL(join(__dirname, 'npx-repair.js')).href);
  mod.repairNpxCache();
  if (mod.repairCacheIntegrity) mod.repairCacheIntegrity();
} catch {
  // Non-fatal — continue even if repair fails
}

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname2, '..', 'v3', '@claude-flow', 'cli', 'bin', 'cli.js');
await import(pathToFileURL(cliPath).href);
