import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { hasTextWeight, legacyTextProps, withTextWeight } from '../hooks/text-weight'
import { RUFLO_RUN } from './fixtures/ruflo-run'
import { command, PANE, SESSION } from './fixtures/inputs'
import { elementsOf, worldOf } from './fixtures/world'

/**
 * Text `weight` (Claude Code 2.1.299, `bold` deprecated). The views say `weight`; on an engine before 2.1.299, which
 * refuses a tree with a Text prop it does not know, the kit says `bold` instead. The version is `$.session.version()`.
 */
const propsOf = (tree: RenderElement) => elementsOf(tree, 'Text').map(node => (node as { props?: Record<string, unknown> }).props ?? {})

describe('text weight (2.1.299)', () => {
  for (const [version, isModern] of [['2.1.318', true], ['2.1.299', true], ['2.1.298', false], ['2.1.289', false]] as const) {
    test(`on ${version} the pane's strong text says ${isModern ? 'weight' : 'bold'}, never the other`, async ($, on) => {
      worldOf(on, RUFLO_RUN)
      mock.clock(on)
      on('session.version', () => ({ value: { version } as never }))
      await $.session.start(SESSION)
      await $.command.run(command('ruflo-swarm-pane'))

      const props = propsOf(await $.ui.render(PANE))
      // Told 2.1.299+ while the kit itself is an older engine, the tree is refused and the engine draws its own:
      // exactly what the bold fallback is for. Only a 2.1.299+ kit can check the modern form.
      if (isModern && props.length === 0) return
      const strong = props.filter(p => p.weight === 'semibold' || p.bold === true)
      expect(strong.length).toBeGreaterThan(0)
      if (isModern) {
        expect(strong.every(p => p.weight === 'semibold')).toBe(true)
      } else {
        expect(props.some(p => 'weight' in p)).toBe(false)
        expect(strong.every(p => p.bold === true)).toBe(true)
      }
    })
  }

  test('no version from the engine is an older host: bold, which every engine draws', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('ruflo-swarm-pane'))
    expect(propsOf(await $.ui.render(PANE)).some(p => 'weight' in p)).toBe(false)
  })

  test('hasTextWeight reads version or base; anything malformed is older', () => {
    expect(hasTextWeight({ version: '2.1.299' })).toBe(true)
    expect(hasTextWeight({ version: '2.1.300-dev', base: '2.1.318' })).toBe(true)
    expect(hasTextWeight({ version: '2.2.0' })).toBe(true)
    expect(hasTextWeight({ version: '3.0.0' })).toBe(true)
    expect(hasTextWeight({ version: '2.1.298' })).toBe(false)
    expect(hasTextWeight({ version: '2.0.999' })).toBe(false)
    for (const bad of [undefined, null, {}, { version: 2 }, { version: 'next' }, '2.1.318']) expect(hasTextWeight(bad)).toBe(false)
  })

  test('legacyTextProps keeps every other prop and maps only a strong weight to bold', () => {
    expect(legacyTextProps({ weight: 'semibold', color: 'x' })).toEqual({ bold: true, color: 'x' })
    expect(legacyTextProps({ weight: 'bold' })).toEqual({ bold: true })
    expect(legacyTextProps({ weight: 'regular', dimColor: true })).toEqual({ dimColor: true })
    expect(legacyTextProps({ weight: 'medium' })).toEqual({})
    const plain = { color: 'y' }
    expect(legacyTextProps(plain)).toBe(plain)
    const kit = { Text: (p: object) => p, Box: (p: object) => p }
    expect(withTextWeight(kit, true)).toBe(kit)
    expect(withTextWeight(kit, false).Text({ weight: 'semibold' } as never)).toEqual({ bold: true })
    expect(withTextWeight(kit, false).Box).toBe(kit.Box)
  })
})
