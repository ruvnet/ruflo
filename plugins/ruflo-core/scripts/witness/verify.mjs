#!/usr/bin/env node
/**
 * Verify a signed witness manifest against the live tree (ADR-103).
 *
 * Project-agnostic — works without ruflo CLI being installed.
 *
 * Usage:
 *   node verify.mjs --manifest <path> [--root <path>] [--source-only] [--json] [--strict] [--public-key <hex>]
 *
 * Exit codes:
 *   0  — signature valid + all fixes pass or drift (marker present);
 *        with --strict, all fixes must pass without drift
 *   1  — signature invalid OR any fix regressed/missing, or drift with --strict
 *   2  — bad arguments / file not found OR precondition not met
 *        (e.g. dist files not built during full-tree verification).
 *        Issue #1880: scheduled runners use this to distinguish a
 *        "needs install+build" environment from a real verification
 *        failure, so we stop filing recurring issues on every cron run.
 *
 * JSON output carries `status`: 'ok' | 'fail' | 'not-built' |
 * 'no-source-entries'. 'not-built' (exit 2, `precondition: 'dist-not-built'`)
 * is reported only when the signature is valid, no source entry regressed
 * or is missing, and NONE of the manifest's dist/ entries exist on disk —
 * i.e. the build never ran. If any dist/ entry exists, missing dist files
 * are a real failure (exit 1), not a precondition (#4885).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  verify as verifyEd25519,
} from 'node:crypto';
import { fileSha256, fileContains } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node verify.mjs --manifest <path> [--root <path>] [--source-only] [--json] [--strict] [--public-key <hex>]');
  process.exit(0);
}
if (!args.manifest) { console.error('--manifest <path> required'); process.exit(2); }

const manifestPath = resolve(args.manifest);
if (!existsSync(manifestPath)) { console.error(`not found: ${manifestPath}`); process.exit(2); }

const repoRoot = resolve(args.root ?? process.cwd());
const asJson = !!args.json;
const sourceOnly = !!args['source-only'];
const strict = !!args.strict;

const witness = JSON.parse(readFileSync(manifestPath, 'utf8'));

// ─── signature ────────────────────────────────────────────────────
const sig = verifySignature(witness, { publicKey: args['public-key'] });

// ─── per-fix marker check ─────────────────────────────────────────
const allFixes = witness.manifest.fixes;
const selectedFixes = sourceOnly
  ? allFixes.filter((fix) => !isGeneratedDistPath(fix.file))
  : allFixes;
const skippedGenerated = allFixes.length - selectedFixes.length;

if (sourceOnly && selectedFixes.length === 0) {
  const result = {
    ok: false,
    status: 'no-source-entries',
    scope: 'source-only',
    precondition: 'no-source-entries',
    signature: sig,
  };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else console.error('verify.mjs: manifest contains no source entries to verify');
  process.exit(2);
}

const fileResults = selectedFixes.map((fix) => {
  const installed = join(repoRoot, fix.file);
  if (!existsSync(installed)) {
    return { ...fix, status: 'missing', sha256Match: false, markerPresent: false };
  }
  const localSha256 = fileSha256(installed);
  const markerPresent = fileContains(installed, fix.marker);
  const sha256Match = localSha256 === fix.sha256;
  const status = sha256Match && markerPresent ? 'pass'
              : (markerPresent ? 'drift' : 'regressed');
  return { ...fix, status, sha256Match, markerPresent, localSha256 };
});

const summary = {
  pass: fileResults.filter(r => r.status === 'pass').length,
  drift: fileResults.filter(r => r.status === 'drift').length,
  regressed: fileResults.filter(r => r.status === 'regressed').length,
  missing: fileResults.filter(r => r.status === 'missing').length,
  skippedGenerated,
};

// Issue #1880 / #2528 / #4885 — a checkout where the build never ran is a
// precondition failure (exit 2), not an integrity failure. That verdict is
// narrow on purpose so it can never mask a real one:
//   - the signature block must be fully valid (a tampered manifest on an
//     unbuilt checkout still fails with exit 1);
//   - no source (non-dist) entry may be regressed or missing;
//   - NO dist/ entry may exist on disk. One deleted or renamed dist file in
//     an otherwise built tree is a missing artifact (exit 1), not "not built".
const sigOk = sig.signatureValid && sig.manifestHashOk && sig.publicKeyReproducible;
const distResults = fileResults.filter(r => isGeneratedDistPath(r.file));
const distMissing = distResults.filter(r => r.status === 'missing').length;
const sourceMissing = summary.missing - distMissing;
const notBuilt = !sourceOnly
  && sigOk
  && distResults.length > 0
  && distMissing === distResults.length
  && sourceMissing === 0
  && summary.regressed === 0;

if (notBuilt) {
  const notBuiltInfo = {
    distEntries: distResults.length,
    sourceEntries: fileResults.length - distResults.length,
    distDirs: [...new Set(distResults.map(r => distDirOf(r.file)))].sort(),
  };
  if (asJson) {
    console.log(JSON.stringify(
      {
        ok: false,
        status: 'not-built',
        scope: 'full',
        precondition: 'dist-not-built',
        notBuilt: notBuiltInfo,
        signature: sig,
        summary,
        results: fileResults,
      },
      null, 2
    ));
  } else {
    console.error(
      `verify.mjs: NOT BUILT — precondition not met, this is not an integrity failure.\n` +
      `\n` +
      `  manifest signature:  valid\n` +
      `  source entries:      ${notBuiltInfo.sourceEntries} checked — pass=${summary.pass} drift=${summary.drift} regressed=0 missing=0\n` +
      `  dist/ entries:       ${notBuiltInfo.distEntries} not verified — none of them exist on disk\n` +
      `  unbuilt dist dirs:   ${notBuiltInfo.distDirs.join(', ')}\n` +
      `\n` +
      `The dist/ layer cannot be verified until it is built. Build it, then re-run:\n` +
      `  (cd v3 && pnpm install --frozen-lockfile && pnpm --recursive run build)\n` +
      `To verify only the source layer without building, pass --source-only.\n` +
      `Exit 2 = precondition (not built); exit 1 = verification failure. See #1880, #4885.`
    );
  }
  process.exit(2);
}

const ok = sig.signatureValid && sig.manifestHashOk && sig.publicKeyReproducible
        && summary.regressed === 0 && summary.missing === 0
        && (!strict || summary.drift === 0);

if (asJson) {
  console.log(JSON.stringify(
    { ok, status: ok ? 'ok' : 'fail', scope: sourceOnly ? 'source-only' : 'full', signature: sig, summary, results: fileResults },
    null,
    2
  ));
} else {
  console.log(`Verification scope: ${sourceOnly ? 'source-only' : 'full'}`);
  console.log('Manifest signature:');
  console.log(`  hash matches:                    ${sig.manifestHashOk ? 'yes' : 'NO'}`);
  console.log(`  public key reproducible:         ${sig.publicKeyReproducible ? 'yes' : 'NO'}`);
  console.log(`  Ed25519 signature valid:         ${sig.signatureValid ? 'yes' : 'NO'}`);
  console.log(`  authenticity:                    ${sig.authenticity}${sig.pinnedKeyConfigured ? ' (pinned key)' : ''}`);
  if (sig.authenticity === 'self-attested' && !sig.pinnedKeyConfigured) {
    console.log('  WARNING: the signing seed is derived from the public git commit, so this');
    console.log('           signature proves integrity, not authorship. Set');
    console.log('           --public-key or RUFLO_WITNESS_PUBLIC_KEY to pin a release key.');
  }
  if (sig.authenticity === 'external-key' && !sig.pinnedKeyConfigured) {
    console.log('  WARNING: manifest was signed with an external key; verification fails closed');
    console.log('           until --public-key or RUFLO_WITNESS_PUBLIC_KEY pins the matching public key.');
  }
  console.log('');
  console.log(`Summary: pass=${summary.pass} drift=${summary.drift} regressed=${summary.regressed} missing=${summary.missing} skipped-generated=${summary.skippedGenerated}`);
  if (summary.regressed > 0) {
    console.log('\nRegressed:');
    for (const r of fileResults.filter(r => r.status === 'regressed')) {
      console.log(`  ${r.id}  marker missing in ${r.file}`);
    }
  }
  if (summary.missing > 0) {
    console.log('\nMissing files:');
    for (const r of fileResults.filter(r => r.status === 'missing')) {
      console.log(`  ${r.id}  ${r.file}`);
    }
  }
}

process.exit(ok ? 0 : 1);

// ─── ed25519 helpers ─────────────────────────────────────────────
function verifySignature(witness, options = {}) {
  try {
    const recomputed = createHash('sha256').update(JSON.stringify(witness.manifest)).digest('hex');
    const manifestHashOk = recomputed === witness.integrity.manifestHash;
    const authenticity = witness.integrity.authenticity ?? 'self-attested';
    const declaredPublicKey = String(witness.integrity.publicKey ?? '').toLowerCase();
    // --public-key takes precedence over the RUFLO_WITNESS_PUBLIC_KEY env var.
    const pinnedKey = String(options.publicKey ?? process.env.RUFLO_WITNESS_PUBLIC_KEY ?? '').trim().toLowerCase();
    const pinnedKeyConfigured = pinnedKey.length > 0;
    const pinnedKeyMatches = pinnedKeyConfigured ? declaredPublicKey === pinnedKey : undefined;

    // For a legacy self-attested manifest, the public key is reproducible from
    // the commit. For an external-key manifest, only a caller-supplied pinned
    // key can establish authenticity; without one verification fails closed.
    let publicKeyReproducible = false;
    if (pinnedKeyConfigured) {
      publicKeyReproducible = pinnedKeyMatches === true;
    } else if (authenticity === 'self-attested') {
      const seed = createHash('sha256')
        .update(witness.manifest.gitCommit + ':ruflo-witness/v1')
        .digest();

      // RFC 8410 DER wrappers let Node/OpenSSL derive and verify Ed25519 keys
      // without a package install. The witness format remains byte-compatible
      // with manifests produced by @noble/ed25519.
      const privateKey = createPrivateKey({
        key: Buffer.concat([
          Buffer.from('302e020100300506032b657004220420', 'hex'),
          seed,
        ]),
        format: 'der',
        type: 'pkcs8',
      });
      const reproducedKey = createPublicKey(privateKey)
        .export({ format: 'der', type: 'spki' })
        .subarray(-32);
      publicKeyReproducible = reproducedKey.toString('hex') === declaredPublicKey;
    }

    const declaredKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(witness.integrity.publicKey, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    const signatureValid = verifyEd25519(
      null,
      Buffer.from(witness.integrity.manifestHash, 'hex'),
      declaredKey,
      Buffer.from(witness.integrity.signature, 'hex'),
    );
    return {
      manifestHashOk,
      publicKeyReproducible,
      signatureValid,
      authenticity,
      pinnedKeyConfigured,
      pinnedKeyMatches,
      verifier: 'node:crypto',
    };
  } catch (error) {
    return {
      manifestHashOk: false,
      publicKeyReproducible: false,
      signatureValid: false,
      authenticity: witness?.integrity?.authenticity ?? 'self-attested',
      pinnedKeyConfigured: Boolean(options.publicKey ?? process.env.RUFLO_WITNESS_PUBLIC_KEY),
      verifier: 'node:crypto',
      reason: 'signature-verification-error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function distDirOf(file) {
  const parts = file.split(/[\\/]/);
  return parts.slice(0, parts.indexOf('dist') + 1).join('/');
}

function isGeneratedDistPath(file) {
  return typeof file === 'string' && file.split(/[\\/]/).includes('dist');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--help' || a === '--strict') { out[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}
