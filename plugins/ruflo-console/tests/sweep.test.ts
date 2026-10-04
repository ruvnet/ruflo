import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { cliAnswer, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

/** Every area, by the name `/ruflo <name>` takes. */
const VIEWS = ['overview', 'swarm', 'hive', 'claims', 'federation', 'plugins', 'learning', 'metaharness', 'memory', 'cost', 'timeline', 'approvals', 'events', 'missions', 'xruv', 'skills', 'secure', 'perf', 'automate', 'neural', 'vector', 'evolve', 'devtools', 'sandbox', 'market', 'settings']

/** Buttons that only move the cursor inside a list that has nothing to move over in the fixture world. */
const SCROLL = /^(prev|next|up|down|older|newer|page|older-|newer-|refresh|close|task-next|approve-1|net-|ev-kind-all|tl-range-|sk-scope-project|evolve-reread|xr-(name|about)-|cat-load|cat-reload|st-name-|st-reload|st-level-|nav-style-|mc-tab-|mc-profile-|mc-rigor-|sec-)/i

describe('every button does something', () => {
  for (const view of VIEWS) {
    test(`${view}: pressing each button changes the screen, asks, or runs one thing`, { options: { boot: false } }, async ($, on) => {
      const world = worldOf(on, RUFLO_FILES)

      world.respond = argv => cliAnswer(argv)
      mock.clock(on)
      await $.session.start(SESSION)
      await $.command.run(command(view))

      const pane = await $.ui.mount({ ...paneAt(140), surface: 'terminal' as const, plugin: PLUGIN })
      const keys = [...new Set(elementsOf(await pane.drawn(), 'Button').map(keyOf))].filter(key => !key.startsWith('tab-') && key !== '')
      const dead: string[] = []

      for (const key of keys) {
        await $.command.run(command('no'))
        await $.command.run(command(view))

        const before = textOf(await pane.drawn())
        const runs = world.runs.length

        try {
          await pane.press({ key })
        } catch (error) {
          // A button an earlier press removed (a reload that empties the list) is gone, not dead.
          if (!/no Button/.test(String(error))) dead.push(`${key} (press threw)`)

          continue
        }

        const after = textOf(await pane.drawn())

        if (after === before && world.runs.length === runs && !SCROLL.test(key)) dead.push(key)
      }

      await pane.unmount()
      expect(dead).toEqual([])
    })
  }
})
