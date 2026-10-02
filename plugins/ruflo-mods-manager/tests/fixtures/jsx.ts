/**
 * The JSX factory the engine gives a module (`h`, `Fragment`), stood in for plain vitest: an element is
 * `{ type, props, children }`, the tag the element constructor carries. Import before any view.
 */

type Node = { type: string; props: Record<string, unknown>; children: unknown[] }

const tagOf = (type: unknown): string => (typeof type === 'string' ? type : ((type as { tag?: string })?.tag ?? 'Fragment'))

const g = globalThis as unknown as { h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => Node; Fragment: string }

g.h = (type, props, ...children) => ({ type: tagOf(type), props: { ...(props ?? {}) }, children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false) })
g.Fragment = 'Fragment'

/** An element constructor for `tag`, as the engine's table holds one. */
export const el = (tag: string) => Object.assign((props: Record<string, unknown>) => ({ type: tag, props, children: [] }), { tag })

export const KIT = { Box: el('Box'), Text: el('Text'), Button: el('Button') }
export const KIT_RASTER = { ...KIT, Raster: el('Raster'), Markdown: el('Markdown') }

/** Every node of `type` in a tree. */
export function all(node: unknown, type: string): Node[] {
  if (node === null || typeof node !== 'object') {
    return []
  }

  const n = node as Node

  return [...(n.type === type ? [n] : []), ...(n.children ?? []).flatMap(child => all(child, type))]
}

/** All the text a tree shows, button labels included. */
export function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (node === null || typeof node !== 'object') {
    return ''
  }

  const n = node as Node
  const label = n.type === 'Button' && typeof n.props.label === 'string' ? n.props.label : ''

  return label + (n.children ?? []).map(text).join('')
}
