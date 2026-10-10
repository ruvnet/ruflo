/**
 * The trail Back walks: `state.trail` holds the pages the person left, oldest first. A page change pushes the page it leaves
 * (`rememberView`), Back pops until it finds a page that still exists (`popBack`), and the breadcrumb peeks at the next one
 * (`peekBack`). An entry can go stale (a page id no longer in the table, or an `agent` whose agent has vanished): those are skipped.
 * A drill-down entry carries the id of the agent that was open, so Back reopens that agent and not the last one drilled.
 */
import { VIEWS, type State, type ViewId } from './state'

export const HISTORY_MAX = 20

export type TrailEntry = { view: ViewId; agentId?: string }

const isPage = (id: ViewId): boolean => VIEWS.some(view => view.id === id)

/** Whether Back may land on this entry from where the person is now. */
function isLive(state: State, entry: TrailEntry): boolean {
  if (entry.view === 'agent') {
    if (entry.agentId === undefined || !(state.snapshot?.agents.some(agent => agent.id === entry.agentId) ?? false)) return false

    return !(state.view === 'agent' && state.drill.agentId === entry.agentId)
  }

  return entry.view !== state.view && isPage(entry.view)
}

/** Remembers the page being left (and, for the drill-down, its agent). The same step twice in a row is not a step; the trail is capped at HISTORY_MAX. */
export function rememberView(state: State, left: ViewId): void {
  const entry: TrailEntry = left === 'agent' && state.drill.agentId !== null ? { view: left, agentId: state.drill.agentId } : { view: left }
  const top = state.trail[state.trail.length - 1]

  if (top !== undefined && top.view === entry.view && top.agentId === entry.agentId) return

  state.trail.push(entry)
  if (state.trail.length > HISTORY_MAX) state.trail.splice(0, state.trail.length - HISTORY_MAX)
}

function indexOfBack(state: State): number {
  for (let i = state.trail.length - 1; i >= 0; i -= 1) if (isLive(state, state.trail[i] as TrailEntry)) return i

  return -1
}

/** The page Back would go to, without going: null when the trail has none left. */
export function peekBack(state: State): TrailEntry | null {
  return state.trail[indexOfBack(state)] ?? null
}

/** Takes the entry Back goes to off the trail (dropping stale entries above it), or the menu / Overview when nothing is left. */
export function popBack(state: State): TrailEntry {
  const at = indexOfBack(state)

  if (at < 0) {
    state.trail = []

    return { view: state.options.look === 'bbs' ? 'menu' : 'overview' }
  }

  const target = state.trail[at] as TrailEntry

  state.trail.length = at

  return target
}

/** The page a drill-down was opened from (what its tabs, accent and help follow): the last non-agent page on the trail, else Overview. */
export const originOf = (state: State): ViewId => {
  for (let i = state.trail.length - 1; i >= 0; i -= 1) {
    const id = (state.trail[i] as TrailEntry).view

    if (id !== 'agent' && isPage(id)) return id
  }

  return 'overview'
}
