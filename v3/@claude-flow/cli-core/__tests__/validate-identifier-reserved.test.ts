/**
 * GHSA-6rwv-52g2-vx7j: identifiers key JSON record stores, so names that
 * resolve to Object.prototype or a built-in on a plain object are refused.
 */
import { describe, expect, it } from 'vitest';
import { validateIdentifier } from '../src/mcp-tools/validate-input.js';

describe('validateIdentifier reserved names', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('refuses %s', (id) => {
    const r = validateIdentifier(id, 'agentId');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/reserved name/);
  });

  it('still accepts ordinary ids, including ones that contain those words', () => {
    for (const id of ['agent-1', 'proto', 'my_constructor', 'prototype-2', 'ns:key.v1']) {
      expect(validateIdentifier(id, 'agentId').valid, id).toBe(true);
    }
  });
});
