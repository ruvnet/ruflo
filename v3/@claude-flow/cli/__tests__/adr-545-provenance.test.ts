/**
 * ADR-545 — registry provenance check, offline, from fixtures.
 *
 * `fixtures/adr-545/sigstore-3.0.0.*` are real registry responses (the
 * attestations endpoint and the version packument for sigstore@3.0.0, which
 * is published with provenance), so the parser is proven against the real
 * shape: DSSE envelope, base64 in-toto statement, hex sha512 subject digest
 * versus base64 `dist.integrity`. The ruflo cases reuse that real attestation
 * with its statement re-encoded for a ruflo version.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  attestationsUrl,
  automaticProvenanceCheckEnabled,
  integrityToSha512Hex,
  packumentUrl,
  PROVENANCE_SOURCE_REPO,
  SLSA_PROVENANCE_V1,
  verifyOurProvenance,
  verifyPackageProvenance,
  versionBefore,
  type FetchLike,
} from '../src/init/provenance.js';
import { checkProvenance, projectPinnedVersions } from '../src/commands/doctor-provenance.js';

const FIX = join(__dirname, 'fixtures', 'adr-545');
const realAttestations = JSON.parse(readFileSync(join(FIX, 'sigstore-3.0.0.attestations.json'), 'utf-8'));
const realPackument = JSON.parse(readFileSync(join(FIX, 'sigstore-3.0.0.packument.json'), 'utf-8'));

type Routes = Record<string, { status: number; body?: unknown } | Error>;

function fakeFetch(routes: Routes): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (!r) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

function integrityFor(bytes: string): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** The real SLSA attestation with its statement re-encoded for `pkg@version`. */
function attestationFor(pkg: string, version: string, opts: { digestHex: string; repo?: string }) {
  const slsa = structuredClone(realAttestations.attestations.find((a: { predicateType: string }) => a.predicateType === SLSA_PROVENANCE_V1));
  const statement = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf-8'));
  statement.subject = [{ name: `pkg:npm/${pkg.replace(/^@/, '%40')}@${version}`, digest: { sha512: opts.digestHex } }];
  statement.predicate.buildDefinition.externalParameters.workflow.repository = opts.repo ?? PROVENANCE_SOURCE_REPO;
  slsa.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  return { attestations: [slsa] };
}

function routesFor(version: string, mode: 'pass' | 'none' | 'wrong-repo' | 'digest-mismatch'): Routes {
  const routes: Routes = {};
  for (const pkg of ['@claude-flow/cli', 'claude-flow', 'ruflo']) {
    const integrity = integrityFor(`${pkg}@${version} tarball`);
    routes[packumentUrl(pkg, version)] = { status: 200, body: { name: pkg, version, dist: { integrity } } };
    if (mode === 'none') continue;
    const hex = integrityToSha512Hex(mode === 'digest-mismatch' && pkg === 'ruflo' ? integrityFor('tampered') : integrity)!;
    const repo = mode === 'wrong-repo' && pkg === 'claude-flow' ? 'https://github.com/evil/ruflo-fork' : PROVENANCE_SOURCE_REPO;
    routes[attestationsUrl(pkg, version)] = { status: 200, body: attestationFor(pkg, version, { digestHex: hex, repo }) };
  }
  return routes;
}

describe('provenance helpers', () => {
  it('URL-encodes the scope', () => {
    expect(attestationsUrl('@claude-flow/cli', '3.79.0')).toBe('https://registry.npmjs.org/-/npm/v1/attestations/%40claude-flow%2Fcli@3.79.0');
    expect(packumentUrl('@claude-flow/cli', '3.79.0')).toBe('https://registry.npmjs.org/@claude-flow%2Fcli/3.79.0');
    expect(attestationsUrl('ruflo', '3.79.0')).toBe('https://registry.npmjs.org/-/npm/v1/attestations/ruflo@3.79.0');
  });

  it('converts dist.integrity to the hex digest the statement carries', () => {
    expect(integrityToSha512Hex(realPackument.dist.integrity)).toBe(
      JSON.parse(Buffer.from(realAttestations.attestations[1].bundle.dsseEnvelope.payload, 'base64').toString()).subject[0].digest.sha512,
    );
    expect(integrityToSha512Hex('sha1-abc')).toBeNull();
  });

  it('orders versions, prereleases before their release', () => {
    expect(versionBefore('3.78.1', '3.79.0')).toBe(true);
    expect(versionBefore('3.79.0-rc.1', '3.79.0')).toBe(true);
    expect(versionBefore('3.79.0', '3.79.0')).toBe(false);
    expect(versionBefore('3.80.0', '3.79.0')).toBe(false);
    expect(versionBefore('4.0.0', '3.79.0')).toBe(false);
  });

  it('automatic checks are off under vitest unless forced', () => {
    expect(automaticProvenanceCheckEnabled({ VITEST: 'true' })).toBe(false);
    expect(automaticProvenanceCheckEnabled({ VITEST: 'true', RUFLO_PROVENANCE_CHECK: '1' })).toBe(true);
    expect(automaticProvenanceCheckEnabled({ RUFLO_NO_PROVENANCE_CHECK: '1' })).toBe(false);
    expect(automaticProvenanceCheckEnabled({})).toBe(true);
  });
});

