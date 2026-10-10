/**
 * The trail Back walks: `state.trail` holds the pages the person left, oldest first. A page change pushes the page it leaves
 * (`rememberView`), Back pops until it finds a page that still exists (`popBack`), and the breadcrumb peeks at the next one
 * (`peekBack`). An entry can go stale (a page id no longer in the table, or an `agent` whose agent has vanished): those are skipped.
 */
import { VIEWS, type State, type ViewId } from './state'

export const HISTORY_MAX = 20

const isPage = (id: ViewId): boolean => VIEWS.some(view => view.id === id)

/** Whether Back may land on this entry from where the person is now. */
function isLive(state: State, id: ViewId): boolean {
  if (id === state.view) return false
  if (id === 'agent') return state.snapshot?.agents[state.select.agent] !== undefined

  return isPage(id)
}

/** Remembers the page being left. The same page twice in a row is not a step, and the trail is capped at HISTORY_MAX. */
export function rememberView(state: State, left: ViewId): void {
  if (state.trail[state.trail.length - 1] === left) return

  state.trail.push(left)
  if (state.trail.length > HISTORY_MAX) state.trail.splice(0, state.trail.length - HISTORY_MAX)
}

/** The page Back would go to, without going: null when the trail has none left. */
export function peekBack(state: State): ViewId | null {
  for (let i = state.trail.length - 1; i >= 0; i -= 1) {
    const id = state.trail[i] as ViewId

    if (isLive(state, id)) return id
  }

  return null
}

/** Takes the page Back goes to off the trail (dropping stale entries above it), or the menu / Overview when nothing is left. */
export function popBack(state: State): ViewId {
  const target = peekBack(state)

  if (target === null) {
    state.trail = []

    return state.options.look === 'bbs' ? 'menu' : 'overview'
  }

  state.trail.length = state.trail.lastIndexOf(target)

  return target
}

/** The page a drill-down was opened from (what its tabs, accent and help follow): the one Back returns to, else Overview. */
export const originOf = (state: State): ViewId => {
  for (let i = state.trail.length - 1; i >= 0; i -= 1) {
    const id = state.trail[i] as ViewId

    if (id !== 'agent' && isPage(id)) return id
  }

  return 'overview'
}
