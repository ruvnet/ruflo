import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6, high): the published claude-flow umbrella
// declares zod directly, and the cli/shared dist it ships resolves zod from the
// umbrella's own dependency, so this pin is what users actually get.
const require = createRequire(import.meta.url);
const semver = require('semver');
const FIXED = '4.6.6';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('root claude-flow package declares a zod range with no version below the fix', () => {
  const spec = pkg.dependencies?.zod;
  assert.ok(spec, 'root package.json must declare zod');
  const min = semver.minVersion(spec);
  assert.ok(min && semver.gte(min, FIXED), `zod spec "${spec}" allows versions below ${FIXED}`);
});

test('root lockfile resolves the hoisted zod at or above the fix', () => {
  assert.equal(lock.packages[''].dependencies.zod, pkg.dependencies.zod);
  const hoisted = lock.packages['node_modules/zod']?.version;
  assert.ok(hoisted && semver.gte(hoisted, FIXED), `hoisted zod ${hoisted} is below ${FIXED}`);
});
