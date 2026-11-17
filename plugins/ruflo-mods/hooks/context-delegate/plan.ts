/**
 * Automatic context delegation (ADR-522): when to hand a large Read to a cheap worker. Pure, so the CLI's tests can check
 * these numbers against `DEFAULT_CONTEXT_LIMITS` in `@claude-flow/cli` (ADR-521).
 */
export type DelegationMode = 'off' | 'observe' | 'enforce'

/** Mirrors `DEFAULT_CONTEXT_LIMITS` (context-delegation.ts); a parity test fails if they drift. */
export const LIMITS = Object.freeze({ minInputBytes: 14_000, maxInputBytes: 120_000, maxOutputBytes: 8_000, maxFindings: 32, timeoutMs: 30_000 })
/** The worker's model: an alias the session resolves on its own credentials. */
export const WORKER_MODEL = 'haiku'
/** The prompt the worker answers against is cut here. */
export const MAX_QUESTION_CHARS = 2_000
/** Worker-written answers are untrusted text; each is cut here before the model sees it. */
export const MAX_ANSWER_CHARS = 400

/** Prompts that route here are reading to understand; every other route reads directly (ADR-521: only analysis delegates). */
const ANALYSIS_AGENTS = new Set(['researcher', 'reviewer'])
/** A prompt that asks for a change needs the exact file in context, whatever it routed to. */
const CHANGE = /\b(fix|fixes|change|edit|modify|update|refactor|implement|add|remove|delete|rename|write|create|build|debug|patch|replace|migrate|rewrite|move|convert)\b/i

export type ReadFacts = {
  readonly tool: string
  /** Set when the read is a subagent's: delegating there would nest workers. */
  readonly agentId?: string
  readonly hasRange: boolean
  readonly bytes: number
  readonly prompt: string
  readonly routedAgent?: string
  /** This path was already read or delegated this session. */
  readonly seen: boolean
}

export type Decision = { readonly route: 'direct' | 'delegate'; readonly reason: string }

export function decide(read: ReadFacts): Decision {
  if (read.tool !== 'Read') return { route: 'direct', reason: 'not-read' }
  if (read.agentId !== undefined) return { route: 'direct', reason: 'nested-worker' }
  if (read.hasRange) return { route: 'direct', reason: 'targeted-read' }
  if (read.seen) return { route: 'direct', reason: 'already-read' }
  if (read.bytes < LIMITS.minInputBytes) return { route: 'direct', reason: 'small-input' }
  if (read.bytes > LIMITS.maxInputBytes) return { route: 'direct', reason: 'input-limit' }
  if (!read.prompt.trim()) return { route: 'direct', reason: 'no-question' }
  if (CHANGE.test(read.prompt)) return { route: 'direct', reason: 'change-intent' }
  if (!read.routedAgent || !ANALYSIS_AGENTS.has(read.routedAgent)) return { route: 'direct', reason: 'not-analysis' }
  return { route: 'delegate', reason: 'bulk-analysis' }
}
