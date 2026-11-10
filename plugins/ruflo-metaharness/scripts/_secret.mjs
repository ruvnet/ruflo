// readSecret: one way to read a plugin credential (ADR-506). Copied verbatim into each plugin that
// needs it, since a plugin may not import from another plugin's folder; keep the copies identical
// (a test compares them).
//
// Order: CLAUDE_PLUGIN_OPTION_<NAME>, which Claude Code sets for a plugin's hooks when the
// `userConfig` option (declared with "sensitive": true, kept in the credential store) is filled in;
// then the environment variables the plugin always read, for standalone CLI use and backward
// compatibility. The value is never logged, echoed, or placed in an error message.

/** The environment variable Claude Code sets for a `userConfig` key (non-identifier characters to `_`, upper-cased). */
export const optionEnvName = (name) => `CLAUDE_PLUGIN_OPTION_${String(name).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`

/** The secret, or undefined when neither the option nor any fallback variable holds a non-empty value. Read at call time. */
export function readSecret(name, envFallbacks = [], env = process.env) {
  for (const variable of [optionEnvName(name), ...envFallbacks]) {
    const value = env[variable]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/** Where the secret was found (a variable NAME, never the value), or undefined. */
export function secretSource(name, envFallbacks = [], env = process.env) {
  for (const variable of [optionEnvName(name), ...envFallbacks]) {
    const value = env[variable]
    if (typeof value === 'string' && value.trim() !== '') return variable
  }
  return undefined
}

/** Error text for a missing secret: names the option and the variables, never a value. */
export function secretHint(name, envFallbacks = []) {
  const vars = envFallbacks.length ? ` or export ${envFallbacks.join(' / ')} in your shell` : ''
  return `no ${name} configured: set the plugin option "${name}" with /plugin (it is stored in the credential store)${vars}. Never paste a key into a prompt or a file.`
}
