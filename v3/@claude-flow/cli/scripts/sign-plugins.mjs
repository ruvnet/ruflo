#!/usr/bin/env node
/**
 * Sign every plugin in the ruflo marketplace (ADR-509 §2.1) →
 * <plugin>/.claude-plugin/signature.json
 *
 * RELEASE STEP (run after the tree is final, before tagging, from a clean checkout):
 *   RUFLO_HELPERS_SIGNING_SECRET=ruflo-helpers-signing-key RUFLO_HELPERS_SIGNING_PROJECT=ruv-dev \
 *     node v3/@claude-flow/cli/scripts/sign-plugins.mjs
 *   git add every <plugin>/.claude-plugin/signature.json it wrote, and commit them with the release
 *
 * It uses the EXISTING helpers signing key pair (scripts/sign-helpers.mjs, ADR-174):
 * no new secret. The public half is RUFLO_HELPERS_PUBKEY in src/init/helper-signing.ts,
 * which the verifier (src/plugins/marketplace-trust/signature.ts) uses.
 *
 * Private-key resolution — identical to sign-helpers.mjs, and the key is never printed:
 *   1. RUFLO_HELPERS_SIGNING_SECRET (+ optional RUFLO_HELPERS_SIGNING_PROJECT): GCP Secret Manager
 *   2. RUFLO_HELPERS_SIGNING_KEY=<pem-file-path>
 *   3. ~/.ruflo/helpers-signing.key
 *   --stdin-key: read the PEM from piped stdin (never from a TTY)
 *
 * Options:
 *   --root <dir>      marketplace root (default: the repo root this script sits in)
 *   --plugin <name>   sign only this plugin (repeatable)
 *
 * Signed content: the files git tracks under the plugin's directory (a stray
 * untracked file in the release checkout is not signed, and so verifies as an
 * `extra` file). Outside a git repository, every file under the directory.
 * Canonical bytes MUST match canonicalPluginManifestBytes() in signature.ts.
 */
import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIGNATURE_RELATIVE = '.claude-plugin/signature.json';
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
}
const fail = (msg) => { console.error(`[sign-plugins] ${msg}`); process.exit(1); };

function loadPrivateKey() {
  if (process.argv.includes('--stdin-key')) {
    if (process.stdin.isTTY) fail('--stdin-key requires piped stdin; refusing interactive key entry.');
    const key = readFileSync(0, 'utf-8');
    if (!key.trim()) fail('--stdin-key received empty input');
    return key;
  }
  const secret = process.env.RUFLO_HELPERS_SIGNING_SECRET;
  if (secret) {
    const args = ['secrets', 'versions', 'access', 'latest', '--secret', secret];
    if (process.env.RUFLO_HELPERS_SIGNING_PROJECT) args.push('--project', process.env.RUFLO_HELPERS_SIGNING_PROJECT);
    try {
      // stdout captured, stderr captured: never inherited, so no key material can pass through to a log.
      return execFileSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      fail('failed to read the GCP secret named by RUFLO_HELPERS_SIGNING_SECRET. Is gcloud authed? (gcloud auth login)');
    }
  }
  const keyPath = process.env.RUFLO_HELPERS_SIGNING_KEY || join(homedir(), '.ruflo', 'helpers-signing.key');
  if (!existsSync(keyPath)) fail('no signing key. Set RUFLO_HELPERS_SIGNING_SECRET (GCP) or RUFLO_HELPERS_SIGNING_KEY (PEM path), or put the key at ~/.ruflo/helpers-signing.key.');
  return readFileSync(keyPath, 'utf-8');
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const posix = (p) => p.split(sep).join('/');

function digestOf(abs) {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) return sha256(`link:${readlinkSync(abs)}`);
  return st.isFile() ? sha256(readFileSync(abs)) : null;
}

/** git-tracked files under dir (relative to dir), or null outside a git work tree. */
function trackedFiles(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).map(posix);
  } catch {
    return null;
  }
}

function walk(root, rel = '', out = []) {
  for (const name of readdirSync(rel ? join(root, rel) : root).sort()) {
    const childRel = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(root, childRel));
    if (st.isDirectory() && !st.isSymbolicLink()) { if (!SKIP_DIRS.has(name)) walk(root, childRel, out); }
    else out.push(childRel);
  }
  return out;
}

function canonical(m) {
  const files = [...m.files].map((f) => ({ path: f.path, sha256: f.sha256 })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return Buffer.from(JSON.stringify({ plugin: m.plugin, version: m.version, files }), 'utf-8');
}

const root = resolve(arg('--root')[0] ?? join(__dirname, '..', '..', '..', '..'));
const only = new Set(arg('--plugin'));
const catalogPath = join(root, '.claude-plugin', 'marketplace.json');
if (!existsSync(catalogPath)) fail(`no marketplace at ${catalogPath}`);
const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));

const privateKeyPem = loadPrivateKey();
try {
  if (createPrivateKey(privateKeyPem).asymmetricKeyType !== 'ed25519') throw new Error('wrong-key-type');
} catch {
  fail('signing key is not a valid Ed25519 private key'); // never echo the PEM or parser input
}

let signed = 0;
for (const p of catalog.plugins ?? []) {
  if (!p || typeof p.name !== 'string' || (only.size && !only.has(p.name))) continue;
  const source = typeof p.source === 'string' ? p.source : `./plugins/${p.name}`;
  if (source.startsWith('/') || source.split(/[\\/]/).includes('..')) { console.warn(`[sign-plugins] skip ${p.name}: source outside the marketplace`); continue; }
  const dir = join(root, source);
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifestPath)) { console.warn(`[sign-plugins] skip ${p.name}: no ${relative(root, manifestPath)}`); continue; }
  const version = String(JSON.parse(readFileSync(manifestPath, 'utf-8')).version ?? '0.0.0');
  const tracked = trackedFiles(dir);
  if (tracked && tracked.length === 0) console.warn(`[sign-plugins] ${p.name}: git tracks no files here; signing every file on disk`);
  const listed = (tracked && tracked.length ? tracked : walk(dir)).filter((f) => f !== SIGNATURE_RELATIVE && !f.split("/").some((s) => SKIP_DIRS.has(s)));
  const files = [];
  for (const f of listed) {
    const abs = join(dir, f);
    if (!existsSync(abs) && !(() => { try { return lstatSync(abs).isSymbolicLink(); } catch { return false; } })()) continue; // tracked but deleted: not part of the release
    const digest = digestOf(abs);
    if (digest) files.push({ path: f, sha256: digest });
  }
  const manifest = { plugin: p.name, version, files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
  const signature = edSign(null, canonical(manifest), privateKeyPem).toString('base64');
  writeFileSync(join(dir, SIGNATURE_RELATIVE), JSON.stringify({ manifest, signature, algorithm: 'ed25519' }, null, 2) + '\n', 'utf-8');
  console.log(`[sign-plugins] ${p.name}@${version}: ${files.length} files`);
  signed++;
}
if (only.size && signed !== only.size) fail(`signed ${signed} of ${only.size} requested plugins`);
console.log(`[sign-plugins] signed ${signed} plugin(s) under ${root}`);
