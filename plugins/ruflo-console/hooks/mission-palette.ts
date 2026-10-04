/** Palette entries for Mission Control, so `/ruflo run mission-next` and `/ruflo plan <goal>` work headless; a write or a turn still asks. */
import type { ActionSpec } from './actions'
import { blocksCreate } from './mission-options'
import { activeMission, cancelSpec, createSpec, dispatchSpec, mcOf, missionWired, nextTask, setGoal } from './mission-control'
import type { PaletteEntry } from './palette'
import type { State } from './state'

export function missionPalette(state: State): PaletteEntry[] {
  const wired = missionWired(state)
  const local = (label: string, run: () => void): ActionSpec | null => (wired === undefined ? null : { label, args: [], expect: label, isReadOnly: true, run: async () => run() })
  const why = 'open Mission Control (the Missions view) first'
  const spec = (make: () => ActionSpec | null) => ({ kind: 'spec' as const, spec: wired === undefined ? null : make(), why })
  const text = (keyword: string, make: (text: string) => ActionSpec | null) => ({ kind: 'text' as const, keyword, make: (value: string) => (wired === undefined ? null : make(value)), why: () => why })
  const tasks = () => state.snapshot?.tasks ?? []

  return [
    { id: 'mission-goal', group: 'missions', label: 'mission-goal <goal>: plan a goal as a SPARC goal-oriented plan (nothing is written)', run: text('mission-goal', value => local('plan the goal', () => setGoal(state, value))) },
    { id: 'mission-status', group: 'missions', label: 'mission status: progress, each task’s status, what is next', run: spec(() => local('mission status', () => undefined)) },
    { id: 'mission-create', group: 'missions', label: 'create the mission and its tasks from the planned goal (asks first)', run: spec(() => (wired === undefined || blocksCreate(mcOf(state).screen) ? null : createSpec(state, wired.host, () => undefined))) },
    {
      id: 'mission-next',
      group: 'missions',
      label: 'hand the next ready task to Claude (asks first: it starts a turn)',
      run: spec(() => {
        const mission = activeMission(state)
        const task = mission === null ? null : nextTask(mission, tasks())

        return wired === undefined || mission === null || task === null ? null : dispatchSpec(state, wired.host, mission, task, text => wired.host.submitPrompt(text))
      }),
    },
    { id: 'mission-pause', group: 'missions', label: 'pause: no more tasks are handed out', run: spec(() => local('pause the mission', () => wired?.actions.pause())) },
    { id: 'mission-resume', group: 'missions', label: 'resume handing out tasks', run: spec(() => local('resume the mission', () => wired?.actions.resume())) },
    { id: 'mission-cancel', group: 'missions', label: 'cancel the mission and its open tasks (asks first)', run: spec(() => { const mission = activeMission(state); return wired === undefined || mission === null ? null : cancelSpec(state, wired.host, mission, tasks()) }) },
    { id: 'mission-aside', group: 'missions', label: 'mission-aside <question>: /btw beside the running task', run: text('mission-aside', value => local('ask aside', () => wired?.actions.aside(value))) },
    { id: 'mission-guide', group: 'missions', label: 'mission-guide <instruction>: a visible instruction to Claude (screened, asks first)', run: text('mission-guide', value => local('guide Claude', () => wired?.actions.guide(value))) },
    { id: 'mission-auto', group: 'missions', label: 'mission-auto on|off: hand over each next ready task without asking', run: text('mission-auto', value => local('auto-run', () => wired?.actions.auto(value.trim() === 'on'))) },
    { id: 'mission-research', group: 'missions', label: 'research the question typed in Missions: screened, then confirm (a billed turn with web access up to the cap)', run: spec(() => local('start the research', () => wired?.research())) },
    { id: 'mission-open', group: 'missions', label: 'open Mission Control', run: { kind: 'view', view: 'missions' } },
  ].map(entry => ({ ...entry, label: mcOf(state) === undefined ? entry.label : entry.label })) as PaletteEntry[]
}
