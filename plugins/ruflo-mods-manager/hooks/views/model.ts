/**
 * What the pane shows, worked out from the state with no engine call: rows, the selection, the diagrams' data, and an
 * honest label for every number (how old it is, whether it was measured, why it is missing).
 */

import { configureLine, type Scope } from '../model/argv'
import { chainOf, countsOf, effective, enabledFromSettings, plain, type ChainLink, type Counts, type ModRow, type Verdict } from '../model/data'
import { MANAGER_ID, type Point, type State, type View } from '../state'
import type { HookMap, Pulse } from './frames'

/** The events ruflo-mods' gate counts as risky (plugins/ruflo-mods/hooks/trust.ts). */
export const RISKY_EVENTS = new Set(['tool.check', 'tool.call', '*', 'classic.*', 'plugin.register', 'prompt.compose'])

export const VERDICT_WORDS: Record<Verdict, string> = {
  gate: 'the gate',
  'no-gate': 'no gate',
  off: 'gate off',
  allowed: 'allowed',
  clean: 'clean',
  observed: 'observed',
  refused: 'refused',
  unknown: 'unknown',
}

export type Row = {
  id: string
  name: string
  version: string
  scope: string
  enabled: boolean
  installed: boolean | null
  resolvable: boolean | null
  verdict: Verdict
  events: number | null
  isSelected: boolean
}

export type Freshness = { word: 'MEASURED' | 'STALE' | 'LOADING' | 'FAILED'; text: string }

export type PaneModel = {
  view: View
  columns: number
  rows: number
  isFocused: boolean
  hasRaster: boolean
  isHelp: boolean
  isActing: boolean
  freshness: Freshness
  rows_: Row[]
  selected: (Row & { detail: string[]; calls: string[]; configure: string }) | null
  confirm: string | null
  outcome: { text: string; ok: boolean } | null
  hookMap: HookMap
  hookTable: string[]
  chain: ChainLink[]
  counts: Counts | null
  history: Point[]
  pulse: Pulse
  pulseLabel: string
  notes: string[]
}

