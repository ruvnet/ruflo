import type { PluginOptions, Timer } from 'claude-code'

import { CLI_PREFIXES, type CliChoice, type Scope } from './model/argv'
import type { Finding, ModList } from './model/data'

export const PLUGIN_NAME = 'ruflo-mods-manager'
export const PANE_ID = 'ruflo-mods-manager'
export const COMMAND = 'mods'
/** The pane opens as a manager of these, by provenance; the manager's own id is one of them. */
export const MANAGER_ID = 'ruflo-mods-manager@ruflo'

export const VIEWS = ['list', 'diagrams', 'health'] as const
export type View = (typeof VIEWS)[number]

/** The inline body rows each view wants (ADR-406); the dock ignores them. */
export const VIEW_ROWS: Record<View, number> = { list: 18, diagrams: 22, health: 16 }

/** How many doctor points the timeline keeps, per project. */
export const HISTORY = 48
/** How many refresh times the pulse keeps. */
export const BEATS = 32
/** A disable waits this long for its second press. */
export const CONFIRM_MS = 8_000

export const historyKeyOf = (cwd: string): string => `ruflo-mods-manager/history:${cwd}`

export type Options = {
  cli: CliChoice
  /** Poll period while the pane is open, seconds (10 to 600). */
  refreshSeconds: number
  /** Animate the health pulse; off draws it still. */
  animate: boolean
}

/** Each option checked against what the plugin knows: anything else is its default. */
export function optionsOf(raw: PluginOptions): Options {
  const value = (raw ?? {}) as Record<string, unknown>
  const cli = typeof value.cli === 'string' && (value.cli === 'auto' || value.cli in CLI_PREFIXES) ? (value.cli as CliChoice) : 'auto'
  const seconds = Number(value.refreshSeconds)

  return {
    cli,
    refreshSeconds: Number.isFinite(seconds) ? Math.min(600, Math.max(10, Math.round(seconds))) : 30,
    animate: value.animate !== false,
  }
}

/** One fetch: what it gave, when it finished, and why it failed when it did. The data of a failed fetch is the last good one. */
export type Fetched<T> = { data: T | null; atMs: number | null; error: string | null }

export type Point = { atMs: number; pass: number; warn: number; fail: number }

export type Heartbeat = { startedAt: string; owned: string[] }

export type State = {
  options: Options
  cwd: string
  localCli: string | null
  view: View
  selected: string | null
  list: Fetched<ModList>
  status: Fetched<Finding[]>
  settings: Fetched<Partial<Record<Scope, unknown>>>
  heartbeat: Fetched<Heartbeat | 'none'>
  history: Point[]
  beats: number[]
  pane: { isOpen: boolean; columns: number; rows: number; isFocused: boolean; placement: string; hasRaster: boolean }
  /** The pulse's box as last drawn: every blit is this size. */
  pulseBox: { columns: number; rows: number } | null
  confirm: { id: string; scope: Scope; askedAtMs: number } | null
  outcome: { text: string; ok: boolean; atMs: number } | null
  isHelp: boolean
  isRefreshing: boolean
  isRefreshQueued: boolean
  isActing: boolean
  timers: Map<string, Timer>
}

const fresh = <T>(): Fetched<T> => ({ data: null, atMs: null, error: null })

export function newState(raw: PluginOptions): State {
  return {
    options: optionsOf(raw),
    cwd: '',
    localCli: null,
    view: 'list',
    selected: null,
    list: fresh(),
    status: fresh(),
    settings: fresh(),
    heartbeat: fresh(),
    history: [],
    beats: [],
    pane: { isOpen: false, columns: 80, rows: 18, isFocused: false, placement: 'inline', hasRaster: false },
    pulseBox: null,
    confirm: null,
    outcome: null,
    isHelp: false,
    isRefreshing: false,
    isRefreshQueued: false,
    isActing: false,
    timers: new Map(),
  }
}

/** The stored timeline, checked point by point: a store written by another version never breaks the pane. */
export function historyOf(value: unknown): Point[] {
  if (!Array.isArray(value)) {
    return []
  }

  const ok = (v: unknown): v is Point => {
    const p = v as Point

    return typeof v === 'object' && v !== null && [p.atMs, p.pass, p.warn, p.fail].every(n => typeof n === 'number' && Number.isFinite(n))
  }

  return value.filter(ok).slice(-HISTORY)
}

export function stopTimers(state: State, names?: readonly string[]): void {
  for (const [name, timer] of [...state.timers]) {
    if (names === undefined || names.includes(name)) {
      timer.cancel()
      state.timers.delete(name)
    }
  }
}
