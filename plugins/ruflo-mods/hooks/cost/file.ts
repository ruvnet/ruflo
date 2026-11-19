/**
 * The shared budget file (ADR-508 §2.1): `.claude-flow/cost/budget.json`,
 * version 1, written by `ruflo cost budget set` and read by both this mod and
 * `ruflo cost budget export`. Pure.
 *
 * The file is project-writable, so it is untrusted: a file that fails any rule
 * is no budget at all (the ladder stays off), never a zero budget that halts
 * at once. Unknown fields never survive. The CLI keeps a second copy of these
 * rules (v3/@claude-flow/cli/src/cost/budget-file.ts); a parity test runs both
 * over the same hostile corpus.
 */

export const BUDGET_PATH = '.claude-flow/cost/budget.json'

/** Windows a file may hold; more is a hostile file, not a richer budget. */
export const MAX_WINDOWS = 8
/** The largest window, in USD, a file may state. */
export const MAX_USD = 1_000_000
/** LiteLLM's `budget_duration` grammar (`30s`, `30m`, `30h`, `30d`), with a bounded count. */
export const PERIOD = /^[1-9][0-9]{0,3}[smhd]$/
const MODEL = /^[A-Za-z0-9._:/@-]{1,128}$/

export type BudgetWindow = { readonly usd: number; readonly period: string }

export type BudgetFile = {
  readonly version: 1
  readonly windows: readonly BudgetWindow[]
  readonly hardStop: boolean
  readonly fallbackModel?: string
}

const SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** A period's length in seconds (for ordering windows). */
export const periodSeconds = (period: string) => Number(period.slice(0, -1)) * SECONDS[period.slice(-1)]!

/**
 * A budget file's value, validated, or undefined when it breaks any rule:
 * not an object, a version other than 1, no windows or more than MAX_WINDOWS,
 * a `usd` that is not a finite number in (0, MAX_USD], a period outside the
 * grammar or repeated, a non-boolean `hardStop`, or a `fallbackModel` outside
 * a plain model-name charset.
 */
export function validateBudget(value: unknown): BudgetFile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const o = value as Record<string, unknown>
  if (o.version !== 1) return undefined
  if (!Array.isArray(o.windows) || o.windows.length === 0 || o.windows.length > MAX_WINDOWS) return undefined
  const windows: BudgetWindow[] = []
  const seen = new Set<string>()
  for (const w of o.windows as unknown[]) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return undefined
    const { usd, period } = w as Record<string, unknown>
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > MAX_USD) return undefined
    if (typeof period !== 'string' || !PERIOD.test(period) || seen.has(period)) return undefined
    seen.add(period)
    windows.push({ usd, period })
  }
  if (o.hardStop !== undefined && typeof o.hardStop !== 'boolean') return undefined
  if (o.fallbackModel !== undefined && (typeof o.fallbackModel !== 'string' || !MODEL.test(o.fallbackModel))) return undefined
  return {
    version: 1,
    windows,
    hardStop: o.hardStop === true,
    ...(typeof o.fallbackModel === 'string' ? { fallbackModel: o.fallbackModel } : {}),
  }
}

/** The file's text parsed and validated; throws on any failure (the reader turns that into "no budget"). */
export function parseBudget(text: string): BudgetFile {
  const budget = validateBudget(JSON.parse(text))
  if (!budget) throw new Error('budget.json fails validation')
  return budget
}

/**
 * The window the per-session ladder uses: the smallest `usd` (ties: the
 * shorter period). The mod sees one session's spend, so of every window the
 * smallest is always the nearest to its limit; the others are the gateway's.
 */
export function ladderWindow(budget: BudgetFile): BudgetWindow {
  return [...budget.windows].sort((a, b) => a.usd - b.usd || periodSeconds(a.period) - periodSeconds(b.period))[0]!
}
