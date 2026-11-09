/**
 * zod >= 4.6.6 floor (GHSA-mrhx-c7xc-m3w5).
 *
 * This plugin's schemas have no size-bounded collection of constrained
 * elements, so the floor is checked directly, along with the zod 4 issue shape
 * this plugin's tool handlers now report: an unknown enum member is
 * `invalid_value` (zod 3 called it `invalid_enum_value`) and lists the
 * accepted values.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { MemoryAnalyzeInputSchema } from '../src/types.js';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string> };

/** "^4.6.7" or "4.6.7" -> [4, 6, 7] */
function floorOf(range: string): number[] {
  const m = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) throw new Error(`unsupported zod range: ${range}`);
  return [+m[1], +m[2], +m[3]];
}

function atLeast(v: number[], floor: number[]): boolean {
  return v[0] === floor[0] && (v[1] - floor[1] || v[2] - floor[2]) >= 0;
}

const declared = floorOf(manifest.dependencies?.zod ?? '0.0.0');
const resolved = (require('zod/package.json') as { version: string }).version
  .split('.')
  .map(Number);
// The runtime checks below need the zod this package declares. A workspace
// run that hoists another zod (the repo-root test ratchet resolves zod 3 from
// the root install) skips them instead of testing the wrong library.
const ownZod = atLeast(resolved, declared);

describe('zod floor', () => {
  it('declares zod ^4.6.6 or later', () => {
    expect(declared[0]).toBe(4);
    expect(atLeast(declared, [4, 6, 6])).toBe(true);
  });

  it.runIf(ownZod)('reports an unknown analysis kind as invalid_value', () => {
    const result = MemoryAnalyzeInputSchema.safeParse({ analysis: ['not_an_analysis'] });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'analysis.0');
    expect(issue?.code).toBe('invalid_value');
    expect((issue as { values?: unknown[] }).values).not.toContain('not_an_analysis');
  });
});
