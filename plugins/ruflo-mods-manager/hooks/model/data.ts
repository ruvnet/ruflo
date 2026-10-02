/**
 * The CLI's answers, read as untrusted text: `ruflo mods list --json` (ADR-406) and `ruflo mods status --json`
 * (#3612's findings). Every field is checked and every string cut and stripped of control characters before a view
 * sees it; a field that is not there is null, never a default.
 */

import { MOD_ID, SCOPES, type Scope } from './argv'

export type Verdict = 'gate' | 'no-gate' | 'off' | 'allowed' | 'clean' | 'observed' | 'refused' | 'unknown'
const VERDICTS = new Set<Verdict>(['gate', 'no-gate', 'off', 'allowed', 'clean', 'observed', 'refused', 'unknown'])

export type ModRow = {
  id: string
  name: string
  version: string | null
  enabledIn: Record<Scope, boolean | null>
  enabled: boolean
  installed: boolean
  installScope: Scope | null
  installPath: string | null
  resolvable: boolean
  source: string
  events: string[] | null
  calls: string[] | null
  scanError: string | null
  /** The folder the CLI scanned: the install, or the marketplace clone when the install predates the hooks module. */
  scannedFrom: string | null
  verdict: Verdict
  risk: string[]
}

export type ModList = {
  generatedAt: string
  claude: { path: string; version: string | null } | null
  gate: { enabled: boolean; modTrust: string; allow: string[] }
  mods: ModRow[]
  errors: string[]
}

export type Finding = { name: string; status: 'pass' | 'warn' | 'fail'; message: string; fix: string | null }

/** Printable text only: control and bidi-override characters dropped, whitespace collapsed, cut to `max`. */
export function plain(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()

  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown, max = 64, cap = 64): string[] => (Array.isArray(v) ? v.filter(s => typeof s === 'string').slice(0, cap).map(s => plain(s, max)) : [])
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** The JSON object in a CLI's stdout: the whole of it, or the span from its first `{`/`[` (a banner line before it). */
export function jsonOf(stdout: string): unknown {
  const text = stdout.trim()

  for (const start of [0, text.search(/[[{]/)]) {
    if (start < 0) {
      continue
    }

    try {
      return JSON.parse(text.slice(start))
    } catch {
      // try the next start
    }
  }

  throw new Error('no JSON in the CLI output')
}

function rowOf(v: unknown): ModRow | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !MOD_ID.test(v.id)) {
    return null
  }

  const enabledIn = isRecord(v.enabledIn) ? v.enabledIn : {}
  const scan = isRecord(v.scan) ? v.scan : null
  const trust = isRecord(v.trust) ? v.trust : {}
  const verdict = typeof trust.verdict === 'string' && VERDICTS.has(trust.verdict as Verdict) ? (trust.verdict as Verdict) : 'unknown'
  const scope = typeof v.installScope === 'string' && (SCOPES as readonly string[]).includes(v.installScope) ? (v.installScope as Scope) : null

  return {
    id: v.id,
    name: plain(v.name ?? v.id.replace(/@ruflo$/, ''), 48),
    version: typeof v.version === 'string' ? plain(v.version, 24) : null,
    enabledIn: { user: flag(enabledIn.user), project: flag(enabledIn.project), local: flag(enabledIn.local) },
    enabled: v.enabled === true,
    installed: v.installed === true,
    installScope: scope,
    installPath: typeof v.installPath === 'string' ? plain(v.installPath, 240) : null,
    resolvable: v.resolvable === true,
    source: plain(v.source, 16),
    events: scan === null ? null : strings(scan.events),
    calls: scan === null ? null : strings(scan.calls),
    scanError: typeof v.scanError === 'string' ? plain(v.scanError, 160) : null,
    scannedFrom: typeof v.scannedFrom === 'string' ? plain(v.scannedFrom, 240) : null,
    verdict,
    risk: strings(trust.risk, 96, 16),
  }
}

