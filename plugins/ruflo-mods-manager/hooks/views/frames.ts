/**
 * Every picture the pane draws, as a function of the data, the box it gets and (for the pulse) the time. A picture's
 * size depends on `columns` and `rows` only, never on `t`: the first paint and every blit come from these same
 * functions, and a blit at another size is refused.
 */

import { Braille, DEFAULT, dim, Grid } from './raster'

/** Mid-tone colours, legible on dark and light terminals. Every one also has a word or glyph beside it. */
export const RGB = { edge: 0x5f87af, risky: 0xd7875f, label: 0x8a8a8a, good: 0x5faf5f, warn: 0xd7af5f, bad: 0xd75f5f, trace: 0x5fafd7 } as const

export type HookMap = {
  mods: string[]
  events: string[]
  /** [mod index, event index, is the event risky] */
  edges: Array<[number, number, boolean]>
}

export type Box = { columns: number; rows: number }

/** Events past the rows a map has are folded into one `+n more` row rather than squeezed. */
export function hookMapFrame(map: HookMap, box: Box): Grid {
  const grid = new Grid(box.columns, box.rows)
  const left = Math.min(16, Math.max(6, Math.floor(grid.columns * 0.22)))
  const right = Math.min(18, Math.max(6, Math.floor(grid.columns * 0.26)))
  const middle = Math.max(2, grid.columns - left - right - 2)
  const shownEvents = map.events.length > grid.rows ? map.events.slice(0, grid.rows - 1) : map.events
  const shownMods = map.mods.slice(0, grid.rows)
  const isFolded = shownEvents.length < map.events.length
  // Spread `n` items over the first `lines` rows; a folded event list leaves the last row to its `+n more` label.
  const spread = (i: number, n: number, lines: number) => (n <= 1 ? Math.floor((lines - 1) / 2) : Math.round((i * (lines - 1)) / (n - 1)))
  const yOf = (i: number, n: number) => spread(i, n, grid.rows)
  const yOfEvent = (i: number) => spread(i, shownEvents.length, isFolded ? grid.rows - 1 : grid.rows)
  const canvas = new Braille(middle, grid.rows)

  for (const [m, ev, isRisky] of map.edges) {
    if (m >= shownMods.length || ev >= shownEvents.length) {
      continue
    }

    const y0 = yOf(m, shownMods.length) * 4 + 1.5
    const y1 = yOfEvent(ev) * 4 + 1.5

    canvas.line(0, y0, canvas.width - 1, y1, isRisky ? RGB.risky : RGB.edge, isRisky ? 2 : 1)
  }

  shownMods.forEach((name, i) => grid.text(0, yOf(i, shownMods.length), `${name.slice(0, left - 2).padEnd(left - 2)} >`, DEFAULT, left))
  canvas.paint(grid, left + 1, 0)

  shownEvents.forEach((name, i) => {
    const risky = map.edges.some(([, ev, r]) => ev === i && r)

    grid.text(left + middle + 2, yOfEvent(i), name.slice(0, right), risky ? RGB.risky : RGB.label, right)
  })

  if (isFolded) {
    grid.text(left + middle + 2, grid.rows - 1, `+${map.events.length - shownEvents.length} more`, RGB.label, right)
  }

  return grid
}

/** A braille line of `values` (oldest first) over the box, scaled to 0..max with max at least 1. */
export function sparkFrame(values: readonly number[], box: Box, color: number = RGB.warn): Grid {
  const grid = new Grid(box.columns, box.rows)
  const canvas = new Braille(grid.columns, grid.rows)
  const max = Math.max(1, ...values)
  const shown = values.slice(-canvas.width)
  const yOf = (v: number) => canvas.height - 1 - (v / max) * (canvas.height - 1)

  shown.forEach((v, i) => {
    const x = canvas.width - shown.length + i
    const prev = shown[i - 1]

    if (prev !== undefined) {
      canvas.line(x - 1, yOf(prev), x, yOf(v), color)
    } else {
      canvas.dot(x, yOf(v), color)
    }
  })

  canvas.paint(grid, 0, 0)

  return grid
}

export type Pulse = {
  /** When each measured refresh finished, epoch ms, oldest first. */
  beats: readonly number[]
  /** The poll period, ms: three of them without a beat is STALE. */
  periodMs: number
  /** The window the trace spans, ms. */
  windowMs: number
}

export const isStale = (pulse: Pulse, t: number): boolean => {
  const last = pulse.beats[pulse.beats.length - 1]

  return last === undefined || t - last > pulse.periodMs * 3
}

/**
 * The health pulse: a trace scrolling right to left over real time, with a spike at each measured refresh. Spikes fade
 * with age; once the data is stale the trace is flat and grey. It encodes refresh times and nothing else.
 */
export function pulseFrame(pulse: Pulse, box: Box, t: number): Grid {
  const grid = new Grid(box.columns, box.rows)
  const canvas = new Braille(grid.columns, grid.rows)
  const base = canvas.height - 2
  const stale = isStale(pulse, t)
  const color = stale ? RGB.label : RGB.trace
  const xOf = (at: number) => ((at - (t - pulse.windowMs)) / pulse.windowMs) * (canvas.width - 1)

  canvas.line(0, base, canvas.width - 1, base, dim(color, 0.6))

  if (!stale) {
    for (const at of pulse.beats) {
      const x = xOf(at)

      if (x < 0 || x > canvas.width - 1) {
        continue
      }

      const k = Math.max(0.25, 1 - (t - at) / pulse.windowMs)
      const peak = 1

      canvas.line(x - 2, base, x - 1, base - 3, dim(color, k), 2)
      canvas.line(x - 1, base - 3, x, peak, dim(color, k), 3)
      canvas.line(x, peak, x + 1, base, dim(color, k), 3)
    }
  }

  canvas.paint(grid, 0, 0)

  return grid
}
