/**
 * Doctor checks for the MetaHarness package and its ruflo integration.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { ownInstallAncestors } from '../../plugins/own-install.js';
import type { HealthCheck } from './shared.js';

/**
 * iter 45 — verify the ruflo-side MetaHarness integration is intact.
 *
 * The existing `checkMetaharness` verifies the UPSTREAM `metaharness`
 * package is reachable (warn if missing — it's optional per ADR-150).
 * This check verifies the INTEGRATION LAYER (plugin scripts, production
 * module, subprocess bridge) is intact. Unlike upstream, the integration
 * layer is shipped with ruflo — missing files mean ruflo's install is
 * corrupted, not that an optional dep is absent.
 *
 * Status mapping:
 *   pass — all required files present + module loads + similarity() smoke OK
 *   fail — any required file missing OR module fails to import
 *   warn — files present but module import errored at runtime
 *
 * Verified files (iter 36-53 surfaces — full ADR-150 deep-integration set):
 *   - plugins/ruflo-metaharness/scripts/_harness.mjs                (subprocess bridge)
 *   - plugins/ruflo-metaharness/scripts/_similarity.mjs             (ADR-152 §3.1 module, iter 36)
 *   - plugins/ruflo-metaharness/scripts/similarity.mjs              (CLI skill, iter 36)
 *   - plugins/ruflo-metaharness/scripts/_spike-similarity.mjs       (regression anchor, iter 35)
 *   - plugins/ruflo-metaharness/scripts/drift-from-history.mjs      (1-command primitive, iter 53)
 *   - plugins/ruflo-metaharness/skills/harness-similarity/SKILL.md
 *   - plugins/ruflo-metaharness/skills/harness-drift-from-history/SKILL.md  (iter 53)
 */
