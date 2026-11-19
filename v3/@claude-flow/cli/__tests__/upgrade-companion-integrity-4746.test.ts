/**
 * #4746 (review follow-up): `init --upgrade` must not leave companions that the
 * next run's integrity check reads as tampered.
 *
 * session.cjs and memory.cjs are signed critical helpers now, so the startup
 * refresh compares the installed bytes with the package's signed copies.
 * executeUpgrade used to regenerate both from the CLI's generators, whose
 * output is not byte-identical to the packaged copies, so every upgraded
 * project reported both as tampered (forever, under `.LOCKED` or an ahead
 * stamp, where the refresh only inspects). The upgrade now copies the
 * package's own bytes and falls back to the generators only when the package
 * ships no copy.
 *
 * The manifest here is signed with a throwaway key over the package's real
 * companion bytes: this repo's committed manifest is re-signed only by a
 * maintainer, at publish time (docs/helpers-sync.md).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import { executeUpgrade } from '../src/init/executor.js';
import { ensureCommonJsCompanions } from '../src/init/helper-companions.js';
import { CRITICAL_HELPERS, findPackageHelpersDir, getInstalledCliVersion } from '../src/init/helper-refresh.js';
import { verifyInstalledCriticalHelpers } from '../src/init/helper-integrity.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';
import { generateMemoryHelper, generateSessionManager } from '../src/init/helpers-generator.js';

const COMPANIONS = ['session.cjs', 'memory.cjs'] as const;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): { cwd: string; helpersDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-upgrade-integrity-4746-'));
  roots.push(cwd);
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  mkdirSync(join(cwd, '.claude-flow', 'sessions'), { recursive: true });
  for (const name of COMPANIONS) writeFileSync(join(helpersDir, name), '// stale companion\n');
  return { cwd, helpersDir };
}

/** A source dir holding the package's companion bytes under a throwaway-key manifest for this CLI version. */
function signedPackageCopy(packageHelpers: string): { sourceDir: string; pubkeyPem: string } {
  const sourceDir = mkdtempSync(join(tmpdir(), 'ruflo-upgrade-integrity-4746-source-'));
  roots.push(sourceDir);
  const files: Record<string, string> = {};
  for (const name of COMPANIONS) {
    const bytes = readFileSync(join(packageHelpers, name));
    writeFileSync(join(sourceDir, name), bytes);
    files[name] = sha256Hex(bytes);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = { version: getInstalledCliVersion(), files };
  const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
  writeFileSync(join(sourceDir, 'helpers.manifest.json'), JSON.stringify({ manifest, signature, algorithm: 'ed25519' }));
  return { sourceDir, pubkeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

describe('#4746: init --upgrade then the integrity check', () => {
  const packageHelpers = findPackageHelpersDir();

  it('the package ships both companions, and their bytes differ from the generators (the precondition of the bug)', () => {
    expect(packageHelpers).not.toBeNull();
    expect(readFileSync(join(packageHelpers!, 'session.cjs'), 'utf8')).not.toBe(generateSessionManager());
    expect(readFileSync(join(packageHelpers!, 'memory.cjs'), 'utf8')).not.toBe(generateMemoryHelper());
  });

  it('an upgraded project passes the integrity check: the companions are the package\'s signed bytes', async () => {
    const { cwd, helpersDir } = project();
    const result = await executeUpgrade(cwd);
    expect(result.success).toBe(true);

    // What the next run's startup refresh checks: before the fix both companions read as tampered.
    const { sourceDir, pubkeyPem } = signedPackageCopy(packageHelpers!);
    const integrity = verifyInstalledCriticalHelpers(helpersDir, sourceDir, CRITICAL_HELPERS, pubkeyPem, getInstalledCliVersion());
    expect(integrity.blocked).toBeUndefined();
    expect(integrity.tampered).toEqual([]);
    for (const name of COMPANIONS) {
      expect(result.updated).toContain(`.claude/helpers/${name}`);
      expect(readFileSync(join(helpersDir, name))).toEqual(readFileSync(join(packageHelpers!, name)));
    }
  });

  it('falls back to the generators only for a companion the package does not ship (or ships as a link)', async () => {
    const { helpersDir } = project();
    const sourceDir = mkdtempSync(join(tmpdir(), 'ruflo-upgrade-integrity-4746-partial-'));
    roots.push(sourceDir);
    writeFileSync(join(sourceDir, 'session.cjs'), '// packaged session\n');
    writeFileSync(join(sourceDir, 'elsewhere.cjs'), '// not a companion\n');
    symlinkSync(join(sourceDir, 'elsewhere.cjs'), join(sourceDir, 'memory.cjs'));
    expect(await ensureCommonJsCompanions(helpersDir, true, sourceDir)).toEqual(['session.cjs', 'memory.cjs']);
    expect(readFileSync(join(helpersDir, 'session.cjs'), 'utf8')).toBe('// packaged session\n');
    expect(readFileSync(join(helpersDir, 'memory.cjs'), 'utf8')).toBe(generateMemoryHelper());
  });
});
