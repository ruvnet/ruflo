import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { COMMAND_SPEC, parseSub } from './commands'
import { controllerOf } from './controller'
import type { Host } from './host'
import { LOCAL_CLI } from './model/argv'
import { plain } from './model/data'
import { COMMAND, historyOf, historyKeyOf, newState, PANE_ID, stopTimers, type State } from './state'
import { paneModelOf } from './views/model'
import { HELP, listText, paneView, PULSE_ROWS, type Kit, type PaneActions } from './views/pane'

/**
 * Binds a Host from `$`. Declared here, each member spelled `$.noun.method(...)`, so the engine reads what the module
 * calls off its source (ADR-406's least-authority table is exactly this list). Draw calls are wrapped: a refused toast
 * or status is not a crashed hook.
 */
function hostOf($: EngineInterface): Host {
  const quietly = (fn: () => void) => {
    try {
      fn()
    } catch {
      // Refused: there is nothing to do about a draw nobody may make.
    }
  }

  return {
    now: () => $.clock.now(),
    every: (ms, fn) => $.clock.every(ms, fn),
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
    settings: source => $.settings.read(source !== undefined ? { source } : undefined),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    invalidate: () => quietly(() => $.ui.invalidate('ui.render')),
    toast: text => quietly(() => $.ui.toast(text)),
    status: text => quietly(() => $.ui.status(text)),
    open: pane => $.ui.open(pane),
    close: id => $.ui.close({ id }),
    panes: () => $.ui.panes(),
    blit: args => $.ui.blit(args),
    fill: input => $.prompt.fill(input),
    registerCommand: spec => $.command.register(spec),
  }
}

/** The pane's buttons, as closures over the controller: the view calls nothing on the engine. */
function actionsOf(state: State, control: ReturnType<typeof controllerOf>): PaneActions {
  const selected = () => state.selected ?? null

  return {
    view: view => void control.setView(view),
    next: () => control.step(1),
    prev: () => control.step(-1),
    enable: () => {
      const id = selected()

      if (id !== null) {
        void control.toggle('enable', id, 'local')
      }
    },
    disable: () => void control.pressDisable(),
    refresh: () => void control.refresh(),
    configure: () => {
      const id = selected()

      if (id !== null) {
        void control.configure(id).then(text => control.tell(text, !text.startsWith('could not')))
      }
    },
    help: () => {
      state.isHelp = !state.isHelp
      stopTimers(state, ['frames'])
      void control.tell(state.isHelp ? 'help: press h again to go back' : 'help closed', true)
    },
  }
}

/**
 * The ruflo mod manager (ADR-406): `/mods` opens a pane listing ruflo-family mods, the hooks they take, the init chain
 * and the doctor's health, and enables or disables one through the ruflo CLI. Read-only otherwise.
 */
