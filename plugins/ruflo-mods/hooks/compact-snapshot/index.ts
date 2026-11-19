import type { On } from 'claude-code'

import { openIdLines } from '../compact/block'
import { under, type ModState } from '../state'
import { reloadBlock } from './reload'
import { buildSnapshot, MAX_SNAPSHOTS, pickSlot, slotPath } from './snapshot'

/**
 * Claude Code refuses a hooks module that registers one event twice without a matcher (#4485); compactCarry and the
 * always-on modules hold the bare registrations, so this module matches on a field each event carries. `precompute`
 * installs nothing (its result waits for the compaction that comes, which dispatches again), so it is not matched.
 */
const COMPACTING = /^(?:manual|auto|plugin)$/
const ANY = /^[\s\S]*$/

/**
 * Pre-compaction snapshot and one-shot post-compaction reload (ADR-505). On unless `compactSnapshot` is false, and
 * inert outside a ruflo project (no `.claude-flow/`).
 *
 * - `session.compact`, main loop only (`agentId` absent): writes the transcript about to be compacted to
 *   `.claude-flow/sessions/compactions/snapshot-<n>.jsonl` (role, text cut to 2,000 characters, tool names and ids;
 *   never tool inputs or outputs; each line screened), at most 400 messages and 2 MiB, ten slots, the oldest
 *   overwritten. The write runs beside the compaction: it is never blocked, delayed or rewritten, and a failed write
 *   is logged to debug and dropped.
 * - The next main-loop `prompt.submit` (not a slash command) after a compaction that stood gets one
 *   `[RUFLO_AFTER_COMPACT]` context block of at most 2,000 characters, then the flag clears.
 */
export function registerCompactSnapshot(on: On, state: ModState) {
  const s = state.snapshot
  s.enabled = true
  let project: boolean | undefined

  on('session.compact', { trigger: COMPACTING }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    project ??= await $.fs.stat(under(state, '.claude-flow')).then(stat => stat.kind === 'dir', () => false)
    if (project !== true) return next(e)

    // Built from the transcript as it stands before the compaction; written beside it, never in its way.
    let writing: Promise<string | undefined> = Promise.resolve(undefined)
    try {
      const snap = buildSnapshot(e.messages ?? [], new Date().toISOString(), String(e.trigger))
      const stats = Array.from({ length: MAX_SNAPSHOTS }, (_, n) => $.fs.stat(under(state, slotPath(n))).then(st => st.mtimeMs, () => undefined))
      writing = Promise.all(stats)
        .then(async mtimes => {
          const path = slotPath(pickSlot(mtimes))
          await $.fs.write(under(state, path), snap.text)
          return path
        })
        .catch((error: unknown) => {
          s.failed++
          try {
            $.ui.log(`ruflo mods: compaction snapshot not written (${String((error as Error)?.message ?? error)})`, { to: 'debug' })
          } catch {
            // a withheld ui.log changes nothing
          }
          return undefined
        })
    } catch {
      s.failed++
    }

    const result = await next(e)
    const path = await writing
    if (path) {
      s.written++
      s.lastPath = path
    } else s.lastPath = undefined
    // Only a compaction that stood lost anything: a skip leaves the conversation as it was.
    if (result && typeof result === 'object' && (result as { skip?: unknown }).skip === undefined) s.compacted = true
    return result
  }).catch(($, e, next) => next(e)) // fail open: the compaction always goes on

  on('prompt.submit', { text: ANY }, async ($, e, next) => {
    if (!s.compacted) return next(e)
    const text = typeof e.text === 'string' ? e.text : ''
    // A slash command or an empty prompt keeps the block for the next real one.
    if (text.trim() === '' || text.trimStart().startsWith('/')) return next(e)
    s.compacted = false
    const block = reloadBlock({
      lessons: state.loop.recentLessons,
      outcomes: state.loop.recentOutcomes,
      ids: await openIdLines({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) }, state.root),
      snapshotPath: s.lastPath,
    })
    if (!block) return next(e)
    s.reloaded++
    return next({ ...e, context: [...(e.context ?? []), block] })
  }).catch(($, e, next) => next(e)) // a broken reload never blocks a prompt
}
