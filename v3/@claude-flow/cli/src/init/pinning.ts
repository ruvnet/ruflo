/**
 * ADR-545 — pinned package specifiers for everything `ruflo init` writes.
 *
 * A generated `npx ruflo@latest …` runs whatever was published most recently,
 * on every hook, MCP start and copy-pasted CLAUDE.md command. Init now writes
 * the exact version of the CLI that is running it, so a project keeps the
 * release it was set up with until someone repins it deliberately
 * (`ruflo init repin`). `--channel latest` keeps the old floating behaviour.
 *
 * This module is the single place that builds a specifier. Generators call
 * `ourSpec()` / `thirdPartySpec()`; `rewriteOurRefs()` is the text rewrite that
 * `init repin` and the helper copy path share.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** `pinned` (default): exact version. `latest`: the floating tag, as before ADR-545. */
export type ReleaseChannel = 'pinned' | 'latest';
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ['pinned', 'latest'];

/** The three packages of the public release train (CLAUDE.md "Publishing Rules"). */
export const OUR_PACKAGES = ['@claude-flow/cli', 'claude-flow', 'ruflo'] as const;
export type OurPackage = (typeof OUR_PACKAGES)[number];

/** npm dist-tags our packages have been referenced by in generated files. */
export const FLOATING_TAGS = ['latest', 'alpha', 'v3alpha', 'next', 'beta'] as const;

/**
 * Third-party MCP servers / tools init can reference. Pinned to the version
 * that was current when this release was cut (npm view, 2026-11-19); bump them
 * deliberately with the release. `floating` is what init wrote before ADR-545.
 */
export const THIRD_PARTY_PINS = {
  'flow-nexus': { version: '0.1.128', floating: 'flow-nexus@latest' },
  'ruv-swarm': { version: '2.0.1', floating: 'ruv-swarm' },
  'agentic-jujutsu': { version: '2.3.6', floating: 'agentic-jujutsu@latest' },
} as const;
export type ThirdPartyPackage = keyof typeof THIRD_PARTY_PINS;

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isExactVersion(v: unknown): v is string {
  return typeof v === 'string' && EXACT_VERSION_RE.test(v);
}

/** Parse a `--channel` flag value. `undefined` → pinned. */
export function parseReleaseChannel(value: unknown): ReleaseChannel | { error: string } {
  if (value === undefined || value === null || value === '' || value === true) return 'pinned';
  if (typeof value === 'string' && (RELEASE_CHANNELS as readonly string[]).includes(value)) return value as ReleaseChannel;
  return { error: `Invalid --channel ${JSON.stringify(value)}: expected one of ${RELEASE_CHANNELS.join(', ')}` };
}

/**
 * Version of the @claude-flow/cli package this module ships in. Walks up from
 * the module (src/init in a checkout, dist/src/init when installed) to the
 * first package.json named @claude-flow/cli. Null when it cannot be found or
 * is not an exact version — callers then fall back to floating rather than
 * emitting a made-up pin such as `@0.0.0`.
 */
export function readCliPackageVersion(startDir: string = moduleDir()): string | null {
  const pkg = readCliPackageJson(startDir);
  return pkg && isExactVersion(pkg.version) ? pkg.version : null;
}

