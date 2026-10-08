/** The confirm-gated writes of Mission Control: create the mission and its tasks, hand a task to Claude, cancel. */
import type { ActionSpec } from './actions'
import { plain, type TaskRecord } from './data/parse'
import { stageOf, toMissionPlan, type Profile } from './goap'
import { checkLimit, MISSION_OBJECTIVE_MAX } from './full-text'
import type { Host } from './host'
import { adrBlockFor } from './adr-mission'
import { EVENT_RESUMED, stoppedByAdvisor } from './mission-advisor'
import { activeMission, instructionOf, mcOf, nextTask, record, rufloTaskOf, saveLedger } from './mission-control'
import type { LedgerTask, MissionRecord } from './mission-types'
import { CLI_PREFIXES, type State } from './state'

const argvOf = (state: State, tool: string, params: unknown): string[] => [...CLI_PREFIXES[state.options.cli], 'mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)]

/** The JSON object after `Result:` in a tool run's output (the CLI logs around it), or null. */
export function resultOf(stdout: string): Record<string, unknown> | null {
  const text = stdout.replace(/\x1b\[[0-9;]*m/g, '')
  const start = text.indexOf('{', Math.max(0, text.indexOf('Result:')))
  let depth = 0

  for (let i = start; i >= 0 && i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }

  return null
}

const taskType = (profile: Profile) => (profile === 'bugfix' ? 'bugfix' : profile === 'refactor' ? 'refactor' : profile === 'research' ? 'research' : 'feature')

/**
 * Why the mission cannot be created from this goal, or null: the ruflo mission record takes an objective of at most MISSION_OBJECTIVE_MAX
 * characters (mission_create's input schema), and the goal is never cut to fit (ADR-481). Checked before the ask, with the exact count.
 */
export function createWhy(state: State): string | null {
  const goal = mcOf(state).goal
  const fit = checkLimit(goal, MISSION_OBJECTIVE_MAX, 'the goal', 'the ruflo mission record takes at most that many; planning, guidance and the skills use the whole goal', 'No mission was created; ✎ edit the goal to fit.')

  return fit.ok ? null : fit.message
}

/** Create the mission: `mission_create`, `mission_plan`, then a ruflo task per plan node. One confirm for the chain. */
export function createSpec(state: State, host: Host, onDone: () => void): ActionSpec | null {
  const mc = mcOf(state)

  if (mc.planned === null || mc.goal === '' || createWhy(state) !== null) return null

  const planned = mc.planned
  const goal = mc.goal
  const body = toMissionPlan(planned)
  const stamp = Date.now().toString(36)

  return {
    label: `create the mission and its ${body.tasks.length} tasks: ${plain(goal, 60)}`,
    scope: 'goal',
    args: [],
    argv: argvOf(state, 'mission_create', { requestId: `console-create-${stamp}`, objective: goal }),
    shows: `mission_create → mission_plan → task_create × ${body.tasks.length}, each \`ruflo mcp exec -t <tool>\` (${planned.profile}, ${planned.rigor}; ceiling ${body.budget.ceilingMinor / 100} ${body.budget.currency}, a record, not a charge)`,
    expect: 'a planned mission and its tasks in the ruflo task store',
    note: 'Writes the mission record and one task per plan node to this project’s ruflo stores. It runs no agent and spends nothing.',
    run: async () => {
      // The goal changed while this ask was open: the plan on screen is not the plan that was asked for.
      if (mc.goal !== goal) return void (mc.last = { label: 'not created', ok: false, detail: 'the goal changed since you asked; ask again' })

      try {
        await createChain()
      } catch (error) {
        mc.last = { label: 'creating the mission failed', ok: false, detail: plain(error instanceof Error ? error.message : String(error), 160) }
        host.invalidate()
      }
    },
  }

  async function createChain(): Promise<void> {
    {
      const mission = mc
      const fail = (label: string, detail: string) => {
        mission.last = { label, ok: false, detail }
        host.invalidate()
      }
      const call = async (tool: string, params: unknown) => resultOf((await host.run(argvOf(state, tool, params), 60_000)).stdout)
      const created = await call('mission_create', { requestId: `console-create-${stamp}`, objective: goal })
      const data = (created?.data ?? {}) as { missionId?: string; revision?: number }

      if (created?.ok !== true || typeof data.missionId !== 'string') return fail('mission_create failed', plain(String(created?.message ?? 'no answer'), 160))

      const id = data.missionId
      const placed = await call('mission_plan', { requestId: `console-plan-${stamp}`, missionId: id, expectedRevision: data.revision ?? 1, plan: body })

      if (placed?.ok !== true) return fail('mission_plan refused the plan', plain(String(placed?.message ?? 'no answer'), 200))

      const tasks: LedgerTask[] = []

      for (const step of planned.steps) {
        const task = body.tasks.find(candidate => candidate.id === step.id)
        const made = await call('task_create', {
          type: taskType(planned.profile),
          description: `[${id}/${step.id}] ${task?.title ?? step.action.title}`.slice(0, 200),
          priority: 'normal',
          tags: [`mission:${id}`, `task:${step.id}`, `phase:${step.action.phase}`],
        })
        const rufloTaskId = typeof made?.taskId === 'string' ? made.taskId : undefined

        tasks.push({ id: step.id, title: step.action.title, phase: step.action.phase, stage: stageOf(step.action), agent: step.action.agent, requirement: step.action.requirement, dependsOn: step.dependsOn, ...(rufloTaskId !== undefined && { rufloTaskId }) })
      }

      const missing = tasks.filter(task => task.rufloTaskId === undefined).length

      if (missing > 0) {
        for (const task of tasks) if (task.rufloTaskId !== undefined) await host.run(argvOf(state, 'task_cancel', { taskId: task.rufloTaskId, reason: 'mission creation failed in the console' }), 60_000).catch(() => undefined)

        return fail(`${missing} of ${tasks.length} tasks could not be created`, `mission ${id} exists without tasks; the tasks that were made were cancelled. Ask again.`)
      }

      const record0: MissionRecord = {
        id,
        objective: goal,
        profile: planned.profile,
        rigor: planned.rigor,
        planDigest: typeof (placed.data as { planDigest?: string } | undefined)?.planDigest === 'string' ? (placed.data as { planDigest: string }).planDigest : undefined,
        tasks,
        acceptance: body.acceptance.map(criterion => ({ id: criterion.id, check: criterion.check })),
        events: [],
        paused: false,
        cancelled: false,
        auto: false,
        createdAtMs: Date.now(),
      }

      record(record0, { type: 'mission.created', status: 'draft' })
      record(record0, { type: 'plan.validated', status: 'planned', evidenceRef: record0.planDigest })
      record(record0, { type: 'tasks.created', note: `${tasks.filter(task => task.rufloTaskId !== undefined).length} of ${tasks.length}` })
      mc.missions.set(id, record0)
      mc.active = id
      mc.tab = 'tasks'
      mc.last = { label: `mission ${id} planned`, ok: true, detail: `${tasks.length} tasks in the ruflo task store; ▶ Run next hands the first to Claude` }
      saveLedger(state, host)
      onDone()
      host.invalidate()
    }
  }
}

/** Mark one task in progress and hand it to the primary session as a visible prompt. One confirm: it starts a model turn. */
/** Tasks handed over in the last seconds: the task store has not refreshed yet, so they still read ready. */
/** How many times auto-run hands one task to Claude before the mission pauses and waits for the person (#3818). */
export const MAX_HANDOUTS = 3

/** True when a tool run's output says it worked: exit 0, and no `"success": false`, error line or `isError` in what it printed. */
const worked = (result: { exitCode: number; stdout: string }): boolean => result.exitCode === 0 && !/"success"\s*:\s*false|"isError"\s*:\s*true|\[ERROR\]/.test(result.stdout)

const inflight = new WeakSet<LedgerTask>()

export const isInflight = (task: LedgerTask): boolean => inflight.has(task)

/** `isReady` replaces the one-at-a-time check for a caller that has its own bound (autopilot's `startable`); without it the mission's own `nextTask` rule applies. */
export function dispatchSpec(state: State, host: Host, mission: MissionRecord, task: LedgerTask, send: (text: string) => Promise<void>, isReady?: (mission: MissionRecord, tasks: readonly TaskRecord[], task: LedgerTask) => boolean): ActionSpec {
  const text = instructionOf(mission, task, adrBlockFor(state, mission))

  return {
    label: `hand task ${task.id} to Claude: ${task.title}`,
    scope: 'controls',
    args: [],
    shows: `task_update ${task.rufloTaskId ?? ''} in_progress, then this prompt to the Claude Code session: “${plain(text, 140)}…”`,
    expect: 'a visible prompt in the transcript; the task in progress',
    note: 'Starts a Claude Code turn on your plan (billed as any turn is); the prompt is visible and Claude records the result with task_complete.',
    run: async () => {
      // The ask stays open for a while: the mission may have moved (paused, cancelled, auto-run took it, a double press).
      if (mission.paused || mission.cancelled || inflight.has(task) || !(isReady === undefined ? nextTask(mission, state.snapshot?.tasks ?? [])?.id === task.id : isReady(mission, state.snapshot?.tasks ?? [], task))) {
        mcOf(state).last = { label: `task ${task.id} not handed over`, ok: false, detail: 'the mission changed since you asked (paused, cancelled, or that task already went)' }
        host.invalidate()

        return
      }

      inflight.add(task)
      host.after(15_000, () => inflight.delete(task))
      // Every attempt counts, so a task whose hand-out keeps failing is not retried without end (auto-run pauses at MAX_HANDOUTS).
      task.handouts = (task.handouts ?? 0) + 1

      // The task store must say in_progress BEFORE the prompt goes: if it did not take, the task is still pending and would be sent again on the next idle.
      const update = await host.run(argvOf(state, 'task_update', { taskId: task.rufloTaskId, status: 'in_progress', progress: 5 }), 60_000).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }))

      if (!worked(update)) {
        inflight.delete(task)
        record(mission, { type: 'task.handout-failed', taskId: task.id, note: `the task store did not take in_progress (attempt ${task.handouts})` })
        saveLedger(state, host)
        mcOf(state).last = { label: `task ${task.id} was not handed over`, ok: false, detail: 'the ruflo task store refused the in_progress update, so no prompt was sent' }
        host.invalidate()

        return
      }

      task.dispatchedAtMs = Date.now()
      record(mission, { type: 'task.dispatched', taskId: task.id, status: 'in_progress', evidenceRef: task.rufloTaskId })
      saveLedger(state, host)

      try {
        await send(text)
      } catch (error) {
        // The prompt did not go: put the task back so the mission does not stall on a task nobody is doing.
        await host.run(argvOf(state, 'task_update', { taskId: task.rufloTaskId, status: 'pending', progress: 0 }), 60_000).catch(() => undefined)
        task.dispatchedAtMs = undefined
        inflight.delete(task)
        mcOf(state).last = { label: `task ${task.id} was not sent`, ok: false, detail: plain(error instanceof Error ? error.message : String(error), 140) }
        host.invalidate()

        return
      }

      mcOf(state).last = { label: `task ${task.id} handed to Claude`, ok: true, detail: 'it is in the transcript now; the pane follows the task store' }
      host.invalidate()
    },
  }
}

