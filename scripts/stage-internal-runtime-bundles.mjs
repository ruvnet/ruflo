#!/usr/bin/env node

import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

export const INTERNAL_RUNTIME_PACKAGES = [
  {
    directory: 'security',
    name: '@claude-flow/security',
    requiredAssets: ['dist'],
    optionalAssets: ['README.md'],
    // #4940: security needs zod >=4.6.7 while the CLI and the umbrella keep
    // zod 3. npm never installs the dependencies of a bundled package, so a
    // declaration alone still resolves `zod` to the wrapper's zod 3 and the
    // root export dies at `z.config`. The files have to ship in the bundle.
    vendoredDependencies: ['zod'],
  },
  {
    directory: 'codex',
    name: '@claude-flow/codex',
    requiredAssets: ['dist', '.agents/skills'],
    optionalAssets: ['README.md'],
  },
  {
    directory: 'mcp',
    name: '@claude-flow/mcp',
    requiredAssets: ['dist'],
    optionalAssets: ['README.md'],
  },
  {
    directory: 'plugin-agent-federation',
    name: '@claude-flow/plugin-agent-federation',
    requiredAssets: ['dist'],
    optionalAssets: ['README.md', 'LICENSE'],
  },
];

const BUILD_PREREQUISITES = ['shared'];

function runBuild(packageDirectory) {
  // CreateProcess cannot launch a .cmd directly, and Node has refused to
  // since CVE-2024-27980 — spawnSync('npm.cmd', ...) without shell:true
  // throws EINVAL on Windows. `command`/args here are constant literals,
  // never hook-derived or user-controlled, so shell:true carries no
  // injection risk (contrast plugins/ruflo-core/scripts/ruflo-hook.cjs,
  // which resolves a real .js entrypoint instead because its argv IS
  // externally derived).
  // Node's DEP0190 warns when shell:true is combined with an args array
  // (args are concatenated, not escaped) — harmless here since nothing is
  // interpolated, but the single-string form below is what Node itself
  // recommends to avoid the warning while keeping shell:true.
  const win32 = process.platform === 'win32';
  const result = win32
    ? spawnSync('npm.cmd run build', { cwd: packageDirectory, stdio: 'inherit', shell: true })
    : spawnSync('npm', ['run', 'build'], { cwd: packageDirectory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Internal runtime build failed for ${packageDirectory} with exit code ${result.status ?? 'unknown'}`,
    );
  }
}

async function copyIfPresent(source, target) {
  try {
    await cp(source, target, { recursive: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function copyRequired(source, target) {
  await access(source);
  await cp(source, target, { recursive: true });
}

function collectEntrypoints(value, entrypoints) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) entrypoints.add(value.slice(2));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEntrypoints(item, entrypoints);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectEntrypoints(item, entrypoints);
  }
}

async function validateEntrypoints(packageRoot, packageJson) {
  const entrypoints = new Set();
  collectEntrypoints(packageJson.main, entrypoints);
  collectEntrypoints(packageJson.types, entrypoints);
  collectEntrypoints(packageJson.bin, entrypoints);
  collectEntrypoints(packageJson.exports, entrypoints);
  for (const entrypoint of entrypoints) {
    if (entrypoint.includes('*')) {
      const entrypointDirectory = dirname(entrypoint);
      const expression = new RegExp(
        `^${entrypoint
          .slice(entrypointDirectory.length + 1)
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      const matches = (await readdir(join(packageRoot, entrypointDirectory))).filter(
        (name) => expression.test(name),
      );
      if (matches.length === 0) {
        throw new Error(`No staged entrypoints match ${entrypoint}`);
      }
      continue;
    }
    await access(join(packageRoot, entrypoint));
  }
}

export function createBundledRuntimeManifest(packageJson, vendoredDependencies = []) {
  const dependencyMetadata = {};
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]) {
    if (packageJson[field] && Object.keys(packageJson[field]).length > 0) {
      dependencyMetadata[field] = packageJson[field];
    }
  }

  const bundledManifest = {
    ...packageJson,
    rufloBundledRuntime: {
      format: 1,
      sourceDependencies: dependencyMetadata,
    },
  };
  delete bundledManifest.dependencies;
  // A vendored dependency ships inside this package's own node_modules. It
  // stays declared so the manifest matches the files and npm packs them.
  const vendored = {};
  for (const name of vendoredDependencies) {
    const range = packageJson.dependencies?.[name];
    if (range === undefined) {
      throw new Error(`${packageJson.name} does not declare its vendored dependency ${name}`);
    }
    vendored[name] = range;
  }
  if (Object.keys(vendored).length > 0) bundledManifest.dependencies = vendored;
  delete bundledManifest.optionalDependencies;
  delete bundledManifest.peerDependencies;
  delete bundledManifest.peerDependenciesMeta;
  return bundledManifest;
}

