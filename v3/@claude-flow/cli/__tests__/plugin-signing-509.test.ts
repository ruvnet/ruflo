/**
 * ADR-509 §2.1 — scripts/sign-plugins.mjs and the verifier round-trip, with a
 * GENERATED test key pair (the real helpers key is never used here).
 * Cases: verified, changed, missing, extra, bad signature (corrupt, wrong key,
 * copied from another plugin), unsigned, git-tracked-only signing, status file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { verifyPluginDir, listMarketplacePlugins, describeVerification, SIGNATURE_RELATIVE } from '../src/plugins/marketplace-trust/signature.js';
import { readVerifyStatus, verifyClone, writeVerifyStatus } from '../src/plugins/marketplace-trust/verify-status.js';

const SCRIPT = resolve(__dirname, '../scripts/sign-plugins.mjs');

let root: string;
let keyFile: string;
let publicPem: string;

function plugin(name: string, files: Record<string, string>, source = `./plugins/${name}`): void {
  const dir = join(root, source);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '1.2.3' }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

function sign(extraArgs: string[] = []): string {
  return execFileSync(process.execPath, [SCRIPT, '--root', root, ...extraArgs], {
    encoding: 'utf-8',
    env: { ...process.env, RUFLO_HELPERS_SIGNING_KEY: keyFile, RUFLO_HELPERS_SIGNING_SECRET: '' },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adr509-sign-'));
  const pair = generateKeyPairSync('ed25519');
  keyFile = join(root, '..', `${root.split('/').pop()}.key.pem`);
  writeFileSync(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
  publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'ruflo',
    plugins: [{ name: 'alpha', source: './plugins/alpha' }, { name: 'beta', source: './plugins/beta/directory' }, { name: 'escape', source: '../outside' }],
  }));
  plugin('alpha', { 'hooks/hooks.json': '{"hooks":{}}', 'README.md': 'alpha', 'node_modules/x/index.js': 'ignored' });
  plugin('beta', { 'skills/s/SKILL.md': 'beta skill' }, './plugins/beta/directory');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keyFile, { force: true });
});

describe('ADR-509 sign-plugins.mjs → verifyPluginDir', () => {
  it('signs every listed plugin (its marketplace source dir), never printing the key', () => {
    const out = sign();
    expect(out).toMatch(/alpha@1\.2\.3/);
    expect(out).toMatch(/beta@1\.2\.3/);
    expect(out).not.toMatch(/PRIVATE KEY/);
    expect(existsSync(join(root, 'plugins/beta/directory', SIGNATURE_RELATIVE))).toBe(true);
    const signed = JSON.parse(readFileSync(join(root, 'plugins/alpha', SIGNATURE_RELATIVE), 'utf-8'));
    const paths = signed.manifest.files.map((f: { path: string }) => f.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).not.toContain(SIGNATURE_RELATIVE);
    expect(paths.some((p: string) => p.includes('node_modules'))).toBe(false);
    expect(listMarketplacePlugins(root).map((p) => p.name)).toEqual(['alpha', 'beta']); // ../outside is not this clone's
  });

  it('round-trips to verified, then reports each tamper', () => {
    sign();
    const dir = join(root, 'plugins/alpha');
    expect(verifyPluginDir(dir, 'alpha', publicPem).result).toBe('verified');

    writeFileSync(join(dir, 'README.md'), 'tampered');
    let v = verifyPluginDir(dir, 'alpha', publicPem);
    expect(v.result).toBe('modified');
    expect(v.changed).toEqual(['README.md']);

    unlinkSync(join(dir, 'hooks/hooks.json'));
    v = verifyPluginDir(dir, 'alpha', publicPem);
    expect(v.missing).toEqual(['hooks/hooks.json']);

    writeFileSync(join(dir, 'hooks/evil.js'), 'x');
    v = verifyPluginDir(dir, 'alpha', publicPem);
    expect(v.extra).toEqual(['hooks/evil.js']);
    expect(describeVerification(v)).toMatch(/^alpha: modified \(changed README\.md, missing hooks\/hooks\.json, extra hooks\/evil\.js\)$/);
  });

  it('bad-signature: corrupted signature, a different key, or a signature copied from another plugin', () => {
    sign();
    const dir = join(root, 'plugins/alpha');
    const sigPath = join(dir, SIGNATURE_RELATIVE);
    const signed = JSON.parse(readFileSync(sigPath, 'utf-8'));

    // Wrong key: the real pinned helpers key did not sign this.
    expect(verifyPluginDir(dir, 'alpha').result).toBe('bad-signature');

    // A manifest edited to match tampered content no longer matches its signature.
    writeFileSync(sigPath, JSON.stringify({ ...signed, manifest: { ...signed.manifest, version: '9.9.9' } }));
    expect(verifyPluginDir(dir, 'alpha', publicPem).result).toBe('bad-signature');

    writeFileSync(sigPath, '{not json');
    expect(verifyPluginDir(dir, 'alpha', publicPem).result).toBe('bad-signature');

    // beta's valid signature copied into alpha: signed plugin name differs.
    writeFileSync(sigPath, readFileSync(join(root, 'plugins/beta/directory', SIGNATURE_RELATIVE)));
    expect(verifyPluginDir(dir, 'alpha', publicPem).result).toBe('bad-signature');
  });

  it('unsigned when there is no signature.json', () => {
    expect(verifyPluginDir(join(root, 'plugins/alpha'), 'alpha', publicPem).result).toBe('unsigned');
  });

  it('--plugin signs one plugin; an unknown one fails loudly', () => {
    sign(['--plugin', 'alpha']);
    expect(existsSync(join(root, 'plugins/alpha', SIGNATURE_RELATIVE))).toBe(true);
    expect(existsSync(join(root, 'plugins/beta/directory', SIGNATURE_RELATIVE))).toBe(false);
    expect(() => sign(['--plugin', 'nope'])).toThrow();
  });

  it('in a git checkout only tracked files are signed: an untracked file verifies as extra', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'x');
    writeFileSync(join(root, 'plugins/alpha/stray.log'), 'local junk');
    sign();
    const v = verifyPluginDir(join(root, 'plugins/alpha'), 'alpha', publicPem);
    expect(v.result).toBe('modified');
    expect(v.extra).toEqual(['stray.log']);
  });

  it('refuses a non-Ed25519 key without echoing it', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    writeFileSync(keyFile, rsa);
    let stderr = '';
    try {
      sign();
    } catch (e) {
      stderr = String((e as { stderr?: unknown }).stderr ?? '');
    }
    expect(stderr).toMatch(/not a valid Ed25519 private key/);
    expect(stderr).not.toMatch(/PRIVATE KEY|MII/);
  });
});

describe('ADR-509 verify status file', () => {
  it('writes per config dir and reads back; two config dirs never overwrite each other', () => {
    sign();
    const home = mkdtempSync(join(tmpdir(), 'adr509-home-'));
    try {
      const results = verifyClone(root); // real pinned key: test-key signatures read as bad-signature
      expect(results.map((r) => [r.plugin, r.result])).toEqual([['alpha', 'bad-signature'], ['beta', 'bad-signature']]);
      writeVerifyStatus('/cfg/a', root, results, home);
      writeVerifyStatus('/cfg/b', root, [{ ...results[0], result: 'verified' }], home);
      const file = readVerifyStatus(home);
      expect(file.byConfigDir['/cfg/a'].plugins).toEqual({ alpha: 'bad-signature', beta: 'bad-signature' });
      expect(file.byConfigDir['/cfg/b'].plugins).toEqual({ alpha: 'verified' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('records the worst of clone and install cache per plugin, each copy by directory, under a normalized key', () => {
    const home = mkdtempSync(join(tmpdir(), 'adr509-home-'));
    try {
      const clone = [{ plugin: 'alpha', dir: '/c/plugins/alpha', result: 'verified' as const, changed: [], missing: [], extra: [] }];
      const cache = [{ plugin: 'alpha', dir: '/cfg/plugins/cache/ruflo/alpha/1.2.3/', result: 'modified' as const, changed: ['x'], missing: [], extra: [] }];
      writeVerifyStatus('C:\\Users\\U\\.claude\\', '/c', clone, home, cache);
      const entry = readVerifyStatus(home).byConfigDir['c:/users/u/.claude'];
      expect(entry.plugins).toEqual({ alpha: 'modified' });
      expect(entry.paths).toEqual({ '/c/plugins/alpha': 'verified', '/cfg/plugins/cache/ruflo/alpha/1.2.3': 'modified' });
      // An older, unnormalized spelling of the same config dir is replaced, not kept beside it.
      writeVerifyStatus('c:/users/u/.claude', '/c', clone, home);
      expect(Object.keys(readVerifyStatus(home).byConfigDir)).toEqual(['c:/users/u/.claude']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('verifyAndRecord (the mods install path) records a tampered install cache next to a clean clone (negative control: clone only)', async () => {
    const { verifyAndRecord } = await import('../src/mods/install-trust.js');
    const home = mkdtempSync(join(tmpdir(), 'adr509-home-'));
    const cfg = mkdtempSync(join(tmpdir(), 'adr509-cfg-'));
    try {
      // The clone's alpha is unsigned; its install-cache copy carries a signature that does not verify.
      const cacheDir = join(cfg, 'plugins', 'cache', 'ruflo', 'alpha', '1.2.3');
      mkdirSync(join(cacheDir, '.claude-plugin'), { recursive: true });
      writeFileSync(join(cacheDir, '.claude-plugin', 'plugin.json'), '{"name":"alpha"}');
      writeFileSync(join(cacheDir, SIGNATURE_RELATIVE), '{"manifest":{"plugin":"alpha","files":[]},"signature":"AAAA","algorithm":"ed25519"}');
      writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'alpha@ruflo': [{ installPath: cacheDir }] } }));
      verifyAndRecord(cfg, root, ['alpha'], home);
      const entry = readVerifyStatus(home).byConfigDir[cfg];
      expect(entry.plugins.alpha).toBe('bad-signature');
      expect(entry.paths?.[cacheDir]).toBe('bad-signature');
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cfg, { recursive: true, force: true });
    }
  });
});
