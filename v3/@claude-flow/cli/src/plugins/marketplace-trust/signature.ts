/**
 * Signed plugin manifests for the ruflo marketplace (ADR-509 §2.1).
 *
 * At release, scripts/sign-plugins.mjs writes `<plugin>/.claude-plugin/signature.json`
 * for every plugin listed in `.claude-plugin/marketplace.json`: a sorted list of
 * every file's path and SHA-256, the plugin's version, and an Ed25519 signature
 * over the canonical JSON of both. The key pair is the existing helpers signing
 * key (ADR-174): the public half is RUFLO_HELPERS_PUBKEY, already pinned here.
 *
 * This module is the verifier. The canonical bytes MUST match the signer
 * byte-for-byte; a round-trip test (signer script → this verifier) pins that.
 */
import { createHash, verify as edVerify } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

import { RUFLO_HELPERS_PUBKEY } from '../../init/helper-signing.js';

export const SIGNATURE_RELATIVE = '.claude-plugin/signature.json';
/** Never part of a plugin's signed content: VCS metadata and installed dependencies. */
const SKIP_DIRS = new Set(['.git', 'node_modules']);

export interface PluginFileEntry {
  path: string; // posix, relative to the plugin root
  sha256: string;
}
export interface PluginManifest {
  plugin: string;
  version: string;
  files: PluginFileEntry[];
}
export interface SignedPluginManifest {
  manifest: PluginManifest;
  signature: string; // base64 Ed25519 over canonicalPluginManifestBytes(manifest)
  algorithm: 'ed25519';
}

export type VerifyResult = 'verified' | 'modified' | 'unsigned' | 'bad-signature';
export interface PluginVerification {
  plugin: string;
  dir: string;
  result: VerifyResult;
  /** Files whose digest differs from the signed one. */
  changed: string[];
  /** Signed files that are gone. */
  missing: string[];
  /** Files present on disk that the signature does not list. */
  extra: string[];
  version?: string;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** Canonical bytes: fixed key order, files sorted by path. MUST match scripts/sign-plugins.mjs. */
export function canonicalPluginManifestBytes(m: PluginManifest): Buffer {
  const files = [...m.files]
    .map((f) => ({ path: f.path, sha256: f.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return Buffer.from(JSON.stringify({ plugin: m.plugin, version: m.version, files }), 'utf-8');
}

/**
 * Every file under a plugin root, as posix paths, excluding the signature
 * itself. A symlink is an entry of its own (digest of `link:<target>`), never
 * followed: following it would let a link swap in content the digest never saw.
 */
export function digestPluginDir(root: string): PluginFileEntry[] {
  const out: PluginFileEntry[] = [];
  const walk = (rel: string) => {
    const abs = rel ? join(root, rel) : root;
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (childRel === SIGNATURE_RELATIVE) continue;
      const st = lstatSync(join(abs, name));
      if (st.isSymbolicLink()) out.push({ path: childRel, sha256: sha256(`link:${readlinkSync(join(abs, name))}`) });
      else if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(childRel);
      } else if (st.isFile()) out.push({ path: childRel, sha256: sha256(readFileSync(join(abs, name))) });
    }
  };
  walk('');
  return out;
}

function parseSigned(text: string): SignedPluginManifest | null {
  try {
    const s = JSON.parse(text) as SignedPluginManifest;
    if (!s || s.algorithm !== 'ed25519' || typeof s.signature !== 'string' || !s.manifest) return null;
    const m = s.manifest;
    if (typeof m.plugin !== 'string' || typeof m.version !== 'string' || !Array.isArray(m.files)) return null;
    if (!m.files.every((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string')) return null;
    return s;
  } catch {
    return null;
  }
}

/** Signature check only: true when `signed.signature` verifies over its manifest. */
export function signatureValid(signed: SignedPluginManifest, pubkeyPem: string = RUFLO_HELPERS_PUBKEY): boolean {
  try {
    return edVerify(null, canonicalPluginManifestBytes(signed.manifest), pubkeyPem, Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Check a plugin directory against its signature.json. `expectName` (the
 * marketplace name) must match the signed plugin name: a valid signature
 * copied from another plugin is a bad signature here, not a pass.
 */
export function verifyPluginDir(dir: string, expectName: string, pubkeyPem: string = RUFLO_HELPERS_PUBKEY): PluginVerification {
  const base: PluginVerification = { plugin: expectName, dir, result: 'unsigned', changed: [], missing: [], extra: [] };
  const sigPath = join(dir, SIGNATURE_RELATIVE);
  if (!existsSync(sigPath)) return base;
  const signed = parseSigned(readFileSync(sigPath, 'utf-8'));
  if (!signed || signed.manifest.plugin !== expectName || !signatureValid(signed, pubkeyPem)) {
    return { ...base, result: 'bad-signature', version: signed?.manifest.version };
  }
  const signedFiles = new Map(signed.manifest.files.map((f) => [f.path, f.sha256]));
  const onDisk = new Map(digestPluginDir(dir).map((f) => [f.path, f.sha256]));
  const changed: string[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [path, digest] of signedFiles) {
    const now = onDisk.get(path);
    if (now === undefined) missing.push(path);
    else if (now !== digest) changed.push(path);
  }
  for (const path of onDisk.keys()) if (!signedFiles.has(path)) extra.push(path);
  const clean = changed.length === 0 && missing.length === 0 && extra.length === 0;
  return { ...base, result: clean ? 'verified' : 'modified', changed, missing, extra, version: signed.manifest.version };
}

export interface MarketplacePlugin {
  name: string;
  dir: string;
}

/** The plugins a marketplace clone lists, each with its directory (its `source`, else plugins/<name>). */
export function listMarketplacePlugins(clone: string): MarketplacePlugin[] {
  const catalog = JSON.parse(readFileSync(join(clone, '.claude-plugin', 'marketplace.json'), 'utf-8')) as { plugins?: unknown };
  const listed = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  const out: MarketplacePlugin[] = [];
  for (const p of listed as Array<Record<string, unknown>>) {
    if (!p || typeof p.name !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(p.name)) continue;
    const source = typeof p.source === 'string' ? p.source : `./plugins/${p.name}`;
    // A source outside the clone (absolute, `..`, or a remote object) is not this clone's to verify.
    if (source.startsWith('/') || source.split(/[\\/]/).includes('..')) continue;
    out.push({ name: p.name, dir: join(clone, source) });
  }
  return out;
}

/** One line per verification, with the differing files named (capped). */
export function describeVerification(v: PluginVerification, cap = 5): string {
  if (v.result !== 'modified') return `${v.plugin}: ${v.result}`;
  const parts = [
    ...v.changed.map((p) => `changed ${p}`),
    ...v.missing.map((p) => `missing ${p}`),
    ...v.extra.map((p) => `extra ${p}`),
  ];
  const shown = parts.slice(0, cap).join(', ');
  return `${v.plugin}: modified (${shown}${parts.length > cap ? `, … ${parts.length - cap} more` : ''})`;
}
