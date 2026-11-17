import { describe, expect, it } from 'vitest';
import { compileExclusionPatterns } from '../src/mcp-tools/glob-exclusions.js';

describe('bounded exclusion glob matching (#4753)', () => {
  it.each([
    ['*.md', 'note.md', true],
    ['*.md', '/notes/note.md', false],
    ['*.md', 'notes\\note.md', false],
    ['**/voice-?.md', '/notes/voice-a.md', true],
    ['**/voice-?.md', '/notes/voice-ab.md', false],
    ['**\\voice-*.md', 'C:\\notes\\voice-main.md', true],
    ['a**b*c', 'a/path/b--c', true],
    ['a**b*c', 'a/path/b/path/c', false],
    ['a**b*c', 'ab/path/b--c', true],
    ['note[1].md', 'note[1].md', true],
    ['note[1].md', 'note1.md', false],
    ['a+b.(md)', 'a+b.(md)', true],
    ['**', 'line\nbreak', false],
    ['*', 'line\nbreak', true],
    ['***', 'line\nbreak', true],
    ['***', 'line\nbreak/path', false],
    ['****', 'line\nbreak', false],
    ['?', '😀', false],
    ['??', '😀', true],
    ['', '', true],
    ['', 'nonempty', false],
  ])('matches %s against %s as %s', (pattern, path, expected) => {
    expect(compileExclusionPatterns([pattern])[0](path)).toBe(expected);
  });

  it.each(['*'.repeat(16), '*a'.repeat(32), '**a'.repeat(32)])(
    'handles adversarial wildcard placement %s without regex backtracking', (prefix) => {
      const match = compileExclusionPatterns([`${prefix}X`])[0];
      expect(match('a'.repeat(80))).toBe(false);
      expect(match(`${'a'.repeat(80)}X`)).toBe(true);
    },
  );

  it('accepts each bound and rejects the next input', () => {
    expect(compileExclusionPatterns(Array(64).fill('*'))).toHaveLength(64);
    expect(() => compileExclusionPatterns(Array(65).fill('*'))).toThrow(/64/);
    expect(compileExclusionPatterns(['x'.repeat(1024)])[0]('x'.repeat(1024))).toBe(true);
    expect(() => compileExclusionPatterns(['x'.repeat(1025)])).toThrow(/1024/);
    expect(compileExclusionPatterns(['?'.repeat(32)])[0]('x'.repeat(32))).toBe(true);
    expect(() => compileExclusionPatterns(['?'.repeat(33)])).toThrow(/32/);
  });

  it('does not create filters when none are supplied', () => {
    expect(compileExclusionPatterns(undefined)).toEqual([]);
    expect(compileExclusionPatterns([])).toEqual([]);
    expect(() => compileExclusionPatterns(null)).toThrow(/array/);
  });
});
