/**
 * ADR-546: the native vector pictures (hooks/gfx/vector.ts) and which keys a frame gets as vectors (hooks/views/vector-art.ts).
 * Security (escaping, colours, no active content), the host's size limit, motion gating, determinism and build cost. Run with
 *   npx vitest run plugins/ruflo-console/tests/vector-pictures.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { SVG_SOURCE_MAX } from '../hooks/gfx/svg'
import { DEFAULT_PALETTE, gaugeSvg, neonTitleSvg, paletteOf, safeColor, sparklineSvg, statusColor, topologySvg, type VectorOptions } from '../hooks/gfx/vector'
import type { TopoModel } from '../hooks/gfx/pictures'
import { newState } from '../hooks/state'
import { vectorsOf } from '../hooks/views/vector-art'
import { parseDesktopArt } from '../hooks/desktop-art'
import { isWellFormed } from './xml-check'

const HOSTILE = ['<script>alert(1)</script>', '"><svg onload="x()">', 'a]]>b', 'x & y', "it's", '\u0000\u0007\ud800', 'url(https://evil.example/x)']
/**
 * Anything that could run, fetch or leave the document, as markup: an element that loads or runs something, an event handler or link
 * attribute, or a `url(...)` other than the glow filter's own. Escaped text (`&lt;script&gt;`) is inert and is not markup.
 */
const ACTIVE_TAG = /^(script|image|foreignObject|use|a|iframe|animate|set|feImage|style:import)$/i
/** The attributes that may hold a `url(...)`: only the glow filter's own local one is allowed. */
const URL_ATTR = /^(filter|fill|stroke|clip-path|mask|marker-start|marker-mid|marker-end|style)$/i

