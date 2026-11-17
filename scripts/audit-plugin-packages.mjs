#!/usr/bin/env node
/**
 * Plugin package.json install-safety audit (regression guard for #1902/#1903/#1904).
 *
 * Scans v3/plugins/<name>/package.json and fails CI on any of:
 *
 *   A. (#1903) A `@claude-flow/*` package referenced as a hard `dependencies`
 *      entry, OR as a `peerDependencies` entry that is NOT marked
 *      `peerDependenciesMeta[name].optional: true`, that is not in the
 *      KNOWN_PUBLISHED allow-list. npm 7+ auto-installs non-optional peers,
 *      so an unpublished one (e.g. `@claude-flow/ruvector-upstream`) makes
 *      `npm install <plugin>` fail with E404.
 *
 *   B. (#1902) A `peerDependencies` range for a `@claude-flow/*` or
 *      `@ruvector/*` target that is a "bare stable" range (`>=X.Y.Z`,
 *      `^X.Y.Z`, `~X.Y.Z`, `X.Y.Z`) with no prerelease component. Those
 *      ranges DON'T satisfy a prerelease publish like `3.0.0-alpha.15`, so
 *      npm can't find a matching version. Use `>=X.Y.Z-0` or `*`.
 *
 *   C. (#1904, static) Every path in `main` / `module` / `types` / `bin` and
 *      every path inside `exports` must live under a directory (or glob) that
 *      is included in `files` — otherwise it isn't in the published tarball.
 *
 *   D. (#1904, post-build) For any plugin whose `dist/` exists on disk (i.e.
 *      it has been built), every `main`/`module`/`types`/`exports` path must
 *      exist. This is the real catch for "exports.import → ./dist/index.mjs
 *      but the build only emits .cjs". CI builds the plugins before running
 *      this script so check D is live there.
 *
 *   E. Dependency confusion: a dependency name (any field) that is NOT
 *      registered on npm. npm installs optionalDependencies automatically, so
 *      whoever registers the name first runs code on every install. The
 *      names in UNREGISTERED_NAMES were checked with `npm view <name>`
 *      (E404); the source can still try a dynamic import, but the manifest
 *      must not declare them until they are published under our control.
 *
 * Usage:
 *   node scripts/audit-plugin-packages.mjs            # audit, exit 1 on any issue
 *   node scripts/audit-plugin-packages.mjs --json     # machine-readable report
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const REPO_ROOT = process.cwd();
const PLUGINS_DIR = join(REPO_ROOT, 'v3', 'plugins');
const JSON_OUT = process.argv.includes('--json');

// @claude-flow/* packages known to be published to the npm registry. A hard
// dep / non-optional peer on anything @claude-flow/* NOT in this set fails the
// audit. Refresh with: for n in <pkg>; do npm view @claude-flow/$n version; done
const KNOWN_PUBLISHED = new Set([
  '@claude-flow/aidefence',
  '@claude-flow/browser',
  '@claude-flow/claims',
  '@claude-flow/cli',
  '@claude-flow/cli-core',
  '@claude-flow/codex',
  '@claude-flow/deployment',
  '@claude-flow/embeddings',
  '@claude-flow/guidance',
  '@claude-flow/hooks',
  '@claude-flow/integration',
  '@claude-flow/mcp',
  '@claude-flow/memory',
  '@claude-flow/neural',
  '@claude-flow/performance',
  '@claude-flow/plugins',
  '@claude-flow/providers',
  '@claude-flow/security',
  '@claude-flow/shared',
  '@claude-flow/swarm',
  '@claude-flow/testing',
  // plugin-* packages publish under @claude-flow/plugin-<name>; the plugin
  // store loads them by tarball, but if one plugin hard-depends on another
  // it must be published. Add entries here if/when that happens.
]);

// A peer-range is "prerelease-safe" if it includes a prerelease tag (`-0`,
// `-alpha`, …) or is the wildcard `*` / `latest` / a workspace protocol.
function isPrereleaseSafeRange(range) {
  const r = String(range).trim();
  if (r === '*' || r === 'latest' || r === '' || r.startsWith('workspace:') || r.startsWith('file:') || r.startsWith('link:')) return true;
  if (/-[0-9A-Za-z.]+/.test(r)) return true; // has a prerelease component somewhere
  // bare stable: >=X.Y.Z | ^X.Y.Z | ~X.Y.Z | X.Y.Z | >X.Y.Z (and ranges of those)
  if (/^[\^~]?\d+(\.\d+){0,2}$/.test(r)) return false;
  if (/^>=?\s*\d+(\.\d+){0,2}$/.test(r)) return false;
  // anything else (e.g. "3.x", "1.2 - 2.3", complex composites) — don't flag,
  // too noisy; the two patterns above cover the real-world offenders.
  return true;
}

// Does `files` (array of literal paths / globs) include `relPath`?
function filesCovers(files, relPath) {
  if (!Array.isArray(files)) return true; // no `files` field → whole dir publishes
  const clean = relPath.replace(/^\.\//, '');
  const topSeg = clean.split('/')[0];
  for (const entry of files) {
    const e = String(entry).replace(/^\.\//, '');
    if (e === clean) return true;
    if (e === topSeg) return true;          // "dist" covers "dist/index.js"
    if (e.startsWith(topSeg + '/')) return true; // "dist/**" covers "dist/index.js"
    if (e === topSeg + '/**') return true;
    if (e.includes('*')) {
      // crude glob → regex
      const re = new RegExp('^' + e.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      if (re.test(clean)) return true;
    }
  }
  return false;
}

// Collect every file path referenced by package.json export-ish fields.
function collectExportPaths(pkg) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.startsWith('.')) out.add(v); };
  add(pkg.main); add(pkg.module); add(pkg.types); add(pkg.typings);
  if (typeof pkg.bin === 'string') add(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === 'object') Object.values(pkg.bin).forEach(add);
  const walk = (node) => {
    if (typeof node === 'string') return add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') return Object.values(node).forEach(walk);
  };
  if (pkg.exports) walk(pkg.exports);
  return [...out];
}

const plugins = existsSync(PLUGINS_DIR)
  ? readdirSync(PLUGINS_DIR).filter((d) => {
      const p = join(PLUGINS_DIR, d);
      return statSync(p).isDirectory() && existsSync(join(p, 'package.json'));
    })
  : [];

// Unscoped names that 404 on npm (checked 2026-11-08 with `npm view <name> name`).
const UNREGISTERED_NAMES = new Set([
  'micro-hnsw-wasm',
  'ruvector-economy-wasm',
  'ruvector-learning-wasm',
  'ruvector-sparse-inference-wasm',
  'ruvector-hyperbolic-hnsw-wasm',
  'ruvector-exotic-wasm',
  'ruvector-nervous-system-wasm',
]);

const issues = [];
const note = (plugin, code, message) => issues.push({ plugin, code, message });

for (const dir of plugins) {
  const pkgPath = join(PLUGINS_DIR, dir, 'package.json');
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); }
  catch (e) { note(dir, 'PARSE', `package.json is not valid JSON: ${e.message}`); continue; }

  const deps = pkg.dependencies || {};
  const peers = pkg.peerDependencies || {};
  const peerMeta = pkg.peerDependenciesMeta || {};

  // --- Check A: unpublished @claude-flow/* as hard dep / non-optional peer
  for (const [name] of Object.entries(deps)) {
    if (name.startsWith('@claude-flow/') && !KNOWN_PUBLISHED.has(name)) {
      note(dir, 'A', `"${name}" is a hard dependency but not a published @claude-flow package — \`npm install\` will E404. Make it an optional peerDependency or remove it (the runtime should fall back when absent).`);
    }
  }
  for (const [name] of Object.entries(peers)) {
    const optional = peerMeta[name] && peerMeta[name].optional === true;
    if (name.startsWith('@claude-flow/') && !KNOWN_PUBLISHED.has(name) && !optional) {
      note(dir, 'A', `"${name}" is a non-optional peerDependency but not a published @claude-flow package — npm 7+ auto-installs peers and will E404. Add \`peerDependenciesMeta["${name}"].optional: true\`.`);
    }
  }

  // --- Check B: bare-stable peer ranges for prerelease @claude-flow targets.
  // All @claude-flow packages currently publish as 3.x prereleases, so a bare
  // ">=3.0.0" can never resolve. We only flag @claude-flow/* here (and only
  // when non-optional, or optional-but-@claude-flow since the project always
  // ships those as prereleases). Optional @ruvector/* WASM peers are exempt —
  // a bare range there at worst means the optional dep doesn't get installed.
  for (const [name, range] of Object.entries(peers)) {
    if (!name.startsWith('@claude-flow/')) continue;
    if (isPrereleaseSafeRange(range)) continue;
    note(dir, 'B', `peerDependency "${name}": "${range}" can't resolve any @claude-flow publish — they're all 3.x prereleases. Use ">=${String(range).replace(/^[\^~>=\s]+/, '')}-0" or "*".`);
  }

  // --- Check E: unregistered (squattable) dependency names
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      if (UNREGISTERED_NAMES.has(name)) {
        note(dir, 'E', `${field} "${name}" is not registered on npm — anyone can publish it and npm will install it. Remove it from the manifest.`);
      }
    }
  }

  // --- Check C: export-ish paths must be covered by `files`
  const exportPaths = collectExportPaths(pkg);
  for (const rel of exportPaths) {
    if (!filesCovers(pkg.files, rel)) {
      note(dir, 'C', `"${rel}" is referenced (main/module/exports) but not covered by "files" ${JSON.stringify(pkg.files)} — it won't be in the published tarball.`);
    }
  }

  // --- Check D: if built, export-ish paths must exist on disk
  const distDir = join(PLUGINS_DIR, dir, 'dist');
  if (existsSync(distDir)) {
    for (const rel of exportPaths) {
      const abs = join(PLUGINS_DIR, dir, rel.replace(/^\.\//, ''));
      if (!existsSync(abs)) {
        note(dir, 'D', `"${rel}" is referenced (main/module/exports) but does not exist after build — the build emits a different filename/extension. (e.g. tsup may emit .cjs/.js, not .mjs)`);
      }
    }
  }
}

const report = {
  scannedPlugins: plugins.length,
  issueCount: issues.length,
  byCode: issues.reduce((m, i) => ((m[i.code] = (m[i.code] || 0) + 1), m), {}),
  issues,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`plugin package audit — scanned ${plugins.length} plugin(s)`);
  if (issues.length === 0) {
    console.log('  ✓ no install-safety issues');
  } else {
    const labels = { A: 'unpublished @claude-flow dep', B: 'prerelease-unsafe peer range', C: 'export not in files', D: 'export missing after build', E: 'unregistered dependency name', PARSE: 'invalid package.json' };
    for (const i of issues) {
      console.log(`  ✗ [${i.code}] ${i.plugin}: ${i.message}`);
    }
    console.log(`\n${issues.length} issue(s) across codes: ${Object.entries(report.byCode).map(([c, n]) => `${c}=${n} (${labels[c] || c})`).join(', ')}`);
  }
}

process.exit(issues.length > 0 ? 1 : 0);
