/**
 * Back is a real history: setView remembers the page you left, and Back walks that trail one page at a time (skipping pages that no
 * longer exist, falling back to the menu or Overview when the trail is empty). Run with
 *   npx vitest run plugins/ruflo-console/tests/history.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { createController } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { HISTORY_MAX } from '../hooks/history'
import { newState, type ViewId } from '../hooks/state'

function fakeHost(): Host {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'scrollTop') return () => undefined
        if (key === 'after' || key === 'every') return () => ({ cancel: () => undefined })
        if (key === 'pluginRoot') return '/plugin'
        if (key === 'fs') return { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => Promise.reject(new Error('ENOENT')), list: async () => Promise.reject(new Error('ENOENT')) }

        return () => Promise.resolve(undefined)
      },
    },
  ) as unknown as Host
}

function setup(look: 'bbs' | 'plain' = 'plain') {
  const state = newState({})

  state.options.look = look
  state.view = 'overview'

  const control = createController(state, fakeHost())

  return { state, control }
}

const agentsOf = (...ids: string[]) => ({ agents: ids.map(id => ({ id })) }) as never

describe('real back', () => {
  it('walks overview -> swarm -> agent -> back -> back to overview', () => {
    const { state, control } = setup()

    control.setView('swarm')
    state.snapshot = agentsOf('a1')
    control.drill('a1')
    expect(state.view).toBe('agent')

    control.actions.back()
    expect(state.view).toBe('swarm')
    control.actions.back()
    expect(state.view).toBe('overview')
    expect(state.trail).toEqual([])
  })

  it('falls back to Overview in the plain look and the menu in the bbs look when there is no history', () => {
    const plain = setup('plain')

    plain.state.view = 'swarm'
    plain.control.actions.back()
    expect(plain.state.view).toBe('overview')

    const bbs = setup('bbs')

    bbs.state.view = 'swarm'
    bbs.control.actions.back()
    expect(bbs.state.view).toBe('menu')
  })

  it('skips a history entry that is no longer a page, and an agent that has vanished', () => {
    const { state, control } = setup()

    state.view = 'swarm'
    state.trail = ['claims', 'nope-gone' as ViewId, 'agent', 'memory']
    state.snapshot = agentsOf()
    control.actions.back()
    expect(state.view).toBe('memory')
    // 'agent' has no agent behind it, and 'nope-gone' is not a page: both are skipped to land on claims.
    control.actions.back()
    expect(state.view).toBe('claims')
    control.actions.back()
    expect(state.view).toBe('overview')
  })

  it('goes back to an agent that still exists', () => {
    const { state, control } = setup()

    state.snapshot = agentsOf('a1')
    state.select.agent = 0
    state.view = 'swarm'
    state.trail = ['agent']
    control.actions.back()
    expect(state.view).toBe('agent')
  })

  it('keeps at most 20 entries, dropping the oldest', () => {
    const { state, control } = setup()
    const pages: ViewId[] = ['swarm', 'claims']

    for (let i = 0; i < 60; i += 1) control.setView(pages[i % 2] as ViewId)
    expect(HISTORY_MAX).toBe(20)
    expect(state.trail.length).toBe(20)
    expect(state.trail[0]).not.toBe(state.trail[1])
  })

  it('replace does not push, and the same page twice does not push', () => {
    const { state, control } = setup()

    control.setView('swarm')
    expect(state.trail).toEqual(['overview'])
    control.setView('swarm')
    expect(state.trail).toEqual(['overview'])
    control.setView('claims', { replace: true })
    expect(state.view).toBe('claims')
    expect(state.trail).toEqual(['overview'])
  })

  it('does not push the page Back is leaving', () => {
    const { state, control } = setup()

    control.setView('swarm')
    control.setView('claims')
    control.actions.back()
    expect(state.view).toBe('swarm')
    expect(state.trail).toEqual(['overview'])
  })
})
