#!/usr/bin/env node
// audit-plugin-secrets — ADR-506 regression guard for plugin credentials.
//
//   A. A `userConfig` key whose name looks like a credential (/(key|token|secret|password|jwt)/i)
//      must be declared "sensitive": true, so Claude Code keeps it in the credential store and
//      masks it, instead of writing it in plain text under `pluginConfigs` in settings.
//   B. No `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json` or `.lsp.json` may carry a
//      literal value shaped like a secret. The shapes are the mods' secret screen (COMMON_SECRETS in
//      plugins/ruflo-agentdb/hooks/screen.ts, parsed from that file so there is one list) plus
//      LOCAL_SECRETS below (OpenRouter keys, which the screen has no shape for).
//   C. Under an `env` or `headers` object, a credential-named entry (key, token, secret, password,
//      jwt, authorization, cookie, credential) must not hold a literal of 16+ characters: it must
//      reference `${VAR}` or `${user_config.KEY}`. This catches admin, gateway and other tokens that
//      no shape knows.
//   D. `${user_config.` must never appear in a hook or server `command`, `headersHelper` or `args`
//      entry: a substituted secret in argv is visible in `ps` (ADR-506 section 2.3). The server's
//      `env` block, or the hook's CLAUDE_PLUGIN_OPTION_<KEY> variable, is the place for it.
//
// Findings name the plugin, file and JSON path, and the rule. A matched value is never printed, and an
// object key that is itself shaped like a secret is shown as <redacted-key> in every path.
//
//   node scripts/audit-plugin-secrets.mjs                   # audits plugins/
//   node scripts/audit-plugin-secrets.mjs --root <dir>      # audits <dir>/*/ (tests use fixtures)
//   node scripts/audit-plugin-secrets.mjs --screen <file>   # alternative screen.ts

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CREDENTIAL_NAME = /(key|token|secret|password|jwt)/i
export const DEFAULT_SCREEN = join(REPO, 'plugins', 'ruflo-agentdb', 'hooks', 'screen.ts')
/** Shapes the mods' screen does not know, kept here because that screen is shared by every mod. */
export const LOCAL_SECRETS = [
  ['openrouter key', /\bsk-or-v1-[A-Za-z0-9]{32,}/],
]
export const SCANNED_FILES = ['.claude-plugin/plugin.json', 'hooks/hooks.json', '.mcp.json', '.lsp.json']
export const REDACTED_KEY = '<redacted-key>'
const CREDENTIAL_ENTRY = /(key|token|secret|password|jwt|authorization|cookie|credential)/i
const SECRET_CONTAINERS = new Set(['env', 'headers'])
const ARGV_KEYS = new Set(['command', 'headersHelper'])
const MIN_LITERAL = 16

/** The COMMON_SECRETS rules of the mods' screen, as [name, RegExp] pairs. Throws when none parse. */
export function loadSecretRules(screenPath = DEFAULT_SCREEN) {
  const source = readFileSync(screenPath, 'utf8')
  const start = source.indexOf('export const COMMON_SECRETS')
  const end = start < 0 ? -1 : source.indexOf('\n]', start)
  if (start < 0 || end < 0) throw new Error(`COMMON_SECRETS not found in ${screenPath}`)
  const rules = []
  for (const line of source.slice(start, end).split('\n')) {
    const m = line.match(/^\s*\['([^']+)',\s*\/(.*)\/([a-z]*)\],?\s*$/)
    if (m) rules.push([m[1], new RegExp(m[2], m[3])])
  }
  if (rules.length === 0) throw new Error(`no rules parsed from ${screenPath}: the audit would check nothing`)
  return rules
}

/**
 * Every string in a JSON value, object keys included. `keys` is the chain of object keys above the
 * string (array indices skipped) and `inArray` says whether its nearest container is an array.
 * `segment` renders a key for a path, so a key shaped like a secret never reaches a printed path.
 */
function* strings(value, path, segment, keys = [], inArray = false) {
  if (typeof value === 'string') yield { path, text: value, keys, inArray, isKey: false }
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}[${i}]`, segment, keys, true)
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    const seg = segment(k)
    yield { path: `${path}.${seg}#key`, text: k, keys, inArray: false, isKey: true }
    yield* strings(v, `${path}.${seg}`, segment, [...keys, k], false)
  }
}

/** Findings for one plugin directory. */
export function auditPlugin(dir, rules) {
  const findings = []
  const plugin = dir.split(/[\\/]/).filter(Boolean).pop()
  const shapes = [...rules, ...LOCAL_SECRETS]
  const segment = (k) => (shapes.some(([, re]) => re.test(k)) ? REDACTED_KEY : k)
  for (const rel of SCANNED_FILES) {
    const file = join(dir, rel)
    if (!existsSync(file)) continue
    let json
    try { json = JSON.parse(readFileSync(file, 'utf8')) } catch { findings.push({ plugin, file: rel, path: '$', rule: 'invalid JSON' }); continue }
    if (rel.endsWith('plugin.json')) {
      for (const [key, option] of Object.entries(json.userConfig ?? {})) {
        if (CREDENTIAL_NAME.test(key) && option?.sensitive !== true) {
          findings.push({ plugin, file: rel, path: `$.userConfig.${segment(key)}`, rule: 'credential-named option without "sensitive": true' })
        }
      }
    }
    for (const { path, text, keys, inArray, isKey } of strings(json, '$', segment)) {
      for (const [name, re] of shapes) if (re.test(text)) findings.push({ plugin, file: rel, path, rule: `literal ${name}` })
      if (isKey) continue
      const own = keys[keys.length - 1]
      const container = keys[keys.length - 2]
      if (!inArray && SECRET_CONTAINERS.has(container) && CREDENTIAL_ENTRY.test(own) && !text.includes('${') && text.length >= MIN_LITERAL) {
        findings.push({ plugin, file: rel, path, rule: `literal credential under ${container} (reference \${VAR} or \${user_config.KEY})` })
      }
      if (text.includes('${user_config.') && ((!inArray && ARGV_KEYS.has(own)) || (inArray && own === 'args'))) {
        findings.push({ plugin, file: rel, path, rule: '${user_config.*} in a command line (use the env block or CLAUDE_PLUGIN_OPTION_<KEY>)' })
      }
    }
  }
  return findings
}

/** Findings for every plugin directory directly under root. */
export function auditRoot(root, rules) {
  const dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(root, d.name))
  return { checked: dirs.filter(d => existsSync(join(d, '.claude-plugin', 'plugin.json'))).length, findings: dirs.flatMap(d => auditPlugin(d, rules)) }
}

function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const root = resolve(arg('--root') ?? join(REPO, 'plugins'))
  const rules = loadSecretRules(arg('--screen') ? resolve(arg('--screen')) : DEFAULT_SCREEN)
  const { checked, findings } = auditRoot(root, rules)
  if (checked === 0) { console.error(`audit-plugin-secrets: no plugin manifests under ${root}; a check that inspects nothing must not pass`); return 1 }
  for (const f of findings) console.error(`FAIL ${f.plugin}/${f.file} ${f.path}: ${f.rule}`)
  if (findings.length) {
    console.error(`audit-plugin-secrets: ${findings.length} finding(s). Declare credential options with "sensitive": true and keep secrets out of manifests and command lines (ADR-506).`)
    return 1
  }
  console.log(`audit-plugin-secrets: ${checked} plugin manifest(s), ${rules.length + LOCAL_SECRETS.length} secret shapes, clean`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)))