/** `ruflo mods list --json`, or why it could not be read. */
export function parseList(stdout: string): ModList {
  const v = jsonOf(stdout)

  if (Array.isArray(v)) {
    // A ruflo CLI from before ADR-406 has no `mods list`: its `mods` falls through to the status findings.
    throw new Error('this ruflo CLI has no `mods list` (it predates ADR-406): install @claude-flow/cli in the project, or set the cli option')
  }

  if (!isRecord(v) || v.version !== 1 || !Array.isArray(v.mods)) {
    throw new Error('mods list --json: not a version 1 list')
  }

  const claude = isRecord(v.claude) && typeof v.claude.path === 'string' ? { path: plain(v.claude.path, 200), version: typeof v.claude.version === 'string' ? plain(v.claude.version, 24) : null } : null
  const gate = isRecord(v.gate) ? v.gate : {}

  return {
    generatedAt: plain(v.generatedAt, 40),
    claude,
    gate: { enabled: gate.enabled === true, modTrust: plain(gate.modTrust ?? 'observe', 16), allow: strings(gate.allow, 80) },
    mods: v.mods.map(rowOf).filter((row): row is ModRow => row !== null).slice(0, 64).sort((a, b) => a.id.localeCompare(b.id)),
    errors: strings(v.errors, 200, 8),
  }
}

/** `ruflo mods status --json`: #3612's findings, in their order. */
export function parseStatus(stdout: string): Finding[] {
  const v = jsonOf(stdout)

  if (!Array.isArray(v)) {
    throw new Error('mods status --json: not a findings array')
  }

  return v.flatMap((f): Finding[] =>
    isRecord(f) && typeof f.name === 'string' && (f.status === 'pass' || f.status === 'warn' || f.status === 'fail')
      ? [{ name: plain(f.name, 48), status: f.status, message: plain(f.message, 240), fix: typeof f.fix === 'string' ? plain(f.fix, 240) : null }]
      : [],
  ).slice(0, 32)
}

/** The init chain's four links and the finding each one reads (ADR-406). */
export const CHAIN = [
  { link: 'settings', finding: 'ruflo-mods plugin' },
  { link: 'marketplace', finding: 'ruflo marketplace' },
  { link: 'plugin', finding: 'ruflo-mods installed' },
  { link: 'helpers', finding: 'classic handshake' },
] as const

export type ChainLink = { link: string; status: 'pass' | 'warn' | 'fail' | 'unknown'; message: string; fix: string | null }

/** Each link's finding, or `unknown` saying why there is none (#3612 checks resolvability only once the mod is enabled). */
export function chainOf(findings: readonly Finding[]): ChainLink[] {
  const byName = new Map(findings.map(f => [f.name, f]))
  const enabled = byName.get('ruflo-mods plugin')?.status === 'pass'

  return CHAIN.map(({ link, finding }) => {
    const f = byName.get(finding)

    if (f !== undefined) {
      return { link, status: f.status, message: f.message, fix: f.fix }
    }

    return { link, status: 'unknown', message: enabled ? `no "${finding}" finding in mods status` : 'not checked: ruflo-mods is not enabled here', fix: null }
  })
}

export type Counts = { pass: number; warn: number; fail: number }

export const countsOf = (findings: readonly Finding[]): Counts => ({
  pass: findings.filter(f => f.status === 'pass').length,
  warn: findings.filter(f => f.status === 'warn').length,
  fail: findings.filter(f => f.status === 'fail').length,
})

/** `enabledPlugins[id]` per settings source, as the engine reads them (`$.settings.read({ source })`); null where the source does not name it. */
export function enabledFromSettings(id: string, bySource: Partial<Record<Scope, unknown>>): Record<Scope, boolean | null> {
  const of = (settings: unknown): boolean | null => {
    if (!isRecord(settings)) {
      return null
    }

    const plugins = settings.enabledPlugins

    return isRecord(plugins) && typeof plugins[id] === 'boolean' ? (plugins[id] as boolean) : null
  }

  return { user: of(bySource.user), project: of(bySource.project), local: of(bySource.local) }
}

/** The effective flag: the most specific source that names it (local over project over user). */
export const effective = (by: Record<Scope, boolean | null>): boolean => by.local ?? by.project ?? by.user ?? false
