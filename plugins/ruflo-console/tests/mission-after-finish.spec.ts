/**
 * A finished or cancelled mission stayed the active mission for ever, so a goal typed after it was planned but could never become a mission:
 * the NEXT STEP box said "Create the mission and its tasks" was done (with the old id) and had no create button. "Done" is read from the
 * ruflo task store, not from the mission record (still `planned` in this release). Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-after-finish.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { TaskRecord } from '../hooks/data/parse'
import type { Host } from '../hooks/host'
import { activeMission, createSpec, isOver, ledgerKeyOf, mcOf, missionActions, setGoal, type MissionRecord } from '../hooks/mission-control'
import type { Runner } from '../hooks/runner'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { launchRows, launchSteps } from '../hooks/views/mission-launch'
import { missionControlView, missionStrip } from '../hooks/views/mission-control'

const OLD = 'msn_0123456789abcdef01234567'
const NEW = 'msn_fedcba9876543210fedcba98'
const OLD_GOAL = 'add a dark mode toggle'
const NEW_GOAL = 'fix the crash when the password is empty'
const CWD = '/home/me/project'

type El = { kind: string; props: Record<string, unknown> }
const node = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: node('Box'), Text: node('Text'), Button: node('Button'), Input: node('Input') }
const flat = (el: unknown): El[] => {
  if (Array.isArray(el)) return el.flatMap(flat)

  const n = el as El

  if (typeof n !== 'object' || n === null || n.props === undefined) return []

  const kids = n.props.children

  return [n, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}

const pressed: string[] = []
const act = new Proxy({ mission: new Proxy({}, { get: (_t, key) => () => void pressed.push(String(key)) }) }, { get: (t, key) => (key in t ? t[key as 'mission'] : () => undefined) })
const ctxOf = (state: State): Ctx => ({ kit, state, nowMs: 5_000, columns: 120, pictures: new Map(), act, cards: false }) as unknown as Ctx
const buttons = (tree: unknown): string[] => flat(tree).filter(n => n.kind === 'Button').map(n => String(n.props.key))

const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [] })

/** A mission of three tasks whose ruflo task ids are r1..r3. */
function missionOf(id: string, objective: string, extra: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id,
    objective,
    profile: 'feature',
    rigor: 'standard',
    tasks: [
      { id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'a written specification', dependsOn: [], rufloTaskId: 'r1' },
      { id: 't2', title: 'Design', phase: 'A', agent: 'architecture', requirement: 'a design', dependsOn: ['t1'], rufloTaskId: 'r2' },
      { id: 't3', title: 'Pseudocode', phase: 'P', agent: 'pseudocode', requirement: 'pseudocode', dependsOn: ['t1'], rufloTaskId: 'r3' },
    ],
    acceptance: [{ id: 'ac-specified', check: 'a specification exists' }],
    events: [],
    paused: false,
    cancelled: false,
    auto: false,
    createdAtMs: 1,
    ...extra,
  }
}

const DONE = [task('r1', 'completed'), task('r2', 'completed'), task('r3', 'completed')]
const OPEN = [task('r1', 'completed'), task('r2', 'in_progress'), task('r3', 'pending')]

/** The old mission is active over `tasks`; `goal` is typed after it (Enter planned it). */
function stateWith(tasks: TaskRecord[], goal: string | null, extra: Partial<MissionRecord> = {}): State {
  const state = newState({})

  state.cwd = CWD
  state.snapshot = { tasks, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [] }, alerts: [] } as never
  mcOf(state).missions.set(OLD, missionOf(OLD, OLD_GOAL, extra))
  mcOf(state).active = OLD
  if (goal !== null) setGoal(state, goal)

  return state
}

/** The screen and Claude's guidance are settled, so the create step is the next one whenever it is offered. */
const settled = (state: State): State => {
  Object.assign(mcOf(state), { screen: mcOf(state).screen ?? { status: 'safe', detail: 'no threats or PII found' }, guidance: { goal: mcOf(state).goal, status: 'done', lines: [], note: 'advised', stop: null, startedAtMs: 0 } })

  return state
}

const stepOf = (state: State, id: string) => launchSteps(ctxOf(settled(state))).find(step => step.id === id)

