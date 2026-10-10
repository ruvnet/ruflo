/**
 * The breadcrumb's "◂ Back to <page>" button: absent with nothing to go back to, present (and named for the target) once the trail has a
 * live entry, and pressing it runs the real `back` action (an agent entry reopens that agent). It has no hotkey, and the close path
 * (Esc / the close mark) is untouched. Run with
 *   npx vitest run tests/back-button.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createController } from '../hooks/controller'
import type { Host } from '../hooks/host'
import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { newState } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { paneView } from '../hooks/views/pane'
import { RUFLO_FILES } from './fixtures/ruflo-run'

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const files = Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text]))
const memoryFs = {
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
}
const flat = (node: unknown): El[] => {
  if (typeof node !== 'object' || node === null) return []

  const el = node as El
  const children = el.props.children

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

function setup(look: 'bbs' | 'plain' = 'plain') {
  const state = newState({ boot: false })

  state.options.look = look
  state.view = 'overview'

  const control = createController(state, fakeHost())
  const act = new Proxy({ back: control.actions.back } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : key === 'then' ? undefined : () => undefined),
  }) as unknown as Ctx['act']
  const draw = (columns = 100) => flat(paneView({ kit, state, act, columns, nowMs: 100_000, pictures: new Map() } as unknown as Ctx))
  const backButton = (columns = 100) => draw(columns).find(el => el.kind === 'Button' && el.props.key === 'crumb-back')

  return { state, control, backButton }
}

afterEach(() => setLook('plain'))

describe('the breadcrumb Back button', () => {
  for (const look of ['plain', 'bbs'] as const) {
    it(`${look}: absent with an empty trail`, () => {
      const { backButton } = setup(look)

      expect(backButton()).toBeUndefined()
    })

    it(`${look}: present once there is a page to go back to, named for it, with no hotkey; pressing it goes back`, () => {
      const { state, control, backButton } = setup(look)

      control.setView('swarm')
      const button = backButton()

      expect(button?.props.label).toBe('◂ Back to Overview')
      expect(button?.props.hotkey).toBeUndefined()
      ;(button?.props.onPress as () => void)()
      expect(state.view).toBe('overview')
      expect(backButton()).toBeUndefined()
    })
  }

  it('is also there on a narrow pane', () => {
    const { control, backButton } = setup()

    control.setView('swarm')
    expect(backButton(40)?.props.label).toBe('◂ Back to Overview')
  })

  it('pressing it from a page reopens the agent that was open (the existing back path)', async () => {
    const { state, control, backButton } = setup()

    state.snapshot = await readSnapshot(memoryFs, new Map() as ReadCache, '/work', '/home/dev', {}, 0)
    const id = state.snapshot.agents[0]?.id as string

    expect(id).toBeTruthy()
    control.setView('swarm')
    control.drill(id)
    control.setView('overview')
    expect(state.trail.at(-1)).toEqual({ view: 'agent', agentId: id })
    expect(backButton()?.props.label).toBe('◂ Back to Agent')
    ;(backButton()?.props.onPress as () => void)()
    expect(state.view).toBe('agent')
    expect(state.drill.agentId).toBe(id)
  })

  it('leaves the close path alone: closing by hand still marks the pane closed and does not touch the trail', () => {
    const { state, control } = setup()

    control.setView('swarm')
    const trail = [...state.trail]

    control.closedByPerson()
    expect(state.pane.isClosedByPerson).toBe(true)
    expect(state.trail).toEqual(trail)
  })
})

describe('the breadcrumb blurb never names a key for going back', () => {
  const text = (nodes: El[]): string => nodes.filter(el => el.kind === 'Text').map(el => String(el.props.children ?? '')).join(' ')
  const drawText = (state: ReturnType<typeof newState>): string => text(flat(paneView({ kit, state, act: {}, columns: 100, nowMs: 100_000, pictures: new Map() } as unknown as Ctx)))

  for (const look of ['plain', 'bbs'] as const) {
    it(`${look}: off the agent page it has no "b <-" (b is the Hive-Mind key there); the button names the page`, () => {
      const { state, control, backButton } = setup(look)

      control.setView('swarm')
      expect(backButton()?.props.label).toBe('◂ Back to Overview')
      expect(drawText(state)).not.toMatch(/b <-/)
    })
  }

  it('on the agent page it still says b goes back to the page it came from', async () => {
    const { state, control } = setup()

    state.snapshot = await readSnapshot(memoryFs, new Map() as ReadCache, '/work', '/home/dev', {}, 0)
    control.setView('swarm')
    control.drill(state.snapshot.agents[0]?.id as string)
    expect(drawText(state)).toMatch(/b goes back to Swarm/)
  })
})
