import type { On } from 'claude-code'

/**
 * `agentModels`: a per-project model for an agent type, applied in
 * `agent.spawn` when the call chose none. It covers types whose definition the
 * person cannot edit (the built-in `Explore` and `general-purpose`, another
 * plugin's agent) and workflow agents, whose model a hook may set since Claude
 * Code 2.1.300. It only fills a gap: a model the call or another hook set is
 * kept, and forks (which always inherit) and teammates are left alone.
 */
export type AgentModels = ReadonlyMap<string, string>

const TYPE = /^[A-Za-z0-9._:-]{1,64}$/
const MODEL = /^(?:haiku|sonnet|opus|inherit|claude-[a-z0-9.-]{1,60})$/

/** `Explore=haiku, general-purpose=sonnet` (or an object of the same) → type (lower case) → model; a malformed pair is dropped. */
export function readAgentModels(value: unknown): AgentModels {
  const pairs: [unknown, unknown][] =
    typeof value === 'string'
      ? value.split(',').map(p => p.split('=').map(s => s.trim()) as [string, string])
      : value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>)
        : []
  const out = new Map<string, string>()
  for (const [type, model] of pairs) {
    if (typeof type !== 'string' || typeof model !== 'string' || !TYPE.test(type) || !MODEL.test(model)) continue
    out.set(type.toLowerCase(), model)
  }
  return out
}

/** The model this spawn should get, or undefined to leave it as it is. */
export function modelFor(e: { subagentType?: unknown; model?: unknown; fork?: unknown; isTeammate?: unknown }, models: AgentModels): string | undefined {
  if (models.size === 0 || e.fork === true || e.isTeammate === true) return undefined
  if (typeof e.model === 'string' && e.model !== '') return undefined
  return typeof e.subagentType === 'string' ? models.get(e.subagentType.toLowerCase()) : undefined
}

export function registerAgentModels(on: On, models: AgentModels, counter: { routed: number }) {
  // A matcher: the loader allows one bare on('agent.spawn') per plugin (cost/ has it). Every typed spawn matches; modelFor picks.
  on('agent.spawn', { subagentType: /^[\s\S]+$/ }, async ($, e, next) => {
    const model = modelFor(e, models)
    if (model === undefined) return next(e)
    counter.routed++
    return next({ ...e, model })
  }).catch(($, e, next) => next(e)) // a broken routing table never blocks a spawn
}
