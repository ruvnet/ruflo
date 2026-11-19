/**
 * ADR-545 — registry provenance check for ruflo's three published packages.
 *
 * For each of `@claude-flow/cli`, `claude-flow` and `ruflo` at a version, this
 * reads the npm attestations endpoint and the version's packument and checks
 * that:
 *   1. an attestation with predicateType `https://slsa.dev/provenance/v1` exists;
 *   2. its in-toto subject names `pkg@version` with a sha512 digest equal to
 *      the registry's `dist.integrity`;
 *   3. its build definition names the source repository
 *      `https://github.com/ruvnet/ruflo`.
 *
 * Scope, stated plainly: this decodes the DSSE envelope and checks that the
 * registry's attestation is CONSISTENT with the registry's tarball digest and
 * our repository. It does NOT verify the sigstore signature or certificate
 * chain over the envelope — `npm audit signatures` does that, in a project
 * that has the packages installed. (That command also passes, with exit 0, a
 * package that has no attestation at all; it only counts the ones it found.
 * This check is what notices a missing one.)
 *
 * Results: `pass`; `warn` for no provenance on a version published before
 * ADR-545 (< 3.79.0), an unpublished version, or a network failure; `fail` for
 * an attestation whose digest or repository does not match, and for a missing
 * attestation on a version that must have one (>= 3.79.0) — that is what a
 * republish without provenance looks like.
 *
 * Everything takes an injected `fetch`, so it is testable offline.
 */
import { OUR_PACKAGES, type OurPackage } from './pinning.js';

export const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
export const PROVENANCE_SOURCE_REPO = 'https://github.com/ruvnet/ruflo';
/** First version published by CI with `npm publish --provenance` (ADR-545). */
export const PROVENANCE_SINCE = '3.79.0';
export const NPM_REGISTRY = 'https://registry.npmjs.org';

export type ProvenanceStatus = 'pass' | 'warn' | 'fail';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

export interface PackageProvenanceResult {
  pkg: string;
  version: string;
  status: ProvenanceStatus;
  message: string;
}

export interface ProvenanceReport {
  version: string;
  status: ProvenanceStatus;
  results: PackageProvenanceResult[];
}

export interface ProvenanceOptions {
  fetch?: FetchLike;
  registry?: string;
  timeoutMs?: number;
  packages?: readonly string[];
  /** Source repository the provenance must name (default: ruvnet/ruflo). */
  expectedRepo?: string;
}

/** `@claude-flow/cli` → `@claude-flow%2Fcli` (packument path form). */
function packumentName(pkg: string): string {
  return pkg.startsWith('@') ? `@${encodeURIComponent(pkg.slice(1))}` : encodeURIComponent(pkg);
}

export function packumentUrl(pkg: string, version: string, registry = NPM_REGISTRY): string {
  return `${registry}/${packumentName(pkg)}/${encodeURIComponent(version)}`;
}

export function attestationsUrl(pkg: string, version: string, registry = NPM_REGISTRY): string {
  return `${registry}/-/npm/v1/attestations/${encodeURIComponent(pkg)}@${encodeURIComponent(version)}`;
}

/** Numeric x.y.z compare; a prerelease sorts before its release (semver §11). */
export function versionBefore(version: string, floor: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre !== undefined };
  };
  const a = parse(version);
  const b = parse(floor);
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i];
  }
  return a.pre && !b.pre;
}

/** `sha512-<base64>` → lowercase hex, or null for any other algorithm. */
export function integrityToSha512Hex(integrity: unknown): string | null {
  if (typeof integrity !== 'string') return null;
  const entry = integrity.split(/\s+/).find((e) => e.startsWith('sha512-'));
  if (!entry) return null;
  const hex = Buffer.from(entry.slice('sha512-'.length), 'base64').toString('hex');
  return hex.length === 128 ? hex : null;
}

function normalizeRepo(url: unknown): string {
  return typeof url === 'string' ? url.trim().replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase() : '';
}

class NetworkError extends Error {}

async function getJson(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<{ status: number; body?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) return { status: res.status };
    return { status: res.status, body: await res.json() };
  } catch (error) {
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

interface Attestation { predicateType?: unknown; bundle?: { dsseEnvelope?: { payload?: unknown } } }
interface Statement {
  subject?: Array<{ name?: unknown; digest?: { sha512?: unknown } }>;
  predicate?: { buildDefinition?: { externalParameters?: { workflow?: { repository?: unknown } } } };
}

function decodeStatement(att: Attestation): Statement | null {
  const payload = att.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as Statement;
  } catch {
    return null;
  }
}

function subjectMatchesPackage(name: unknown, pkg: string, version: string): boolean {
  if (typeof name !== 'string') return false;
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { /* keep raw */ }
  return decoded === `pkg:npm/${pkg}@${version}`;
}