export function register(on: On, raw: PluginOptions) {
  const state = newState(raw)
  let host: Host | null = null
  const control = controllerOf(state, () => host)

  /** The pane is gone (the person's close, or ours: a caller's own `ui.close` hook may not run for its own call). */
  const closed = () => {
    state.pane.isOpen = false
    state.isHelp = false
    state.confirm = null
    stopTimers(state, ['poll', 'frames'])
  }

  on('session.start', async ($, e, next) => {
    host = hostOf($)
    state.cwd = e.cwd
    stopTimers(state)

    const bound = host
    const local = `${e.cwd.replace(/\/+$/, '')}/${LOCAL_CLI}`

    await Promise.all([
      bound.registerCommand(COMMAND_SPEC).catch(() => undefined),
      bound
        .exists(local)
        .then(isThere => {
          state.localCli = isThere ? local : null
        })
        .catch(() => undefined),
      bound
        .storeGet(historyKeyOf(e.cwd))
        .then(value => {
          state.history = historyOf(value)
        })
        .catch(() => undefined),
      // A reload while the pane stayed up: the engine's record says so, and polling resumes.
      bound
        .panes()
        .then(panes => {
          state.pane.isOpen = panes.some(pane => pane.id === PANE_ID)
        })
        .catch(() => undefined),
    ])

    if (state.pane.isOpen) {
      control.startPolling()
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopTimers(state)
    host?.status(undefined)

    return next(e)
  })

  on('command.run', { command: 'mods' }, async ($, e, next) => {
    if (host === null) {
      return next(e)
    }

    const sub = parseSub(e.args)

    switch (sub.kind) {
      case 'toggle':
        if (state.pane.isOpen) {
          await host.close(PANE_ID).then(closed, () => undefined)

          return { text: 'mods pane closed' }
        }

        return { text: await control.open() }
      case 'view': {
        const opened = state.pane.isOpen ? `mods pane: ${sub.view}` : await control.open(sub.view)

        await control.setView(sub.view)

        if (sub.view === 'list') {
          await control.refresh()

          return { text: `${opened}\n${listText(paneModelOf(state, 100, 40, await host.now()))}` }
        }

        return { text: opened }
      }
      case 'step':
        control.step(sub.by)

        return { text: `selected ${state.selected ?? 'nothing'}` }
      case 'select':
        return { text: control.select(sub.id) ? `selected ${sub.id}` : `${sub.id} is not a known ruflo mod (try /mods refresh)` }
      case 'toggle-mod': {
        // The command form is its own confirmation: the person typed the id.
        const result = await control.toggle(sub.action, sub.id, sub.scope)

        return { text: result.text, exitCode: result.ok ? 0 : 1 }
      }
      case 'refresh':
        await control.refresh()

        return { text: `refreshed: ${state.list.error === null ? 'ruflo mods list ok' : `list failed: ${state.list.error}`}; ${state.status.error === null ? 'status ok' : `status failed: ${state.status.error}`}` }
      case 'configure':
        return { text: await control.configure(sub.id) }
      case 'help':
        state.isHelp = true
        host.invalidate()

        return { text: HELP.replace(/\\\|/g, '|') }
      case 'close':
        await host.close(PANE_ID).then(closed, () => undefined)

        return { text: 'mods pane closed' }
      case 'error':
        return { text: sub.text, exitCode: 2 }
    }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (host === null || e.requestId !== PANE_ID) {
      return next(e)
    }

    const table = $.ui.resolve(e) as Partial<Kit> & Pick<Kit, 'Box' | 'Text' | 'Button'>
    const kit: Kit = { Box: table.Box, Text: table.Text, Button: table.Button, ...(table.Raster !== undefined && { Raster: table.Raster }), ...(table.Markdown !== undefined && { Markdown: table.Markdown }) }
    const columns = Math.max(20, Math.floor(Number(e.props.bodyColumns) || 0) - 1)
    const rows = Math.max(6, Math.floor(Number(e.props.scroll?.bodyRows) || 0))
    const nowMs = await host.now()

    state.pane = { ...state.pane, columns, rows, isFocused: e.props.isFocused === true, placement: String(e.props.placement ?? 'inline'), hasRaster: kit.Raster !== undefined }
    state.pulseBox = { columns, rows: PULSE_ROWS }

    // A reload or resume can leave the pane up with nothing polling; a closing pane can draw once more after its
    // `ui.close`. Only the engine's record tells the two apart, so polling resumes only when it lists the pane.
    void control.resume()

    return paneView(kit, paneModelOf(state, columns, rows, nowMs), actionsOf(state, control), nowMs)
  })

  /** `/mods list` in the transcript, drawn as a table where the surface draws trees; any other row is the engine's. */
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (host === null || e.props.command !== COMMAND || !/^\s*(list|1)\b/i.test(e.props.args) || state.list.data === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const model = paneModelOf(state, 100, 40, await host.now())

    return (
      Box({
        flexDirection: 'column',
        children: [
          Text({ bold: true, children: `ruflo mods · ${model.freshness.word} · ${model.freshness.text}` }),
          ...model.rows_.map(row =>
            Text({ dimColor: !row.enabled, wrap: 'truncate-end', children: plain(`${row.enabled ? '●' : '○'} ${row.id} ${row.version} · ${row.scope} · installed ${row.installed === null ? '?' : row.installed ? 'yes' : 'no'} · resolvable ${row.resolvable === null ? '?' : row.resolvable ? 'yes' : 'no'} · ${row.verdict} · ${row.events ?? '?'} hooks`, 160) }),
          ),
        ],
      })
    )
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)

    if (e.id === PANE_ID && result.deny === undefined) {
      closed()
    }

    return result
  })
}