/** Walks every start tag: its name, and each attribute's name and (still escaped) value. Text and escaped values are inert. */
function isActive(svg: string): boolean {
  for (const tag of svg.matchAll(/<([A-Za-z][\w:-]*)((?:\s+[^\s=>]+="[^"]*")*)\s*\/?>/g)) {
    if (ACTIVE_TAG.test(tag[1] as string)) return true
    for (const attr of (tag[2] ?? '').matchAll(/\s([^\s=>]+)="([^"]*)"/g)) {
      const name = attr[1] as string
      const value = attr[2] as string

      if (/^on/i.test(name) || /(^|:)href$/i.test(name) || /^src$/i.test(name)) return true
      if (URL_ATTR.test(name) && /url\(/i.test(value) && value !== 'url(#glow)') return true
    }
  }
  const style = /<style>([^<]*)<\/style>/.exec(svg)?.[1] ?? ''

  return /url\(|@import|javascript:|expression\(/i.test(style)
}

const MOVING: VectorOptions = { width: 880, height: 240, animate: true }
const STILL: VectorOptions = { width: 880, height: 240, animate: false }

function model(n: number, topology = 'hierarchical', label = (i: number) => `agent-${i}`, status = (i: number) => (i % 3 === 0 ? 'busy' : 'idle')): TopoModel {
  return {
    topology,
    nodes: Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, label: i === 0 ? 'queen' : label(i), status: i === 0 ? 'leader' : status(i), isLeader: i === 0 })),
  }
}

/** Every document these specs build, checked the same way. */
function holds(svg: string | null, alt: string): string {
  expect(svg).not.toBeNull()
  const source = svg as string

  expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(isWellFormed(source), source.slice(0, 400)).toBe(true)
  expect(isActive(source), 'active content').toBe(false)
  expect(source.length).toBeLessThanOrEqual(SVG_SOURCE_MAX)
  expect(source).toContain('<title>')
  expect(source).toContain(`aria-label="`)
  // The raw data never reaches the markup unescaped: where it holds markup characters, only their escapes are present.
  if (/[<>&"]/.test(alt)) expect(source).not.toContain(alt)

  return source
}

describe('topologySvg', () => {
  it('draws every node as a hoverable group with a tooltip naming it, its status and its id', () => {
    const svg = holds(topologySvg(model(6), 'swarm graph', MOVING), 'swarm graph')

    expect(svg.match(/<g class="n">/g)).toHaveLength(6)
    expect(svg).toContain('<title>agent-3 · busy · id-3</title>')
    expect(svg).toContain('<title>queen · leader · id-0</title>')
    expect(svg).toContain('★')
  })

  it('runs traffic along a busy node’s edges and pulses it while motion is on, and draws none of it still', () => {
    const moving = holds(topologySvg(model(7), 'g', MOVING), 'g')
    const still = holds(topologySvg(model(7), 'g', STILL), 'g')

    expect(moving).toContain('class="flow"')
    expect(moving).toContain('class="ring"')
    expect(moving).toContain('@keyframes')
    expect(moving).toContain('prefers-reduced-motion')
    for (const marker of ['class="flow"', 'class="ring', '@keyframes', 'animation']) expect(still).not.toContain(marker)
  })

  it('draws no traffic where nothing is busy', () => {
    expect(holds(topologySvg(model(5, 'mesh', undefined, () => 'idle'), 'g', MOVING), 'g')).not.toContain('class="flow"')
  })

  it('escapes hostile labels, statuses and ids into text and titles; nothing active survives', () => {
    for (const bad of HOSTILE) {
      const m: TopoModel = { topology: 'mesh', nodes: [{ id: bad, label: bad, status: bad, isLeader: true }, { id: `${bad}2`, label: bad, status: 'busy', isLeader: false }] }

      holds(topologySvg(m, bad, MOVING), bad)
    }
  })

  it('keeps a 100-agent mesh with long labels (the console’s cap) under the host’s limit, labels left to the tooltips', () => {
    const svg = holds(topologySvg(model(100, 'mesh', i => `${'very-long-agent-name-'.repeat(4)}${i}`), 'g', { width: 1600, height: 900, animate: true }), 'g')

    expect(svg.match(/<g class="n">/g)).toHaveLength(100)
    expect(svg).not.toContain('font-size="10" fill="#8b949e" opacity')
  })

  it('every topology lays out without NaN', () => {
    for (const topology of ['hierarchical', 'mesh', 'ring', 'star', 'hierarchical-mesh', 'adaptive']) {
      for (const n of [1, 2, 9, 40]) expect(holds(topologySvg(model(n, topology), 'g', MOVING), 'g')).not.toMatch(/NaN|Infinity/)
    }
  })
})

describe('gaugeSvg', () => {
  it('fills the arc to spend/limit and marks the ladder at 50, 75, 90 and 100%', () => {
    const svg = holds(gaugeSvg(1.5, 2, 'budget', MOVING), 'budget')

    expect(svg).toContain('stroke-dasharray="75 100"')
    expect(svg.match(/class="(?!n")/g), 'its data ticks every turn: only hover groups, no entrance animation to replay').toBeNull()
    for (const step of ['50%', '75%', '90%', '100%']) expect(svg).toContain(`<title>${step} · `)
    expect(svg).toContain('$1.50')
    expect(svg).toContain(`stroke="${DEFAULT_PALETTE.warn}"`)
  })

  it('says n/a for an unknown spend and "no budget set" without a limit; never $0, never a filled arc', () => {
    const unknown = holds(gaugeSvg(null, 5, 'b', MOVING), 'b')
    const noLimit = holds(gaugeSvg(0.42, null, 'b', MOVING), 'b')

    expect(unknown).toContain('>n/a<')
    expect(unknown).not.toContain('$0.00')
    expect(noLimit).toContain('no budget set')
    expect(noLimit).not.toContain('pathLength')
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(holds(gaugeSvg(bad, bad, 'b', MOVING), 'b')).toContain('>n/a<')
  })

  it('caps the arc at the limit when spend is over it', () => {
    expect(holds(gaugeSvg(9, 3, 'b', STILL), 'b')).toContain('stroke-dasharray="100 100"')
  })
})

describe('sparklineSvg', () => {
  it('draws each series with a tooltip per sample, its newest value, and says so when there are too few samples', () => {
    const svg = holds(sparklineSvg([{ label: 'tool calls', values: [1, 4, 2, 8] }, { label: 'writes', values: [3] }], 'activity', MOVING, v => String(v)), 'activity')

    expect(svg.match(/<rect class="pt"/g)).toHaveLength(4)
    expect(svg).toContain('<title>tool calls · #4: 8</title>')
    expect(svg).toContain('not enough samples yet')
    expect(svg.match(/class="(?!pt")/g), 'only the hover columns carry a class: nothing replays when a sample lands').toBeNull()
  })

  it('drops non-finite samples and keeps the newest 120, so a long session cannot outgrow the limit', () => {
    const values = Array.from({ length: 5000 }, (_, i) => (i % 97 === 0 ? Number.NaN : i))
    const svg = holds(sparklineSvg([{ label: 'a', values }, { label: 'b', values }, { label: 'c', values }, { label: 'd', values }, { label: 'e', values }], 'x', MOVING), 'x')

    expect(svg.match(/<rect class="pt"/g)).toHaveLength(4 * 120)
    expect(svg).not.toMatch(/NaN/)
  })

  it('escapes hostile series names', () => {
    for (const bad of HOSTILE) holds(sparklineSvg([{ label: bad, values: [1, 2, 3] }], bad, MOVING), bad)
  })
})

describe('neonTitleSvg', () => {
  it('lights the words with a local glow filter and flickers only while motion is on', () => {
    const moving = holds(neonTitleSvg('ruflo', 'agent swarm console', 'RUFLO / AGENT SWARM CONSOLE', MOVING), 'x')

    expect(moving).toContain('<title>RUFLO / AGENT SWARM CONSOLE</title>')
    expect(moving).toContain('filter="url(#glow)"')
    expect(moving).toContain('class="flicker"')
    expect(neonTitleSvg('ruflo', '', 'x', STILL)).not.toContain('flicker')
    for (const bad of HOSTILE) holds(neonTitleSvg(bad, bad, bad, MOVING), bad)
  })
})

describe('the active-content check itself', () => {
  it('catches what it is there to catch, so a pass means something', () => {
    for (const bad of ['<svg><script>x</script></svg>', '<svg><g onclick="x()"></g></svg>', '<svg><a href="https://e"></a></svg>', '<svg><path filter="url(https://e/x)"/></svg>', '<svg><image xlink:href="x"/></svg>', '<svg><style>@import "x";</style></svg>']) {
      expect(isActive(bad), bad).toBe(true)
    }
    expect(isActive('<svg aria-label="&lt;script&gt; onload=&quot;x&quot; url(https://e)"><text>&lt;script&gt;</text></svg>')).toBe(false)
  })
})

describe('colours and documents', () => {
  it('lets only hex colours into an attribute; a terminal colour name or markup falls back to the default', () => {
    expect(safeColor('#0af', '#000000')).toBe('#0af')
    expect(safeColor('#00aaff', '#000000')).toBe('#00aaff')
    for (const bad of ['claude', 'success', 'red;}</style><script>', '#12345', '#00aaff"/><script', '', 'url(#x)']) expect(safeColor(bad, '#000000')).toBe('#000000')
    const p = paletteOf({ head: '"><script>x</script>', warn: 'warning' })

    expect(p.head).toBe(DEFAULT_PALETTE.head)
    expect(p.warn).toBe(DEFAULT_PALETTE.warn)
    holds(topologySvg(model(4), 'g', { ...MOVING, palette: { head: '"/><script>', info: 'javascript:x' } }), 'g')
  })

  it('writes no data into the stylesheet: it is one of two constants', () => {
    const styles = new Set<string>()

    for (const svg of [topologySvg(model(9), 'a', MOVING), gaugeSvg(1, 2, 'b', MOVING), sparklineSvg([{ label: 'z', values: [1, 2] }], 'c', MOVING), neonTitleSvg('w', 's', 'd', MOVING), topologySvg(model(3), 'e', STILL), gaugeSvg(1, 2, 'f', STILL)]) {
      styles.add(/<style>([^<]*)<\/style>/.exec(svg as string)?.[1] ?? '')
    }
    expect(styles.size).toBe(2)
  })

  it('clamps a hostile size: no huge canvas, no NaN', () => {
    const svg = holds(gaugeSvg(1, 2, 'b', { width: 1e9, height: Number.NaN, animate: false }), 'b')

    expect(svg).toMatch(/width="1600" height="1"/)
    expect(svg).not.toMatch(/NaN|Infinity/)
  })

  it('is a function of its data alone: the same input is the same document', () => {
    expect(topologySvg(model(12), 'g', MOVING)).toBe(topologySvg(model(12), 'g', MOVING))
    expect(sparklineSvg([{ label: 'a', values: [1, 2, 3] }], 'x', MOVING)).toBe(sparklineSvg([{ label: 'a', values: [1, 2, 3] }], 'x', MOVING))
  })

  it('colours a node by the status ruflo wrote', () => {
    const p = paletteOf(undefined)

    expect(statusColor('busy', false, p)).toBe(p.warn)
    expect(statusColor('error', false, p)).toBe(p.bad)
    expect(statusColor('terminated', false, p)).toBe(p.dim)
    expect(statusColor('idle', false, p)).toBe(p.info)
    expect(statusColor('idle', true, p)).toBe(p.head)
  })

  it('builds a 100-agent mesh in a few milliseconds (it runs once per render, not per frame)', () => {
    const m = model(100, 'mesh')
    const runs = 50
    const started = performance.now()

    for (let i = 0; i < runs; i++) topologySvg(m, 'g', { width: 1600, height: 900, animate: true })
    const perBuild = (performance.now() - started) / runs

    expect(perBuild).toBeLessThan(15)
  })
})

describe('vectorsOf', () => {
  const at = 1_800_000_000_000
  const ready = (view: string, look: 'bbs' | 'plain' | 'orbital' = 'plain') => {
    const state = newState({})

    state.cwd = '/work/project'

    state.view = view as typeof state.view
    state.options = { ...state.options, look, fps: 8, boot: false }
    state.pane.bootAtMs = 0
    state.loadedAtMs = 0
    state.activity = [1, 2, 3]
    state.history.spend = [{ atMs: at - 2000, value: 0.1 }, { atMs: at, value: 0.2 }] as typeof state.history.spend

    return state
  }

  it('gives the overview its activity and the cost page its gauge and burn, as vectors', () => {
    expect([...vectorsOf(ready('overview'), 110, at).keys()]).toEqual(['activity'])
    expect([...vectorsOf(ready('cost'), 110, at).keys()].sort()).toEqual(['burn', 'gauge'])
    for (const spec of vectorsOf(ready('cost'), 110, at).values()) holds(spec.draw('cost picture'), 'cost picture')
  })

  it('gives the BBS look its neon banner and title', () => {
    expect([...vectorsOf(ready('menu', 'bbs'), 110, at).keys()].sort()).toEqual(['header', 'title'])
    expect([...vectorsOf(ready('overview', 'bbs'), 110, at).keys()].sort()).toEqual(['activity', 'title'])
  })

  it('draws nothing as a vector for the cells setting, and nothing moves with fps 0', () => {
    const cells = ready('cost')

    cells.desktopArt = 'cells'
    expect(vectorsOf(cells, 110, at).size).toBe(0)
    const still = ready('cost')

    still.options = { ...still.options, fps: 0 }
    for (const spec of vectorsOf(still, 110, at).values()) expect(spec.draw('x')).not.toContain('@keyframes')
  })

  it('reads only the two known settings back from the store', () => {
    expect(parseDesktopArt('rich')).toBe('rich')
    expect(parseDesktopArt('cells')).toBe('cells')
    for (const bad of [undefined, null, 'RICH', '', 1, { mode: 'rich' }]) expect(parseDesktopArt(bad)).toBeNull()
  })
})
