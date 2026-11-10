// Secret bridge (ADR-506): hand a sensitive `userConfig` option to the scripts a skill or command runs
// through the Bash tool. Copied verbatim into each plugin that needs it (a test keeps the copies identical).
//
// Claude Code gives a plugin's option only to that plugin's hooks, as CLAUDE_PLUGIN_OPTION_<KEY>; the Bash
// tool never sees it. A SessionStart hook, though, gets CLAUDE_ENV_FILE, and the lines it appends there are
// loaded into every later Bash tool command of the session. So the plugin's SessionStart hook calls
// bridge({ option: 'VARIABLE' }) and the script reads VARIABLE as it always did.
//
// Exposure: the value then sits in the session's environment file (under ~/.claude, owner-only) and in the
// environment of the session's Bash commands, the same as exporting it in a shell profile. What the option
// adds is masked entry and credential-store storage instead of a plain-text profile or .env file.
//
// Rules: a variable the user already exported wins and is never overwritten; the value is never printed,
// logged or put in argv; a value with a newline or NUL is refused; any failure is silent and never blocks
// the session.
'use strict'
const fs = require('fs')

const optionEnvName = (name) => `CLAUDE_PLUGIN_OPTION_${String(name).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`

/** The env-file lines for the options that are set and whose variable is not. Never contains a value that was not asked for. */
function bridgeLines(map, env = process.env) {
  const lines = []
  for (const [option, variable] of Object.entries(map || {})) {
    if (!VARIABLE.test(variable)) continue
    if (typeof env[variable] === 'string' && env[variable].trim() !== '') continue
    const value = env[optionEnvName(option)]
    if (typeof value !== 'string' || value.trim() === '' || /[\n\r\0]/.test(value)) continue
    lines.push(`export ${variable}=${quote(value)}`)
  }
  return lines
}

/** Append the lines to CLAUDE_ENV_FILE (owner-only). Returns the variable NAMES written, never values. */
function bridge(map, env = process.env) {
  try {
    const file = env.CLAUDE_ENV_FILE
    if (!file) return []
    const lines = bridgeLines(map, env)
    if (lines.length === 0) return []
    fs.appendFileSync(file, lines.join('\n') + '\n', { mode: 0o600 })
    return lines.map((line) => line.slice('export '.length, line.indexOf('=')))
  } catch {
    return []
  }
}

module.exports = { bridge, bridgeLines, optionEnvName }
