/**
 * ADR-506: plugin credentials through `userConfig` with `sensitive: true`.
 *
 * - scripts/audit-plugin-secrets.mjs: a credential-named option without `sensitive`, literal secrets
 *   in plugin.json / hooks.json / .mcp.json (shapes, OpenRouter keys, credential entries under env or
 *   headers), `${user_config.*}` in argv, a secret used as an object key that must never be printed,
 *   and the real plugins/ tree must be clean.
 * - readSecret (scripts/_secret.mjs) and the SessionStart bridge (scripts/_secret-env.cjs), each copied
 *   into ruflo-cost-tracker and ruflo-metaharness: behaviour, and the copies stay identical.
 * - the consumers: cost-tracker openrouter.mjs and the metaharness redblue child environment, and the
 *   SessionStart hooks that wire the bridge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const REPO = resolve(__dirname, '../../../..')
const AUDIT = join(REPO, 'scripts', 'audit-plugin-secrets.mjs')
const PLUGINS = ['ruflo-cost-tracker', 'ruflo-metaharness']
const HELPERS = PLUGINS.map((p) => join(REPO, 'plugins', p, 'scripts', '_secret.mjs'))
const BRIDGES = PLUGINS.map((p) => join(REPO, 'plugins', p, 'scripts', '_secret-env.cjs'))
// Built at runtime so this test file never holds a literal secret shape.
const FAKE_GITHUB_TOKEN = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')
const FAKE_OPENROUTER_KEY = ['sk', 'or', 'v1', 'a1b2c3d4'.repeat(8)].join('-')
const FAKE_ADMIN_TOKEN = ['adm', 'Zq8Wv3Lx9Tk2Rp7Ns4'].join('')
const PROBE = 'probe-value-not-a-real-secret-7f3a'

const runAudit = (root: string) => spawnSync(process.execPath, [AUDIT, '--root', root], { encoding: 'utf8' })

function writePlugin(root: string, name: string, manifest: object, hooks?: object, mcp?: object) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '0.0.1', ...manifest }, null, 2))
  if (hooks) {
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify(hooks, null, 2))
  }
  if (mcp) writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcp, null, 2))
}

describe('ADR-506 audit-plugin-secrets', () => {
  let tmp: string
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'adr506-')) })
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('passes a clean manifest with a sensitive credential option', () => {
    const root = join(tmp, 'clean')
    writePlugin(root, 'p', { userConfig: {
      apiKey: { type: 'string', title: 'Key', description: 'A key.', required: false, sensitive: true },
      guard: { type: 'string', title: 'Guard', description: 'on/off', required: false, default: 'on' },
    } }, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node -e "1"' }] }] } })
    const r = runAudit(root)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/1 plugin manifest/)
  })

  it('fails a credential-named option declared without sensitive: true', () => {
    const root = join(tmp, 'notsensitive')
    writePlugin(root, 'p', { userConfig: { adminToken: { type: 'string', title: 'T', description: 'd', required: false } } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('p/.claude-plugin/plugin.json $.userConfig.adminToken')
    expect(r.stderr).toContain('without "sensitive": true')
  })

  it('treats sensitive: "true" (a string) as not sensitive', () => {
    const root = join(tmp, 'stringtrue')
    writePlugin(root, 'p', { userConfig: { dbPassword: { type: 'string', title: 'P', description: 'd', sensitive: 'true' } } })
    expect(runAudit(root).status).toBe(1)
  })

  it('fails a literal secret in plugin.json or hooks.json and never prints it', () => {
    const root = join(tmp, 'literal')
    writePlugin(root, 'a', { description: `uses ${FAKE_GITHUB_TOKEN}` })
    writePlugin(root, 'b', {}, { hooks: { Stop: [{ hooks: [{ type: 'command', command: `curl -H "x: ${FAKE_GITHUB_TOKEN}"` }] }] } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('a/.claude-plugin/plugin.json $.description: literal github token')
    expect(r.stderr).toContain('b/hooks/hooks.json')
    expect(r.stderr + r.stdout).not.toContain(FAKE_GITHUB_TOKEN)
  })

  it('a secret used as an object KEY is reported with a redacted path and never printed', () => {
    // The first version built paths from raw key text and printed the token itself (review finding 2).
    const root = join(tmp, 'keypos')
    writePlugin(root, 'k', { mcpServers: { x: { command: 'node', headers: { [FAKE_GITHUB_TOKEN]: 'v' }, env: { [FAKE_GITHUB_TOKEN]: { nested: 'x' } } } } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('$.mcpServers.x.headers.<redacted-key>#key: literal github token')
    expect(r.stderr).toContain('$.mcpServers.x.env.<redacted-key>#key: literal github token')
    expect(r.stderr + r.stdout).not.toContain(FAKE_GITHUB_TOKEN)
    expect(r.stderr + r.stdout).not.toContain(FAKE_GITHUB_TOKEN.slice(4, 20))
  })

  it('scans .mcp.json: a literal bearer token in a header fails', () => {
    const root = join(tmp, 'mcpjson')
    writePlugin(root, 'm', {}, undefined, { mcpServers: { x: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: `Bearer ${FAKE_GITHUB_TOKEN}` } } } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('m/.mcp.json $.mcpServers.x.headers.Authorization')
    expect(r.stderr + r.stdout).not.toContain(FAKE_GITHUB_TOKEN)
  })

  it('fails a literal OpenRouter key, which the mods screen has no shape for', () => {
    const root = join(tmp, 'openrouter')
    writePlugin(root, 'o', { mcpServers: { x: { command: 'node', env: { OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY } } } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('$.mcpServers.x.env.OPENROUTER_API_KEY: literal openrouter key')
    expect(r.stderr + r.stdout).not.toContain(FAKE_OPENROUTER_KEY)
  })

  it('fails a credential-named env or header entry holding any literal of 16+ characters', () => {
    const root = join(tmp, 'structural')
    writePlugin(root, 's', {}, undefined, { mcpServers: {
      a: { command: 'node', env: { RUFLO_ADMIN_TOKEN: FAKE_ADMIN_TOKEN } },
      b: { type: 'http', url: 'https://example.test', headers: { 'X-Api-Key': FAKE_ADMIN_TOKEN } },
    } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('$.mcpServers.a.env.RUFLO_ADMIN_TOKEN: literal credential under env')
    expect(r.stderr).toContain('$.mcpServers.b.headers.X-Api-Key: literal credential under headers')
    expect(r.stderr + r.stdout).not.toContain(FAKE_ADMIN_TOKEN)
  })

  it('negative controls: references, short or non-credential values under env/headers pass', () => {
    const root = join(tmp, 'references')
    writePlugin(root, 'r', { userConfig: { openrouterApiKey: { type: 'string', title: 'k', description: 'd', sensitive: true } } }, undefined, { mcpServers: {
      a: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs'], env: { OPENROUTER_API_KEY: '${user_config.openrouterApiKey}', CGF_CALLER_TOKEN: '${CGF_CALLER_TOKEN}', TOKEN_MODE: 'readonly', CLAUDE_FLOW_MCP_TRANSPORT: 'stdio-transport-long-value' } },
      b: { type: 'http', url: 'https://example.test', headers: { Authorization: 'Bearer ${user_config.openrouterApiKey}' } },
    } })
    const r = runAudit(root)
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails ${user_config.*} in a hook command, an MCP command, or args', () => {
    const root = join(tmp, 'argv')
    writePlugin(root, 'v', { userConfig: { apiKey: { type: 'string', title: 'k', description: 'd', sensitive: true } } },
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['x.cjs', '--key', '${user_config.apiKey}'] }] }] } },
      { mcpServers: { a: { command: 'node ${user_config.apiKey}' } } })
    const r = runAudit(root)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('v/hooks/hooks.json $.hooks.Stop[0].hooks[0].args[2]: ${user_config.*} in a command line')
    expect(r.stderr).toContain('v/.mcp.json $.mcpServers.a.command: ${user_config.*} in a command line')
  })

  it('refuses to pass when it inspects nothing', () => {
    const root = join(tmp, 'empty')
    mkdirSync(root, { recursive: true })
    expect(runAudit(root).status).toBe(1)
  })

  it('loads every COMMON_SECRETS rule from the mods screen', async () => {
    const mod = await import(pathToFileURL(AUDIT).href)
    const screen = readFileSync(mod.DEFAULT_SCREEN, 'utf8')
    const block = screen.slice(screen.indexOf('export const COMMON_SECRETS'), screen.indexOf('\n]', screen.indexOf('export const COMMON_SECRETS')))
    const expected = block.split('\n').filter((l) => /^\s*\['/.test(l)).length
    expect(expected).toBeGreaterThan(10)
    expect(mod.loadSecretRules()).toHaveLength(expected)
    expect(mod.SCANNED_FILES).toEqual(expect.arrayContaining(['.claude-plugin/plugin.json', 'hooks/hooks.json', '.mcp.json']))
  })

  it('the real plugins/ tree is clean', () => {
    const r = spawnSync(process.execPath, [AUDIT], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  })

  it('the two ADR-506 options are declared sensitive and optional; x-gateway declares none', () => {
    for (const plugin of PLUGINS) {
      const m = JSON.parse(readFileSync(join(REPO, 'plugins', plugin, '.claude-plugin', 'plugin.json'), 'utf8'))
      expect(m.userConfig?.openrouterApiKey, plugin).toMatchObject({ type: 'string', sensitive: true, required: false })
      expect(m.userConfig.openrouterApiKey).not.toHaveProperty('default')
    }
    // The gateway runs as a deployed server, never as a Claude Code child, so an option could not reach it.
    const gw = JSON.parse(readFileSync(join(REPO, 'plugins', 'ruflo-x-gateway', '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(gw.userConfig ?? {}).not.toHaveProperty('adminToken')
  })
})

describe('ADR-506 readSecret helper', () => {
  it('the per-plugin copies are byte-identical', () => {
    const [first, ...rest] = HELPERS.map((f) => readFileSync(f, 'utf8'))
    for (const copy of rest) expect(copy).toBe(first)
  })

  for (const file of HELPERS) {
    describe(file.slice(REPO.length + 1), () => {
      it('reads the option over the environment fallbacks, then the fallbacks in order', async () => {
        const { readSecret, optionEnvName, secretSource } = await import(pathToFileURL(file).href)
        expect(optionEnvName('openrouterApiKey')).toBe('CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY')
        expect(optionEnvName('a-b')).toBe('CLAUDE_PLUGIN_OPTION_A_B')
        const env = { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: 'from-option', OPENROUTER_API_KEY: 'from-env', SECOND: 'second' }
        expect(readSecret('openrouterApiKey', ['OPENROUTER_API_KEY'], env)).toBe('from-option')
        expect(secretSource('openrouterApiKey', ['OPENROUTER_API_KEY'], env)).toBe('CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY')
        expect(readSecret('openrouterApiKey', ['OPENROUTER_API_KEY'], { ...env, CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: '  ' })).toBe('from-env')
        expect(readSecret('x', ['MISSING', 'SECOND'], env)).toBe('second')
        expect(readSecret('x', ['MISSING'], env)).toBeUndefined()
        expect(secretSource('x', ['MISSING'], env)).toBeUndefined()
      })

      it('the hint names the option and variables, never a value', async () => {
        const { secretHint } = await import(pathToFileURL(file).href)
        const hint = secretHint('openrouterApiKey', ['OPENROUTER_API_KEY'])
        expect(hint).toContain('openrouterApiKey')
        expect(hint).toContain('OPENROUTER_API_KEY')
        expect(hint).not.toContain(PROBE)
      })
    })
  }
})

describe('ADR-506 SessionStart bridge (_secret-env.cjs)', () => {
  const req = createRequire(import.meta.url)
  let tmp: string
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'adr506-env-')) })
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('the per-plugin copies are byte-identical', () => {
    const [first, ...rest] = BRIDGES.map((f) => readFileSync(f, 'utf8'))
    for (const copy of rest) expect(copy).toBe(first)
  })

  it('writes the variable only when the option is set and the variable is not, quoted for the shell', () => {
    const { bridgeLines } = req(BRIDGES[0])
    const map = { openrouterApiKey: 'OPENROUTER_API_KEY' }
    expect(bridgeLines(map, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE })).toEqual([`export OPENROUTER_API_KEY='${PROBE}'`])
    expect(bridgeLines(map, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE, OPENROUTER_API_KEY: 'mine' })).toEqual([])
    expect(bridgeLines(map, {})).toEqual([])
    expect(bridgeLines(map, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: '  ' })).toEqual([])
    expect(bridgeLines(map, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: "a'b; rm x" })).toEqual([`export OPENROUTER_API_KEY='a'\\''b; rm x'`])
    expect(bridgeLines(map, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: 'a\nexport EVIL=1' })).toEqual([])
    expect(bridgeLines({ openrouterApiKey: 'BAD NAME' }, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE })).toEqual([])
  })

  it('a quoted value round-trips through bash unchanged', () => {
    const { bridgeLines } = req(BRIDGES[0])
    const tricky = `p'q"r$HOME\`id\` ;|&`
    const [line] = bridgeLines({ k: 'OUT' }, { CLAUDE_PLUGIN_OPTION_K: tricky })
    const r = spawnSync('bash', ['-c', `${line}; printf %s "$OUT"`], { encoding: 'utf8' })
    expect(r.stdout).toBe(tricky)
  })

  it('appends to CLAUDE_ENV_FILE owner-only, returns names only, and is a no-op without it', () => {
    const { bridge } = req(BRIDGES[0])
    const file = join(tmp, 'session.env')
    expect(bridge({ openrouterApiKey: 'OPENROUTER_API_KEY' }, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE })).toEqual([])
    expect(existsSync(file)).toBe(false)
    const written = bridge({ openrouterApiKey: 'OPENROUTER_API_KEY' }, { CLAUDE_ENV_FILE: file, CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE })
    expect(written).toEqual(['OPENROUTER_API_KEY'])
    expect(JSON.stringify(written)).not.toContain(PROBE)
    expect(readFileSync(file, 'utf8')).toBe(`export OPENROUTER_API_KEY='${PROBE}'\n`)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0)
  })

  it('the SessionStart hook of each plugin runs the bridge, prints nothing, and fills the env file', () => {
    for (const plugin of PLUGINS) {
      const root = join(REPO, 'plugins', plugin)
      const hooks = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8'))
      const command: string = hooks.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
      expect(command, plugin).toContain("'_secret-env.cjs'")
      expect(command).toContain("bridge({openrouterApiKey:'OPENROUTER_API_KEY'})")
      expect(command).not.toContain('user_config')
      const file = join(tmp, `${plugin}.env`)
      const r = spawnSync('bash', ['-c', command], { encoding: 'utf8', env: {
        PATH: process.env.PATH ?? '', CLAUDE_PLUGIN_ROOT: root, CLAUDE_ENV_FILE: file, CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE,
      } })
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout + r.stderr).toBe('')
      expect(readFileSync(file, 'utf8')).toBe(`export OPENROUTER_API_KEY='${PROBE}'\n`)
    }
  })
})

describe('ADR-506 consumers read the option', () => {
  const clean = (extra: Record<string, string>) => {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/OPENROUTER|CLAUDE_PLUGIN_OPTION_|RUFLO_ADMIN_TOKEN/.test(k)) env[k] = v
    return { ...env, ...extra }
  }
  const openrouter = join(REPO, 'plugins/ruflo-cost-tracker/scripts/openrouter.mjs')
  const blockFetch = 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("blocked")}'

  it('cost-tracker openrouter.mjs: missing key names the option and variable, and exits 2 before any request', () => {
    const r = spawnSync(process.execPath, [openrouter, 'key', '--yes'], { encoding: 'utf8', env: clean({}) })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('openrouterApiKey')
    expect(r.stderr).toContain('OPENROUTER_API_KEY')
  })

  it('cost-tracker openrouter.mjs: the variable the bridge writes is enough to pass the key gate, and is never printed', () => {
    // fetch is replaced by a stub that throws, so nothing reaches the network: with a key present the
    // script gets past the missing-key gate (exit 2) to the request and fails there (exit 1).
    for (const extra of [{ OPENROUTER_API_KEY: PROBE }, { CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE }]) {
      const r = spawnSync(process.execPath, ['--import', blockFetch, openrouter, 'key', '--yes'], { encoding: 'utf8', env: clean(extra) })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('request failed: TypeError')
      expect(r.stdout + r.stderr).not.toContain(PROBE)
    }
  })

  it('metaharness redblue: the child gets OPENROUTER_API_KEY from the option, an explicit variable wins', async () => {
    const { judgeEnv } = await import(pathToFileURL(join(REPO, 'plugins/ruflo-metaharness/scripts/_redblue.mjs')).href)
    expect(judgeEnv({ CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE }).OPENROUTER_API_KEY).toBe(PROBE)
    expect(judgeEnv({ CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE, OPENROUTER_API_KEY: 'explicit' }).OPENROUTER_API_KEY).toBe('explicit')
    expect(judgeEnv({ PATH: '/bin' })).not.toHaveProperty('OPENROUTER_API_KEY')
  })
})
