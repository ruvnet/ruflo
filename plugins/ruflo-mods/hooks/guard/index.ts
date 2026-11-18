import type { On } from 'claude-code'

import { cachedFile, type Read } from '../files'
import type { GuidanceHooks } from '../guidance'
import { redraw, under, type ModState } from '../state'
import { dangerousCommandVerdict } from './dangerous-command'
import { parseProjection, policyOpinion, PROJECTION_PATH, type Projection } from './policy'
import { researchCheck, WEB_TOOLS } from './research'
import { isFinal, stricter, type Verdict } from './verdict'

/**
 * What `tool.check` answers when ruflo's own check could not run. Only a
 * person may approve it (2.1.304 `decider`): a classifier or auto mode must
 * not wave through a call ruflo failed to judge.
 */
export const CHECK_FAILED: Verdict = {
  decision: 'ask',
  reason: 'ruflo: its policy check could not run, so this call is put to you instead of allowed',
  decider: 'person',
}

/**
 * How long a read-only call trusts the last full check's "no policy projection
 * here" before it stats the file again. A projection written meanwhile is seen
 * by the next call that is not read-only, or by any call once this has passed.
 */
export const FAST_PATH_TTL_MS = 2_000

/** The `tool.check` fields the guard reads (2.1.290 `agentId`, 2.1.304 `isReadOnly`); hosts before them send neither. */
export type CheckFacts = { readonly tool?: unknown; readonly input?: unknown; readonly isReadOnly?: unknown; readonly agentId?: unknown }

/** Which way a check goes: nothing left to tighten, the read-only fast path, or the full check. */
export type CheckPath = 'final' | 'read-only' | 'full'

/**
 * `final` when the chain already denies (nothing is stricter); `read-only`
 * when the host marked the call read-only, it is not a web tool (the research
 * guard, ADR-440, asks on those), and a full check found no projection less
 * than FAST_PATH_TTL_MS ago; `full` otherwise. Only a literal `true` counts.
 */
export function checkPath(e: CheckFacts, chain: Verdict, absentUntil: number, now: number): CheckPath {
  if (isFinal(chain)) return 'final'
  const tool = typeof e.tool === 'string' ? e.tool : ''
  if (e.isReadOnly === true && !WEB_TOOLS.has(tool) && now < absentUntil) return 'read-only'
  return 'full'
}

const AGENT_ID = /^[A-Za-z0-9_.:-]{1,64}$/

/** Names the subagent on ruflo's own reason, so the person sees which agent asked; a malformed id is left out. */
export function forAgent(verdict: Verdict, agentId: unknown): Verdict {
  if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) return verdict
  return { ...verdict, reason: `${verdict.reason ?? 'ruflo'} (subagent ${agentId})` }
}

/**
 * Ruflo's opinion on one call, from the dangerous-command list and the read
 * policy projection; `observed` is set when observe mode would have acted.
 */
export function opinionOf(
  state: ModState,
  read: Read<Projection>,
  tool: string,
  input: unknown,
): { verdict?: Verdict; observed?: string } {
  const danger = dangerousCommandVerdict(tool, input)
  if (danger) return { verdict: danger }

  if (read.kind === 'absent') {
    state.policy = 'none'
    return {}
  }
  if (read.kind === 'error') {
    // The CLI writes a projection only where policy is in force: one that
    // exists and cannot be read fails closed, by one step.
    state.policy = 'unreadable'
    return { verdict: { ...CHECK_FAILED, reason: `ruflo: policy projection unreadable (${read.message}); asking instead of allowing` } }
  }
  state.policy = read.value.mode
  const { verdict, wouldBe } = policyOpinion(read.value, tool, input)
  return wouldBe ? { observed: wouldBe } : { verdict }
}

/**
 * `tool.check`: tighten only. The chain runs first (engine rules, mode, the
 * PreToolUse hooks, every plugin beneath); ruflo's opinion is merged with
 * `stricter`, so an allow may become an ask or a deny and nothing ever
 * becomes looser. The dangerous-command list always applies; ruflo policy
 * applies when the CLI projected rules for Claude Code tools. A chain deny
 * and a read-only call with no projection skip the file reads (checkPath).
 */
export function registerGuard(on: On, state: ModState, guidance?: GuidanceHooks) {
  const projection = cachedFile(() => under(state, PROJECTION_PATH), parseProjection)
  const research = researchCheck(state)
  // Until when a read-only call may skip the projection stat: set by a full check that found none.
  let absentUntil = 0

  on('tool.check', async ($, e, next) => {
    const task = guidance?.active()
    const chain = await next(e)
    const tool = typeof e.tool === 'string' ? e.tool : ''
    const route = checkPath(e, chain, absentUntil, Date.now())
    if (route !== 'full') {
      // The dangerous-command list is pure and always applies; only the file reads are skipped.
      const danger = route === 'read-only' ? dangerousCommandVerdict(tool, e.input) : undefined
      const merged = danger ? stricter(chain, forAgent(danger, e.agentId)) : chain
      if (merged !== chain) {
        state.tightened++
        redraw(state)
      }
      guidance?.check(task, merged.decision)
      return merged
    }
    const read = await projection({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) })
    absentUntil = read.kind === 'absent' ? Date.now() + FAST_PATH_TTL_MS : 0
    const { verdict, observed } = opinionOf(state, read, tool, e.input)
    if (observed) {
      state.observed++
      try {
        $.ui.log(`ruflo policy (observe): ${tool} ${observed}`, { to: 'debug' })
      } catch {
        // a refused log never turns an observation into a failure
      }
    }
    // The research guard (ADR-440) sees what ruflo's own opinion left standing.
    const ours = stricter(chain, verdict && forAgent(verdict, e.agentId))
    const merged = await research({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) }, tool, ours)
    if (merged !== chain) {
      state.tightened++
      redraw(state)
    }
    guidance?.check(task, merged.decision)
    return merged
  }).catch(async ($, e, next) => {
    // Since 2.1.301 this runs only when the hook above threw or timed out: ruflo
    // could not judge. Fail closed by one step: the chain's verdict stands where
    // it is already ask or deny; an allow is put to the person.
    const chain = await next(e).catch(() => undefined)
    const failed = forAgent(CHECK_FAILED, e.agentId)
    const result = chain ? stricter(chain, failed) : failed
    guidance?.check(guidance.active(), result.decision)
    return result
  })
}
