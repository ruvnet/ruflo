#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  alignBundledRuntimeVersion,
  createBundledRuntimeManifest,
} from '../stage-internal-runtime-bundles.mjs';

const source = {
  name: '@claude-flow/example',
  version: '1.2.3',
  main: 'dist/index.js',
  dependencies: { runtime: '^1.0.0' },
  optionalDependencies: { native: '^2.0.0' },
  peerDependencies: { host: '^3.0.0' },
  peerDependenciesMeta: { host: { optional: true } },
};

const bundled = createBundledRuntimeManifest(source);

assert.equal(bundled.name, source.name);
assert.equal(bundled.version, source.version);
assert.equal(bundled.main, source.main);
assert.equal(bundled.dependencies, undefined);
assert.equal(bundled.optionalDependencies, undefined);
assert.equal(bundled.peerDependencies, undefined);
assert.equal(bundled.peerDependenciesMeta, undefined);
assert.deepEqual(bundled.rufloBundledRuntime, {
  format: 1,
  sourceDependencies: {
    dependencies: source.dependencies,
    optionalDependencies: source.optionalDependencies,
    peerDependencies: source.peerDependencies,
    peerDependenciesMeta: source.peerDependenciesMeta,
  },
});
assert.deepEqual(source.dependencies, { runtime: '^1.0.0' });

const security = createBundledRuntimeManifest({
  name: '@claude-flow/security',
  version: '3.0.7',
  dependencies: { '@noble/ed25519': '^2.1.0', zod: '^4.6.7' },
});
assert.deepEqual(security.dependencies, { zod: '^4.6.7' });
assert.deepEqual(security.rufloBundledRuntime.sourceDependencies.dependencies, {
  '@noble/ed25519': '^2.1.0',
  zod: '^4.6.7',
});

const target = {
  name: 'public-wrapper',
  dependencies: { '@claude-flow/mcp': '3.0.0-alpha.9' },
};
assert.equal(alignBundledRuntimeVersion(target, {
  name: '@claude-flow/mcp',
  version: '3.0.0-alpha.10',
}), true);
assert.equal(target.dependencies['@claude-flow/mcp'], '3.0.0-alpha.10');
assert.equal(alignBundledRuntimeVersion(target, {
  name: '@claude-flow/mcp',
  version: '3.0.0-alpha.10',
}), false);

console.log('bundled runtime manifest is self-contained and preserves source metadata');