/**
 * Range check for a vendored dependency, without a semver package: this script
 * also runs in CI jobs that install only the v3 workspace. Accepts an exact
 * version or a caret range on a major >= 1; anything else is refused so an
 * unusual range is looked at, not guessed.
 */
export function satisfiesCaretOrExact(version, range) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const got = parse(version);
  const caret = range.startsWith('^');
  const want = parse(caret ? range.slice(1) : range);
  if (!got || !want) throw new Error(`Unsupported vendored version or range: ${version} vs ${range}`);
  if (!caret) return got.join('.') === want.join('.');
  if (want[0] === 0) throw new Error(`Unsupported vendored range (0.x caret): ${range}`);
  if (got[0] !== want[0]) return false;
  return got[1] !== want[1] ? got[1] > want[1] : got[2] >= want[2];
}

/**
 * Copy one dependency of a bundled package into that package's node_modules,
 * from the copy the workspace build resolved. Only leaf packages qualify: a
 * vendored dependency with dependencies of its own would need them vendored
 * too, so that is refused instead of shipping a tree that cannot load.
 */
export async function vendorDependency(sourceRoot, stagedRoot, packageJson, name) {
  const range = packageJson.dependencies?.[name];
  if (range === undefined) {
    throw new Error(`${packageJson.name} does not declare its vendored dependency ${name}`);
  }
  let directory = dirname(createRequire(join(sourceRoot, 'package.json')).resolve(name));
  let manifest;
  for (;;) {
    try {
      const candidate = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (candidate.name === name) { manifest = candidate; break; }
    } catch { /* keep walking up to the package root */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find the package root of ${name}`);
    directory = parent;
  }
  if (!satisfiesCaretOrExact(manifest.version, range)) {
    throw new Error(
      `${packageJson.name} needs ${name}@${range}, but the workspace resolved ${manifest.version}`,
    );
  }
  const own = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
  if (Object.keys(own).length > 0) {
    throw new Error(`${name}@${manifest.version} has dependencies of its own and cannot be vendored`);
  }
  await cp(directory, join(stagedRoot, 'node_modules', name), {
    recursive: true,
    dereference: true,
    filter: (source) => !source.slice(directory.length).split(/[\\/]/).includes('node_modules'),
  });
  return manifest.version;
}

export function alignBundledRuntimeVersion(targetPackageJson, runtimePackageJson) {
  const current = targetPackageJson.dependencies?.[runtimePackageJson.name];
  if (current === undefined) {
    throw new Error(`${runtimePackageJson.name} must be a dependency of ${targetPackageJson.name}`);
  }
  if (current === runtimePackageJson.version) return false;
  targetPackageJson.dependencies[runtimePackageJson.name] = runtimePackageJson.version;
  return true;
}

/**
 * Build reviewed internal packages and stage only their runtime artifacts under
 * a public package's node_modules tree. npm's bundledDependencies mechanism
 * then embeds them in the public tarball, so installation never depends on an
 * unpublished internal package coordinate.
 */
export async function stageInternalRuntimeBundles(
  targetPackageDirectory,
  { build = true } = {},
) {
  const targetRoot = resolve(targetPackageDirectory);
  const scopeRoot = join(targetRoot, 'node_modules', '@claude-flow');
  const targetPackageJson = JSON.parse(
    await readFile(join(targetRoot, 'package.json'), 'utf8'),
  );
  // npm normalizes `bundledDependencies` to `bundleDependencies` when it
  // rewrites a manifest. Accept both documented spellings so staging remains
  // stable after lockfile/version maintenance.
  const declaredBundles = new Set(
    targetPackageJson.bundleDependencies ??
      targetPackageJson.bundledDependencies ??
      [],
  );
  for (const runtimePackage of INTERNAL_RUNTIME_PACKAGES) {
    if (targetPackageJson.dependencies?.[runtimePackage.name] === undefined) {
      throw new Error(`${runtimePackage.name} must be a dependency of ${targetPackageJson.name}`);
    }
    if (!declaredBundles.has(runtimePackage.name)) {
      throw new Error(`${runtimePackage.name} must be bundled by ${targetPackageJson.name}`);
    }
  }
  await mkdir(scopeRoot, { recursive: true });

  if (build) {
    for (const packageDirectory of BUILD_PREREQUISITES) {
      runBuild(join(repoRoot, 'v3', '@claude-flow', packageDirectory));
    }
  }

  let targetManifestChanged = false;

  for (const runtimePackage of INTERNAL_RUNTIME_PACKAGES) {
    const sourceRoot = join(repoRoot, 'v3', '@claude-flow', runtimePackage.directory);
    if (build) runBuild(sourceRoot);

    const packageJson = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
    if (packageJson.name !== runtimePackage.name) {
      throw new Error(
        `Internal bundle identity mismatch: expected ${runtimePackage.name}, got ${String(packageJson.name)}`,
      );
    }
    targetManifestChanged =
      alignBundledRuntimeVersion(targetPackageJson, packageJson) || targetManifestChanged;

    const packageLeaf = runtimePackage.name.slice('@claude-flow/'.length);
    const target = join(scopeRoot, packageLeaf);
    const temporary = `${target}.${process.pid}.tmp`;
    await rm(temporary, { recursive: true, force: true });
    try {
      await mkdir(temporary, { recursive: true });
      await writeFile(
        join(temporary, 'package.json'),
        `${JSON.stringify(
          createBundledRuntimeManifest(packageJson, runtimePackage.vendoredDependencies),
          null,
          2,
        )}\n`,
      );
      for (const name of runtimePackage.vendoredDependencies ?? []) {
        await vendorDependency(sourceRoot, temporary, packageJson, name);
      }
      for (const asset of runtimePackage.requiredAssets) {
        await copyRequired(join(sourceRoot, asset), join(temporary, asset));
      }
      for (const asset of runtimePackage.optionalAssets) {
        await copyIfPresent(join(sourceRoot, asset), join(temporary, asset));
      }
      await validateEntrypoints(temporary, packageJson);
      await rm(target, { recursive: true, force: true });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  // The source-built runtime may be newer than the registry bootstrap used by
  // `npm ci`. The packed manifest must name the bytes actually embedded in the
  // archive or npm correctly reports the bundle as invalid during install.
  if (targetManifestChanged) {
    await writeFile(
      join(targetRoot, 'package.json'),
      `${JSON.stringify(targetPackageJson, null, 2)}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targetIndex = process.argv.indexOf('--target');
  if (targetIndex === -1 || !process.argv[targetIndex + 1]) {
    throw new Error('Usage: stage-internal-runtime-bundles.mjs --target <package-directory>');
  }
  await stageInternalRuntimeBundles(process.argv[targetIndex + 1], {
    build: !process.argv.includes('--no-build'),
  });
}
