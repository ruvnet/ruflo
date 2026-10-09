/**
 * Runs what the person asked for: a palette entry, a claims button, an approval. A change waits for a confirm (y, or
 * `/ruflo yes`) and then runs one fixed argv through the ruflo CLI, after which the disk is re-read to say whether it
 * took; a read runs at once and shows what it printed. Nothing reaches `$` but through the Host.
 */
import { LONG_TEXT_MAX } from './full-text'
import { textRefusal } from './ops'
import type { ActionSpec } from './actions'
import { rememberKey } from './remember'
import { record } from './data/events'
import { plain } from './data/parse'
import type { Host } from './host'
import { labLines } from './mh-lab'
import { outputLines } from './ops'
import { filterPalette, paletteEntries, textOfQuery, type PaletteEntry } from './palette'
import { COLD_TIMEOUT_MS, explainFailure, FIRST_RUN_LABEL, forgetLauncher, resolveLauncher } from './launcher'
import type { Pending, State } from './state'
import { prettyLines } from './result-lines'

export const PENDING_TTL_MS = 30_000

export type RunnerDeps = {
  /** A read of the disk that starts after this call. */
  freshRead: () => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  command: (name: 'refresh' | 'help' | 'close') => void
  /** Why an ask of Claude's that landed after its tool call returned (it was screened first) may no longer be queued: the level was lowered, or Stop pressed, meanwhile. Null when it still may. */
  landingRefusal?: (pending: Pending) => string | null
}

export type Runner = {
  ask: (spec: ActionSpec | null, why: string) => void
  /** `seen` is the id of the card the person said Yes to: when another card took its place meanwhile, nothing runs and the new card stays (ADR-450 T17). */
  confirm: (seen?: number) => Promise<void>
  cancel: () => void
  runEntry: (entry: PaletteEntry, text: string) => void
  /** `exact` (the model path, ADR-450 T13) resolves the id as written and never falls back to fuzzy matching. */
  runById: (id: string, text: string, options?: { exact?: boolean }) => boolean
  /** Resolves when the read started last has finished: `/ruflo run` waits on it to answer with what it printed. */
  settled: () => Promise<void>
  /** Resolves when the last action that brought its own `run` (and is not awaited by `confirm`) has finished: the model tools wait on it, with a limit. */
  finished: () => Promise<void>
}

