import type { On } from 'claude-code'

import { cachedFile, isMissing } from '../files'
import type { ModOptions } from '../options'
import { redraw, under, type ModState } from '../state'
import {
  apiErrorText, appendLines, ATTRIBUTION_PATH, attributionLine, createAttribution, isBudgetRefusal, noteCost, noteSpawn, noteTool, resetAttribution,
} from './attribution'
import { alertLevel, isRaised, type BudgetLevel } from './budget'
import { BUDGET_PATH, ladderWindow, parseBudget, type BudgetWindow } from './file'

/** Matches every value of a field each event carries (#4485: the always-on modules hold the bare registrations). */
const ANY = /^[\s\S]*$/

/**
 * ruflo-cost-tracker's budget ladder on the session's live cost:
 * `session.measure` pushes the figure after each turn, so no transcript parse
 * and no node spawn. Crossing a rung up says so once. With `costHardStop`,
 * the HARD_STOP rung does what budget.mjs recommends at 100%: new subagent
 * spawns are refused (a deny on `agent.spawn`; tightening only).
 *
 * With `costLedger` (ADR-508), in a ruflo project:
 * - when `costBudgetUsd` is off, the ladder takes its limit from the shared
 *   budget file `.claude-flow/cost/budget.json` (its smallest window) and
 *   names that window; the file's `hardStop` acts as `costHardStop`;
 * - each cost delta is charged to the subagent type and the tool that ran
 *   just before it, and one line per session goes to
 *   `.claude-flow/cost/attribution.jsonl` for `ruflo cost report`;
 * - a turn that ends on a gateway's budget refusal is toasted once and counted.
 *   Nothing retries or changes model: that is the gateway's fallback.
 */
export function registerCost(on: On, state: ModState, options: ModOptions) {
  const optionLimit = options.costBudgetUsd
  const ledger = options.costLedger
  if (optionLimit === undefined && !ledger) return
  const file = cachedFile(() => under(state, BUDGET_PATH), parseBudget)
  const attribution = createAttribution()
  let fileWindow: BudgetWindow | undefined
  let fileHardStop = false
  let announced: BudgetLevel = 'OK' // the highest rung told this session; a fall and a second rise stay quiet
  let project: boolean | undefined
  const limitNow = () => optionLimit ?? fileWindow?.usd
  const reset = () => ({ level: 'OK' as const, ...(limitNow() !== undefined ? { limit: limitNow() } : {}) })
  state.budget = reset()

  // The budget is per session. /clear ends one (session.end, reason clear; no
  // session.start follows) and the process goes on with the next one's cost
  // counted from zero, so the ladder and the hard stop start over. Registered
  // after the rollup, which records this session's rung before this runs.
  on('session.end', { reason: /^clear$/ }, ($, e, next) => {
    announced = 'OK'
    state.budget = reset()
    redraw(state)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    const usd = e.cost?.usd
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return result
    if (ledger) noteCost(attribution, usd)

    if (optionLimit === undefined) {
      // The ladder's limit from the shared budget file: one stat per measurement, a read only when it changed.
      const read = await file({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) })
      fileWindow = read.kind === 'ok' ? ladderWindow(read.value) : undefined
      fileHardStop = read.kind === 'ok' && read.value.hardStop
    }
    const limit = limitNow()
    if (limit === undefined) {
      state.budget = { level: 'OK' }
      return result
    }

    const level = alertLevel(usd / limit)
    const raised = isRaised(announced, level)
    if (raised) announced = level
    state.budget = { level, usd, limit }
    if (isRaised(state.rollup.rung, level)) state.rollup.rung = level // the session rollup keeps the highest rung reached
    if (raised) {
      const window = optionLimit === undefined && fileWindow ? ` (${fileWindow.period} window)` : ''
      // INFO and WARNING are heads-up; CRITICAL and HARD_STOP are errors, which the toast policy never drops (ADR-477).
      await state.say({ level: level === 'INFO' ? 'info' : level === 'WARNING' ? 'warn' : 'error', text: `ruflo budget ${level}: $${usd.toFixed(2)} of $${limit.toFixed(2)} this session${window}`, timeoutMs: 8000 })
      redraw(state)
    }
    return result
  })

  if ((optionLimit !== undefined && options.costHardStop) || ledger) {
    on('agent.spawn', async ($, e, next) => {
      const halt = options.costHardStop || (optionLimit === undefined && fileHardStop)
      if (halt && state.budget.level === 'HARD_STOP' && state.budget.limit !== undefined) {
        return { deny: `ruflo budget: $${(state.budget.usd ?? 0).toFixed(2)} of $${state.budget.limit.toFixed(2)} spent; new agents are halted (${options.costHardStop ? 'costHardStop' : 'budget.json hardStop'})` }
      }
      const result = await next(e)
      if (ledger) noteSpawn(attribution, (result as { agentId?: unknown } | undefined)?.agentId, e.subagentType)
      return result
    })
  }

  if (!ledger) return

  on('tool.call', { tool: ANY }, async ($, e, next) => {
    const result = await next(e)
    noteTool(attribution, e.tool, e.agentId)
    return result
  })

  on('turn.complete', { turnId: ANY }, async ($, e, next) => {
    const result = await next(e)
    // Only a main-loop turn that ended on an API error is read, and only for a budget refusal's words.
    if (e.agentId !== undefined || e.reason !== 'error') return result
    // Claude Code 2.1.289 ends such a turn with `answer: ''` and puts the error in the transcript as a
    // synthetic assistant message ("API Error: 400 ..."): read that one message, and only when it is one.
    const last = e.answer ? undefined : await $.session.messages().then(m => (Array.isArray(m) ? m.at(-1) : undefined), () => undefined)
    if (!isBudgetRefusal(e.answer || apiErrorText(last))) return result
    attribution.refusals++
    if (!attribution.toasted) {
      attribution.toasted = true
      await state.say({ level: 'error', text: `budget: the gateway refused the request (${fileWindow ? `${fileWindow.period} window` : 'budget'} spent)`, timeoutMs: 10000 })
    }
    return result
  })

  on('session.end', { reason: ANY }, async ($, e, next) => {
    try {
      project ??= await $.fs.stat(under(state, '.claude-flow')).then(stat => stat.kind === 'dir', () => false)
      if (project && (attribution.totalUsd > 0 || attribution.refusals > 0)) {
        const line = attributionLine(attribution, String(e.reason), Date.now(), optionLimit === undefined ? fileWindow : { usd: optionLimit, period: 'session' })
        const path = under(state, ATTRIBUTION_PATH)
        const existing = await $.fs.read(path).catch((error: unknown) => {
          if (isMissing(error)) return ''
          throw error // a file that exists but cannot be read is never overwritten
        })
        await $.fs.write(path, appendLines(existing, [line]))
      }
    } catch {
      // the breakdown is best effort; a session must end whatever happens here
    }
    resetAttribution(attribution)
    return next(e)
  })
}
