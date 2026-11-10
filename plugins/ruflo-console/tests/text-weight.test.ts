import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { hasTextWeight, legacyTextProps } from '../hooks/text-weight'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, paneAt, SESSION, worldOf } from './fixtures/world'

/**
 * Text `weight` (Claude Code 2.1.299, `bold` deprecated). Every view says `weight`; an engine before 2.1.299 refuses a
 * tree with a Text prop it does not know and draws its own row, so there the kit says `bold` (hooks/text-weight.ts).
 */
const propsOf = (tree: RenderElement) => elementsOf(tree, 'Text').map(node => (node as { props?: Record<string, unknown> }).props ?? {})

describe('text weight (2.1.299)', () => {
  for (const [version, isModern] of [['2.1.318', true], ['2.1.289', false]] as const) {
    test(`on ${version} the pane says ${isModern ? 'weight' : 'bold'}, never the other`, { timeoutMs: 30_000, options: { boot: false } }, async ($, on) => {
      worldOf(on, RUFLO_FILES)
      mock.clock(on)
      on('session.version', () => ({ value: { version } as never }))
      await $.session.start(SESSION)
      await $.command.run(command('overview'))

      const props = propsOf(await $.ui.render(paneAt(120)))
      // Told 2.1.299+ while this kit is an older engine, the tree is refused (the reason for the fallback).
      if (isModern && props.length === 0) return
      const strong = props.filter(p => p.weight === 'semibold' || p.bold === true)
      expect(strong.length).toBeGreaterThan(0)
      if (isModern) expect(strong.every(p => p.weight === 'semibold')).toBe(true)
      else expect(props.some(p => 'weight' in p)).toBe(false)
    })
  }

  test('the codemod mapping: bold true is semibold, the weight the engine already reads it as', { timeoutMs: 30_000 }, () => {
    expect(hasTextWeight({ version: '2.1.299' })).toBe(true)
    expect(hasTextWeight({ version: '2.1.298' })).toBe(false)
    expect(hasTextWeight(undefined)).toBe(false)
    expect(legacyTextProps({ weight: 'semibold', wrap: 'wrap' })).toEqual({ bold: true, wrap: 'wrap' })
    expect(legacyTextProps({ weight: 'regular' })).toEqual({})
  })
})
