import { describe, expect, it } from 'vitest';
import { bearerToken } from '../src/transport/guard.js';

describe('bearerToken', () => {
  it('returns the token after the scheme, case-insensitively', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer\tabc')).toBe('abc');
    expect(bearerToken('BEARER   abc def')).toBe('abc def');
  });

  it('rejects headers with no token or another scheme', () => {
    for (const h of [undefined, '', 'Bearer', 'Bearer ', 'Bearer  \t ', 'Bearerabc', 'Basic abc', 'Token abc']) {
      expect(bearerToken(h)).toBeUndefined();
    }
  });

  it('rejects an oversized header without inspecting it', () => {
    expect(bearerToken(`Bearer ${'a'.repeat(9000)}`)).toBeUndefined();
  });

  // The regex it replaces, /^Bearer\s+(.+)$/i, backtracks quadratically on a
  // long run of whitespace that ends in a character `.` cannot match. Time the
  // same input against both so a regression back to a quantified regex shows.
  it('stays linear on a long run of whitespace', () => {
    const hostile = `Bearer${'\t'.repeat(8000)}\n`;
    const old = /^Bearer\s+(.+)$/i;
    let t = performance.now();
    old.test(hostile);
    const oldMs = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < 100; i++) bearerToken(hostile);
    const newMs = (performance.now() - t) / 100;
    expect(newMs).toBeLessThan(2);
    expect(newMs).toBeLessThan(oldMs);
  });
});
