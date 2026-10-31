/**
 * Verified lessons for the prompt (#4581, ADR-502). Pure.
 *
 * `.claude-flow/data/learned-lessons.json` is written by the CLI ingest from
 * SONA patterns that verified outcomes trained. It is a project file, so it
 * is untrusted: every field is validated to a fixed shape, and a block that
 * fails the secret or injection screen is dropped whole.
 */

import { scan } from '../guidance/screen'
import { lessonFile } from './record'

/** The SONA routing gate; a file cannot lower it. */
export const GATE = 0.6
/** Lessons added to one prompt, at most. */
export const MAX_PER_PROMPT = 3
const MAX_LESSONS = 50
/** ADR-511: files one lesson names, at most. */
export const MAX_FILES_SHOWN = 3

export type Lesson = {
  readonly id: string
  readonly kind: 'lesson' | 'caution'
  readonly agent: string
  readonly keywords: readonly string[]
  readonly confidence: number
  readonly successes: number
  readonly failures: number
  readonly evidence: string
  /** ADR-511: files the passing fixes edited, most often first; empty for a caution or an older file. */
  readonly files: readonly string[]
}

export type Lessons = { readonly gate: number; readonly lessons: readonly Lesson[]; readonly belowGate: number }

const WORD = /^[a-z0-9][a-z0-9 _./-]{0,40}$/
const AGENT = /^[a-z][a-z0-9-]{0,40}$/
/** The CLI cites a lesson by a hash of its SONA pattern key (`lessonId` in verified-outcomes.ts), never the key itself. */
const ID = /^L-[a-f0-9]{10}$/
const EVIDENCE = /^[A-Za-z0-9 ._:/=@+-]{1,80}$/
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1_000_000) : 0)

/** The file's text, validated. Throws on JSON that is not an object (cachedFile reports it as unreadable). */
export function parseLessons(text: string): Lessons {
  const raw = JSON.parse(text) as { version?: unknown; gate?: unknown; lessons?: unknown; belowGate?: unknown }
  if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('learned-lessons.json: not version 1')
  const gate = typeof raw.gate === 'number' && raw.gate >= GATE && raw.gate < 1 ? raw.gate : GATE
  const lessons: Lesson[] = []
  for (const item of Array.isArray(raw.lessons) ? raw.lessons.slice(0, MAX_LESSONS) : []) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    const confidence = typeof l.confidence === 'number' && l.confidence >= 0 && l.confidence <= 1 ? l.confidence : -1
    const keywords = Array.isArray(l.keywords) ? l.keywords.filter((k): k is string => typeof k === 'string' && WORD.test(k)).slice(0, 10) : []
    if (typeof l.id !== 'string' || !ID.test(l.id) || typeof l.agent !== 'string' || !AGENT.test(l.agent) || keywords.length === 0 || confidence < 0) continue
    if (l.kind !== 'lesson' && l.kind !== 'caution') continue
    // A lesson below the gate never reaches a prompt, whatever the file says.
    if (l.kind === 'lesson' && confidence < gate) continue
    const evidence = typeof l.evidence === 'string' && EVIDENCE.test(l.evidence) ? l.evidence : ''
    // ADR-511: the same screen the recorder applies; a path that fails it is dropped, never shown.
    const files = l.kind === 'lesson' && Array.isArray(l.files) ? l.files.filter((f): f is string => typeof f === 'string' && lessonFile(f)).slice(0, MAX_FILES_SHOWN) : []
    lessons.push({ id: l.id, kind: l.kind, agent: l.agent, keywords, confidence, successes: count(l.successes), failures: count(l.failures), evidence, files })
  }
  return { gate, lessons, belowGate: count(raw.belowGate) }
}

const words = (text: string) => new Set(text.toLowerCase().split(/[\s\-_.,;:!?'"()\[\]{}]+/).filter(Boolean))

/** Whether the prompt says a keyword: as a word, or (for one with a space or slash) as a phrase. */
const says = (said: Set<string>, lower: string, keyword: string) => said.has(keyword) || (/[ /]/.test(keyword) && lower.includes(keyword))

/** ADR-511: a lesson scoring under this share of the best match is left out (it matched on words every task says). */
export const MIN_SHARE_OF_BEST = 0.5

/**
 * The lessons that share a keyword with the prompt, best first: the matched
 * share of the lesson's keywords times its confidence. ADR-511: each keyword
 * is weighted by how rare it is among the lessons (inverse document
 * frequency), so words every lesson has ("test", "fix") barely count. At most
 * three, and none far below the best.
 */
export function pick(file: Lessons, prompt: string): Lesson[] {
  const said = words(prompt)
  const lower = prompt.toLowerCase()
  const df = new Map<string, number>()
  for (const l of file.lessons) for (const k of new Set(l.keywords)) df.set(k, (df.get(k) ?? 0) + 1)
  const weight = (k: string) => Math.log((file.lessons.length + 1) / (df.get(k) ?? 1))
  const sum = (ks: readonly string[]) => ks.reduce((a, k) => a + weight(k), 0)
  const scored = file.lessons
    .map(l => {
      const matched = l.keywords.filter(k => says(said, lower, k))
      return { l, overlap: matched.length, score: (sum(matched) / sum(l.keywords)) * l.confidence }
    })
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.score - a.score)
  const best = scored[0]?.score ?? 0
  return scored
    .filter(x => x.score >= best * MIN_SHARE_OF_BEST)
    .slice(0, MAX_PER_PROMPT)
    .map(x => x.l)
}

/** The context block for the model; null when nothing applies or the block fails the screen. */
export function lessonBlock(chosen: readonly Lesson[]): string | null {
  if (chosen.length === 0) return null
  const lines = chosen.map(l => {
    const tag = `[${l.kind} ${l.id} conf ${l.confidence.toFixed(2)}, ${l.successes} passed / ${l.failures} failed]`
    const check = l.evidence ? ` \`${l.evidence}\`` : ' verification'
    if (l.kind === 'caution') return `- ${tag} tasks about ${l.keywords.join(', ')} failed${check} ${l.failures} times: check that first`
    // ADR-511: a lesson that knows where the passing fixes went leads with it; the model skims a keyword list.
    if (l.files.length) return `- ${tag} verified fixes for tasks like this (${l.keywords.join(', ')}) edited ${l.files.map(f => `\`${f}\``).join(', ')}: look there first. They passed${check}.`
    return `- ${tag} tasks about ${l.keywords.join(', ')} went to ${l.agent} and passed${check}`
  })
  const block = ['[RUFLO_LESSONS] From this project\'s own test/build exit status (never a model\'s claim of success). Advisory only:', ...lines].join('\n')
  const found = scan(block)
  return found.secrets.length || found.injection.length ? null : block
}
