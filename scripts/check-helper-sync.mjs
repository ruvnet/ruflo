#!/usr/bin/env node
/** Verify a helper sync before committing; never sign or repair its inputs. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'v3', '@claude-flow', 'cli');
const vitest = join(cli, 'node_modules', 'vitest');

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`Helper sync check failed (${result.signal || result.status}): ${args.join(' ')}`);
  }
}

try {
  const manifest = join(vitest, 'package.json');
  const runner = join(vitest, 'vitest.mjs');
  if (!existsSync(manifest) || !existsSync(runner)) {
    throw new Error('CLI-local Vitest 4 is required. Run pnpm install --frozen-lockfile in v3 first.');
  }
  const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!/^4\./.test(version)) throw new Error(`CLI-local Vitest 4 is required; found ${version}.`);

  console.log('[helper-sync] Checking root and packaged hook-handler.cjs imports and timeout behavior');
  run(['--test', join(root, 'tests', 'hook-handler-runwithtimeout.test.cjs')], root);
  console.log('[helper-sync] Checking the committed packaged helpers.manifest.json signature and helper bytes');
  run([runner, 'run', '__tests__/helper-signing.test.ts', '--maxWorkers=1'], cli);
} catch (error) {
  console.error(`[helper-sync] ${error.message}`);
  process.exitCode = 1;
}