describe('the create step after a mission that is over', () => {
  it('offers create as the next step when the active mission is finished (15/15 style) and a new goal is planned', () => {
    const state = stateWith(DONE, NEW_GOAL)
    const create = stepOf(state, 'create')

    expect(create?.state).toBe('next')
    expect(create?.action?.key).toBe('mc-create')
    expect(create?.detail).not.toContain(OLD.slice(0, 16))
  })

  it('does not count the finished mission as the new goal\'s own: the run step waits for the mission that is about to exist', () => {
    const run = stepOf(stateWith(DONE, NEW_GOAL), 'run')

    expect(run?.state).toBe('todo')
    expect(run?.detail).toBe('after the mission exists')
    expect(run?.action).toBeUndefined()
  })

  it('offers create when the active mission is cancelled, with open tasks or not', () => {
    for (const tasks of [OPEN, DONE]) {
      const create = stepOf(stateWith(tasks, NEW_GOAL, { cancelled: true }), 'create')

      expect(create?.state).toBe('next')
      expect(create?.action?.key).toBe('mc-create')
    }
  })

  it('still offers nothing to create while the active mission has tasks pending or running (re-plan in place, as before)', () => {
    for (const tasks of [OPEN, [task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')], [task('r1', 'completed'), task('r2', 'completed'), task('r3', 'failed')], []]) {
      const create = stepOf(stateWith(tasks, NEW_GOAL), 'create')

      expect(create?.state).toBe('done')
      expect(create?.detail).toBe(OLD.slice(0, 16))
      expect(create?.action).toBeUndefined()
    }
  })

  it('offers create when every task is settled but one was cancelled on its own (14 done + 1 cancelled), mission not cancelled', () => {
    const tasks = [task('r1', 'cancelled'), task('r2', 'completed'), task('r3', 'completed')]
    const create = stepOf(stateWith(tasks, NEW_GOAL), 'create')

    expect(create?.state).toBe('next')
    expect(create?.action?.key).toBe('mc-create')
    expect(create?.detail).not.toContain(OLD.slice(0, 16))
  })

  it('offers create when every task was cancelled one by one', () => {
    const tasks = [task('r1', 'cancelled'), task('r2', 'cancelled'), task('r3', 'cancelled')]

    expect(stepOf(stateWith(tasks, NEW_GOAL), 'create')?.action?.key).toBe('mc-create')
  })

  it('a cancelled task does not close a mission that still has a pending, running or failed one', () => {
    for (const rest of ['pending', 'in_progress', 'failed']) {
      const tasks = [task('r1', 'cancelled'), task('r2', 'completed'), task('r3', rest)]

      expect(stepOf(stateWith(tasks, NEW_GOAL), 'create')?.action).toBeUndefined()
    }
  })

  it('the goal of a mission closed by a cancelled task is not offered again (its plan stays on screen after the create)', () => {
    const tasks = [task('r1', 'cancelled'), task('r2', 'completed'), task('r3', 'completed')]

    expect(stepOf(stateWith(tasks, OLD_GOAL), 'create')?.action).toBeUndefined()
  })

  it('isOver: done and cancelled tasks only, at least one task, or the mission cancelled', () => {
    const mission = missionOf(OLD, OLD_GOAL)

    expect(isOver(mission, [task('r1', 'cancelled'), task('r2', 'completed'), task('r3', 'complete')])).toBe(true)
    expect(isOver(mission, [task('r1', 'cancelled'), task('r2', 'completed'), task('r3', 'pending')])).toBe(false)
    expect(isOver({ ...mission, tasks: [] }, [])).toBe(false)
    expect(isOver({ ...mission, cancelled: true }, OPEN)).toBe(true)
  })

  it('a paused mission with open tasks is not over', () => {
    expect(stepOf(stateWith(OPEN, NEW_GOAL, { paused: true }), 'create')?.action).toBeUndefined()
  })

  it('a mission with no tasks is not "finished" (0 of 0 is not done)', () => {
    const state = stateWith(DONE, NEW_GOAL)

    mcOf(state).missions.set(OLD, { ...missionOf(OLD, OLD_GOAL), tasks: [] })
    expect(stepOf(state, 'create')?.action).toBeUndefined()
  })

  it('with no active mission it is what it was: create is the next step once the goal is planned', () => {
    const state = stateWith(DONE, NEW_GOAL)

    mcOf(state).active = null

    const create = stepOf(state, 'create')

    expect(create?.state).toBe('next')
    expect(create?.action?.key).toBe('mc-create')
    expect(stepOf(state, 'run')?.detail).toBe('after the mission exists')
  })

  it('with no plan yet there is nothing to create, whatever the active mission is', () => {
    const state = stateWith(DONE, null)

    expect(stepOf(state, 'create')?.action).toBeUndefined()
  })

  it('AIDefence still blocks the create after a finished mission: blocked, no button', () => {
    const state = stateWith(DONE, NEW_GOAL)

    mcOf(state).screen = { status: 'unsafe', detail: 'prompt injection' } as never

    const create = stepOf(state, 'create')

    expect(create?.state).toBe('blocked')
    expect(create?.action).toBeUndefined()
  })

  it('does not offer a second mission for the goal a finished mission was just made from (its plan stays on screen after the create)', () => {
    const state = stateWith(DONE, OLD_GOAL)

    expect(stepOf(state, 'create')?.state).toBe('done')
    expect(stepOf(state, 'create')?.action).toBeUndefined()
  })

  it('a cancelled mission\'s own goal can be created again', () => {
    expect(stepOf(stateWith(OPEN, OLD_GOAL, { cancelled: true }), 'create')?.action?.key).toBe('mc-create')
  })

  it('launchRows draws the mc-create button and marks the create step as the next one', () => {
    const tree = launchRows(ctxOf(settled(stateWith(DONE, NEW_GOAL))))
    const text = flat(tree).filter(n => n.kind === 'Text').map(n => String(n.props.children)).join('\n')

    expect(buttons(tree)).toContain('mc-create')
    expect(text).toContain('NEXT STEP: Create the mission and its tasks')
  })

  it('launchRows keeps its "all done" box for the goal the finished mission was made from', () => {
    const text = flat(launchRows(ctxOf(settled(stateWith(DONE, OLD_GOAL))))).filter(n => n.kind === 'Text').map(n => String(n.props.children)).join('\n')

    expect(text).not.toContain('NEXT STEP: Create')
    expect(buttons(launchRows(ctxOf(settled(stateWith(DONE, OLD_GOAL)))))).not.toContain('mc-create')
  })
})

describe('Mission Control after a mission that is over', () => {
  it('renders mc-create for a new goal planned after a finished mission, and keeps the picker', () => {
    const state = stateWith(DONE, NEW_GOAL)

    mcOf(state).missions.set('msn_aaaaaaaaaaaaaaaaaaaaaaaa', missionOf('msn_aaaaaaaaaaaaaaaaaaaaaaaa', 'an older goal'))
    expect(buttons(missionControlView(ctxOf(state)))).toEqual(expect.arrayContaining(['mc-create', `mc-pick-${OLD}`, 'mc-pick-msn_aaaaaaaaaaaaaaaaaaaaaaaa']))
  })

  it('renders no mc-create while the active mission is still going', () => {
    expect(buttons(missionControlView(ctxOf(stateWith(OPEN, NEW_GOAL))))).not.toContain('mc-create')
  })

  it('the menu goal box says a new goal becomes another mission once the active one is over, and "in place" while it is going', () => {
    const hint = (state: State) => String(flat(missionStrip(ctxOf(state))).find(n => n.kind === 'Input')?.props.placeholder ?? '')

    expect(hint(stateWith(OPEN, null))).toContain('planned in place of this one')
    expect(hint(stateWith(DONE, null))).toContain('create it as another mission')
    expect(hint(stateWith(OPEN, null, { cancelled: true }))).toContain('create it as another mission')
  })

  it('pressing it asks the create action (nothing is created by showing the button)', () => {
    pressed.length = 0

    const button = flat(missionControlView(ctxOf(stateWith(DONE, NEW_GOAL)))).find(n => n.kind === 'Button' && n.props.key === 'mc-create')

    expect(pressed).toEqual([])
    ;(button?.props.onPress as () => void)()
    expect(pressed).toEqual(['create'])
  })
})

describe('create from a finished mission', () => {
  const out = (data: unknown) => `[INFO] Executing tool\nResult:\n${JSON.stringify(data, null, 2)}\n[INFO] done`

  function setup(goal: string) {
    const state = stateWith(DONE, goal)
    const runs: string[][] = []
    const stored = new Map<string, unknown>()
    let n = 0
    const host = {
      run: async (argv: readonly string[]) => {
        runs.push([...argv])

        // The plan goes in a file (`install` writes it) and `mission plan --plan-file` answers with bare JSON; every other step is `mcp exec -t <tool>`.
        if (argv.includes('plan') && argv.includes('--plan-file')) return { exitCode: 0, stdout: JSON.stringify({ ok: true, data: { missionId: NEW, revision: 2, state: 'planned', planDigest: 'sha256:abc' } }), stderr: '' }

        const at = argv.indexOf('-t')

        if (at < 0) return { exitCode: 0, stdout: '', stderr: '' }

        const tool = argv[at + 1]
        const params = JSON.parse(argv[argv.lastIndexOf('-p') + 1] as string) as Record<string, unknown>
        const data = tool === 'mission_create' ? { ok: true, data: { missionId: NEW, revision: 1, state: 'draft' } } : { taskId: `new-${++n}`, ...params }

        return { exitCode: 0, stdout: out(data), stderr: '' }
      },
      storeGet: async (key: string) => stored.get(key),
      storeSet: async (key: string, value: unknown) => void stored.set(key, value),
      invalidate: () => undefined,
      after: () => ({ cancel: () => undefined }),
    } as unknown as Host
    const asked: (ActionSpec | null)[] = []
    const runner = { ask: (spec: ActionSpec | null) => void asked.push(spec) } as unknown as Runner

    return { state, host, runs, stored, asked, actions: missionActions(state, host, runner) }
  }

  it('the create action asks (it is not hidden behind the finished mission), and asking writes nothing', () => {
    const { state, actions, asked, runs } = setup(NEW_GOAL)

    actions.create()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.label).toContain('create the mission and its')
    expect(runs).toEqual([])
    expect(activeMission(state)?.id).toBe(OLD)
  })

  it('makes the new mission active from the NEW plan, keeps the old one, in the picker and in the saved ledger', async () => {
    const { state, host, runs, stored, actions, asked } = setup(NEW_GOAL)
    const mc = mcOf(state)
    const planned = mc.planned

    expect(planned?.profile).toBe('bugfix')
    actions.create()
    await asked[0]?.run?.()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mc.last).toMatchObject({ ok: true })

    const fresh = activeMission(state) as MissionRecord

    expect(fresh.id).toBe(NEW)
    expect(fresh.objective).toBe(NEW_GOAL)
    expect(fresh.profile).toBe('bugfix')
    // The tasks are the new plan's nodes, one ruflo task each, and none of the old mission's.
    expect(fresh.tasks.map(t => t.id)).toEqual(planned?.steps.map(step => step.id))
    expect(fresh.tasks.map(t => t.title)).toEqual(planned?.steps.map(step => step.action.title))
    expect(fresh.tasks.every(t => t.rufloTaskId?.startsWith('new-'))).toBe(true)
    expect(fresh.tasks.some(t => ['r1', 'r2', 'r3'].includes(t.rufloTaskId ?? ''))).toBe(false)
    expect(runs.map(argv => argv[argv.indexOf('-t') + 1]).filter(tool => tool === 'task_create')).toHaveLength(planned?.steps.length ?? -1)
    expect(JSON.parse(runs[0]?.[runs[0].indexOf('-p') + 1] as string)).toMatchObject({ objective: NEW_GOAL })

    // The old mission is untouched and still there.
    expect([...mc.missions.keys()]).toEqual([OLD, NEW])
    expect(mc.missions.get(OLD)?.tasks.map(t => t.rufloTaskId)).toEqual(['r1', 'r2', 'r3'])
    expect(mc.missions.get(OLD)?.cancelled).toBe(false)
    expect(buttons(missionControlView(ctxOf(state)))).toEqual(expect.arrayContaining([`mc-pick-${OLD}`, `mc-pick-${NEW}`]))

    const saved = stored.get(ledgerKeyOf(CWD)) as { active: string; missions: MissionRecord[] }

    expect(saved.active).toBe(NEW)
    expect(saved.missions.map(m => m.id)).toEqual([OLD, NEW])
    void host
  })

  it('leaves the goal, plan and screen as typed, shows the Tasks tab, and the create step is done for the new mission', async () => {
    const { state, actions, asked } = setup(NEW_GOAL)
    const mc = mcOf(state)

    mc.screen = { status: 'clean', detail: 'no threats or PII found' } as never

    const planned = mc.planned

    actions.create()
    await asked[0]?.run?.()
    expect(mc.goal).toBe(NEW_GOAL)
    expect(mc.planned).toBe(planned)
    expect(mc.screen).toMatchObject({ status: 'clean' })
    expect(mc.tab).toBe('tasks')
    expect(mc.last).toMatchObject({ ok: true })

    // Its tasks are not in the (stale) snapshot yet: the new mission is simply not finished, so the create step reads done with the new id.
    const create = stepOf(state, 'create')

    expect(create?.state).toBe('done')
    expect(create?.detail).toBe(NEW.slice(0, 16))
    expect(create?.action).toBeUndefined()
    expect(stepOf(state, 'run')?.detail).toContain('0/')
  })

  it('refuses the create when the goal changed while it was being asked (the plan on screen is not the one confirmed)', async () => {
    const { state, host, runs } = setup(NEW_GOAL)
    const spec = createSpec(state, host, () => undefined) as ActionSpec

    setGoal(state, 'investigate why recall drops')
    await spec.run?.()
    expect(runs).toEqual([])
    expect(mcOf(state).last?.detail).toContain('the goal changed')
    expect(activeMission(state)?.id).toBe(OLD)
  })
})
