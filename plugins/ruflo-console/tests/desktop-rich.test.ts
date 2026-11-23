/**
 * ADR-546, end to end through the console: on a surface that draws Svg, the pictures with a native vector form (the swarm graph, the
 * cost gauge and burn, the overview's activity, the BBS titles) are interactive vector documents; the Settings "Desktop pictures" row
 * switches them back to the cell pictures and is saved; the terminal never changes. Run with
 *   claude plugin test plugins/ruflo-console
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { settingsAnswer } from './fixtures/settings'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>
type Props = { source?: string; alt?: string; width?: number; height?: number; isInteractive?: boolean }
const propsOf = (element: unknown): Props => ((element as { props?: Props }).props ?? {}) as Props
const SVG_SOURCE_MAX = 131_072
/** A host that takes Text `weight` (2.1.299+) and so the Svg `height` and `isInteractive` props: the vectors are drawn only there. */
const modern = (on: Body[1], version = '2.1.318') => on('session.version', () => ({ value: { version } as never }))

/** The Svg elements a page draws on one surface, by their box's picture key. */
async function drawnOn($: Body[0], view: string, surface: 'terminal' | 'desktop') {
  await $.command.run(command(view))
  await $.command.run(command('status'))
  const pane = await $.ui.mount({ ...paneAt(110, 60, true, surface), plugin: PLUGIN })
  const tree = await pane.drawn()
  await pane.unmount()
  const boxes = elementsOf(tree, 'Box').filter(box => keyOf(box).startsWith('svg-'))
  const svgs = new Map(boxes.map(box => [keyOf(box).slice(4), propsOf(elementsOf(box, 'Svg')[0])]))

  return { tree, svgs }
}