describe('real registry fixture (sigstore@3.0.0)', () => {
  const routes: Routes = {
    [packumentUrl('sigstore', '3.0.0')]: { status: 200, body: realPackument },
    [attestationsUrl('sigstore', '3.0.0')]: { status: 200, body: realAttestations },
  };

  it('passes against its own repository', async () => {
    const r = await verifyPackageProvenance('sigstore', '3.0.0', { fetch: fakeFetch(routes), expectedRepo: 'https://github.com/sigstore/sigstore-js' });
    expect(r.status).toBe('pass');
  });

  it('fails when the expected repository is ruvnet/ruflo', async () => {
    const r = await verifyPackageProvenance('sigstore', '3.0.0', { fetch: fakeFetch(routes) });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/sigstore\/sigstore-js.*expected https:\/\/github.com\/ruvnet\/ruflo/);
  });
});

describe('verifyOurProvenance', () => {
  it('pass: all three packages carry matching provenance', async () => {
    const fetch = fakeFetch(routesFor('3.79.0', 'pass'));
    const report = await verifyOurProvenance('3.79.0', { fetch });
    expect(report.status).toBe('pass');
    expect(report.results.map((r) => r.pkg)).toEqual(['@claude-flow/cli', 'claude-flow', 'ruflo']);
    expect(fetch.calls).toContain('https://registry.npmjs.org/-/npm/v1/attestations/%40claude-flow%2Fcli@3.79.0');
  });

  it('warn: no attestation on a version published before ADR-545', async () => {
    const report = await verifyOurProvenance('3.78.1', { fetch: fakeFetch(routesFor('3.78.1', 'none')) });
    expect(report.status).toBe('warn');
    for (const r of report.results) expect(r.message).toMatch(/no provenance: published before ADR-545, versions < 3\.79\.0/);
  });

  it('fail: no attestation on a version that must have one', async () => {
    const report = await verifyOurProvenance('3.79.0', { fetch: fakeFetch(routesFor('3.79.0', 'none')) });
    expect(report.status).toBe('fail');
    expect(report.results[0].message).toMatch(/no SLSA provenance for a version >= 3\.79\.0/);
  });

  it('fail: provenance names the wrong repository', async () => {
    const report = await verifyOurProvenance('3.79.0', { fetch: fakeFetch(routesFor('3.79.0', 'wrong-repo')) });
    expect(report.status).toBe('fail');
    const bad = report.results.find((r) => r.pkg === 'claude-flow')!;
    expect(bad.status).toBe('fail');
    expect(bad.message).toMatch(/evil\/ruflo-fork/);
    expect(report.results.filter((r) => r.status === 'pass')).toHaveLength(2);
  });

  it('fail: attested digest does not match dist.integrity', async () => {
    const report = await verifyOurProvenance('3.79.0', { fetch: fakeFetch(routesFor('3.79.0', 'digest-mismatch')) });
    expect(report.status).toBe('fail');
    expect(report.results.find((r) => r.pkg === 'ruflo')!.message).toMatch(/digest does not match/);
  });

  it('fail: subject names a different package', async () => {
    const routes = routesFor('3.79.0', 'pass');
    const integrity = (routes[packumentUrl('ruflo', '3.79.0')] as { body: { dist: { integrity: string } } }).body.dist.integrity;
    routes[attestationsUrl('ruflo', '3.79.0')] = { status: 200, body: attestationFor('other-pkg', '3.79.0', { digestHex: integrityToSha512Hex(integrity)! }) };
    const r = await verifyPackageProvenance('ruflo', '3.79.0', { fetch: fakeFetch(routes) });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/does not name ruflo@3\.79\.0/);
  });

  it('warn: network failure is never a fail', async () => {
    const routes: Routes = {};
    for (const pkg of ['@claude-flow/cli', 'claude-flow', 'ruflo']) {
      routes[packumentUrl(pkg, '3.79.0')] = new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      routes[attestationsUrl(pkg, '3.79.0')] = new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
    }
    const report = await verifyOurProvenance('3.79.0', { fetch: fakeFetch(routes) });
    expect(report.status).toBe('warn');
    expect(report.results[0].message).toMatch(/registry unreachable/);
  });

  it('warn: a version that is not published (e.g. a source checkout)', async () => {
    const report = await verifyOurProvenance('9.9.9', { fetch: fakeFetch({}) });
    expect(report.status).toBe('warn');
    expect(report.results[0].message).toMatch(/not published/);
  });

  it('warn: registry error status', async () => {
    const routes = routesFor('3.79.0', 'pass');
    routes[attestationsUrl('ruflo', '3.79.0')] = { status: 503 };
    const r = await verifyPackageProvenance('ruflo', '3.79.0', { fetch: fakeFetch(routes) });
    expect(r.status).toBe('warn');
  });
});

describe('doctor --component provenance', () => {
  it('checks the versions the project pins and mentions npm audit signatures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr545-doctor-'));
    try {
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'claude-flow': { args: ['-y', 'ruflo@3.79.0', 'mcp', 'start'] } } }));
      writeFileSync(join(dir, 'CLAUDE.md'), 'npx my-ruflo@1.2.3 is not ours\n');
      expect(projectPinnedVersions(dir)).toEqual(['3.79.0']);

      const pass = await checkProvenance(dir, { fetch: fakeFetch(routesFor('3.79.0', 'pass')) });
      expect(pass.status).toBe('pass');
      expect(pass.message).toMatch(/npm audit signatures/);

      const fail = await checkProvenance(dir, { fetch: fakeFetch(routesFor('3.79.0', 'wrong-repo')) });
      expect(fail.status).toBe('fail');
      expect(fail.fix).toMatch(/exits 0 for packages with no attestation/);

      const warn = await checkProvenance(dir, { versions: ['3.78.1'], fetch: fakeFetch(routesFor('3.78.1', 'none')) });
      expect(warn.status).toBe('warn');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
