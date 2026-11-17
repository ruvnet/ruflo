/** Counters the mod keeps for the session and writes to `.claude-flow/agent-mod/status.json` for the console. */
export type Stats = { calls: number; blocked: number; startedMs: number; lastDenied?: string }

export const newStats = (): Stats => ({ calls: 0, blocked: 0, startedMs: 0 })

export const STATUS_PATH = '.claude-flow/agent-mod/status.json'

/** The file's text; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: { guard: boolean; managedWorkflows?: boolean; maxBudgetCents?: number; allowInlineAgents?: boolean }, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, mod: 'agent', modVersion: '0.4.0', guard: mode.guard, summary: `Managed workflows ${mode.managedWorkflows ? 'on' : 'off'}; budget ${mode.maxBudgetCents ?? 2500} cents; inline ${mode.allowInlineAgents ? 'on' : 'off'}; secrets ${mode.guard ? 'on' : 'off'}`, ...stats }, null, 2)}\n`
}
