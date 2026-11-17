/**
 * #4959: v3/@claude-flow/watermark is a stale 0.2.0 duplicate. The published
 * npm package (0.4.x) and crate (0.3.x) are built from ruvnet/ai-text-watermark.
 *
 * A recursive publish from ruflo would otherwise ship the stale copy on top of
 * the canonical release. Keep every publish path closed and keep the README
 * pointing at the canonical source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(__dirname, '../../../..')
const PACKAGE_JSON = 'v3/@claude-flow/watermark/package.json'
const CARGO_TOML = 'v3/crates/ruflo-watermark/Cargo.toml'
const README = 'v3/@claude-flow/watermark/README.md'
const CANONICAL =
  'https://github.com/ruvnet/ai-text-watermark/tree/main/packages/watermark'

const read = (relativePath: string) => readFileSync(join(REPO, relativePath), 'utf8')

describe('@claude-flow/watermark non-canonical mirror (#4959)', () => {
  it('keeps the npm package private and free of publishConfig', () => {
    const pkg = JSON.parse(read(PACKAGE_JSON))
    expect(pkg.name).toBe('@claude-flow/watermark')
    expect(pkg.private).toBe(true)
    expect(pkg.publishConfig).toBeUndefined()
  })

  it('keeps the Rust crate out of cargo publish', () => {
    const lines = read(CARGO_TOML).split(/\r?\n/)
    const start = lines.findIndex((line) => line.trim() === '[package]')
    expect(start).toBeGreaterThanOrEqual(0)
    const nextTable = lines.findIndex(
      (line, index) => index > start && /^\s*\[/.test(line),
    )
    const packageTable = lines.slice(start + 1, nextTable === -1 ? undefined : nextTable)
    expect(packageTable.some((line) => /^\s*publish\s*=\s*false\s*(?:#.*)?$/.test(line))).toBe(true)
  })

  it('points readers at the canonical source instead of documenting the stale API', () => {
    const readme = read(README)
    expect(readme).toContain(CANONICAL)
    expect(readme).toMatch(/not\s+the\s+source|non-canonical|stale/i)
  })
})
