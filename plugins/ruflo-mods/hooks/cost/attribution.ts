/**
 * Per-session cost attribution (ADR-508 §2.3). Pure.
 *
 * A gateway sees every request but not which subagent or tool caused it. The
 * mod sees more, but not per request: Claude Code measures cost once per
 * main-thread turn (`session.measure`), and a foreground subagent runs inside
 * the main loop's Agent tool call, so its tool calls all land before that
 * turn's one measurement. So each measured delta is split across the tool
 * calls completed since the last measurement, one equal share per call: a
 * subagent's calls go to its type (from `agent.spawn`), the main loop's to
 * `main` (its Agent/Task call that wrapped the subagent counts as one main
 * share). A delta with no tool call in it (a plain answer) goes to `main` and
 * `(model)`. This is a split by call count, an estimate, not a per-request
 * price. At session end one line goes to `.claude-flow/cost/attribution.jsonl`,
 * which `ruflo cost report` reads.
 */

export const ATTRIBUTION_PATH = '.claude-flow/cost/attribution.jsonl'
/** Lines the file keeps (oldest dropped). */
export const MAX_LINES = 500
/** Distinct agent or tool names kept per session; the rest are charged to `other`. */
export const MAX_KEYS = 64
/** Spawned-agent ids remembered per session. */
export const MAX_AGENTS = 256

/** The agent a cost is charged to when the main loop ran the last tool. */
export const MAIN = 'main'
/** The tool a cost is charged to when no tool has run yet (a plain answer). */
export const NO_TOOL = '(model)'

const NAME = /^[A-Za-z0-9_.:@/-]{1,80}$/

export type Attribution = {
  /** The session's cumulative cost at the last measurement (the base for the next delta). */
  lastUsd: number
  totalUsd: number
  /** Tool calls completed since the last charged measurement, counted by agent and by tool. */
  pendingCalls: number
  pendingAgent: Map<string, number>
  pendingTool: Map<string, number>
  byAgent: Map<string, number>
  byTool: Map<string, number>
  /** Spawned subagent id → its type, so a subagent's tool calls are charged to its type. */
  agents: Map<string, string>
  refusals: number
  toasted: boolean
}

export const createAttribution = (): Attribution => ({
  lastUsd: 0,
  totalUsd: 0,
  pendingCalls: 0,
  pendingAgent: new Map(),
  pendingTool: new Map(),
  byAgent: new Map(),
  byTool: new Map(),
  agents: new Map(),
  refusals: 0,
  toasted: false,
})

/** A name as kept: a plain identifier, else `other`. */
export const nameOf = (value: unknown) => (typeof value === 'string' && NAME.test(value) ? value : 'other')

/** Remembers a started subagent's type under its id. */
export function noteSpawn(a: Attribution, agentId: unknown, subagentType: unknown): void {
  if (typeof agentId !== 'string' || agentId === '' || agentId.length > 128) return
  if (!a.agents.has(agentId) && a.agents.size >= MAX_AGENTS) return
  a.agents.set(agentId, nameOf(subagentType))
}

function charge(map: Map<string, number>, key: string, usd: number) {
  const k = map.has(key) || map.size < MAX_KEYS ? key : 'other'
  map.set(k, (map.get(k) ?? 0) + usd)
}

/** A tool call that just completed, and whose loop it ran in: one share of the next measured delta. */
export function noteTool(a: Attribution, tool: unknown, agentId: unknown): void {
  charge(a.pendingTool, nameOf(tool), 1)
  charge(a.pendingAgent, typeof agentId === 'string' ? a.agents.get(agentId) ?? 'subagent' : MAIN, 1)
  a.pendingCalls++
}

/**
 * Splits the delta since the last measurement across the tool calls completed
 * since then, one equal share per call; with none, it goes to `main` and
 * `(model)`. A total below the base means the host counted from zero again (a
 * /clear): the new total is the delta. A measurement with no cost change (a
 * rate-limit move) keeps the pending calls for the next one. Returns the delta.
 */
export function noteCost(a: Attribution, usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0
  const delta = usd < a.lastUsd ? usd : usd - a.lastUsd
  a.lastUsd = usd
  if (delta <= 0) return 0
  a.totalUsd += delta
  if (a.pendingCalls === 0) {
    charge(a.byAgent, MAIN, delta)
    charge(a.byTool, NO_TOOL, delta)
  } else {
    for (const [agent, calls] of a.pendingAgent) charge(a.byAgent, agent, (delta * calls) / a.pendingCalls)
    for (const [tool, calls] of a.pendingTool) charge(a.byTool, tool, (delta * calls) / a.pendingCalls)
  }
  a.pendingCalls = 0
  a.pendingAgent.clear()
  a.pendingTool.clear()
  return delta
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6
const sorted = (map: Map<string, number>) => Object.fromEntries([...map].sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, round(v)]))

/** The JSONL line `ruflo cost report` reads (`parseAttributionLine` in cli/src/cost/attribution.ts). */
export function attributionLine(a: Attribution, reason: string, now: number, window?: { usd: number; period: string }): string {
  return JSON.stringify({
    v: 1,
    endedAt: now,
    reason: nameOf(reason),
    totalUsd: round(a.totalUsd),
    byAgent: sorted(a.byAgent),
    byTool: sorted(a.byTool),
    refusals: a.refusals,
    budget: window ? { usd: window.usd, period: window.period } : null,
  })
}

/** `existing` plus `lines`, capped to the newest MAX_LINES; blank lines dropped. */
export function appendLines(existing: string, lines: readonly string[]): string {
  const all = [...existing.split('\n').filter(l => l.trim()), ...lines]
  return `${all.slice(-MAX_LINES).join('\n')}\n`
}

/**
 * Whether a turn's error text is a gateway's budget refusal: LiteLLM's
 * `budget_exceeded` type and `ExceededTokenBudget` / "Budget has been
 * exceeded" messages, or a plain "budget exceeded". Only ever read for a turn
 * that ended on an API error; a model answer is never read.
 */
export function isBudgetRefusal(text: unknown): boolean {
  if (typeof text !== 'string' || text === '') return false
  const t = text.slice(0, 4096)
  return /budget_exceeded|ExceededTokenBudget|budget has been exceeded|exceeded (?:the |your |its )?(?:max )?budget|budget (?:limit )?exceeded/i.test(t)
}

/**
 * The text of a transcript message Claude Code wrote for an API error
 * (`API Error: <status> ...`), else ''. A model-written message never starts
 * that way in practice, and this is only read for a turn whose reason is
 * already `error`.
 */
export function apiErrorText(message: unknown): string {
  const m = message as { role?: unknown; text?: unknown } | undefined
  return m?.role === 'assistant' && typeof m.text === 'string' && /^API Error\b/.test(m.text) ? m.text.slice(0, 4096) : ''
}

/** Clears the per-session figures (after a line is written, or at /clear); spawned ids are dropped too. */
export function resetAttribution(a: Attribution): void {
  Object.assign(a, createAttribution())
}
