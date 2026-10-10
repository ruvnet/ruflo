import { describe, expect, it } from 'vitest'

import { below, hasParentSegment, isAbsolutePath, joinPath, normalizePath, samePath, trimTrailing } from '../hooks/data/paths'

describe('paths', () => {
  it('absolute forms', () => {
    for (const p of ['/work', 'C:\\Users\\x', 'c:/Users/x', '\\\\srv\\share\\x']) expect(isAbsolutePath(p)).toBe(true)
    for (const p of ['work', '.\\x', 'C:x', '']) expect(isAbsolutePath(p)).toBe(false)
  })
  it('join keeps style', () => {
    expect(joinPath('C:\\Users\\x', '.claude-flow', 'console')).toBe('C:\\Users\\x\\.claude-flow\\console')
    expect(joinPath('/work', '.claude-flow')).toBe('/work/.claude-flow')
  })
  it('join does not double a trailing separator', () => {
    expect(joinPath('C:\\Users\\x\\', 'a')).toBe('C:\\Users\\x\\a')
    expect(joinPath('c:/Users/x/', 'a/b')).toBe('c:/Users/x/a/b')
    expect(joinPath('/work/', 'a')).toBe('/work/a')
  })
  it('same path', () => {
    expect(samePath('c:\\users\\mariu\\', 'C:\\Users\\mariu')).toBe(true)
    expect(samePath('C:/Users/mariu', 'c:\\users\\MARIU')).toBe(true)
    expect(samePath('/a/B', '/a/b')).toBe(false)
  })
  it('parent segments, either separator on a Windows path', () => {
    expect(hasParentSegment('C:\\a\\..\\b')).toBe(true)
    expect(hasParentSegment('c:/a/../b')).toBe(true)
    expect(hasParentSegment('C:\\a\\b..c')).toBe(false)
    expect(hasParentSegment('/a/../b')).toBe(true)
    expect(hasParentSegment('/a\\..\\b')).toBe(false) // a POSIX name may hold a backslash
  })
  it('normalises in the style it was written', () => {
    expect(normalizePath('/a//./b/')).toBe('/a/b')
    expect(normalizePath('C:\\a\\.\\b')).toBe('C:\\a\\b')
    expect(normalizePath('c:/a//b')).toBe('c:/a/b')
    expect(normalizePath('C:\\x\\proj/out/./f.md')).toBe('C:\\x\\proj/out/f.md')
    expect(normalizePath('\\\\srv\\share\\a')).toBe('\\\\srv\\share\\a')
  })
  it('below and trimTrailing', () => {
    expect(below('/work', '/work/a/b')).toEqual(['a', 'b'])
    expect(below('/work', '/workshop/a')).toBeNull()
    expect(below('/work', '/work')).toBeNull()
    expect(below('C:\\Work\\', 'c:/work/a/b')).toEqual(['a', 'b'])
    expect(below('C:\\Work', 'D:\\work\\a')).toBeNull()
    expect(trimTrailing('C:\\a\\\\')).toBe('C:\\a')
    expect(trimTrailing('/a//')).toBe('/a')
  })
})
