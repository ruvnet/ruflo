/**
 * Shared Cryptographic Utilities
 *
 * Centralises timing-safe comparison so every module that verifies
 * HMAC signatures uses the same constant-time implementation.
 *
 * @module @claude-flow/guidance/crypto-utils
 */

import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison to prevent timing attacks on HMAC signatures.
 *
 * Delegates to Node.js `crypto.timingSafeEqual` via `Buffer.from` for
 * encoding-safe comparison. Falls back to a manual XOR loop when the
 * buffers have different byte lengths (which the native function rejects).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  if (bufA.length !== bufB.length) return false;

  return nodeTimingSafeEqual(bufA, bufB);
}