export async function checkMetaharnessIntegration(): Promise<HealthCheck> {
  // Locate plugins dir.
  //
  // Pre-#2437 fix this only walked up from `process.cwd()` + checked one
  // hard-coded `<cwd>/node_modules/@claude-flow/cli/...` candidate. That
  // missed the two cases users actually run from:
  //   (a) `npx @claude-flow/cli@<tag>` → resolves to a per-version cache
  //       under `~/.npm/_npx/<hash>/node_modules/@claude-flow/cli/...`
  //   (b) `npm install -g @claude-flow/cli` → lives at
  //       `$(npm prefix -g)/lib/node_modules/@claude-flow/cli/...`
  //
  // The bulletproof fix: resolve relative to THIS file's own location via
  // `import.meta.url`. The plugins dir is always a sibling of the package
  // root regardless of where the package was installed. Walk up from
  // `dist/src/commands/doctor.js` (built) or `src/commands/doctor.ts`
  // (dev) until we find a directory containing `plugins/ruflo-metaharness/`.
  const candidates: string[] = [];

  // Walk up from this module's own URL — covers npx, global and project-local
  // installs and monorepo dev. The plugin found here is imported below, so it
  // must come from this CLI's own install, never from the cwd (the project).
  try {
    // Bounded at node_modules: a project-local install must not reach the project.
    const selfDir = dirname(fileURLToPath(import.meta.url));
    for (const q of ownInstallAncestors(selfDir)) {
      candidates.push(join(q, 'plugins', 'ruflo-metaharness'));
    }
  } catch {
    // import.meta.url unavailable under some bundlers — the plugin is reported absent.
  }

  let pluginDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(join(c, 'scripts', '_harness.mjs'))) {
      pluginDir = c;
      break;
    }
  }

  if (!pluginDir) {
    // #2437: MetaHarness is documented as an optional dependency in
    // optionalDependencies (per ADR-150 architectural constraint #2 —
    // "Optional in package.json"). A genuinely-absent plugin therefore
    // warrants WARN, not FAIL — same posture as the runtime path which
    // returns {degraded: true, exit 0}. FAIL is reserved for misconfigured
    // installs where the plugin SHOULD be present but is broken.
    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'warn',
      message: 'plugins/ruflo-metaharness/ not found — MetaHarness skills will degrade gracefully',
      fix: 'Optional: install via `npm i -D @metaharness/darwin metaharness` or run `ruflo plugins install ruflo-metaharness`',
    };
  }

  // Required files (iter 36+44 surfaces, +ADR-153 darwin surfaces in v3.13.0)
  const required = [
    'scripts/_harness.mjs',
    'scripts/_similarity.mjs',
    'scripts/similarity.mjs',
    'scripts/_spike-similarity.mjs',
    // iter 53 surfaces — gated against silent deletion
    'scripts/drift-from-history.mjs',
    'skills/harness-similarity/SKILL.md',
    'skills/harness-drift-from-history/SKILL.md',
    // ADR-153 Darwin Mode surfaces (v3.13.0) — added to gate against silent deletion
    'scripts/_darwin.mjs',
    'scripts/evolve.mjs',
    'scripts/security-bench.mjs',
    'scripts/bench.mjs',
    'skills/harness-evolve/SKILL.md',
    'skills/harness-security-bench/SKILL.md',
    'skills/harness-bench/SKILL.md',
  ];
  const missing = required.filter((f) => !existsSync(join(pluginDir, f)));
  if (missing.length > 0) {
    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'fail',
      message: `Missing files: ${missing.join(', ')}`,
      fix: 'Reinstall ruflo or restore from git: `git checkout HEAD -- plugins/ruflo-metaharness/`',
    };
  }

  // Runtime smoke: import the similarity module and exercise it
  try {
    const modPath = join(pluginDir, 'scripts', '_similarity.mjs');
    const mod = await import(pathToFileURL(modPath).href) as { similarity?: (a: unknown, b: unknown) => { overall?: number } };
    if (typeof mod.similarity !== 'function') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'fail',
        message: '_similarity.mjs does not export similarity()',
        fix: 'Reinstall ruflo or restore the file from git',
      };
    }
    const result = mod.similarity({}, {});
    if (typeof result?.overall !== 'number') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'warn',
        message: 'similarity() returned unexpected shape; module may be stale',
      };
    }

    // iter 52 — also verify the iter-50 mcp-scan text parser exports
    // correctly. parseMcpScanText is the shared util both mcp-scan.mjs
    // and oia-audit.mjs depend on; if it's missing the audit-trend
    // introduced/cleared diff silently degrades to dead code.
    //
    // iter 61 — additionally verify iter-56's async exports
    // (runHarnessAsync / runMetaharnessAsync). These are the
    // parallelization primitives oia-audit depends on; if they're
    // missing, oia-audit's import fails and the whole pipeline breaks.
    const harnessPath = join(pluginDir, 'scripts', '_harness.mjs');
    const harnessMod = await import(pathToFileURL(harnessPath).href) as {
      parseMcpScanText?: (s: string) => unknown;
      runHarnessAsync?: (args: string[]) => Promise<unknown>;
      runMetaharnessAsync?: (args: string[]) => Promise<unknown>;
    };
    if (typeof harnessMod.parseMcpScanText !== 'function') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'fail',
        message: '_harness.mjs does not export parseMcpScanText (iter 50 — needed by mcp-scan + oia-audit)',
        fix: 'Reinstall ruflo or restore _harness.mjs from git',
      };
    }
    if (typeof harnessMod.runHarnessAsync !== 'function' || typeof harnessMod.runMetaharnessAsync !== 'function') {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'fail',
        message: '_harness.mjs missing iter-56 async exports (runHarnessAsync / runMetaharnessAsync) — oia-audit parallelization will fail',
        fix: 'Reinstall ruflo or restore _harness.mjs from git',
      };
    }
    // Smoke: parser handles empty input gracefully
    const parsed = harnessMod.parseMcpScanText('') as { findings?: unknown };
    if (!Array.isArray(parsed?.findings)) {
      return {
        name: 'MetaHarness integration (ADR-150)',
        status: 'warn',
        message: 'parseMcpScanText returned unexpected shape on empty input',
      };
    }

    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'pass',
      message: 'plugin scripts intact, _similarity.mjs + parseMcpScanText load, smoke OK',
    };
  } catch (e) {
    return {
      name: 'MetaHarness integration (ADR-150)',
      status: 'warn',
      message: `Module import errored: ${(e as Error).message.slice(0, 60)}`,
    };
  }
}

/**
 * Dependency-contract check: every `@metaharness/*` package this CLI DECLARES
 * in its own optionalDependencies must actually resolve at runtime. Declared
 * packages are advertised integration surfaces (`ruflo metaharness evolve`,
 * flywheel receipt interop, radio coordination) — a declared-but-absent
 * package means the install dropped an optional dep (or the declaration
 * regressed to peer-only), so the advertised integration silently degrades.
 * That is a FAIL, not a warn: warn is reserved for surfaces that were never
 * advertised as installed (the `npx metaharness` umbrella path above).
 */
