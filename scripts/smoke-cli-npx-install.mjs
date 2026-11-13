#!/usr/bin/env node
/**
 * Smoke: `npx`-style install of the CLI tarball (regression guard for #1147 and #2018).
 *
 * Both issues report the same user-visible failure:
 *   $ npx @claude-flow/cli@latest …
 *   npm error Invalid Version:
 *
 * Caused by an `optionalDependencies` ↔ `peerDependencies` overlap deep in
 * the dep tree (see audit-package-dep-overlap.mjs for the static guard).
 * This script is the BEHAVIOURAL guard — it packs the locally-built CLI,
 * installs the tarball into a scratch project, and asserts `node bin/cli.js
 * --version` runs without an `Invalid Version` crash from npm/arborist.
 *
 * Strategy:
 *   1. `pnpm pack` the CLI (rewrites workspace:* protocol to resolved versions)
 *   2. `npm init -y` in $RUNNER_TEMP/cli-npx-smoke
 *   3. `npm install <tarball>` — captures full npm output
 *   4. Fail if stdout/stderr contains "Invalid Version" OR install exits non-zero
 *   5. Run the installed `cli --version` and assert it prints
 *
 * Runs in CI under Node 22 + 24 to catch the npm 11.x dedupe regression
 * (#2018 hit users on Node 25 / npm 11.12).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const CLI_DIR = join(REPO_ROOT, 'v3', '@claude-flow', 'cli');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
  return { code: r.status ?? -1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function fail(msg) {
  console.error(`\n::error::smoke-cli-npx-install: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(CLI_DIR, 'package.json'))) fail(`cli package not found at ${CLI_DIR}`);
if (!existsSync(join(CLI_DIR, 'bin', 'cli.js'))) fail(`cli not built — run \`pnpm --filter @claude-flow/cli build\` first`);

// 1. Pack the CLI. Prefer pnpm pack (rewrites workspace:*); fall back to npm pack.
const packDest = mkdtempSync(join(tmpdir(), 'cli-pack-'));
let tarball;
{
  console.log(`[1/5] packing CLI to ${packDest}`);
  // #4940: pack what a release packs. A release stages the bundled runtime
  // packages (and their vendored dependencies) and then runs npm pack; a bare
  // `pnpm pack` bundles the workspace links, which is not the published shape.
  let pnpm = { code: 1, stderr: 'skipped: staged bundles are packed with npm' };
  try {
    const { stageInternalRuntimeBundles } = await import('./stage-internal-runtime-bundles.mjs');
    await stageInternalRuntimeBundles(CLI_DIR, { build: false });
    const staged = run('npm', ['pack', '--ignore-scripts', '--pack-destination', packDest], { cwd: CLI_DIR });
    if (staged.code !== 0) fail(`npm pack of the staged CLI failed:\n${staged.stderr}`);
    const tgz = readdirSync(packDest).find((f) => f.endsWith('.tgz'));
    if (tgz) tarball = join(packDest, tgz);
  } catch (error) {
    fail(`staging the bundled runtime packages failed: ${error?.stack ?? error}`);
  }
  if (!tarball) {
    // Fallback to npm pack — works when run with pnpm-resolved workspace already installed
    const npmPack = run('npm', ['pack', '--pack-destination', packDest], { cwd: CLI_DIR });
    if (npmPack.code !== 0) fail(`pnpm pack AND npm pack failed:\n${pnpm.stderr}\n---\n${npmPack.stderr}`);
    const tgz = readdirSync(packDest).find((f) => f.endsWith('.tgz'));
    if (!tgz) fail(`pack produced no .tgz in ${packDest}`);
    tarball = join(packDest, tgz);
  }
  console.log(`      tarball: ${tarball}`);
}

// 2. Scratch project (mirrors what `npx <pkg>` does — temp dir, fresh install)
const scratch = mkdtempSync(join(tmpdir(), 'cli-npx-smoke-'));
console.log(`[2/5] scratch project: ${scratch}`);
writeFileSync(join(scratch, 'package.json'), JSON.stringify({
  name: 'cli-npx-smoke', private: true, type: 'module', version: '0.0.0',
}, null, 2));

// 3. Install — this is where #1147 / #2018 reproduce.
// Mirror what `npx <pkg>` does: install with optionals enabled (the bug is
// triggered when arborist places `@huggingface/transformers` via the
// embeddings package's optional chain). We capture the full npm output and
// grep for "Invalid Version:" regardless of exit code — some installs
// reported the crash mid-tree but completed enough other work to exit 0.
console.log(`[3/5] npm install ${tarball}`);
const install = run('npm', ['install', tarball, '--no-audit', '--no-fund'], { cwd: scratch });
const out = install.stdout + '\n' + install.stderr;
if (/Invalid Version:/i.test(out)) {
  console.error(out);
  fail('npm install printed "Invalid Version:" — regression of #1147 / #2018');
}
if (install.code !== 0) {
  console.error(out);
  fail(`npm install exited ${install.code}`);
}

// 4. Resolve installed bin (handle pkg.bin shape — string or object)
const installedPkgPath = join(scratch, 'node_modules', '@claude-flow', 'cli', 'package.json');
if (!existsSync(installedPkgPath)) fail(`installed cli package.json missing: ${installedPkgPath}`);
const installedPkg = JSON.parse(execFileSync('node', ['-e', `console.log(JSON.stringify(require(${JSON.stringify(installedPkgPath)})))`], { encoding: 'utf-8' }));
let binRel;
if (typeof installedPkg.bin === 'string') binRel = installedPkg.bin;
else if (installedPkg.bin && typeof installedPkg.bin === 'object') {
  binRel = installedPkg.bin['claude-flow'] || installedPkg.bin.cli || Object.values(installedPkg.bin)[0];
}
if (!binRel) fail('installed cli package.json has no usable "bin"');
const binAbs = resolve(join(scratch, 'node_modules', '@claude-flow', 'cli'), binRel);
if (!existsSync(binAbs)) fail(`installed cli bin missing on disk: ${binAbs}`);

console.log(`[4/5] running ${binAbs} --version`);
const ver = run('node', [binAbs, '--version'], { cwd: scratch });
if (ver.code !== 0 || !ver.stdout.trim()) {
  console.error(ver.stdout);
  console.error(ver.stderr);
  fail(`cli --version failed (exit ${ver.code})`);
}
console.log(`      ${ver.stdout.trim()}`);

// #4940: every bundled runtime package must load from the installed CLI. The
// bundled security package once resolved `zod` to the CLI's zod 3 and its root
// export threw `z.config is not a function`; --version never imports it.
const cliRoot = join(scratch, 'node_modules', '@claude-flow', 'cli');
for (const name of installedPkg.bundleDependencies ?? installedPkg.bundledDependencies ?? []) {
  const load = run('node', ['--input-type=module', '-e',
    `import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
     const r = createRequire(${JSON.stringify(join(cliRoot, 'package.json'))});
     await import(pathToFileURL(r.resolve(${JSON.stringify(name)})).href);`], { cwd: scratch });
  if (load.code !== 0) {
    console.error(load.stderr);
    fail(`bundled ${name} does not import from the installed CLI (exit ${load.code})`);
  }
  console.log(`      bundled ${name} imports`);
}

console.log(`[5/5] ok — installed cleanly, no "Invalid Version" regression, bundled runtimes import`);
