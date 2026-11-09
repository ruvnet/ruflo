/**
 * zod >= 4.6.6 floor (GHSA-mrhx-c7xc-m3w5).
 *
 * Below 4.6.6, zod validates every element of an oversized constrained
 * collection before it reports the size violation, so a single request with a
 * huge array allocates one issue per element. From 4.6.6 the size check short-
 * circuits: the same input yields exactly one `too_big` issue on the
 * collection itself. These run against this plugin's real input schema.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { CoverageGapsInputSchema } from '../src/types.js';

const require = createRequire(import.meta.url);

function zodVersion(): number[] {
  const { version } = require('zod/package.json') as { version: string };
  return version.split('.').map(Number);
}

describe('zod floor', () => {
  it('resolves zod 4.6.6 or later', () => {
    const [major, minor, patch] = zodVersion();
    expect(major).toBe(4);
    expect(minor * 1000 + patch).toBeGreaterThanOrEqual(6 * 1000 + 6);
  });

  it('reports one too_big issue for an oversized targetPaths list', () => {
    const path = ['targetPaths'];
    const result = CoverageGapsInputSchema.safeParse({ targetPaths: Array(5000).fill('x'.repeat(600)) });
    expect(result.success).toBe(false);
    const issues = result.error!.issues.filter((i) =>
      path.every((p, k) => i.path[k] === p),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('too_big');
    expect(issues[0].path).toEqual(path);
  });
});