const ago = (ms: number): string => (ms < 1_500 ? 'just now' : ms < 90_000 ? `${Math.round(ms / 1000)} s ago` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`)

export function freshnessOf(state: State, nowMs: number): Freshness {
  const { list } = state
  const periodMs = state.options.refreshSeconds * 1000

  if (list.atMs === null) {
    return list.error !== null ? { word: 'FAILED', text: `ruflo mods list failed: ${list.error}` } : { word: 'LOADING', text: 'reading ruflo mods list…' }
  }

  const age = nowMs - list.atMs
  const failed = list.error !== null ? ` · last refresh failed: ${list.error}` : ''

  return age > periodMs * 3 || list.error !== null
    ? { word: 'STALE', text: `as of ${ago(age)}${failed}` }
    : { word: 'MEASURED', text: `ruflo mods list · ${ago(age)}` }
}

/** Every id the pane can account for: the CLI's list, plus any ruflo id the settings name (shown before the CLI answers). */
export function rowsOf(state: State): ModRow[] {
  const listed = state.list.data?.mods ?? []
  const named = new Set<string>()

  for (const settings of Object.values(state.settings.data ?? {})) {
    const plugins = (settings as { enabledPlugins?: unknown } | null)?.enabledPlugins

    if (plugins !== null && typeof plugins === 'object') {
      for (const id of Object.keys(plugins)) {
        if (/^ruflo-[a-z0-9-]{1,48}@ruflo$/.test(id) && !listed.some(row => row.id === id)) {
          named.add(id)
        }
      }
    }
  }

  const unlisted: ModRow[] = [...named].map(id => ({
    id,
    name: id.replace(/@ruflo$/, ''),
    version: null,
    enabledIn: { user: null, project: null, local: null },
    enabled: false,
    installed: false,
    installScope: null,
    installPath: null,
    resolvable: false,
    source: 'settings',
    events: null,
    calls: null,
    scanError: 'not in ruflo mods list yet',
    scannedFrom: null,
    verdict: 'unknown',
    risk: [],
  }))

  return [...listed, ...unlisted].sort((a, b) => a.id.localeCompare(b.id))
}

function hookMapOf(mods: readonly ModRow[]): { map: HookMap; table: string[] } {
  const scanned = mods.filter(row => row.events !== null && row.events.length > 0)
  const tally = new Map<string, number>()

  for (const row of scanned) {
    for (const ev of new Set(row.events)) {
      tally.set(ev, (tally.get(ev) ?? 0) + 1)
    }
  }

  const events = [...tally.keys()].sort((a, b) => (tally.get(b) ?? 0) - (tally.get(a) ?? 0) || a.localeCompare(b))
  const edges: Array<[number, number, boolean]> = []

  scanned.forEach((row, m) => {
    for (const ev of new Set(row.events)) {
      edges.push([m, events.indexOf(ev), RISKY_EVENTS.has(ev)])
    }
  })

  const table = events.map(ev => `${RISKY_EVENTS.has(ev) ? '!' : ' '} ${ev} ← ${scanned.filter(row => row.events?.includes(ev)).map(row => row.name).join(', ')}`)
  const unscanned = mods.filter(row => row.events === null).map(row => `${row.name}: scan unavailable (${row.scanError ?? 'no reason given'})`)

  return { map: { mods: scanned.map(row => row.name), events, edges }, table: [...table, ...unscanned] }
}

export function paneModelOf(state: State, columns: number, rows: number, nowMs: number): PaneModel {
  const mods = rowsOf(state)
  const selectedId = state.selected !== null && mods.some(row => row.id === state.selected) ? state.selected : (mods[0]?.id ?? null)
  const settingsKnown = state.settings.data !== null
  const scopeText = (row: ModRow): string => {
    const by = settingsKnown ? enabledFromSettings(row.id, state.settings.data ?? {}) : row.enabledIn
    const named = (['local', 'project', 'user'] as Scope[]).filter(s => by[s] !== null)

    return named.length > 0 ? named.join('+') : '—'
  }

  const table: Row[] = mods.map(row => ({
    id: row.id,
    name: row.name,
    version: row.version ?? '?',
    scope: scopeText(row),
    enabled: settingsKnown ? effective(enabledFromSettings(row.id, state.settings.data ?? {})) : row.enabled,
    installed: row.source === 'settings' ? null : row.installed,
    resolvable: row.source === 'settings' ? null : row.resolvable,
    verdict: row.verdict,
    events: row.events?.length ?? null,
    isSelected: row.id === selectedId,
  }))

  const pick = mods.find(row => row.id === selectedId)
  const pickRow = table.find(row => row.id === selectedId)
  const selected =
    pick !== undefined && pickRow !== undefined
      ? {
          ...pickRow,
          calls: pick.calls ?? [],
          configure: configureLine(pick.id),
          detail: [
            `path ${pick.installPath ?? 'not installed'}${pick.installScope !== null ? ` (${pick.installScope} scope)` : ''}`,
            pick.events !== null ? `hooks ${pick.events.join(', ') || 'none'}${pick.scannedFrom !== null && pick.scannedFrom !== pick.installPath ? ` (scanned ${pick.scannedFrom}, not the install)` : ''}` : `hooks unknown: ${pick.scanError ?? 'no scan'}`,
            `trust ${VERDICT_WORDS[pick.verdict]}${pick.risk.length > 0 ? `: ${pick.risk.join('; ')}` : ''}`,
            'last refusal: not recorded on disk (ruflo-mods logs refusals to the transcript)',
          ],
        }
      : null

  const { map, table: hookTable } = hookMapOf(mods)
  const findings = state.status.data
  const gate = state.list.data?.gate
  const manager = mods.find(row => row.id === MANAGER_ID)
  const notes: string[] = []

  if (gate !== undefined && gate.enabled && gate.modTrust === 'refuse-risky' && !gate.allow.includes(MANAGER_ID)) {
    notes.push(`ruflo-mods refuses risky mods: add ${MANAGER_ID} to its modTrustAllow (claude plugin configure ruflo-mods@ruflo), or this pane will not load next session`)
  }

  if (manager !== undefined && manager.source !== 'settings' && !manager.installed) {
    notes.push('this manager runs from a folder, not a ruflo install: ruflo mods list cannot scan it')
  }

  if (state.heartbeat.data !== null) {
    notes.push(state.heartbeat.data === 'none' ? 'ruflo-mods has not started in this project (no heartbeat)' : `ruflo-mods last started ${plain(state.heartbeat.data.startedAt, 32)}, owning ${state.heartbeat.data.owned.join(', ') || 'nothing'}`)
  }

  const periodMs = state.options.refreshSeconds * 1000
  const confirm = state.confirm !== null && nowMs - state.confirm.askedAtMs <= 8_000 ? `disable ${state.confirm.id} (${state.confirm.scope})? press d again to confirm` : null

  return {
    view: state.view,
    columns,
    rows,
    isFocused: state.pane.isFocused,
    hasRaster: state.pane.hasRaster,
    isHelp: state.isHelp,
    isActing: state.isActing,
    freshness: freshnessOf(state, nowMs),
    rows_: table,
    selected,
    confirm,
    outcome: state.outcome !== null && nowMs - state.outcome.atMs < 60_000 ? { text: state.outcome.text, ok: state.outcome.ok } : null,
    hookMap: map,
    hookTable,
    chain: findings !== null ? chainOf(findings) : [],
    counts: findings !== null ? countsOf(findings) : null,
    history: state.history,
    pulse: { beats: state.beats, periodMs, windowMs: Math.max(60_000, periodMs * 4) },
    pulseLabel: 'pulse = time since the last measured refresh (MEASURED); flat and grey = STALE',
    notes,
  }
}
