import type { On } from 'claude-code'

import { cachedFile, isMissing } from '../files'
import { routeTask } from '../route/route-task'
import { redraw, under, type ModState } from '../state'
import { lessonBlock, parseLessons, pick } from './lessons'
import { appendLines, line, LESSONS_PATH, MAX_PENDING, outcomeOf, start, step, VERIFIED_PATH } from './record'
import { relativePath } from './taint'
import { classify, verdict } from './verifier'

/**
 * Claude Code refuses a hooks module that registers one event twice without a matcher (#4485), and the always-on
 * modules hold the bare events, so this optional module matches every event on a field each one carries.
 */
const ANY = /^[\s\S]*$/

/**
 * The verified-outcome learning loop (#4581, ADR-502). Off unless the `learningLoop` option is on, and inert outside a
 * ruflo project (no `.claude-flow/`).
 *
 * - `prompt.submit` opens a trajectory for the main loop's turn and adds at most three cited lessons the CLI learned
 *   from verified outcomes (`learned-lessons.json`, gate 0.6).
 * - `tool.call` records one step per finished call; a recognised test/build/typecheck/lint Bash command records its
 *   exit status as a verifier run.
 * - `turn.complete` closes the trajectory: `verified-success`/`verified-failure` only from verifier runs after the
 *   last edit, otherwise `unknown`, and appends it to `verified-trajectories.jsonl` for `ruflo hooks verified-ingest`.
 *   A success carries taints (ADR-503 §2.1) when the turn edited a test or verifier config, or narrowed its check;
 *   the CLI never trains a tainted record by default.
 *
 * Observe-only: it never denies, rewrites or delays a tool call, never runs a process, and never calls a model or an
 * MCP tool (smoke step 4). Training happens in the CLI, which trains SONA on verified records only.
 */
export function registerLoop(on: On, state: ModState) {
  const loop = state.loop
  const lessons = cachedFile(() => under(state, LESSONS_PATH), parseLessons)

  loop.enabled = true

  on('prompt.submit', { text: ANY }, async ($, e, next) => {
    const text = typeof e.text === 'string' ? e.text : ''
    // Asked once per process, at the first prompt (session.root is settled by then): only a ruflo project records.
    loop.project ??= await $.fs.stat(under(state, '.claude-flow')).then(stat => stat.kind === 'dir', () => false)
    if (loop.project !== true || text.trim() === '' || text.trimStart().startsWith('/')) return next(e)

    loop.active = start(`vt-${Date.now().toString(36)}-${(++loop.counter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text, (state.lastRoute ?? routeTask(text)).agent, Date.now(), loop.session)

    const read = await lessons({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) })
    if (read.kind !== 'ok') return next(e)
    loop.belowGate = read.value.belowGate
    const chosen = pick(read.value, text)
    const block = lessonBlock(chosen)
    if (!block) return next(e)
    loop.lessonsShown += chosen.length
    loop.lastLesson = chosen[0]!.confidence
    redraw(state)
    return next({ ...e, context: [...(e.context ?? []), block] })
  }).catch(($, e, next) => next(e)) // a broken loop never blocks a prompt

  on('tool.call', { tool: ANY }, async ($, e, next) => {
    const result = await next(e)
    const t = loop.active
    // Main loop only: a subagent's calls are its own work, reported back as the Agent call's result.
    if (!t || e.agentId !== undefined || (result as { deny?: unknown } | undefined)?.deny !== undefined) return result

    const verifier = e.tool === 'Bash' ? classify((e as { command?: unknown }).command) : null
    // ADR-503 §2.1: an edit's file decides the edited-tests / edited-verifier-config taints (only the class is kept).
    const args = e as { file_path?: unknown; notebook_path?: unknown }
    const target = typeof args.file_path === 'string' ? args.file_path : typeof args.notebook_path === 'string' ? args.notebook_path : undefined
    step(t, e.tool, (result as { isError?: unknown }).isError !== true, verifier, verifier ? verdict(result) : null, target === undefined ? undefined : relativePath(state.root, target))
    return result
  })

  on('turn.complete', { turnId: ANY }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const t = loop.active
    loop.active = undefined
    // A turn that ran no tool (a plain answer) teaches nothing and is not recorded.
    if (t && t.steps.length > 0) {
      const json = line(t, e.isAborted === true, Date.now())
      const outcome = outcomeOf(json)
      loop.recorded[outcome === 'verified-success' ? 'success' : outcome === 'verified-failure' ? 'failure' : 'unknown']++
      loop.pending.push(json)
      if (loop.pending.length > MAX_PENDING) loop.dropped += loop.pending.splice(0, loop.pending.length - MAX_PENDING).length
      redraw(state)
    }
    await flush(path => $.fs.read(path), (path, text) => $.fs.write(path, text))
    return result
  })

  on('session.end', { reason: ANY }, async ($, e, next) => {
    await flush(path => $.fs.read(path), (path, text) => $.fs.write(path, text))
    return next(e)
  })

  /** Appends the waiting lines. A file that exists but cannot be read is never overwritten: the lines wait. */
  async function flush(read: (path: string) => Promise<string>, write: (path: string, text: string) => Promise<void>) {
    if (loop.pending.length === 0) return
    const lines = loop.pending.splice(0)
    try {
      const path = under(state, VERIFIED_PATH)
      const existing = await read(path).catch((error: unknown) => {
        if (isMissing(error)) return ''
        throw error
      })
      await write(path, appendLines(existing, lines))
    } catch {
      loop.pending.unshift(...lines)
    }
  }
}
