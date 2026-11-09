/**
 * zod >= 4.6.6 floor (GHSA-mrhx-c7xc-m3w5).
 *
 * This plugin's schemas have no size-bounded collection of constrained
 * elements, so the floor is checked directly, along with the zod 4 issue shape
 * this plugin's tool handlers now report: an unknown enum member is
 * `invalid_value` (zod 3 called it `invalid_enum_value`) and lists the
 * accepted values.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { ClauseExtractInputSchema } from '../src/types.js';

const require = createRequire(import.meta.url);

describe('zod floor', () => {
  it('resolves zod 4.6.6 or later', () => {
    const { version } = require('zod/package.json') as { version: string };
    const [major, minor, patch] = version.split('.').map(Number);
    expect(major).toBe(4);
    expect(minor * 1000 + patch).toBeGreaterThanOrEqual(6 * 1000 + 6);
  });

  it('reports an unknown clause type as invalid_value', () => {
    const result = ClauseExtractInputSchema.safeParse({ document: 'x', clauseTypes: ['not_a_clause'] });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'clauseTypes.0');
    expect(issue?.code).toBe('invalid_value');
    expect((issue as { values?: unknown[] }).values).not.toContain('not_a_clause');
  });
});
