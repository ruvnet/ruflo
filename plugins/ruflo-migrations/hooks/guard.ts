import { secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store', 'agentdb_batch'])
/** This plugin's namespaces (migrations, migration-patterns). A `memory_store` outside them is another plugin's write, and ruflo-agentdb (the catch-all) screens it. */
const OWN_NS = /^migration/i
const ownNamespace = (input: unknown): boolean => {
  const top = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const inner = typeof top.input === 'object' && top.input !== null ? (top.input as Record<string, unknown>) : {}
  return [top.namespace, inner.namespace].some(ns => typeof ns === 'string' && OWN_NS.test(ns))
}
const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

/**
 * The reason a call is refused, or undefined when it may go. Migration SQL and connection strings are routinely pasted into memory, so a
 * memory write holding a secret or a database URL with an inline password is refused. Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions, stats: Stats): string | undefined {
  if (!WRITERS.has(toolOf(tool)) || (toolOf(tool) === 'memory_store' && !ownNamespace(input))) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length === 0) return undefined
  stats.lastBlock = found[0]
  return 'ruflo-migrations: this memory write holds what looks like a secret or a database URL with a password. Store the migration name and a reference to where the credential lives, not the value.'
}
