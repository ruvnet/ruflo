/**
 * Pattern store security helpers (#4750).
 *
 * Small, dependency-light helpers shared by the download and discovery paths:
 * - strict name sanitizing so a registry entry cannot escape the cache dir,
 * - a path containment assertion used right before any write,
 * - one Ed25519 verification helper used for both patterns and registries.
 *
 * Ed25519 uses the same RFC 8032 strict mode (@noble/ed25519, zip215:false)
 * as transfer/ipfs/client.ts and the existing verifySignature().
 */

import * as path from 'path';

/**
 * Allowed shape for a pattern/registry name or version component.
 * Anything outside [A-Za-z0-9._-] is stripped.
 */
export function sanitizeName(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  // A cleaned name must not be empty, "." or "..", and must not contain a
  // path segment that is a traversal marker.
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    throw new Error('invalid name: empty after sanitizing');
  }
  if (cleaned.includes('..')) {
    throw new Error(`invalid name: contains ".." (${cleaned})`);
  }
  return cleaned;
}

/**
 * Assert that `target` resolves to a path inside `root`.
 * Throws when the resolved path escapes the root (e.g. via ../ or an absolute
 * segment). `root` and `target` are resolved before comparison.
 */
export function assertInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    // rel === '' means target === root; that is not a file inside the root, so
    // refuse it too (callers always pass a file path).
    throw new Error(`path escapes root: ${resolvedTarget} not under ${resolvedRoot}`);
  }
  return resolvedTarget;
}

/**
 * Verify an `ed25519:<hex>` signature over `content` with an `ed25519:<hex>`
 * public key. Any malformed input or verification error is a failure (false).
 */
export async function verifyEd25519(
  content: Buffer,
  signature: string,
  publicKey: string
): Promise<boolean> {
  if (typeof signature !== 'string' || typeof publicKey !== 'string') return false;
  if (!signature.startsWith('ed25519:') || !publicKey.startsWith('ed25519:')) {
    return false;
  }
  try {
    const ed = await import('@noble/ed25519');
    const sigBytes = Buffer.from(signature.slice('ed25519:'.length), 'hex');
    const pubBytes = Buffer.from(publicKey.slice('ed25519:'.length), 'hex');
    if (sigBytes.length !== 64 || pubBytes.length !== 32) {
      return false;
    }
    // RFC 8032 strict mode, as in transfer/ipfs/client.ts.
    return await ed.verifyAsync(sigBytes, content, pubBytes, { zip215: false });
  } catch {
    return false;
  }
}
