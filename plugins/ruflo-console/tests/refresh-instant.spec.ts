/**
 * Refresh is instant and narrow panes keep their keys. Refresh (the r key, the footer button, the icon, the menu prompt's r) re-reads and
 * probes but never replays the boot screen (that is Settings -> Replay boot). Below 44 columns the pane has no tab buttons and no footer
 * buttons, yet the digit page keys, the keyed pages of the core tab strip (CORE_TABS) and p / r / h are still armed (hidden buttons), and y / n still answer an ask. Run with
 *   npx vitest run tests/refresh-instant.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createController } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { isBooting, newState, VIEWS } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { CORE_TABS, paneView } from '../hooks/views/pane'
import { settingsView } from '../hooks/views/settings'

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const flat = (node: unknown): El[] => {
  if (typeof node !== 'object' || node === null) return []

  const el = node as El
  const children = el.props?.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}

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

function setup(look: 'bbs' | 'plain' = 'bbs') {
  const state = newState({ boot: true })

  state.options.look = look
  state.view = 'overview'

  const control = createController(state, fakeHost())
  const calls: string[] = []
  const act = new Proxy(
    {
      view: (id: string) => calls.push(`view:${id}`),
      palette: (mode: string) => calls.push(`palette:${mode}`),
      help: () => calls.push('help'),
      refresh: () => calls.push('refresh'),
      replayBoot: () => control.actions.replayBoot(),
    } as Record<string | symbol, unknown>,
    { get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : () => undefined) },
  ) as unknown as Ctx['act']
  const draw = (columns: number) => flat(paneView({ kit, state, act, columns, nowMs: 100_000, pictures: new Map() } as unknown as Ctx))
  const byHotkey = (columns: number, hotkey: string) => draw(columns).filter(el => el.kind === 'Button' && el.props.hotkey === hotkey)

  return { state, control, calls, draw, byHotkey }
}

afterEach(() => setLook('plain'))

describe('Refresh never replays the boot screen', () => {
  it('refresh leaves the boot clock alone, so the page is never hidden', () => {
    const { state, control } = setup()

    state.pane.bootAtMs = 0
    control.actions.refresh()
    expect(state.pane.bootAtMs).toBe(0)
    expect(isBooting(state, Date.now())).toBe(false)
  })

  it('the menu prompt r is a refresh, not a boot', () => {
    const { state, control } = setup()

    state.pane.bootAtMs = 0
    control.actions.menu('r')
    expect(state.pane.bootAtMs).toBe(0)
    expect(isBooting(state, Date.now())).toBe(false)
  })

  it('the footer Refresh and the icon row press the refresh action', () => {
    const { calls, byHotkey, draw } = setup()

    ;(byHotkey(100, 'r')[0]?.props.onPress as () => void)()
    ;(draw(100).find(el => el.props.key === 'pane-icon-refresh')?.props.onPress as () => void)()
    expect(calls).toEqual(['refresh', 'refresh'])
  })

  it('Settings -> Replay boot plays the boot', () => {
    const { state, control } = setup()
    const button = flat(settingsView({ kit, state, act: new Proxy({ replayBoot: control.actions.replayBoot, settings: { search: () => undefined } } as Record<string | symbol, unknown>, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => undefined) }) as never, columns: 100, nowMs: 100_000, pictures: new Map() } as unknown as Ctx)).find(el => el.kind === 'Button' && el.props.key === 'st-replay-boot')

    expect(button).toBeDefined()
    state.pane.bootAtMs = 0
    ;(button?.props.onPress as () => void)()
    expect(state.pane.bootAtMs).toBeGreaterThan(0)
    expect(isBooting(state, Date.now())).toBe(true)
  })
})

describe('a narrow pane (40 columns) keeps every shortcut', () => {
  it('every digit-keyed page key is armed', () => {
    const { byHotkey } = setup()

    for (const view of VIEWS.filter(entry => /^[0-9]$/.test(entry.key) && entry.id !== 'overview')) expect(byHotkey(40, view.key), `key ${view.key}`).toHaveLength(1)
  })

  it('every keyed page of the core tab strip is armed too (b, c, ...), not only the digits', () => {
    const { byHotkey } = setup()

    for (const view of VIEWS.filter(entry => CORE_TABS.has(entry.id) && entry.key !== '')) expect(byHotkey(40, view.key), `key ${view.key} (${view.label})`).toHaveLength(1)
  })

  it('3 opens Swarm', () => {
    const { byHotkey, calls } = setup()

    ;(byHotkey(40, '3')[0]?.props.onPress as () => void)()
    expect(calls).toEqual(['view:swarm'])
  })

  it('p opens the palette, h opens help, r refreshes', () => {
    const { byHotkey, calls } = setup()

    ;(byHotkey(40, 'p')[0]?.props.onPress as () => void)()
    ;(byHotkey(40, 'h')[0]?.props.onPress as () => void)()
    ;(byHotkey(40, 'r')[0]?.props.onPress as () => void)()
    expect(calls).toEqual(['palette:all', 'help', 'refresh'])
  })

  it('the armed keys are drawn hidden (display none), not as visible buttons', () => {
    const { draw } = setup()
    const hiddenBoxes = draw(40).filter(el => el.kind === 'Box' && el.props.display === 'none')

    expect(hiddenBoxes.length).toBeGreaterThanOrEqual(2)
  })

  it('every key is unique, so none shadows another', () => {
    const { draw } = setup()
    const keys = draw(40).filter(el => el.kind === 'Button' && el.props.hotkey !== undefined).map(el => String(el.props.hotkey))

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('with an ask pending, y and n still belong to Yes and Cancel, and no page arms them', () => {
    const { state, draw } = setup()

    state.pending = { label: 'start a loop in the main Claude UI: /loop do things', args: ['x'], expect: 'e', askedAtMs: 1 }
    const keyed = draw(40).filter(el => el.kind === 'Button' && el.props.hotkey !== undefined)

    expect(keyed.filter(el => el.props.hotkey === 'y').map(el => el.props.key)).toEqual(['confirm'])
    expect(keyed.filter(el => el.props.hotkey === 'n').map(el => el.props.key)).toEqual(['cancel'])
  })
})
