import type { ModOptions } from './options'
import { splitName } from './guard'

export const MANAGED_TOOLS = ['managed_agent_capabilities', 'managed_agent_learning', 'managed_agent_control', 'managed_agent_create', 'managed_agent_prompt', 'managed_agent_status', 'managed_agent_events', 'managed_agent_list', 'managed_agent_interrupt', 'managed_agent_terminate'] as const

const record = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined

/** Argument wrappers a host may use. Only these are read; arbitrary descendants are never scanned as policy. */
const WRAPPERS = ['input', 'arguments', 'tool_input', 'params', 'args', 'parameters'] as const

/**
 * Host tool envelopes may be flat or hold the arguments in one wrapper. A wrapper that is not an object, two wrappers, or a wrapper
 * next to a flat `dynamicWorkflows` are ambiguous, so they are refused (undefined) rather than read as an envelope with no policy fields.
 */
export function managedInput(event: unknown): Record<string, unknown> | undefined {
  const e = record(event)
  if (!e) return undefined
  const present = WRAPPERS.filter(k => k in e)
  if (present.length === 0) return e
  if (present.length > 1 || e.dynamicWorkflows !== undefined) return undefined
  return record(e[present[0]!])
}

export function managedName(tool: string): string | undefined {
  const name = splitName(tool)?.tool ?? tool
  return (MANAGED_TOOLS as readonly string[]).includes(name) ? name : undefined
}

/** Tightens dynamic creation only; ordinary managed sessions retain their existing behavior. */
export function managedVerdict(tool: string, event: unknown, opts: ModOptions): string | undefined {
  if (managedName(tool) !== 'managed_agent_create') return undefined
  const input = managedInput(event)
  if (!input) return 'ruflo-agent: malformed managed tool input'
  if (input.dynamicWorkflows === undefined || input.dynamicWorkflows === false) return undefined
  if (input.dynamicWorkflows !== true) return 'ruflo-agent: dynamicWorkflows must be boolean'
  if (!opts.managedWorkflows) return 'ruflo-agent: dynamic workflow policy is off; enable managedWorkflows in plugin settings'
  if (typeof input.budgetCents !== 'string' || !/^[1-9][0-9]{0,8}$/.test(input.budgetCents) || Number(input.budgetCents) > opts.maxBudgetCents) return 'ruflo-agent: dynamic workflow budget exceeds plugin policy or is invalid'
  if (input.networking !== undefined && input.networking !== 'limited') return 'ruflo-agent: dynamic workflow network policy requires limited networking'
  if (!opts.allowInlineAgents && (!Array.isArray(input.predefinedAgents) || input.predefinedAgents.length === 0)) return 'ruflo-agent: plugin policy requires predefined agents; inline agents are off'
  return undefined
}

/** Registration is observable; beta access, authorization and remote health are not inferred. */
export function managedCapabilities(tools: readonly string[], opts: ModOptions): string {
  const available = new Set(tools.map(t => splitName(t)?.tool ?? t))
  const present = MANAGED_TOOLS.filter(t => available.has(t))
  const missing = MANAGED_TOOLS.filter(t => !available.has(t))
  return [
    `Managed workflow policy: ${opts.managedWorkflows ? 'on' : 'off'}; maximum ${opts.maxBudgetCents} US cents; inline agents ${opts.allowInlineAgents ? 'on' : 'off'}.`,
    `Registered managed tools (${present.length}/${MANAGED_TOOLS.length}): ${present.join(', ') || 'none'}.`,
    `Registry names: ${tools.filter(t => MANAGED_TOOLS.includes((splitName(t)?.tool ?? t) as typeof MANAGED_TOOLS[number])).slice(0, 32).map(t => t.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 160)).join(', ') || 'none'}.`,
    'Duplicate tool suffixes across servers are ambiguous; select the trusted Ruflo server explicitly.',
    ...(missing.length ? [`Missing: ${missing.join(', ')}. Install or update ruflo-core and ruflo-agent.`] : []),
    'Local registration is not authorization, beta access, credential readiness or remote health.',
    'Use managed_agent_capabilities for runtime configuration facts. Use ruflo-workflows for persisted pipelines, wasm_agent_* for local sandboxing, memory_* only for independently verified evidence.',
  ].join('\n')
}
