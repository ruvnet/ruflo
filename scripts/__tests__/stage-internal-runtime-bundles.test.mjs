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

// #4940: a vendored dependency stays declared and its files ship in the bundle.
{
  const { mkdtemp, mkdir, writeFile, readFile, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { vendorDependency, satisfiesCaretOrExact } = await import('../stage-internal-runtime-bundles.mjs');
  assert.equal(satisfiesCaretOrExact('4.6.7', '^4.6.7'), true);
  assert.equal(satisfiesCaretOrExact('4.7.0', '^4.6.7'), true);
  assert.equal(satisfiesCaretOrExact('4.6.6', '^4.6.7'), false);
  assert.equal(satisfiesCaretOrExact('5.0.0', '^4.6.7'), false);
  assert.equal(satisfiesCaretOrExact('3.25.76', '^4.6.7'), false);
  assert.equal(satisfiesCaretOrExact('4.6.7', '4.6.7'), true);
  assert.throws(() => satisfiesCaretOrExact('4.6.7', '>=4'), /Unsupported/);
  assert.throws(() => satisfiesCaretOrExact('0.2.1', '^0.2.0'), /Unsupported/);

  const withVendored = createBundledRuntimeManifest(
    { name: '@claude-flow/example', version: '1.0.0', dependencies: { leaf: '^4.6.7', other: '^1.0.0' } },
    ['leaf'],
  );
  assert.deepEqual(withVendored.dependencies, { leaf: '^4.6.7' });
  assert.deepEqual(withVendored.rufloBundledRuntime.sourceDependencies.dependencies, {
    leaf: '^4.6.7',
    other: '^1.0.0',
  });
  assert.throws(
    () => createBundledRuntimeManifest({ name: 'x', dependencies: {} }, ['leaf']),
    /does not declare its vendored dependency leaf/,
  );

  const root = await mkdtemp(join(tmpdir(), 'stage-vendored-'));
  try {
    const source = join(root, 'source');
    const staged = join(root, 'staged');
    const fixture = async (name, manifest) => {
      const directory = join(source, 'node_modules', name);
      await mkdir(join(directory, 'node_modules', 'nested'), { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.js', ...manifest }));
      await writeFile(join(directory, 'index.js'), 'module.exports = 4;\n');
      await writeFile(join(directory, 'node_modules', 'nested', 'x.js'), '');
    };
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'package.json'), '{"name":"@claude-flow/example"}');
    await fixture('leaf', { version: '4.6.9' });
    await fixture('old', { version: '3.25.76' });
    await fixture('tree', { version: '1.0.0', dependencies: { more: '^1.0.0' } });
    const pkg = { name: '@claude-flow/example', dependencies: { leaf: '^4.6.7', old: '^4.6.7', tree: '^1.0.0' } };

    assert.equal(await vendorDependency(source, staged, pkg, 'leaf'), '4.6.9');
    const copied = JSON.parse(await readFile(join(staged, 'node_modules', 'leaf', 'package.json'), 'utf8'));
    assert.equal(copied.version, '4.6.9');
    await access(join(staged, 'node_modules', 'leaf', 'index.js'));
    await assert.rejects(access(join(staged, 'node_modules', 'leaf', 'node_modules')));

    // The workspace copy must satisfy the declared range, or zod 3 ships again.
    await assert.rejects(vendorDependency(source, staged, pkg, 'old'), /workspace resolved 3\.25\.76/);
    await assert.rejects(vendorDependency(source, staged, pkg, 'tree'), /dependencies of its own/);
    await assert.rejects(vendorDependency(source, staged, pkg, 'absent'), /does not declare/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('vendored dependencies are declared, range-checked and copied without nested trees');
}