/** Pause or resume dispatching, kept in the ledger (a session-bound mission has no durable executor to pause). */
export function setPaused(state: State, host: Host, paused: boolean): void {
  const mission = activeMission(state)

  if (mission === null || mission.cancelled) return

  mission.paused = paused
  // The person resuming has seen why it stopped: each task gets its hand-outs again.
  if (!paused) for (const task of mission.tasks) task.handouts = 0
  record(mission, { type: paused ? 'mission.paused' : 'mission.resumed', status: paused ? 'paused' : 'running' })
  // ADR-483: resuming after an advisor stop-the-line gives the failing check a fresh run of tries.
  if (!paused && stoppedByAdvisor(mission)) record(mission, { type: EVENT_RESUMED })
  mcOf(state).last = { label: paused ? 'paused: no more tasks are handed out' : 'resumed', ok: true, detail: paused ? 'a task already handed to Claude finishes first' : 'Run next hands out the next ready task' }
  saveLedger(state, host)
  host.invalidate()
}

/** Cancel: cancel every task not done in the ruflo task store, then ask the mission record to cancel (allowed only from some states). */
export function cancelSpec(state: State, host: Host, mission: MissionRecord, tasks: readonly TaskRecord[]): ActionSpec {
  const open = mission.tasks.filter(task => task.rufloTaskId !== undefined && !['completed', 'cancelled'].includes(rufloTaskOf(tasks, task)?.status ?? ''))

  return {
    label: `cancel mission ${mission.id} (${open.length} open tasks)`,
    scope: 'controls',
    args: [],
    shows: `task_cancel × ${open.length}, then mission_request_action cancel (the record may refuse from its state)`,
    expect: 'every open task cancelled',
    note: 'Cancels this mission’s open tasks in the ruflo task store. A task already finished stays finished.',
    run: async () => {
      for (const task of open) await host.run(argvOf(state, 'task_cancel', { taskId: task.rufloTaskId, reason: 'mission cancelled from the console' }), 60_000)

      const refused = resultOf((await host.run(argvOf(state, 'mission_request_action', { requestId: `console-cancel-${Date.now().toString(36)}`, missionId: mission.id, expectedRevision: 2, action: 'cancel', reason: 'cancelled from the console' }), 60_000)).stdout)

      mission.cancelled = true
      record(mission, { type: 'mission.cancelled', status: 'cancelled', note: refused?.ok === true ? 'record cancelled' : `record: ${plain(String(refused?.message ?? 'not asked'), 100)}` })
      mcOf(state).last = { label: `mission ${mission.id} cancelled`, ok: true, detail: `${open.length} tasks cancelled${refused?.ok === true ? '' : `; the record said: ${plain(String(refused?.message ?? ''), 100)}`}` }
      saveLedger(state, host)
      host.invalidate()
    },
  }
}
