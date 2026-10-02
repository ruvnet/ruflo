/**
 * Every command the manager runs, as a fixed argv. Nothing here reads event input: an id or a scope reaches an argv
 * only after `modId` / `scopeOf` accepted it, and the ruflo CLI checks both again before it runs `claude`.
 */

/** How the manager reaches the ruflo CLI when the project has none of its own. Only `npx` may touch the network. */
export const CLI_PREFIXES = {
  'npx-offline': ['npx', '--offline', '-y', '@claude-flow/cli@latest'],
  npx: ['npx', '-y', '@claude-flow/cli@latest'],
  ruflo: ['ruflo'],
  'claude-flow': ['claude-flow'],
} as const satisfies Record<string, readonly string[]>

export type CliChoice = keyof typeof CLI_PREFIXES | 'auto'

/** The project's own CLI, when it has one: preferred, since it is the version the project pinned. */
export const LOCAL_CLI = 'node_modules/@claude-flow/cli/bin/cli.js'

export const SCOPES = ['user', 'project', 'local'] as const
export type Scope = (typeof SCOPES)[number]

/** The ruflo marketplace's plugin ids, as Claude Code keys them. */
export const MOD_ID = /^ruflo-[a-z0-9-]{1,48}@ruflo$/

/** A ruflo mod id from what a person typed (`ruflo-swarm` or `ruflo-swarm@ruflo`), or null. */
export function modId(raw: string): string | null {
  const text = raw.trim().toLowerCase()
  const id = text.includes('@') ? text : `${text}@ruflo`

  return MOD_ID.test(id) ? id : null
}

export const scopeOf = (raw: string | undefined): Scope | null =>
  raw === undefined || raw === '' ? 'local' : (SCOPES as readonly string[]).includes(raw) ? (raw as Scope) : null

/** The argv prefix: the project's CLI when present, else the option's table entry (`auto` falls back to npx-offline). */
export function cliPrefix(choice: CliChoice, localCli: string | null): readonly string[] {
  if (choice === 'auto') {
    return localCli !== null ? ['node', localCli] : CLI_PREFIXES['npx-offline']
  }

  return CLI_PREFIXES[choice]
}

export const listArgv = (prefix: readonly string[]): string[] => [...prefix, 'mods', 'list', '--json']
export const statusArgv = (prefix: readonly string[]): string[] => [...prefix, 'mods', 'status', '--json']

export function toggleArgv(prefix: readonly string[], action: 'enable' | 'disable', id: string, scope: Scope): string[] {
  if (!MOD_ID.test(id) || !(SCOPES as readonly string[]).includes(scope)) {
    throw new Error(`refused: ${action} ${id} --scope ${scope}`)
  }

  return [...prefix, 'mods', action, id, '--scope', scope, '--json']
}

/** What `c` puts in the prompt: a command for the person to run, never run for them. */
export const configureLine = (id: string): string => `! claude plugin configure ${id}`
