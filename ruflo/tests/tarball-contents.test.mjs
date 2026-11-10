// The published `ruflo` package is the CLI wrapper only. The chat UI, the MCP
// bridge and the deploy scripts under src/ are built from the repo (Docker,
// Cloud Build) and nothing in bin/ reads them, so they stay out of the tarball.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function packedFiles() {
  const out = execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' },
  );
  return JSON.parse(out)[0].files.map((f) => f.path);
}

test('the ruflo tarball ships the wrapper and nothing from src/', () => {
  const files = packedFiles();
  assert.ok(files.length > 0, 'npm pack listed no files');
  assert.ok(files.includes('bin/ruflo.js'), 'bin/ruflo.js must ship');
  assert.ok(files.includes('package.json'), 'package.json must ship');

  const allowed = (p) => p.startsWith('bin/') || p.startsWith('dist/')
    || ['package.json', 'README.md', 'LICENSE'].includes(p);
  const unexpected = files.filter((p) => !allowed(p));
  assert.deepEqual(unexpected, [], `unexpected files in the ruflo tarball: ${unexpected.slice(0, 10).join(', ')}`);
});