/** Check one package at one version. Never throws. */
export async function verifyPackageProvenance(
  pkg: string,
  version: string,
  options: ProvenanceOptions = {},
): Promise<PackageProvenanceResult> {
  const fetchFn = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  const registry = options.registry ?? NPM_REGISTRY;
  const timeoutMs = options.timeoutMs ?? 5000;
  const expectedRepo = options.expectedRepo ?? PROVENANCE_SOURCE_REPO;
  const result = (status: ProvenanceStatus, message: string): PackageProvenanceResult => ({ pkg, version, status, message });
  if (!fetchFn) return result('warn', 'no fetch available in this runtime; provenance not checked');

  let packument: { status: number; body?: unknown };
  let attestations: { status: number; body?: unknown };
  try {
    [packument, attestations] = await Promise.all([
      getJson(fetchFn, packumentUrl(pkg, version, registry), timeoutMs),
      getJson(fetchFn, attestationsUrl(pkg, version, registry), timeoutMs),
    ]);
  } catch (error) {
    return result('warn', `registry unreachable (${(error as Error).message}); provenance not checked`);
  }

  if (packument.status === 404) return result('warn', 'version is not published on npm; nothing to check');
  if (!packument.body) return result('warn', `registry returned HTTP ${packument.status} for the packument; provenance not checked`);
  const expectedHex = integrityToSha512Hex((packument.body as { dist?: { integrity?: unknown } }).dist?.integrity);
  if (!expectedHex) return result('warn', 'packument has no sha512 dist.integrity; provenance not checked');

  const before = versionBefore(version, PROVENANCE_SINCE);
  const missing = (detail: string) => before
    ? result('warn', `no provenance: published before ADR-545, versions < ${PROVENANCE_SINCE} (${detail})`)
    : result('fail', `no SLSA provenance for a version >= ${PROVENANCE_SINCE}, which CI publishes with provenance (${detail}) — treat this tarball as untrusted`);

  if (attestations.status === 404) return missing('no attestations');
  if (!attestations.body) return result('warn', `registry returned HTTP ${attestations.status} for attestations; provenance not checked`);
  const list = (attestations.body as { attestations?: unknown }).attestations;
  const slsa = Array.isArray(list) ? (list as Attestation[]).filter((a) => a?.predicateType === SLSA_PROVENANCE_V1) : [];
  if (slsa.length === 0) return missing('attestations exist but none is SLSA provenance v1');

  for (const att of slsa) {
    const statement = decodeStatement(att);
    if (!statement) return result('fail', 'SLSA attestation envelope payload is not a decodable in-toto statement');
    const subject = (statement.subject ?? []).find((s) => subjectMatchesPackage(s?.name, pkg, version));
    if (!subject) return result('fail', `SLSA attestation subject does not name ${pkg}@${version}`);
    const digest = typeof subject.digest?.sha512 === 'string' ? subject.digest.sha512.toLowerCase() : '';
    if (digest !== expectedHex) {
      return result('fail', `SLSA attestation digest does not match the registry tarball (dist.integrity): attested sha512 ${digest.slice(0, 16) || '(none)'}…, registry ${expectedHex.slice(0, 16)}…`);
    }
    const repo = statement.predicate?.buildDefinition?.externalParameters?.workflow?.repository;
    if (normalizeRepo(repo) !== normalizeRepo(expectedRepo)) {
      return result('fail', `SLSA provenance names source repository ${JSON.stringify(repo ?? null)}, expected ${expectedRepo}`);
    }
  }
  return result('pass', `SLSA v1 provenance from ${expectedRepo}; attested digest matches dist.integrity`);
}

/** Worst status wins. */
export function worstStatus(statuses: ProvenanceStatus[]): ProvenanceStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

/** Check all three of ruflo's packages at `version`, in parallel. */
export async function verifyOurProvenance(version: string, options: ProvenanceOptions = {}): Promise<ProvenanceReport> {
  const packages = options.packages ?? (OUR_PACKAGES as readonly OurPackage[]);
  const results = await Promise.all(packages.map((pkg) => verifyPackageProvenance(pkg, version, options)));
  return { version, status: worstStatus(results.map((r) => r.status)), results };
}

/**
 * Whether the automatic provenance check (init, repin) should run. Off under
 * vitest so suites that drive the init command stay offline, and opt-out via
 * RUFLO_NO_PROVENANCE_CHECK=1. RUFLO_PROVENANCE_CHECK=1 forces it on.
 */
export function automaticProvenanceCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RUFLO_PROVENANCE_CHECK === '1') return true;
  if (env.RUFLO_NO_PROVENANCE_CHECK === '1') return false;
  return !env.VITEST;
}

export const NPM_AUDIT_SIGNATURES_NOTE =
  'For sigstore signature verification run `npm audit signatures` in a project that installs ruflo. ' +
  'Note it exits 0 for packages with no attestation (it only counts the ones it finds), so it does not detect missing provenance; this check does.';
