/**
 * What the pane and `/mods` do, over a Host: refresh from the CLI, select, enable and disable, animate. No `$` here;
 * register.ts binds the Host and the hooks.
 */

import type { Host } from './host'
import { cliPrefix, configureLine, listArgv, statusArgv, toggleArgv, type Scope } from './model/argv'
import { countsOf, jsonOf, parseList, parseStatus, plain } from './model/data'
import { isStale, pulseFrame } from './views/frames'
import { rowsOf } from './views/model'
import { PULSE_KEY } from './views/pane'
import { BEATS, CONFIRM_MS, HISTORY, historyKeyOf, MANAGER_ID, PANE_ID, stopTimers, VIEW_ROWS, type State, type View } from './state'

const LIST_TIMEOUT_MS = 120_000
const STATUS_TIMEOUT_MS = 60_000
const TOGGLE_TIMEOUT_MS = 90_000
const FRAME_MS = 125
const HEARTBEAT = '.claude-flow/mods/session.json'

const message = (error: unknown): string => plain(error instanceof Error ? error.message : String(error), 160)

export type Controller = {
  refresh: () => Promise<void>
  startPolling: () => void
  animate: () => void
  resume: () => Promise<void>
  open: (view?: View) => Promise<string>
  setView: (view: View) => Promise<void>
  step: (by: 1 | -1) => void
  select: (id: string) => boolean
  toggle: (action: 'enable' | 'disable', id: string, scope: Scope) => Promise<{ ok: boolean; text: string }>
  pressDisable: () => Promise<void>
  configure: (id: string) => Promise<string>
  tell: (text: string, ok: boolean) => Promise<void>
}

