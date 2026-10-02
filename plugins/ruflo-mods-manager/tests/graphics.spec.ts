/**
 * The pure picture code under plain vitest: base64, the grid, braille, and every frame function. Run with
 *   npx vitest run --root plugins/ruflo-mods-manager tests/graphics.spec.ts
 */
import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { hookMapFrame, isStale, pulseFrame, sparkFrame, type HookMap, type Pulse } from '../hooks/views/frames'
import { cellGlyph, encodeBase64, Grid, MAX_COLUMNS, toBase64 } from '../hooks/views/raster'

const MAP: HookMap = {
  mods: ['ruflo-mods', 'ruflo-swarm', 'ruflo-ruos'],
  events: ['session.start', 'tool.call', 'command.run', 'prompt.submit', 'ui.render'],
  edges: [
    [0, 0, false],
    [0, 1, true],
    [1, 0, false],
    [1, 1, true],
    [1, 2, false],
    [1, 4, false],
    [2, 0, false],
    [2, 3, false],
  ],
}

const PULSE: Pulse = { beats: [940_000, 970_000, 1_000_000], periodMs: 30_000, windowMs: 120_000 }

/** The glyphs of a grid as text rows, for reading a failure. */
const rowsOf = (grid: Grid): string[] =>
  Array.from({ length: grid.rows }, (_, y) => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyphAt(x, y))).join(''))

describe('base64', () => {
  it('matches Buffer for every length 0..64, padding included', () => {
    for (let n = 0; n <= 64; n += 1) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n * 11) & 0xff)

      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    }
  })

  it('a grid encodes columns × rows little-endian u32 triplets, row-major', () => {
    const grid = new Grid(3, 2)

    grid.set(1, 1, '⣿', 0xff8800, 0x01000000)

    const bytes = Buffer.from(grid.toBase64(), 'base64')
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)

    expect(bytes.byteLength).toBe(3 * 2 * 12)
    expect([...words.slice((1 * 3 + 1) * 3, (1 * 3 + 1) * 3 + 3)]).toEqual([0x28ff, 0xff8800, 0x01000000])
    expect(words[0]).toBe(0x20)
  })
})

describe('cells the terminal accepts', () => {
  it('keeps ASCII, box drawing, blocks and braille; anything else becomes a space', () => {
    expect(cellGlyph('a')).toBe(0x61)
    expect(cellGlyph('─')).toBe(0x2500)
    expect(cellGlyph('▀')).toBe(0x2580)
    expect(cellGlyph(0x28ff)).toBe(0x28ff)

    for (const bad of ['😀', '\u0007', '‮', '中', 'é']) {
      expect(cellGlyph(bad)).toBe(0x20)
    }
  })

  it('a grid is bounded to the Raster limits', () => {
    expect(new Grid(9999, 3).columns).toBe(MAX_COLUMNS)
    expect(new Grid(0, 0).rows).toBe(1)
  })
})

describe('frames keep their size', () => {
  const boxes = [
    { columns: 20, rows: 3 },
    { columns: 79, rows: 12 },
    { columns: 140, rows: 14 },
  ]

  it('the pulse is the box size at every t, fresh or stale (a blit at another size is refused)', () => {
    for (const box of boxes) {
      for (const t of [1_000_000, 1_000_125, 1_017_333, 1_090_001, 2_000_000]) {
        const grid = pulseFrame(PULSE, box, t)

        expect([grid.columns, grid.rows]).toEqual([box.columns, box.rows])
        expect(Buffer.from(grid.toBase64(), 'base64').byteLength).toBe(box.columns * box.rows * 12)
      }
    }
  })

  it('the hook map and the sparkline are the box size whatever the data', () => {
    for (const box of boxes) {
      for (const map of [MAP, { mods: [], events: [], edges: [] }, { ...MAP, events: Array.from({ length: 40 }, (_, i) => `event.${i}`) }]) {
        const grid = hookMapFrame(map, box)

        expect([grid.columns, grid.rows]).toEqual([box.columns, box.rows])
      }

      for (const values of [[], [0], [3, 1, 4, 1, 5, 9, 2, 6], Array.from({ length: 500 }, (_, i) => i % 7)]) {
        const grid = sparkFrame(values, box)

        expect([grid.columns, grid.rows]).toEqual([box.columns, box.rows])
      }
    }
  })
})

describe('the pulse says only what was measured', () => {
  const box = { columns: 60, rows: 3 }
  const top = (grid: Grid) => rowsOf(grid)[0]!

  it('spikes at measured refresh times, and they move left as real time passes', () => {
    const now = pulseFrame(PULSE, box, 1_000_500)
    const later = pulseFrame(PULSE, box, 1_030_000)

    expect(top(now).trim()).not.toBe('')
    expect(top(later)).not.toBe(top(now))
    // The newest spike sits at the right edge at its own time.
    expect(top(now).trimEnd().length).toBeGreaterThan(box.columns - 3)
  })

  it('goes flat once three periods pass without a refresh: STALE is never drawn as live', () => {
    const t = 1_000_000 + PULSE.periodMs * 3 + 1

    expect(isStale(PULSE, t)).toBe(true)
    expect(top(pulseFrame(PULSE, box, t)).trim()).toBe('')
    expect(isStale({ ...PULSE, beats: [] }, 1)).toBe(true)
  })

  it('the hook map draws every scanned mod and event name', () => {
    const lines = rowsOf(hookMapFrame(MAP, { columns: 90, rows: 8 })).join('\n')

    for (const name of [...MAP.mods, ...MAP.events]) {
      expect(lines).toContain(name)
    }

    expect(lines).toMatch(/[⠁-⣿]/)
  })
})
