import type { CommandSpec } from 'claude-code'

import { modId, scopeOf, type Scope } from './model/argv'
import { COMMAND, type View } from './state'

export const COMMAND_SPEC: CommandSpec = {
  name: COMMAND,
  description: 'ruflo mods: list, diagrams and health of ruflo-family mods; enable or disable one',
  argumentHint: '[list|diagrams|health|next|prev|select <id>|enable <id> [scope]|disable <id> [scope]|refresh|configure <id>|help|close]',
}

/** One `/mods …` request. Each pane key has one, so nothing depends on the pane holding the keyboard. */
export type Sub =
  | { kind: 'toggle' }
  | { kind: 'view'; view: View }
  | { kind: 'step'; by: 1 | -1 }
  | { kind: 'select'; id: string }
  | { kind: 'toggle-mod'; action: 'enable' | 'disable'; id: string; scope: Scope }
  | { kind: 'refresh' }
  | { kind: 'configure'; id: string }
  | { kind: 'help' }
  | { kind: 'close' }
  | { kind: 'error'; text: string }

const VIEW_WORDS: Record<string, View> = { list: 'list', '1': 'list', diagrams: 'diagrams', '2': 'diagrams', health: 'health', '3': 'health' }

export function parseSub(args: string): Sub {
  const words = args.trim().split(/\s+/).filter(Boolean).slice(0, 4)
  const [verb = '', first, second] = words.map(word => word.toLowerCase())
  const idOf = (raw: string | undefined): string | null => (raw === undefined ? null : modId(raw))

  if (verb === '') {
    return { kind: 'toggle' }
  }

  if (verb in VIEW_WORDS) {
    return { kind: 'view', view: VIEW_WORDS[verb]! }
  }

  switch (verb) {
    case 'next':
    case 'j':
      return { kind: 'step', by: 1 }
    case 'prev':
    case 'k':
      return { kind: 'step', by: -1 }
    case 'refresh':
    case 'r':
      return { kind: 'refresh' }
    case 'help':
    case 'h':
    case '?':
      return { kind: 'help' }
    case 'close':
      return { kind: 'close' }
    case 'select':
    case 'configure':
    case 'c': {
      const id = idOf(first)

      if (id === null) {
        return { kind: 'error', text: `/mods ${verb} needs a ruflo mod id (ruflo-<name> or ruflo-<name>@ruflo)` }
      }

      return verb === 'select' ? { kind: 'select', id } : { kind: 'configure', id }
    }
    case 'enable':
    case 'disable':
    case 'e':
    case 'd': {
      const id = idOf(first)
      const scope = scopeOf(second)
      const action = verb === 'enable' || verb === 'e' ? 'enable' : 'disable'

      if (id === null) {
        return { kind: 'error', text: `/mods ${action} needs a ruflo mod id (ruflo-<name> or ruflo-<name>@ruflo)` }
      }

      if (scope === null) {
        return { kind: 'error', text: `/mods ${action}: scope must be user, project or local` }
      }

      return { kind: 'toggle-mod', action, id, scope }
    }
    default:
      return { kind: 'error', text: `unknown /mods subcommand "${verb.slice(0, 24)}"; try /mods help` }
  }
}
