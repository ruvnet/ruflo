/**
 * #4746 (remainder): the companion helpers belong to the signed release set.
 *
 * `session.cjs` and `memory.cjs` load on every hook (hook-handler.cjs requires
 * them) but were not in `CRITICAL_HELPERS`, so no signed hash ever covered the
 * bytes a project runs. These tests prove the lists name them and the
 * fail-closed refresh gate copies and verifies them from a signed source —
 * using throwaway-keypair fixtures, never this repo's real manifest, which is
 * routinely stale mid-development and only a maintainer can re-sign
 * (docs/helpers-sync.md). The committed manifest itself is NOT touched here:
 * a maintainer must re-sign it before merge, or the gate below would refuse
 * every refresh.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  autoRefreshHelpersIfStale,
  getInstalledCliVersion,
  CRITICAL_HELPERS,
  HELPERS_STAMP_FILE,
} from '../src/init/helper-refresh.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..', '..');
const COMPANIONS = ['session.cjs', 'memory.cjs'] as const;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeProject(): { cwd: string; helpersDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'helper-companion-signing-'));
  roots.push(cwd);
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  return { cwd, helpersDir };
}

/**
 * Throwaway-keypair-signed source fixture holding the given files, mirroring
 * helper-refresh.test.ts's makeSignedSource. `tamper` replaces a file's bytes
 * AFTER the manifest is signed, so its hash no longer matches.
 */
function makeSignedSource(
  version: string,
  files: Record<string, string>,
  tamper?: { name: string; bytes: string },
): { sourceDir: string; pubkeyPem: string } {
  const sourceDir = mkdtempSync(join(tmpdir(), 'helper-companion-signing-source-'));
  roots.push(sourceDir);
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(sourceDir, name), content);
    hashes[name] = sha256Hex(content);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = { version, files: hashes };
  const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
  writeFileSync(
    join(sourceDir, 'helpers.manifest.json'),
    JSON.stringify({ manifest, signature, algorithm: 'ed25519' }),
  );
  if (tamper) writeFileSync(join(sourceDir, tamper.name), tamper.bytes);
  return { sourceDir, pubkeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

const SIGNED = {
  'hook-handler.cjs': '// signed hook-handler fixture\n',
  'session.cjs': '// signed session companion fixture\n',
  'memory.cjs': '// signed memory companion fixture\n',
};

describe('companion helpers in the signed set (#4746)', () => {
  it('CRITICAL_HELPERS names both companion helpers', () => {
    for (const name of COMPANIONS) expect(CRITICAL_HELPERS).toContain(name);
  });

  it('every signing list names both companion helpers', () => {
    // Mirrors the learning-loop list-consistency test: the signer, the
    // publish-time verifier, and the offline signing smoke must all agree
    // with CRITICAL_HELPERS, or the next sign/verify/smoke run diverges.
    // executor.ts is deliberately NOT in this list: its upgrade step copies
    // critical helpers and then ensureCommonJsCompanions(force=true) owns the
    // companions (#4198), so naming them there would only add a redundant copy.
    for (const f of ['scripts/sign-helpers.mjs', 'scripts/verify-helpers.mjs']) {
      const text = readFileSync(join(PKG_ROOT, f), 'utf8');
      for (const name of COMPANIONS) expect(text).toContain(`'${name}'`);
    }
    const smoke = readFileSync(join(REPO_ROOT, 'scripts', 'smoke-helper-signing-security.mjs'), 'utf8');
    for (const name of COMPANIONS) expect(smoke).toContain(`'${name}'`);
  });

  it('a stale-stamped refresh copies the signed companions from the verified source', async () => {
    const { cwd, helpersDir } = makeProject();
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), '// OLD hook-handler\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');
    const version = getInstalledCliVersion();
    const { sourceDir, pubkeyPem } = makeSignedSource(version, SIGNED);

    const r = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });

    expect(r.refreshed).toBe(true);
    // The installed bytes are the SIGNED fixture bytes, not the generated
    // companion output: the refresh copied them through the verify gate.
    for (const name of COMPANIONS) {
      expect(readFileSync(join(helpersDir, name), 'utf8')).toBe(SIGNED[name]);
    }
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf8')).toBe(SIGNED['hook-handler.cjs']);
  });

  it('a companion whose bytes differ from the signed manifest blocks the whole refresh', async () => {
    const { cwd, helpersDir } = makeProject();
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), '// OLD hook-handler\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');
    const version = getInstalledCliVersion();
    const { sourceDir, pubkeyPem } = makeSignedSource(version, SIGNED, {
      name: 'session.cjs',
      bytes: '// TAMPERED session companion\n',
    });

    const r = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });

    expect(r.refreshed).toBe(false);
    expect(r.blocked).toContain('session.cjs');
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf8')).toBe('// OLD hook-handler\n');
  });

  it('a tampered installed companion is healed from the signed source', async () => {
    const { cwd, helpersDir } = makeProject();
    const version = getInstalledCliVersion();
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), SIGNED['hook-handler.cjs']);
    writeFileSync(join(helpersDir, 'session.cjs'), '// TAMPERED installed session companion\n');
    writeFileSync(join(helpersDir, 'memory.cjs'), SIGNED['memory.cjs']);
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), version);
    const { sourceDir, pubkeyPem } = makeSignedSource(version, SIGNED);

    const r = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });

    expect(r.refreshed).toBe(true);
    expect(r.healed).toBe(true);
    expect(r.tampered).toContain('session.cjs');
    expect(readFileSync(join(helpersDir, 'session.cjs'), 'utf8')).toBe(SIGNED['session.cjs']);
  });
});