export function createRunner(state: State, host: Host, deps: RunnerDeps): Runner {
  let pendingSpec: ActionSpec | null = null
  let asks = 0
  let inflight: Promise<void> = Promise.resolve()
  let background: Promise<void> = Promise.resolve()

  const say = (label: string, ok: boolean, detail: string, lines?: string[]) => {
    state.outcome = { label, ok, verified: 'n/a', detail, atMs: Date.now(), ...(lines !== undefined && { lines }) }
    host.invalidate()
  }

  async function execute(spec: ActionSpec): Promise<void> {
    // A harness run reports into the terminal and may take minutes: it does not hold the other buttons.
    if (spec.run !== undefined) {
      const running = spec.run()

      background = running.then(() => undefined, () => undefined)

      // A read that runs its own command (a skills search) is waited on, so `/ruflo run` answers with what it found.
      if (spec.isReadOnly === true) await running

      return
    }

    // The x.ruv.io board keeps its own result panel, so its runs never show in the MetaHarness lab.
    const panel = spec.board === 'xruv' ? state.xruv : state.lab

    let lastArgv: readonly string[] = spec.argv ?? []

    state.isActing = true
    if (spec.lab !== undefined) panel.running = { id: spec.lab, label: spec.label, startedAtMs: Date.now() }
    host.invalidate()

    try {
      // A CLI action picks its launcher once per session; a cold npx download gets a long limit and says it is a first run.
      const launcher = spec.argv === undefined ? await resolveLauncher(host, state) : null
      const argv = spec.argv ?? [...(launcher?.prefix ?? []), ...spec.args]
      const isCold = launcher?.kind === 'cold'

      lastArgv = argv

      if (isCold) say(spec.label, true, FIRST_RUN_LABEL)
      const result = await host.run(argv, isCold ? Math.max(spec.timeoutMs ?? 0, COLD_TIMEOUT_MS) : spec.timeoutMs ?? 90_000, spec.stdin)

      if (result.exitCode !== 0) forgetLauncher(state)
      const answer = /"success"\s*:\s*(true|false)/.exec(result.stdout)?.[1]
      const error = /"error"\s*:\s*"([^"]{0,160})"/.exec(result.stdout)?.[1] ?? /\[ERROR\]\s*(.{0,160})/.exec(result.stdout)?.[1]
      // `mcp exec` wraps a tool's failure as `"isError": true` with its message escaped inside: that is a failure too.
      const ok = result.exitCode === 0 && answer !== 'false' && error === undefined && !/"isError"\s*:\s*true/.test(result.stdout)

      // A lab run's output goes to the lab's result panel, scrolled from its top; the footer keeps the one-line outcome.
      if (spec.lab !== undefined) {
        panel.result = { id: spec.lab, label: spec.label, ok, exitCode: result.exitCode, ...(spec.note !== undefined && { note: spec.note }), lines: prettyLines(spec.read?.(result.stdout, result.stderr, ok) ?? (spec.lines ?? ((out, err) => labLines(spec.lab ?? '', out, err)))(result.stdout, result.stderr)), atMs: Date.now() }
        state.select.item = 0
      }
      // Keyed on the exit, not on `ok`: relay text in a read may carry an "error" key of its own.
      if (result.exitCode === 0) spec.onOutput?.(result.stdout)

      if (spec.isReadOnly === true) {
        say(spec.label, ok, ok ? 'the ruflo CLI answered:' : explainFailure(argv, result) ?? (plain(error ?? result.stderr, 160) || `exit ${result.exitCode}`), spec.lab === undefined ? outputLines(result.stdout) : undefined)

        return
      }

      await deps.freshRead()

      const verified = spec.verifyLocal !== undefined
        ? ok && await spec.verifyLocal(host) ? 'yes' : 'no'
        : spec.verify === undefined || state.snapshot === null ? 'n/a' : spec.verify(state.snapshot) ? 'yes' : 'no'

      state.outcome = {
        label: spec.label,
        ok: ok && verified !== 'no',
        verified,
        detail: ok ? `${spec.argv === undefined ? 'ruflo' : 'the command'} answered ok; expected ${spec.expect}` : explainFailure(argv, result) ?? (plain(error ?? result.stderr, 160) || `exit ${result.exitCode}`),
        atMs: Date.now(),
      }
    } catch (error) {
      forgetLauncher(state)

      const why = explainFailure(lastArgv, { error }) ?? (plain(error instanceof Error ? error.message : String(error), 160) || 'refused')

      if (spec.lab !== undefined) panel.result = { id: spec.lab, label: spec.label, ok: false, exitCode: null, ...(spec.note !== undefined && { note: spec.note }), lines: [why], atMs: Date.now() }
      say(spec.label, false, why)
    } finally {
      state.isActing = false
      panel.running = null
      host.invalidate()
    }
  }

  function ask(spec: ActionSpec | null, why: string): void {
    state.palette.isOpen = false
    // Where this came from: the page puts the confirm and the answer right after that element. A headless run has no press, so it falls back to the top.
    state.origin = state.lastPressed
    state.lastPressed = null

    if (spec === null) {
      pendingSpec = null
      state.pending = null
      say('nothing to do', false, why)

      return
    }

    // Claude's call is held to the gate, whatever the entry says about itself: a "read-only" entry that declares it spends, writes or reaches the
    // network is queued for the level, budget and confirm checks (callTool), not run (#3815). The person's own click is unchanged.
    const byModel = spec.byModel === true || state.control.viaModel
    const isActingForModel = byModel && spec.isReadOnly === true && spec.declared !== undefined

    if (spec.isReadOnly === true && !isActingForModel) {
      inflight = execute(spec)

      return
    }

    // Claude's ask never replaces what the person has waiting: their Yes would run Claude's action instead of the one they read (ADR-450 T17).
    if (byModel && state.pending !== null) {
      say('not queued', false, `an action is already waiting for the person ("${plain(state.pending.label, 80)}"): Claude's request was dropped`)

      return
    }

    // A kind of action the person said never to ask about again runs now, its label saying so. That answer is the person's: an action
    // Claude asked for (ADR-444) still goes through the pending path, where the control level and the confirm mode decide.
    const kind = rememberKey(spec)

    if (kind !== null && state.allowed.has(kind) && !byModel) {
      inflight = execute({ ...spec, label: `${spec.label} (remembered: not asked)` })

      return
    }

    asks += 1

    const pending: Pending = { id: asks, view: state.view, ...(kind !== null && { rememberKey: kind }), ...(spec.scope !== undefined && { scope: spec.scope }), label: spec.label, args: spec.args, expect: spec.expect, askedAtMs: Date.now(), source: byModel ? 'claude' : 'you', ...(spec.shows !== undefined && { shows: spec.shows }), ...(spec.note !== undefined && { note: spec.note }), ...(spec.declared !== undefined && { declared: spec.declared }) }

    // Claude's ask that was screened first lands after every tool call of Claude's returned, so no call is left to gate it: the level and Stop are
    // checked now, not as they were when it was raised, and a refused ask is not queued (nothing waits for a Yes the settings no longer allow).
    // While a call runs, that call's settlePending gates the ask with the same rules.
    if (spec.byModel === true && state.control.activeCalls === 0) {
      const refused = state.control.paused ? 'the person took control back' : deps.landingRefusal?.(pending) ?? null

      if (refused !== null) {
        say(spec.label, false, `Claude's ask was not queued: ${refused}`)

        return
      }
    }

    pendingSpec = spec
    state.pending = pending
    host.invalidate()
  }

  async function confirm(seen?: number): Promise<void> {
    // The Yes answers the card the person read. Another card (the person's own, or Claude's) may have taken its place before the press landed:
    // that Yes runs nothing, and the new card stays to be read.
    if (seen !== undefined && state.pending !== null && state.pending.id !== seen) {
      say(state.pending.label, false, 'the card changed before your Yes: read the new one, then answer it')
      record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `a Yes for card ${seen} was ignored: card ${state.pending.id ?? '?'} ("${plain(state.pending.label, 60)}") is waiting now` }])

      return
    }

    // A card Claude raised is run only if Claude may still ask for it: a level lowered (or Stop pressed) after the card went up wins over the
    // Yes, which would otherwise run something the settings no longer allow Claude to start. The person can run it themselves from the palette.
    const claudes = state.pending?.source === 'claude' ? deps.landingRefusal?.(state.pending) ?? (state.control.paused ? 'the person took control back' : null) : null

    if (claudes !== null && state.pending !== null) {
      const label = state.pending.label

      pendingSpec = null
      state.pending = null
      say(label, false, `not run: ${claudes}. Run it from the palette yourself if you want it`)
      record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `Claude's card "${plain(label, 60)}" was not run: ${claudes}` }])

      return
    }

    const spec = pendingSpec
    const isFresh = state.pending !== null && Date.now() - state.pending.askedAtMs < PENDING_TTL_MS

    const waitedMs = state.pending === null ? 0 : Date.now() - state.pending.askedAtMs

    pendingSpec = null
    state.pending = null

    if (spec === null || !isFresh || state.isActing) {
      if (spec !== null && !isFresh) {
        say(spec.label, false, 'the confirm came more than 30 s after the ask; ask again')
        // `say` is one slot that the next action overwrites; the event stays in the feed (ADR-448 §3.2).
        record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `confirm for "${plain(spec.label, 60)}" came ${Math.round(waitedMs / 1000)}s after the ask and was not run (${PENDING_TTL_MS / 1000}s window)` }])
      }

      host.invalidate()

      return
    }

    await execute(spec)
  }

  function cancel(): void {
    pendingSpec = null
    state.pending = null
    host.invalidate()
  }

  function runEntry(entry: PaletteEntry, text: string): void {
    state.palette.isOpen = false

    switch (entry.run.kind) {
      case 'spec':
        ask(entry.run.spec, entry.run.why)
        break
      case 'text': {
        // Over every limit: refused with the exact count, before anything runs; the palette keeps the text (ADR-481).
        const tooLong = textRefusal(text, 'the text', LONG_TEXT_MAX)

        if (tooLong !== null) {
          state.palette.isOpen = true
          say('text too long', false, tooLong)
          break
        }

        const spec = entry.run.make(text)
        // A command argument carries less than a prompt: when the entry refused only for that, say by how much.
        const argvWhy = spec === null ? textRefusal(text) : null

        ask(spec, argvWhy ?? entry.run.why?.(text) ?? `type "${entry.run.keyword} <text>"; text may not start with -`)
        break
      }
      case 'view':
        deps.setView(entry.run.view)
        break
      case 'drill':
        deps.drill(entry.run.agentId)
        break
      case 'command':
        deps.command(entry.run.name)
        break
    }

    host.invalidate()
  }

  /** A palette entry by its id (`/ruflo run <id> [text]`, an approval's button): false when there is none now. */
  function runById(id: string, text: string, options: { exact?: boolean } = {}): boolean {
    const entries = paletteEntries(state, Date.now())
    const entry = entries.find(candidate => candidate.id === id) ?? (text === '' || options.exact === true ? undefined : filterPalette(entries, `${id} ${text}`, 'all')[0])

    if (entry === undefined) return false

    runEntry(entry, entry.run.kind === 'text' ? textOfQuery(`${id} ${text}`, entry.run.keyword) : text)

    return true
  }

  return { ask, confirm, cancel, runEntry, runById, settled: () => inflight, finished: () => background }
}
