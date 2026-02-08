#!/usr/bin/env node
// Ruflo CLI - thin wrapper around @claude-flow/cli
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try loading from @claude-flow/cli dependency first, fall back to bundled
try {
  const cliPath = createRequire(import.meta.url).resolve('@claude-flow/cli/bin/cli.js');
  await import(cliPath);
} catch {
  // Fallback: try relative path (for development / linked installs)
  await import(resolve(__dirname, '../../v3/@claude-flow/cli/bin/cli.js'));
}
