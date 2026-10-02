import type { On, RenderElement, RenderNode } from 'claude-code'

import { LIST_JSON, STATUS_JSON } from './cli-output'
import { CWD } from './inputs'

export type Answer = { exitCode: number; stdout: string; stderr: string } | { deny: string }
export type Responder = (argv: readonly string[]) => Answer

/** Everything the mod asked of the engine, and what the world beneath it answers. */
export type World = {
  files: Map<string, string>
  runs: string[][]
  opened: Array<Record<string, unknown>>
  closed: string[]
  toasts: string[]
  statuses: Array<string | undefined>
  fills: string[]
  commands: string[]
  blits: Array<{ key: string; columns?: number; rows?: number; cells: string }>
  stored: Map<string, unknown>
  settings: Record<'user' | 'project' | 'local', Record<string, unknown>>
  panes: Array<{ id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }>
  respond: Responder
}

export const ok = (stdout: string): Answer => ({ exitCode: 0, stdout, stderr: '' })

/** The CLI as it answered on ruvultra: the real list and status, and enable/disable succeeding. */
export const realCli: Responder = argv => {
  const sub = argv.slice(argv.indexOf('mods') + 1)

  if (sub[0] === 'list') {
    return ok(LIST_JSON)
  }

  if (sub[0] === 'status') {
    return ok(STATUS_JSON)
  }

  if (sub[0] === 'enable' || sub[0] === 'disable') {
    return ok(JSON.stringify({ version: 1, ok: true, action: sub[0], id: sub[1], scope: sub[3], argv: ['claude', 'plugin', sub[0]], output: '', note: 'takes effect in the next session or after /reload-plugins' }))
  }

  return { exitCode: 2, stdout: '', stderr: `unknown: ${argv.join(' ')}` }
}

/** Seats the in-memory world beneath the plugin. */
export function worldOf(on: On, respond: Responder = realCli): World {
  const world: World = {
    files: new Map(),
    runs: [],
    opened: [],
    closed: [],
    toasts: [],
    statuses: [],
    fills: [],
    commands: [],
    blits: [],
    stored: new Map(),
    settings: { user: { enabledPlugins: { 'ruflo-swarm@ruflo': true } }, project: {}, local: {} },
    panes: [],
    respond,
  }

  const rel = (path: string) => (path.startsWith(`${CWD}/`) ? path.slice(CWD.length + 1) : path)

  on('fs.read', ($, e) => {
    const text = world.files.get(rel(e.path))

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.exists', ($, e) => ({ value: world.files.has(rel(e.path)) }))
  on('settings.read', ($, e) => ({ value: e.source !== undefined && e.source in world.settings ? world.settings[e.source as 'user'] : { ...world.settings.user, ...world.settings.project, ...world.settings.local } }))

  on('process.run', ($, e) => {
    world.runs.push([...e.argv])

    const answer = world.respond(e.argv)

    return 'deny' in answer ? { deny: answer.deny } : { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })

  on('store.get', ($, e) => ({ value: world.stored.get(e.key) }))
  on('store.set', ($, e) => {
    world.stored.set(e.key, e.value)

    return { value: undefined }
  })
  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    world.opened.push({ ...e })

    if (!world.panes.some(p => p.id === e.id)) {
      world.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: e.focus === true, isPlaced: true })
    }

    return { value: { isPlaced: true } } as never
  })
  on('ui.close', ($, e) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter(p => p.id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }) as never)
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.blit', async ($, e, next) => {
    const args = e as unknown as { key: string; columns?: number; rows?: number; cells: string }

    world.blits.push({ key: args.key, cells: args.cells, ...(args.columns !== undefined && { columns: args.columns }), ...(args.rows !== undefined && { rows: args.rows }) })

    // Through to the engine's own blit: it refuses one whose size is not the mounted Raster's.
    return next(e)
  })
  on('prompt.fill', ($, e) => {
    world.fills.push(e.text)

    return { isFilled: true }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'test' }))

  return world
}

/** Every string a drawn tree holds, button labels included, in drawing order. */
export function stringsOf(node: RenderNode | RenderElement | null | undefined): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return []
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return [String(node)]
  }

  const props = (node as { props?: Record<string, unknown> }).props
  const own = node.type === 'Button' && typeof props?.label === 'string' ? [props.label] : []
  const children = (node as { children?: readonly RenderNode[] }).children ?? []

  return [...own, ...children.flatMap(child => stringsOf(child))]
}

export const textOf = (node: RenderNode | RenderElement | null | undefined): string => stringsOf(node).join('')

export function elementsOf(node: RenderNode | RenderElement | null | undefined, type: string): RenderElement[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return []
  }

  const children = (node as { children?: readonly RenderNode[] }).children ?? []

  return [...(node.type === type ? [node as RenderElement] : []), ...children.flatMap(child => elementsOf(child, type))]
}

export const propsOf = (node: RenderElement): Record<string, unknown> => (node as { props?: Record<string, unknown> }).props ?? {}
