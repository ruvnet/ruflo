/**
 * The learning loop without the mod (ADR-512). Pure.
 *
 * Users on classic hooks (`ruflo init`, no `ruflo mods install`) have no in-process `tool.call` event, and their
 * settings carry no PostToolUse hook for Bash. What every hook does get is Claude Code's session transcript
 * (`transcript_path`), which holds each tool call and its result, including a Bash command's `is_error` on a
 * non-zero exit. So the classic `route` and `session-end` hooks replay the turns the transcript gained since they
 * last looked through the mod's own `start`/`step`/`line`, and show lessons through the mod's own `pick`. One source
 * decides an outcome and picks a lesson on both paths: the bundle `.claude/helpers/learning-loop.cjs` is built from
 * this file (`plugins/ruflo-mods/scripts/build-learning-loop-helper.mjs`).
 */

import { utf8Bytes } from '../compact-snapshot/snapshot'
import { lessonBlock, parseLessons, pick } from './lessons'
import { line, start, step } from './record'
import { relativePath } from './taint'
import { classify, verdict } from './verifier'

export { appendLines, LESSONS_PATH, VERIFIED_PATH } from './record'

/** One transcript line, as far as this file reads it. */
type Entry = {
  readonly type?: unknown
  readonly isSidechain?: unknown
  readonly isMeta?: unknown
  readonly isCompactSummary?: unknown
  readonly timestamp?: unknown
  readonly message?: { readonly content?: unknown }
  readonly toolUseResult?: unknown
}

type Block = { readonly type?: unknown; readonly text?: unknown; readonly id?: unknown; readonly name?: unknown; readonly input?: unknown; readonly tool_use_id?: unknown; readonly is_error?: unknown }

export type Replay = {
  /** Record lines for the turns that finished, oldest first (unknown outcomes included: the ingest counts them). */
  readonly lines: string[]
  /** Bytes of `text` consumed: up to the start of the turn still open, never into an unfinished last line. */
  readonly consumed: number
}

const INTERRUPTED = '[Request interrupted by user'

const blocks = (e: Entry): Block[] => (Array.isArray(e.message?.content) ? (e.message!.content as Block[]) : [])

/** The prompt text of a line the user typed, or null: tool results, meta lines, compaction summaries, interrupts and slash commands are not prompts. */
export function promptOf(e: Entry): string | null {
  if (e.type !== 'user' || e.isSidechain === true || e.isMeta === true || e.isCompactSummary === true) return null
  const content = e.message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) && !(content as Block[]).some(b => b.type === 'tool_result')
      ? (content as Block[]).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
      : null
  if (text === null) return null
  const trimmed = text.trimStart()
  if (trimmed === '' || trimmed.startsWith('/') || trimmed.startsWith('<') || trimmed.startsWith(INTERRUPTED)) return null
  return text
}

const time = (e: Entry, fallback: number): number => {
  const t = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN
  return Number.isFinite(t) ? t : fallback
}

/** The mod's tool-call result shape, rebuilt from a transcript result, for `verdict`. */
function resultOf(block: Block, extra: unknown): { isError: boolean; result: unknown } {
  return { isError: block.is_error === true, result: extra && typeof extra === 'object' ? extra : {} }
}

/**
 * Replays the turns in `text`, the transcript read from byte `base`. A turn opens at a typed prompt and closes at the
 * next one, so the last turn stays open (not consumed) unless `final` (the session ended). A last line without its
 * newline is still being written and is never consumed. Lines that do not parse are skipped.
 *
 * @param agentFor the agent the router names for a prompt (the classic router, so records key like the mod's)
 * @param root the project root, to make edited paths project-relative
 */
export function replay(text: string, opts: { base: number; session: string; root: string; final: boolean; agentFor: (prompt: string) => string; now: number }): Replay {
  const lines: string[] = []
  type Open = { t: ReturnType<typeof start>; aborted: boolean; last: number; at: number }
  let open: Open | null = null
  const calls = new Map<string, { tool: string; input: Record<string, unknown> }>()
  const close = () => {
    if (open && open.t.steps.length > 0) lines.push(line(open.t, open.aborted, open.last))
    open = null
    calls.clear()
  }

  const raws = text.split('\n')
  // The segment after the last newline is either empty or a line still being written.
  raws.pop()
  let pos = 0
  for (const raw of raws) {
    const at = pos
    pos += utf8Bytes(raw) + 1
    if (!raw.trim()) continue
    let e: Entry
    try {
      e = JSON.parse(raw) as Entry
    } catch {
      continue
    }
    if (!e || typeof e !== 'object' || e.isSidechain === true) continue
    const prompt = promptOf(e)
    if (prompt !== null) {
      close()
      const when = time(e, opts.now)
      // The id is the prompt's byte position in this session's transcript, so replaying the same turn twice writes
      // the same id, and the ingest ledger (which remembers ids) trains it once.
      const id = `vt-c${opts.session.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}-${(opts.base + at).toString(36)}`
      open = { t: start(id, prompt, opts.agentFor(prompt), when, opts.session), aborted: false, last: when, at }
      continue
    }
    const turn = open as Open | null
    if (!turn) continue
    turn.last = time(e, turn.last)
    for (const b of blocks(e)) {
      if (e.type === 'assistant' && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        calls.set(b.id, { tool: b.name, input: b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {} })
      } else if (e.type === 'user' && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const call = calls.get(b.tool_use_id)
        if (!call) continue
        calls.delete(b.tool_use_id)
        const command = call.tool === 'Bash' ? call.input.command : undefined
        const verifier = call.tool === 'Bash' ? classify(command) : null
        const target = typeof call.input.file_path === 'string' ? call.input.file_path : typeof call.input.notebook_path === 'string' ? call.input.notebook_path : undefined
        // A run sent to the background has no exit status yet, whatever its result line says.
        const status = verifier && call.input.run_in_background !== true ? verdict(resultOf(b, e.toolUseResult)) : null
        step(turn.t, call.tool, b.is_error !== true, verifier, status, target === undefined ? undefined : relativePath(opts.root, target), command)
      } else if (e.type === 'user' && b.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPTED)) {
        turn.aborted = true
      }
    }
  }

  const still = open as Open | null
  if (opts.final || still === null) {
    close()
    return { lines, consumed: pos }
  }
  return { lines, consumed: still.at }
}

/** The lesson block for a prompt from the text of `learned-lessons.json`, or '' (none fits, or the file is bad). */
export function lessonsFor(prompt: string, lessonsText: string): string {
  try {
    return lessonBlock(pick(parseLessons(lessonsText), prompt)) ?? ''
  } catch {
    return ''
  }
}
