/**
 * The confirm card owns y and n: whatever page is open, with an ask pending, the hotkeys y and n reach its Yes and Cancel buttons.
 * The engine gives a hotkey to the LATER button drawn (events-sweep.spec.ts), and the card is drawn above the body, so a page that
 * binds y or n for itself (Timeline's n = "later") would otherwise take the key from the question being asked.
 */
import { describe, expect, it } from 'vitest'

import { VIEWS, type ViewId } from '../hooks/state'
import type { Actions, Ctx } from '../hooks/views/common'
import { paneView } from '../hooks/views/pane'
import { flat } from './fixtures/wf-drill-world'
import { rig } from './fixtures/ev-rig'

/** Every action a page might reach for while drawing exists (a no-op): the test is about the keys, not the data. */
const anyAct = (real: Actions): Actions => {
  const lenient = (target: unknown): unknown =>
    new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : (target as Record<string | symbol, unknown> | undefined)?.[key] ?? lenient(undefined)), apply: () => undefined })

  return lenient(real) as Actions
}

const winners = (ctx: Ctx): Map<string, string> => {
  const won = new Map<string, string>()

  for (const node of flat(paneView(ctx)).filter(item => item.kind === 'Button' && item.props.hotkey !== undefined)) won.set(String(node.props.hotkey), String(node.props.key))

  return won
}

describe('y and n answer the confirm card on every page', () => {
  for (const view of VIEWS.map(entry => entry.id as ViewId)) {
    for (const own of [false, true]) {
      it(`${view}: ${own ? 'an ask raised here' : 'an ask with no page'}`, () => {
        const w = rig(125, { events: 200 })

        w.state.view = view
        w.state.pending = { label: 'start a loop in the main Claude UI: /loop do things', args: ['x'], expect: 'e', askedAtMs: 1, ...(own && { view }) }

        const won = winners({ ...w.ctx, act: anyAct(w.ctx.act) })

        expect(won.get('y'), `y is won by ${won.get('y')}`).toBe('confirm')
        expect(won.get('n'), `n is won by ${won.get('n')}`).toBe('cancel')
      })
    }
  }

  it('without an ask, a page keeps its own n (Timeline pans later)', () => {
    const w = rig(125, { events: 200 })

    w.state.view = 'timeline'

    expect(winners({ ...w.ctx, act: anyAct(w.ctx.act) }).get('n')).toBe('tl-fwd')
  })
})
