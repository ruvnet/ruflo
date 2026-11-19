/**
 * Entry of `.claude/helpers/learning-loop.cjs` (ADR-512): the verified-outcome learning loop for classic hooks.
 *
 * Bundled by build-learning-loop-helper.mjs from the mod's own loop source (hooks/loop/transcript.ts and what it
 * imports), so a turn's outcome and a prompt's lessons are decided by one implementation on both paths. Loaded by
 * hook-handler.cjs: `route` records the turns that finished and prints the lessons for the new prompt; `session-end`
 * records the last turn. Every function swallows its own errors: a hook must never fail because learning did.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { appendLines, LESSONS_PATH, lessonsFor, replay, VERIFIED_PATH } from '../hooks/loop/transcript'

const STATE_PATH = '.claude-flow/data/classic-loop.json'
const LEDGER_PATH = '.claude-flow/data/verified-ingest.json'
/** Transcript bytes one call reads, at most: a hook has seconds, and a first look at a long session starts near its end. */
export const MAX_READ = 8 * 1024 * 1024
const MAX_LESSONS_FILE = 4 * 1024 * 1024
/** Sessions whose read offset the state file keeps (most recent). */
const MAX_SESSIONS = 50
const SESSION = /^[A-Za-z0-9_-]{1,64}$/
const OFF = /^(0|false|off|no)$/i

type State = { v: 1; sessions: Record<string, { offset: number; at: number }> }

/**
 * Whether the loop runs for this project: a ruflo project (`.claude-flow/`), not turned off by
 * `RUFLO_LEARNING_LOOP=0` or `"learningLoop": { "enabled": false }` in `.claude-flow/config.json`.
 */
export function enabled(root: string, env: Record<string, string | undefined> = process.env): boolean {
  if (OFF.test(env.RUFLO_LEARNING_LOOP ?? '')) return false
  if (!existsSync(join(root, '.claude-flow'))) return false
  try {
    const config = JSON.parse(readFileSync(join(root, '.claude-flow', 'config.json'), 'utf8')) as { learningLoop?: { enabled?: unknown } }
    if (config?.learningLoop?.enabled === false) return false
  } catch {
    // no config, or not JSON: the default (on)
  }
  return true
}

function readState(root: string): State {
  try {
    const raw = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8')) as State
    if (raw && raw.v === 1 && raw.sessions && typeof raw.sessions === 'object') return raw
  } catch {
    // missing or damaged: start over (the ingest ledger still trains each record id once)
  }
  return { v: 1, sessions: {} }
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

function readRange(path: string, from: number, to: number): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(to - from)
    let got = 0
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got)
      if (n === 0) break
      got += n
    }
    return buf.subarray(0, got).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Records the turns `transcriptPath` gained since the last call for `session` to
 * `.claude-flow/data/verified-trajectories.jsonl`. With `final`, the turn still open is recorded too.
 *
 * @returns the number of records written
 */
export function recordTurns(opts: { root: string; transcriptPath: unknown; session: unknown; final: boolean; agentFor: (prompt: string) => string; now?: number }): number {
  try {
    const { root } = opts
    if (typeof opts.transcriptPath !== 'string' || typeof opts.session !== 'string' || !SESSION.test(opts.session)) return 0
    if (!opts.transcriptPath.endsWith('.jsonl')) return 0
    const size = statSync(opts.transcriptPath).size
    const state = readState(root)
    const known = state.sessions[opts.session]
    // A transcript shorter than the offset was replaced: read it again from the start.
    let from = known && known.offset <= size ? known.offset : 0
    if (size - from > MAX_READ) from = size - MAX_READ
    if (from >= size) return 0

    const text = readRange(opts.transcriptPath, from, size)
    const now = opts.now ?? Date.now()
    const { lines, consumed } = replay(text, { base: from, session: opts.session, root, final: opts.final, agentFor: opts.agentFor, now })
    if (lines.length > 0) {
      const path = join(root, VERIFIED_PATH)
      let existing = ''
      try {
        existing = readFileSync(path, 'utf8')
      } catch (error) {
        // A file that exists but cannot be read is never overwritten: these turns are replayed next time.
        if ((error as { code?: unknown }).code !== 'ENOENT') return 0
      }
      writeAtomic(path, appendLines(existing, lines))
    }
    state.sessions[opts.session] = { offset: from + consumed, at: now }
    const keep = Object.entries(state.sessions).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_SESSIONS)
    writeAtomic(join(root, STATE_PATH), JSON.stringify({ v: 1, sessions: Object.fromEntries(keep) }))
    return lines.length
  } catch {
    return 0
  }
}

/** The lesson block for a prompt, or '' (no lessons file, none fits, or the file is bad). */
export function lessonsForPrompt(root: string, prompt: unknown): string {
  try {
    if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.trimStart().startsWith('/')) return ''
    const path = join(root, LESSONS_PATH)
    if (statSync(path).size > MAX_LESSONS_FILE) return ''
    return lessonsFor(prompt, readFileSync(path, 'utf8'))
  } catch {
    return ''
  }
}

/** Whether recorded turns are newer than the last ingest, so a detached `ruflo hooks verified-ingest` has work. */
export function ingestDue(root: string): boolean {
  try {
    const recorded = statSync(join(root, VERIFIED_PATH)).mtimeMs
    try {
      return recorded > statSync(join(root, LEDGER_PATH)).mtimeMs
    } catch {
      return true
    }
  } catch {
    return false
  }
}
