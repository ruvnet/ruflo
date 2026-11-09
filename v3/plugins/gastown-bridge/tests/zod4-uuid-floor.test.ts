/**
 * Dependency floor: zod >= 4.6.6 (GHSA-mrhx-c7xc-m3w5) and no `uuid` package
 * (GHSA-w5hq-g745-h8pq). Convoy IDs now come from `crypto.randomUUID()`, which
 * emits RFC 9562 v4 IDs, so they must still pass zod 4's stricter `.uuid()`.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateConvoyId } from '../src/validators.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, string> | undefined>;

describe('dependency floor', () => {
  it('declares zod ^4.6.6 or later', () => {
    const m = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(String(pkg.dependencies?.zod));
    expect(m).not.toBeNull();
    const [major, minor, patch] = m!.slice(1).map(Number);
    expect(major).toBe(4);
    expect(minor * 1000 + patch).toBeGreaterThanOrEqual(6 * 1000 + 6);
  });

  it('does not depend on the uuid package', () => {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(pkg[field]?.uuid).toBeUndefined();
    }
  });
});

describe('convoy IDs', () => {
  it('accepts IDs from crypto.randomUUID()', () => {
    for (let i = 0; i < 50; i++) {
      const id = randomUUID();
      expect(validateConvoyId(id)).toBe(id);
    }
  });

  it('rejects an ID that is not a UUID', () => {
    expect(() => validateConvoyId('convoy-1; rm -rf /')).toThrow(/convoy/i);
  });
});