export async function checkMetaharnessDeclaredPackages(): Promise<HealthCheck> {
  const NAME = 'MetaHarness declared packages (ADR-150)';
  try {
    // Walk up from this module to the CLI package root (works for npx cache,
    // global install, project-local install, and monorepo dev alike).
    let root: string | null = null;
    let q = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pj = join(q, 'package.json');
      if (existsSync(pj)) {
        try {
          if ((JSON.parse(readFileSync(pj, 'utf-8')) as { name?: string }).name === '@claude-flow/cli') { root = q; break; }
        } catch { /* keep walking */ }
      }
      q = dirname(q);
    }
    if (!root) return { name: NAME, status: 'warn', message: 'could not locate the @claude-flow/cli package root' };

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { optionalDependencies?: Record<string, string> };
    const declared = Object.keys(pkg.optionalDependencies ?? {}).filter((n) => n === 'metaharness' || n.startsWith('@metaharness/'));
    if (declared.length === 0) {
      return {
        name: NAME,
        status: 'fail',
        message: 'no @metaharness/* packages declared in optionalDependencies — the dependency contract regressed (peer-only declarations are never installed)',
        fix: 'Restore @metaharness/darwin, @metaharness/flywheel, @metaharness/radio, @metaharness/turn-credit to optionalDependencies in @claude-flow/cli',
      };
    }

    // Node resolution: nearest node_modules wins, walking upward from the CLI root.
    const resolves = (name: string): boolean => {
      let d = root as string;
      for (let i = 0; i < 10; i++) {
        if (existsSync(join(d, 'node_modules', name, 'package.json'))) return true;
        const parent = dirname(d);
        if (parent === d) break;
        d = parent;
      }
      return false;
    };
    const missing = declared.filter((n) => !resolves(n));
    if (missing.length > 0) {
      return {
        name: NAME,
        status: 'fail',
        message: `declared but not installed: ${missing.join(', ')} — advertised MetaHarness surfaces are degraded`,
        fix: 'npm install --include=optional  # optional deps were skipped or pruned',
      };
    }
    return { name: NAME, status: 'pass', message: `${declared.length} declared package(s) resolve: ${declared.join(', ')}` };
  } catch (err) {
    return { name: NAME, status: 'warn', message: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ADR-150 — surface MetaHarness availability + harnessFit score in
// the standard ruflo doctor flow. Graceful degradation: when metaharness
// is not installed (no network, optionalDep skipped), the check returns
// `warn` with a hint instead of `fail` — ruflo continues to function.
export async function checkMetaharness(): Promise<HealthCheck> {
  try {
    // `metaharness` has no --version flag (it falls through to the usage
    // banner, which never matches a version regex) and shelling out via
    // `npx metaharness@latest` ignores the installed version and hits the
    // network every run. Resolve the version from the installed package's
    // own package.json instead. `import.meta.resolve` is the reliable route:
    // `require('metaharness/package.json')` is blocked by the package's
    // `exports` map, and `createRequire().resolve()` fails on its ESM-only
    // entry point.
    const resolved = import.meta.resolve('metaharness');
    let dir = dirname(fileURLToPath(resolved));
    let version: string | null = null;
    for (let i = 0; i < 8; i++) {
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) {
        try {
          const j = JSON.parse(readFileSync(pj, 'utf-8')) as { name?: string; version?: string };
          if (j.name === 'metaharness') { version = j.version ?? null; break; }
        } catch { /* keep walking */ }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!version) {
      return {
        name: 'MetaHarness (ADR-150)',
        status: 'warn',
        message: 'Installed but its package.json was not found while walking up from the resolved module; integration may still work',
      };
    }
    return {
      name: 'MetaHarness (ADR-150)',
      status: 'pass',
      message: `v${version} — run \`npx ruflo metaharness score\` for the full scorecard`,
    };
  } catch {
    return {
      name: 'MetaHarness (ADR-150)',
      status: 'warn',
      message: 'Not installed — `npx ruflo metaharness *` commands will degrade gracefully',
      fix: 'npm install --include=optional  # to enable the metaharness optional dep',
    };
  }
}