for (const look of ['plain', 'bbs', 'orbital'] as const) {
  describe(`the desktop look (${look})`, () => {
    test('the swarm, cost and overview pictures are interactive vectors on the desktop and Rasters on the terminal', { timeoutMs: 60_000, options: { boot: false, look } }, async ($, on) => {
      worldOf(on, RUFLO_FILES)
      modern(on)
      mock.clock(on)
      await $.session.start(SESSION)

      const expected: Record<string, readonly string[]> = { swarm: ['topology'], cost: ['gauge', 'burn'], overview: ['activity'] }

      for (const [view, keys] of Object.entries(expected)) {
        const desktop = await drawnOn($, view, 'desktop')
        const terminal = await drawnOn($, view, 'terminal')

        expect(elementsOf(terminal.tree, 'Svg'), `${look} ${view}: no Svg on the terminal`).toHaveLength(0)
        expect(elementsOf(terminal.tree, 'Raster').map(keyOf), `${look} ${view}: the terminal keeps its Rasters`).toEqual(expect.arrayContaining([...keys]))
        expect(textOf(desktop.tree), `${look} ${view}: the words are the same on both surfaces`).toBe(textOf(terminal.tree))

        for (const key of keys) {
          const svg = desktop.svgs.get(key)

          expect(svg, `${look} ${view}: ${key} is drawn`).toBeDefined()
          expect(svg?.isInteractive, `${look} ${view}: ${key} is interactive`).toBe(true)
          expect(svg?.source ?? '', `${look} ${view}: ${key} is a vector document, not cells`).toContain('<style>')
          expect((svg?.source ?? '').length).toBeLessThanOrEqual(SVG_SOURCE_MAX)
          expect(svg?.alt ?? '').not.toMatch(/needs? a terminal/)
          expect(svg?.height ?? 0).toBeGreaterThan(0)
        }
      }

      const swarm = (await drawnOn($, 'swarm', 'desktop')).svgs.get('topology')?.source ?? ''

      // The fixture swarm's two agents and its leader, each a hoverable node with its own tooltip.
      expect(swarm.match(/<g class="n">/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
      expect(swarm).toContain('agent-1790903032181-97m25s')
    })
  })
}

describe('the desktop look', () => {
  test('the BBS look lights the menu banner as a neon sign, keeping its words', { timeoutMs: 30_000, options: { boot: false, look: 'bbs' } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    modern(on)
    mock.clock(on)
    await $.session.start(SESSION)

    const banner = (await drawnOn($, 'menu', 'desktop')).svgs.get('header')

    expect(banner?.alt).toBe('RUFLO / AGENT SWARM CONSOLE')
    expect(banner?.source).toContain('<title>RUFLO / AGENT SWARM CONSOLE</title>')
    expect(banner?.source).toContain('filter="url(#glow)"')
    expect(banner?.isInteractive).toBe(true)
  })

  test('every BBS page title is a neon sign, never wider than the cell title it replaces, even in a narrow pane', { timeoutMs: 30_000, options: { boot: false, look: 'bbs' } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    modern(on)
    mock.clock(on)
    await $.session.start(SESSION)

    for (const columns of [110, 64]) {
      await $.command.run(command('swarm'))
      const pane = await $.ui.mount({ ...paneAt(columns, 60, true, 'desktop'), plugin: PLUGIN })
      const tree = await pane.drawn()
      await pane.unmount()
      const title = elementsOf(tree, 'Box').filter(box => keyOf(box) === 'svg-title').map(box => propsOf(elementsOf(box, 'Svg')[0]))[0]

      expect(title?.isInteractive, `${columns} columns: the title is a vector`).toBe(true)
      expect(title?.source).toContain('filter="url(#glow)"')
      // The pane's body is `columns - 1` cells of 8 px; the title fits inside it at every width.
      expect(title?.width ?? Infinity, `${columns} columns: the title fits the pane`).toBeLessThanOrEqual((columns - 1) * 8)
      expect(title?.height ?? 0).toBeGreaterThan(0)
    }
  })

  test('a saved "cells" draws the cell pictures, not interactive, as before ADR-546', { timeoutMs: 30_000, options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    modern(on)

    world.stored.set('desktop-art', 'cells')
    mock.clock(on)
    await $.session.start(SESSION)

    const { svgs } = await drawnOn($, 'swarm', 'desktop')
    const topology = svgs.get('topology')

    expect(topology).toBeDefined()
    expect(topology?.isInteractive).toBeUndefined()
    expect(topology?.source).not.toContain('<style>')
  })

  test('a host before 2.1.299 gets the cell pictures: it would refuse a tree with Svg props it does not know', { timeoutMs: 30_000, options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    modern(on, '2.1.289')
    mock.clock(on)
    await $.session.start(SESSION)

    const topology = (await drawnOn($, 'swarm', 'desktop')).svgs.get('topology')

    expect(topology).toBeDefined()
    expect(topology?.isInteractive).toBeUndefined()
    expect(topology?.height).toBeUndefined()
  })

  test('nothing moves with fps 0: the vectors are drawn still', { timeoutMs: 30_000, options: { boot: false, fps: 0 } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    modern(on)
    mock.clock(on)
    await $.session.start(SESSION)

    for (const view of ['swarm', 'cost']) {
      for (const [key, svg] of (await drawnOn($, view, 'desktop')).svgs) expect(svg.source ?? '', `${view} ${key}`).not.toContain('@keyframes')
    }
  })

  test('Settings has a Desktop pictures row; picking cells saves it and redraws the desktop with cells', { timeoutMs: 30_000, options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    modern(on)

    world.respond = settingsAnswer
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('settings'))

    const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })
    const tree = await pane.drawn()

    expect(textOf(tree)).toContain('Desktop pictures')
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['st-opt-ui-desktop-art-rich', 'st-opt-ui-desktop-art-cells']))
    await pane.press({ key: 'st-opt-ui-desktop-art-cells' })
    await pane.drawn()
    await pane.unmount()
    expect(world.stored.get('desktop-art')).toBe('cells')

    const topology = (await drawnOn($, 'swarm', 'desktop')).svgs.get('topology')

    expect(topology?.isInteractive).toBeUndefined()
  })
})