interface CliPackageJson {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readCliPackageJson(startDir: string = moduleDir()): CliPackageJson | null {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as CliPackageJson & { name?: string };
      if (pkg.name === '@claude-flow/cli') return pkg;
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * A package the CLI itself depends on (e.g. `@claude-flow/codex`, which init
 * runs through npx): pinned to the exact version the CLI's package.json
 * declares, so init runs the copy this release was tested with. Floats when
 * the declaration is a range or absent, or on the latest channel.
 */
export function cliDependencySpec(name: string, channel: ReleaseChannel = 'pinned', startDir?: string): string {
  if (channel === 'pinned') {
    const pkg = readCliPackageJson(startDir);
    const declared = pkg?.dependencies?.[name] ?? pkg?.optionalDependencies?.[name];
    if (isExactVersion(declared)) return `${name}@${declared}`;
  }
  return `${name}@latest`;
}

function moduleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

let cachedVersion: string | null | undefined;

/** The exact version init pins to (cached). Null → unresolvable; specs float. */
export function pinnedVersion(): string | null {
  if (cachedVersion === undefined) cachedVersion = readCliPackageVersion();
  return cachedVersion;
}

/** Test seam: force the pinned version (or `undefined` to re-read). */
export function setPinnedVersionForTesting(version: string | null | undefined): void {
  cachedVersion = version;
}

/**
 * `pkg@<exact>` on the pinned channel, `pkg@latest` on the latest channel or
 * when the running version cannot be determined.
 */
export function ourSpec(pkg: OurPackage, channel: ReleaseChannel = 'pinned', version: string | null = pinnedVersion()): string {
  if (channel === 'pinned' && isExactVersion(version)) return `${pkg}@${version}`;
  return `${pkg}@latest`;
}

/** `npx <spec>` for one of our packages — the form CLAUDE.md and docs use. */
export function npxOurs(pkg: OurPackage, channel: ReleaseChannel = 'pinned'): string {
  return `npx ${ourSpec(pkg, channel)}`;
}

/** Third-party specifier: exact on the pinned channel, the pre-ADR-545 form otherwise. */
export function thirdPartySpec(name: ThirdPartyPackage, channel: ReleaseChannel = 'pinned'): string {
  const pin = THIRD_PARTY_PINS[name];
  return channel === 'pinned' ? `${name}@${pin.version}` : pin.floating;
}

// ---------------------------------------------------------------------------
// Text rewrite shared by `init repin` and the helper copy path
// ---------------------------------------------------------------------------

export interface RefChange {
  /** 1-based line number. */
  line: number;
  before: string;
  after: string;
}

export interface RewriteResult {
  text: string;
  changes: RefChange[];
}

/**
 * One of our packages followed by a dist-tag or an exact version. The
 * look-behind keeps it from matching inside another name (`my-ruflo@latest`,
 * `x/claude-flow@alpha`); the look-ahead stops at the end of the specifier.
 */
const OUR_REF_RE = /(?<![\w@/.-])(@claude-flow\/cli|claude-flow|ruflo)@(latest|alpha|v3alpha|next|beta|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![\w.-])/g;

/**
 * An untagged run of one of our packages (`npx @claude-flow/cli hooks …`,
 * `npx -y ruflo …`), which npm resolves to whatever is latest. Only plain
 * flags may sit between the runner and the package, so `--prefix <dir> pkg`
 * (the signed helpers' local-install form) is not matched.
 */
const BARE_RUN_RE = /(\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx|npm\s+exec)(?:\s+--?\w[\w-]*(?:=\S+)?)*\s+)(@claude-flow\/cli|claude-flow|ruflo)(?=$|[\s"'`;|&)])/g;

/** A line that runs a package: npx/npm/pnpm/yarn/bunx or `claude mcp add`. */
const INVOCATION_RE = /\b(?:npx|npm|pnpm|yarn|bunx)\s|\bclaude\s+mcp\s+add\b/;

/**
 * Rewrite every ref to our packages in `text` so it points at `target` — an
 * exact version, or `'latest'`. Floating tags are always rewritten; another
 * exact version is rewritten per `exactVersions`:
 *  - `all` (default): config and scripts, where every ref is an invocation;
 *  - `npx-lines`: only on lines that invoke npx/npm/claude mcp, so prose such
 *    as "fixed in ruflo@3.7.0" in a user's CLAUDE.md is left alone;
 *  - `none`: docs copied from the package, which mention old releases.
 * Refs already at `target` are left alone, so the rewrite is idempotent.
 * Only the specifier changes: the rest of each line, and every line without
 * a ref, is preserved byte for byte (line endings included).
 *
 * `lineFilter` lets a caller restrict the rewrite to some lines (e.g. JSON
 * string values that are not object keys).
 *
 * `pinBareRuns` also pins untagged runs (`npx @claude-flow/cli …`) when
 * `target` is an exact version — for scripts, where such a line executes.
 */
export function rewriteOurRefs(
  text: string,
  target: string,
  lineFilter: (line: string, index: number) => boolean = () => true,
  exactVersions: 'all' | 'npx-lines' | 'none' = 'all',
  pinBareRuns = false,
): RewriteResult {
  if (target !== 'latest' && !isExactVersion(target)) {
    throw new Error(`rewriteOurRefs: target must be an exact version or 'latest', got ${JSON.stringify(target)}`);
  }
  const parts = text.split(/(\r?\n)/);
  const changes: RefChange[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    if (!line || !lineFilter(line, i / 2)) continue;
    const exactOk = exactVersions === 'all' || (exactVersions === 'npx-lines' && INVOCATION_RE.test(line));
    let next = line.replace(OUR_REF_RE, (whole, pkg: string, spec: string) => {
      if (spec === target) return whole;
      if (isExactVersion(spec) && !exactOk) return whole;
      return `${pkg}@${target}`;
    });
    if (pinBareRuns && target !== 'latest') next = next.replace(BARE_RUN_RE, (_w, run: string, pkg: string) => `${run}${pkg}@${target}`);
    if (next !== line) {
      changes.push({ line: i / 2 + 1, before: line, after: next });
      parts[i] = next;
    }
  }
  return { text: parts.join(''), changes };
}

/**
 * Copy a packaged file into a project. On the pinned channel, a text file's
 * refs to ruflo's own packages are pinned to the running version on the way
 * (skills, commands and agents document `npx @claude-flow/cli@latest …`);
 * otherwise, or for a binary file or one without refs, the bytes are copied
 * unchanged. `script` also pins untagged runs (unsigned helper scripts).
 * Never use this for the signed helpers.
 */
export function copyFilePinned(src: string, dest: string, channel: ReleaseChannel = 'pinned', script = false): void {
  const version = pinnedVersion();
  if (channel !== 'pinned' || !version) {
    fs.copyFileSync(src, dest);
    return;
  }
  const raw = fs.readFileSync(src);
  if (raw.includes(0)) {
    fs.copyFileSync(src, dest);
    return;
  }
  // Package docs name old releases in prose; only floating tags are pinned.
  const { text, changes } = rewriteOurRefs(raw.toString('utf-8'), version, undefined, 'none', script);
  if (changes.length === 0) fs.copyFileSync(src, dest);
  else fs.writeFileSync(dest, text, 'utf-8');
}
