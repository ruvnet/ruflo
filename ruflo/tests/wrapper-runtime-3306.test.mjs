import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const wrapperSource = fileURLToPath(new URL('../bin/ruflo.js', import.meta.url));

function install(t, cliVersion) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-wrapper-3306-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const wrapperDir = join(root, 'node_modules', 'ruflo');
  const cliDir = join(root, 'node_modules', '@claude-flow', 'cli');
  mkdirSync(join(wrapperDir, 'bin'), { recursive: true });
  mkdirSync(join(cliDir, 'bin'), { recursive: true });
  copyFileSync(wrapperSource, join(wrapperDir, 'bin', 'ruflo.js'));
  writeFileSync(join(wrapperDir, 'package.json'), JSON.stringify({ name: 'ruflo', version: '3.45.0', type: 'module' }));
  writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: cliVersion, type: 'module' }));
  writeFileSync(join(cliDir, 'bin', 'cli.js'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.RUFLO_TEST_MARKER, 'launched');\n`);
  return { bin: join(wrapperDir, 'bin', 'ruflo.js'), marker: join(root, 'cli-launched') };
}

function run(fixture, args) {
  return spawnSync(process.execPath, [fixture.bin, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, RUFLO_TEST_MARKER: fixture.marker },
  });
}

test('matching wrapper and runtime report the version without importing the CLI', (t) => {
  const fixture = install(t, '3.45.0');
  const result = run(fixture, ['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ruflo v3.45.0\n');
  assert.equal(existsSync(fixture.marker), false);
});

test('a stale runtime cannot masquerade as the current wrapper version', (t) => {
  const fixture = install(t, '3.33.0');
  const result = run(fixture, ['--version']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /3\.45\.0.*3\.33\.0/);
  assert.equal(existsSync(fixture.marker), false);
});

test('a stale runtime is refused before MCP protocol output or implementation import', (t) => {
  const fixture = install(t, '3.33.0');
  const result = run(fixture, ['mcp', 'start']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /requires @claude-flow\/cli/);
  assert.equal(existsSync(fixture.marker), false);
});

test('a matching runtime still receives MCP commands', (t) => {
  const fixture = install(t, '3.45.0');
  const result = run(fixture, ['mcp', 'start']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(fixture.marker), true);
});
