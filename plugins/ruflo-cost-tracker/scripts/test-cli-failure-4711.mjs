#!/usr/bin/env node
// #4711: cost-health subchecks must not report a failed CLI read as empty
// data, and health.mjs must resolve an npx CLI once before starting its
// parallel subchecks (four cold first installs race in one npx directory).
//
// A fake `npx` on PATH records every call. RUFLO_PLUGIN_SKIP_LOCAL_CLI and
// RUFLO_PLUGIN_SKIP_PATH_CLI keep a real ruflo install out of the way.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
let failed = 0;
function check(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failed++;
}

if (process.platform === 'win32') {
  console.log('skip: fake npx shim is POSIX-only');
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'cost-4711-'));
const log = join(dir, 'calls.log');
const npx = join(dir, 'npx');
// MODE=fail: every CLI call fails like a broken install; MODE=ok: version
// succeeds and memory list returns an empty namespace.
writeFileSync(npx, `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *--version*) echo 3.71.5; exit 0 ;;
esac
if [ "$MODE" = fail ]; then
  echo "[ERROR] Failed to list: memory database has an active native WAL connection" >&2
  exit 1
fi
case "$*" in
  *"memory list"*) echo "[]"; exit 0 ;;
esac
exit 1
`);
chmodSync(npx, 0o755);

const env = (mode) => ({
  ...process.env,
  PATH: `${dir}${delimiter}${process.env.PATH}`,
  MODE: mode,
  RUFLO_PLUGIN_SKIP_LOCAL_CLI: '1',
  RUFLO_PLUGIN_SKIP_PATH_CLI: '1',
  RUFLO_DAEMON_AUTOSTART: '0',
});
const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);

try {
  console.log('budget check with a failing CLI read');
  {
    const r = spawnSync('node', [join(SCRIPTS, 'budget.mjs'), 'check'], {
      cwd: dir, env: { ...env('fail'), BUDGET_QUIET: '1' }, encoding: 'utf8',
    });
    check(r.status === 2, `exits 2 (got ${r.status})`);
    check(/memory list failed \(exit 1\)/.test(r.stderr), 'says which CLI call failed');
    check(/active native WAL connection/.test(r.stderr), 'carries the CLI stderr');
    check(!/no budget set/.test(r.stdout + r.stderr), 'does not report "no budget set"');
  }

  console.log('burn with a failing CLI read');
  {
    const r = spawnSync('node', [join(SCRIPTS, 'burn.mjs'), '--format', 'json'], {
      cwd: dir, env: env('fail'), encoding: 'utf8',
    });
    check(r.status === 2, `exits 2 (got ${r.status})`);
    check(/memory list failed/.test(r.stderr), 'reports the failed read');
  }

  console.log('health resolves an npx CLI once before its parallel subchecks');
  {
    writeFileSync(log, '');
    const r = spawnSync('node', [join(SCRIPTS, 'health.mjs'), '--format', 'json'], {
      cwd: dir, env: env('ok'), encoding: 'utf8', timeout: 60_000,
    });
    const lines = calls();
    check(r.status === 0, `empty namespace → exit 0 (got ${r.status})`);
    check(/--version/.test(lines[0] || ''), `first CLI call is the serial warm-up (got "${lines[0]}")`);
    check(lines.filter((l) => /--version/.test(l)).length === 1, 'warms exactly once');
    check(lines.some((l) => /memory list/.test(l)), 'subchecks still read memory');
  }

  console.log('health skips the warm-up when told to');
  {
    writeFileSync(log, '');
    spawnSync('node', [join(SCRIPTS, 'health.mjs'), '--format', 'json'], {
      cwd: dir, env: { ...env('ok'), HEALTH_SKIP_WARMUP: '1' }, encoding: 'utf8', timeout: 60_000,
    });
    check(!calls().some((l) => /--version/.test(l)), 'no --version call');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
