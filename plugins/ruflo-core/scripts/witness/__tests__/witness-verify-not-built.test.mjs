// #4885 — verify.mjs must report a checkout whose dist/ layer was never built
// as `status: 'not-built'` (exit 2), and must NOT let that verdict mask a real
// failure: a tampered file, a deleted dist artifact in a built tree, or a bad
// signature all exit 1.
//
// Runs under vitest so the root CI ratchet (scripts/ci-test-ratchet.mjs)
// collects it. The fixture is signed with node:crypto using the same
// commit-derived seed verify.mjs reproduces, so it needs no git repo and no
// @noble/ed25519.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERIFY = resolve(dirname(fileURLToPath(import.meta.url)), '../verify.mjs');

const FILES = {
  'src/feature.js': 'export const x = 1; // marker:src-fix-1\n',
  'pkg/dist/one.js': 'module.exports = 1; // marker:dist-fix-1\n',
  'pkg/dist/two.js': 'module.exports = 2; // marker:dist-fix-2\n',
};
const MARKERS = {
  'src/feature.js': 'marker:src-fix-1',
  'pkg/dist/one.js': 'marker:dist-fix-1',
  'pkg/dist/two.js': 'marker:dist-fix-2',
};

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function signedManifest() {
  const gitCommit = 'f'.repeat(40);
  const manifest = {
    schema: 'ruflo-witness/v1',
    issuedAt: '2026-11-10T00:00:00.000Z',
    gitCommit,
    branch: 'main',
    os: 'linux',
    releases: {},
    fixes: Object.entries(FILES).map(([file, body], i) => ({
      id: `fix-${i + 1}`,
      file,
      marker: MARKERS[file],
      sha256: sha256(body),
      markerVerified: true,
    })),
  };
  const manifestHash = sha256(JSON.stringify(manifest));
  const seed = createHash('sha256').update(`${gitCommit}:ruflo-witness/v1`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  const signature = sign(null, Buffer.from(manifestHash, 'hex'), privateKey);
  return {
    manifest,
    integrity: {
      manifestHash,
      publicKey: publicKey.toString('hex'),
      signature: signature.toString('hex'),
      authenticity: 'self-attested',
    },
  };
}

function writeTree(root, { dist }) {
  for (const [file, body] of Object.entries(FILES)) {
    if (!dist && file.includes('/dist/')) continue;
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), body);
  }
}

function verify(root, manifestPath) {
  const out = spawnSync(
    process.execPath,
    [VERIFY, '--manifest', manifestPath, '--root', root, '--json'],
    { encoding: 'utf8', env: { ...process.env, RUFLO_WITNESS_PUBLIC_KEY: '' } },
  );
  return { code: out.status, json: JSON.parse(out.stdout), stderr: out.stderr };
}

describe('witness verify.mjs: not-built vs real failure (#4885)', () => {
  let root;
  let manifestPath;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'witness-not-built-'));
    manifestPath = join(root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(signedManifest(), null, 2));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('unbuilt checkout -> status not-built, exit 2, legacy precondition kept', () => {
    writeTree(root, { dist: false });
    const { code, json } = verify(root, manifestPath);
    expect(code).toBe(2);
    expect(json.ok).toBe(false);
    expect(json.status).toBe('not-built');
    expect(json.precondition).toBe('dist-not-built');
    expect(json.notBuilt).toEqual({ distEntries: 2, sourceEntries: 1, distDirs: ['pkg/dist'] });
    expect(json.signature.signatureValid).toBe(true);
    expect(json.summary).toMatchObject({ pass: 1, regressed: 0, missing: 2 });
  });

  it('unbuilt checkout -> text output says NOT BUILT, not "every entry missing"', () => {
    writeTree(root, { dist: false });
    const out = spawnSync(process.execPath, [VERIFY, '--manifest', manifestPath, '--root', root], {
      encoding: 'utf8',
      env: { ...process.env, RUFLO_WITNESS_PUBLIC_KEY: '' },
    });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('NOT BUILT');
    expect(out.stderr).toContain('not an integrity failure');
    expect(out.stderr).not.toContain('every manifest entry is missing');
  });

  it('built and intact -> status ok, exit 0', () => {
    writeTree(root, { dist: true });
    const { code, json } = verify(root, manifestPath);
    expect(code).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.status).toBe('ok');
    expect(json.precondition).toBeUndefined();
    expect(json.summary).toMatchObject({ pass: 3, drift: 0, regressed: 0, missing: 0 });
  });

  it('built tree with one file tampered (marker removed) -> status fail, exit 1', () => {
    writeTree(root, { dist: true });
    const target = join(root, 'pkg/dist/one.js');
    writeFileSync(target, readFileSync(target, 'utf8').replace('marker:dist-fix-1', 'patched-out'));
    const { code, json } = verify(root, manifestPath);
    expect(code).toBe(1);
    expect(json.status).toBe('fail');
    expect(json.summary.regressed).toBe(1);
    expect(json.results.find((r) => r.file === 'pkg/dist/one.js').status).toBe('regressed');
  });

  it('built tree with one dist file deleted -> status fail, exit 1 (not "not built")', () => {
    writeTree(root, { dist: true });
    rmSync(join(root, 'pkg/dist/two.js'));
    const { code, json } = verify(root, manifestPath);
    expect(code).toBe(1);
    expect(json.status).toBe('fail');
    expect(json.precondition).toBeUndefined();
    expect(json.summary.missing).toBe(1);
  });

  it('unbuilt checkout with a source marker regressed -> status fail, exit 1', () => {
    writeTree(root, { dist: false });
    writeFileSync(join(root, 'src/feature.js'), 'export const x = 1;\n');
    const { code, json } = verify(root, manifestPath);
    expect(code).toBe(1);
    expect(json.status).toBe('fail');
    expect(json.summary.regressed).toBe(1);
  });

  it('unbuilt checkout with a tampered signature -> status fail, exit 1', () => {
    writeTree(root, { dist: false });
    const witness = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const s = witness.integrity.signature;
    witness.integrity.signature = `${s[0] === '0' ? '1' : '0'}${s.slice(1)}`;
    writeFileSync(manifestPath, JSON.stringify(witness));
    const { code, json } = verify(root, manifestPath);
    expect(code).toBe(1);
    expect(json.status).toBe('fail');
    expect(json.signature.signatureValid).toBe(false);
  });
});
