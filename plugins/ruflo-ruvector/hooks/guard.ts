import { hasSecret } from './screen'
import { isWriter } from './tools'
import { textsOf } from './screen'
export { textsOf }

/** This plugin's namespaces (vector-patterns, vector-clusters, hyperbolic-embeddings). A `memory_store` outside them is another plugin's write, and ruflo-agentdb (the catch-all) screens it. */
const OWN_NS = /^(?:vector|hyperbolic|ruvector)/i
const ownNamespace = (input: unknown): boolean => {
  const top = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const inner = typeof top.input === 'object' && top.input !== null ? (top.input as Record<string, unknown>) : {}
  return [top.namespace, inner.namespace].some(ns => typeof ns === 'string' && OWN_NS.test(ns))
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!isWriter(tool) || (tool.endsWith('memory_store') && !ownNamespace(input))) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-ruvector: this call holds what looks like a secret (a key, token or password). Keep secrets out of the vector store and the shared brain; store a reference instead.'
    : undefined
}
