import { secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store'])
const OWN = new Set(['create_production', 'separate_stems', 'master', 'extract_midi'])

/** This plugin's namespaces (music-productions, music-briefs). A `memory_store` outside them is another plugin's write, and ruflo-agentdb (the catch-all) screens it. */
const OWN_NS = /^music/i
const ownNamespace = (input: unknown): boolean => {
  const top = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const inner = typeof top.input === 'object' && top.input !== null ? (top.input as Record<string, unknown>) : {}
  return [top.namespace, inner.namespace].some(ns => typeof ns === 'string' && OWN_NS.test(ns))
}

const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)
const serverOf = (name: string) => (name.startsWith('mcp__') ? name.slice(5, name.lastIndexOf('__')) : '')
/** The cogmusic server, however the plugin names it (`cogmusic` or `plugin_ruflo-music_cogmusic`). */
const isCogmusic = (name: string) => serverOf(name).includes('cogmusic') && OWN.has(toolOf(name))

/**
 * The reason a call is refused, or undefined when it may go. Prompts and lyrics leave the machine for music.cognitum.one, and memory
 * writes persist, so neither may carry a key, token or password. Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions, stats: Stats): string | undefined {
  const sends = isCogmusic(tool)
  const memory = WRITERS.has(toolOf(tool)) && (toolOf(tool) !== 'memory_store' || ownNamespace(input))
  if (!sends && !memory) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length === 0) {
    if (sends && toolOf(tool) === 'create_production') stats.productions++
    return undefined
  }
  stats.lastBlock = found[0]
  return sends
    ? 'ruflo-music: this prompt or lyrics hold what looks like a secret (a key, token or password); they would be sent to the music service. Remove it and try again.'
    : 'ruflo-music: this memory write holds what looks like a secret (a key, token or password). Store a reference to where it lives, not the value.'
}
