#!/usr/bin/env node
// smoke-compact-exit — compact.mjs must exit once it has printed its result,
// even when the token optimizer leaves a timer alive (a patched agentic-flow
// >= 2.0.14 does exactly that through agentic-flow/reasoningbank).
//
// Builds a throwaway marketplace layout whose integration package keeps a
// setInterval running, runs compact.mjs against it, and fails if the process
// is still alive after the deadline or if stdout lost the JSON result.
//
// Usage: node plugins/ruflo-cost-tracker/scripts/smoke-compact-exit.mjs [path/to/compact.mjs]

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] || join(here, 'compact.mjs'));
const root = mkdtempSync(join(tmpdir(), 'compact-exit-'));
const DEADLINE_MS = 15_000;

try {
  const scripts = join(root, 'plugins', 'ruflo-cost-tracker', 'scripts');
  const dist = join(root, 'v3', '@claude-flow', 'integration', 'dist');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(dist, { recursive: true });
  copyFileSync(source, join(scripts, 'compact.mjs'));
  writeFileSync(
    join(dist, 'token-optimizer.js'),
    [
      '// Stand-in for a token optimizer whose backend keeps a timer alive.',
      'export async function getTokenOptimizer() {',
      '  setInterval(() => {}, 1000);',
      '  return {',
      '    async getCompactContext() { return { memories: [{}, {}], tokensSaved: 42 }; },',
      "    getStats() { return { agenticFlowAvailable: true, cacheHitRate: '50%' }; },",
      '  };',
      '}',
      '',
    ].join('\n'),
  );

  const run = spawnSync(process.execPath, [join(scripts, 'compact.mjs'), 'auth patterns'], {
    env: { ...process.env, COMPACT_QUIET: '1' },
    encoding: 'utf8',
    timeout: DEADLINE_MS,
  });

  if (run.error?.code === 'ETIMEDOUT' || run.signal) {
    console.error(`FAIL: compact.mjs was still running after ${DEADLINE_MS} ms`);
    process.exit(1);
  }
  if (run.status !== 0) {
    console.error(`FAIL: compact.mjs exited ${run.status}\n${run.stderr}`);
    process.exit(1);
  }
  const out = JSON.parse(run.stdout.trim());
  if (out.memoriesRetrieved !== 2 || out.tokensSaved !== 42 || out.agenticFlowAvailable !== true) {
    console.error(`FAIL: unexpected result ${run.stdout}`);
    process.exit(1);
  }
  console.log('ok: compact.mjs printed its result and exited with a live timer');
} finally {
  rmSync(root, { recursive: true, force: true });
}