export function controllerOf(state: State, host: () => Host | null): Controller {
  const prefix = () => cliPrefix(state.options.cli, state.localCli)

  async function readSettings(bound: Host): Promise<void> {
    try {
      const [user, project, local] = await Promise.all([bound.settings('user'), bound.settings('project'), bound.settings('local')])

      state.settings = { data: { user, project, local }, atMs: await bound.now(), error: null }
    } catch (error) {
      state.settings = { ...state.settings, error: message(error) }
    }
  }

  async function readHeartbeat(bound: Host): Promise<void> {
    try {
      const raw = JSON.parse(await bound.read(`${state.cwd}/${HEARTBEAT}`)) as { startedAt?: unknown; owned?: unknown }

      state.heartbeat = {
        data: { startedAt: plain(raw.startedAt, 40), owned: Array.isArray(raw.owned) ? raw.owned.filter(o => typeof o === 'string').map(o => plain(o, 24)) : [] },
        atMs: await bound.now(),
        error: null,
      }
    } catch (error) {
      // A missing file is "ruflo-mods has not started here"; anything else is an error to show.
      const missing = /ENOENT|not found|no such/i.test(message(error))

      state.heartbeat = missing ? { data: 'none', atMs: await bound.now(), error: null } : { ...state.heartbeat, error: message(error) }
    }
  }

  let inflight: Promise<void> | null = null

  /** One refresh at a time: a caller arriving during one waits for it, and one more runs after. Never rejects. */
  function refresh(): Promise<void> {
    const bound = host()

    if (bound === null) {
      return Promise.resolve()
    }

    if (inflight !== null) {
      state.isRefreshQueued = true

      return inflight
    }

    inflight = refreshOnce(bound)
      .catch(() => undefined)
      .finally(() => {
        inflight = null

        if (state.isRefreshQueued) {
          state.isRefreshQueued = false
          void refresh()
        }
      })

    return inflight
  }

  async function refreshOnce(bound: Host): Promise<void> {
    state.isRefreshing = true

    try {
      const [list, status] = await Promise.all([
        bound.run(listArgv(prefix()), LIST_TIMEOUT_MS).then(
          run => (run.exitCode === 0 ? { list: parseList(run.stdout) } : { error: `exit ${run.exitCode}: ${plain(run.stderr || run.stdout, 120)}` }),
          (error: unknown) => ({ error: message(error) }),
        ),
        bound.run(statusArgv(prefix()), STATUS_TIMEOUT_MS).then(
          run => ({ findings: parseStatus(run.stdout) }),
          (error: unknown) => ({ error: message(error) }),
        ),
        readSettings(bound),
        readHeartbeat(bound),
      ]).catch((error: unknown) => [{ error: message(error) }, { error: message(error) }] as const)
      const at = await bound.now()

      if ('list' in list && list.list !== undefined) {
        state.list = { data: list.list, atMs: at, error: null }
        state.beats = [...state.beats, at].slice(-BEATS)
      } else {
        state.list = { ...state.list, error: 'error' in list ? (list.error ?? 'unknown') : 'unknown' }
      }

      if ('findings' in status && status.findings !== undefined) {
        const counts = countsOf(status.findings)

        state.status = { data: status.findings, atMs: at, error: null }
        state.history = [...state.history, { atMs: at, ...counts }].slice(-HISTORY)
        void bound.storeSet(historyKeyOf(state.cwd), state.history).catch(() => undefined)
      } else {
        state.status = { ...state.status, error: 'error' in status ? (status.error ?? 'unknown') : 'unknown' }
      }

      segment(bound)
    } finally {
      state.isRefreshing = false
      bound.invalidate()
    }
  }

  /** One status segment: how many ruflo mods are on, and any on but not loadable. Measured or absent, never guessed. */
  function segment(bound: Host): void {
    const mods = state.list.data?.mods

    if (mods === undefined) {
      return
    }

    const on = mods.filter(row => row.enabled)
    const broken = on.filter(row => !row.resolvable)

    try {
      bound.status(`ruflo mods: ${on.length} on${broken.length > 0 ? ` · ${broken.length} not loadable` : ''}`)
    } catch {
      // a withheld status line changes nothing
    }
  }

  function startPolling(): void {
    const bound = host()

    if (bound === null || state.timers.has('poll')) {
      return
    }

    state.timers.set('poll', bound.every(state.options.refreshSeconds * 1000, () => void refresh()))
    void refresh()
  }

  /** The health pulse, blitted on the real clock while the health view is up and the data is not stale. */
  function animate(): void {
    const bound = host()

    if (bound === null || state.timers.has('frames') || !state.options.animate || !state.pane.hasRaster || state.view !== 'health' || state.isHelp) {
      return
    }

    state.timers.set(
      'frames',
      bound.every(FRAME_MS, () => void frame(bound)),
    )
  }

  /** One frame of the pulse; a refused clock or blit ends nothing but this frame. */
  async function frame(bound: Host): Promise<void> {
    try {
      const box = state.pulseBox
      const t = await bound.now()
      const pulse = { beats: state.beats, periodMs: state.options.refreshSeconds * 1000, windowMs: Math.max(60_000, state.options.refreshSeconds * 4000) }

      if (box === null || !state.pane.isOpen || state.view !== 'health' || state.isHelp || isStale(pulse, t)) {
        stopTimers(state, ['frames'])
        bound.invalidate()

        return
      }

      const { cells, columns, rows } = pulseFrame(pulse, box, t).toRaster(PULSE_KEY)

      // Fire and forget: a blit resolves once painted, and blits between frames fold anyway.
      void bound.blit({ requestId: PANE_ID, key: PULSE_KEY, cells, columns, rows }).catch(() => undefined)
    } catch {
      // the engine went away (session end, unload): the next frame, if any, tries again
    }
  }

  /** After a draw: poll and animate only while the engine lists the pane as open. */
  async function resume(): Promise<void> {
    const bound = host()

    if (bound === null) {
      return
    }

    const isOpen = await bound.panes().then(
      panes => panes.some(pane => pane.id === PANE_ID),
      () => state.pane.isOpen,
    )

    state.pane.isOpen = isOpen

    if (isOpen) {
      startPolling()
      animate()
    } else {
      stopTimers(state, ['poll', 'frames'])
    }
  }

  async function open(view?: View): Promise<string> {
    const bound = host()

    if (bound === null) {
      return 'the session has not started'
    }

    state.view = view ?? state.view

    try {
      const result = await bound.open({ id: PANE_ID, title: 'Mods', focus: true, closeOnEscape: true, holdToasts: true, rows: VIEW_ROWS[state.view] })

      state.pane.isOpen = result?.isPlaced !== false
      startPolling()

      return result?.isPlaced === false ? `the mods pane is waiting to be placed: ${plain(result.reason ?? '', 120)}` : `mods pane: ${state.view}`
    } catch (error) {
      return `the mods pane could not open: ${message(error)}`
    }
  }

  async function setView(view: View): Promise<void> {
    state.view = view
    state.isHelp = false
    stopTimers(state, ['frames'])

    if (state.pane.isOpen) {
      // Each open sets `rows` anew: ask for this view's height.
      await open(view)
    }

    host()?.invalidate()
  }

  function step(by: 1 | -1): void {
    const ids = rowsOf(state).map(row => row.id)

    if (ids.length > 0) {
      const at = Math.max(0, ids.indexOf(state.selected ?? ids[0]!))

      state.selected = ids[(at + by + ids.length) % ids.length] ?? null
      state.confirm = null
      host()?.invalidate()
    }
  }

  function select(id: string): boolean {
    const known = rowsOf(state).some(row => row.id === id)

    if (known) {
      state.selected = id
      host()?.invalidate()
    }

    return known
  }

  async function tell(text: string, ok: boolean): Promise<void> {
    const bound = host()

    if (bound === null) {
      return
    }

    state.outcome = { text, ok, atMs: await bound.now().catch(() => state.outcome?.atMs ?? 0) }

    if (!state.pane.isOpen) {
      // While the pane is up its toasts are held (holdToasts): the outcome row says it there instead.
      try {
        bound.toast(text)
      } catch {
        // a withheld toast changes nothing
      }
    }

    bound.invalidate()
  }

  async function toggle(action: 'enable' | 'disable', id: string, scope: Scope): Promise<{ ok: boolean; text: string }> {
    const bound = host()

    if (bound === null) {
      return { ok: false, text: 'the session has not started' }
    }

    if (state.isActing) {
      return { ok: false, text: 'another enable or disable is still running' }
    }

    state.isActing = true
    state.confirm = null
    bound.invalidate()

    let result: { ok: boolean; text: string }

    try {
      const run = await bound.run(toggleArgv(prefix(), action, id, scope), TOGGLE_TIMEOUT_MS)
      const answer = jsonOf(run.stdout) as { ok?: unknown; error?: unknown; manual?: unknown; note?: unknown }
      const ok = run.exitCode === 0 && answer.ok === true

      result = ok
        ? { ok, text: `${action}d ${id} (${scope}); ${plain(answer.note ?? 'takes effect in the next session or after /reload-plugins', 80)}` }
        : { ok, text: `${action} ${id} failed: ${plain(answer.error ?? run.stderr, 120)}${typeof answer.manual === 'string' ? ` · run: ${plain(answer.manual, 120)}` : ''}` }
    } catch (error) {
      result = { ok: false, text: `${action} ${id} failed: ${message(error)}` }
    } finally {
      state.isActing = false
    }

    if (result.ok && id === MANAGER_ID && action === 'disable') {
      result.text += ' · this pane goes with it next session'
    }

    await tell(result.text, result.ok)
    void refresh()

    return result
  }

  /** `d`: the first press asks, a second within CONFIRM_MS disables. */
  async function pressDisable(): Promise<void> {
    const bound = host()
    const id = state.selected ?? rowsOf(state)[0]?.id

    if (bound === null || id === undefined) {
      return
    }

    const now = await bound.now()

    if (state.confirm !== null && state.confirm.id === id && now - state.confirm.askedAtMs <= CONFIRM_MS) {
      await toggle('disable', id, state.confirm.scope)

      return
    }

    state.confirm = { id, scope: 'local', askedAtMs: now }
    bound.invalidate()
  }

  async function configure(id: string): Promise<string> {
    const bound = host()

    if (bound === null) {
      return 'the session has not started'
    }

    try {
      await bound.fill({ text: configureLine(id), mode: 'replace' })

      return `put "${configureLine(id)}" in the prompt: press Enter to run it`
    } catch (error) {
      return `could not fill the prompt (${message(error)}); run: claude plugin configure ${id}`
    }
  }

  return { refresh, startPolling, animate, resume, open, setView, step, select, toggle, pressDisable, configure, tell }
}
