/**
 * zod >= 4.6.6 floor (GHSA-mrhx-c7xc-m3w5).
 *
 * Below 4.6.6, zod validates every element of an oversized constrained
 * collection before it reports the size violation, so a single request with a
 * huge array allocates one issue per element. From 4.6.6 the size check short-
 * circuits: the same input yields exactly one `too_big` issue on the
 * collection itself. These run against this plugin's real input schema.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { NeuralConsensusInputSchema } from '../src/types.js';

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

  it.runIf(ownZod)('reports one too_big issue for an oversized agents list', () => {
    const path = ['agents'];
    const result = NeuralConsensusInputSchema.safeParse({ agents: Array(5000).fill({ id: 'x'.repeat(200) }) });
    expect(result.success).toBe(false);
    const issues = result.error!.issues.filter((i) =>
      path.every((p, k) => i.path[k] === p),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('too_big');
    expect(issues[0].path).toEqual(path);
  });
});
