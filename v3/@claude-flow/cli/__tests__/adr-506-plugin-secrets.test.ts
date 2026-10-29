/**
 * ADR-506: plugin credentials through `userConfig` with `sensitive: true`.
 *
 * - scripts/audit-plugin-secrets.mjs: fixtures for a credential-named option without `sensitive`,
 *   a literal secret, and a clean manifest; plus the real plugins/ tree must be clean.
 * - readSecret (copied into three plugins): option over environment, fallback order, hint text
 *   that never carries a value, and the copies stay identical.
 * - the three consumers read the option: cost-tracker openrouter.mjs, x-gateway checkAdmin,
 *   metaharness redblue child environment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const REPO = resolve(__dirname, '../../../..')
const AUDIT = join(REPO, 'scripts', 'audit-plugin-secrets.mjs')
const HELPERS = [
  'plugins/ruflo-cost-tracker/scripts/_secret.mjs',
  'plugins/ruflo-metaharness/scripts/_secret.mjs',
  'plugins/ruflo-x-gateway/src/_secret.mjs',
].map((p) => join(REPO, p))
// Built at runtime so this test file never holds a literal secret shape.
const FAKE_GITHUB_TOKEN = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')
const PROBE = 'probe-value-not-a-real-secret-7f3a'

const runAudit = (root: string) => spawnSync(process.execPath, [AUDIT, '--root', root], { encoding: 'utf8' })

function writePlugin(root: string, name: string, manifest: object, hooks?: object) {
  const dir = join(root, name)
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '0.0.1', ...manifest }, null, 2))
  if (hooks) {
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify(hooks, null, 2))
  }
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
  })

  it('the real plugins/ tree is clean', () => {
    const r = spawnSync(process.execPath, [AUDIT], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
  })

  it('the three ADR-506 options are declared sensitive and optional', () => {
    for (const [plugin, key] of [['ruflo-cost-tracker', 'openrouterApiKey'], ['ruflo-x-gateway', 'adminToken'], ['ruflo-metaharness', 'openrouterApiKey']]) {
      const m = JSON.parse(readFileSync(join(REPO, 'plugins', plugin, '.claude-plugin', 'plugin.json'), 'utf8'))
      expect(m.userConfig?.[key], `${plugin}.${key}`).toMatchObject({ type: 'string', sensitive: true, required: false })
      expect(m.userConfig[key]).not.toHaveProperty('default')
    }
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

describe('ADR-506 consumers read the option', () => {
  const clean = (extra: Record<string, string>) => {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/OPENROUTER|CLAUDE_PLUGIN_OPTION_|RUFLO_ADMIN_TOKEN/.test(k)) env[k] = v
    return { ...env, ...extra }
  }
  const openrouter = join(REPO, 'plugins/ruflo-cost-tracker/scripts/openrouter.mjs')

  it('cost-tracker openrouter.mjs: missing key names the option and variable, and exits 2 before any request', () => {
    const r = spawnSync(process.execPath, [openrouter, 'key', '--yes'], { encoding: 'utf8', env: clean({}) })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('openrouterApiKey')
    expect(r.stderr).toContain('OPENROUTER_API_KEY')
  })

  it('cost-tracker openrouter.mjs: the option alone is enough to pass the key gate, and the value is never printed', () => {
    // fetch is replaced by a stub that throws, so nothing reaches the network: with the key present the
    // script gets past the missing-key gate (exit 2) to the request and fails there (exit 1), which proves
    // the option was read, and the value is never echoed.
    const r = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("blocked")}', openrouter, 'key', '--yes'],
      { encoding: 'utf8', env: clean({ CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE }) })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('request failed: TypeError')
    expect(r.stdout + r.stderr).not.toContain(PROBE)
  })

  it('x-gateway checkAdmin: reads the option at call time and stays fail-closed', async () => {
    const { checkAdmin } = await import(pathToFileURL(join(REPO, 'plugins/ruflo-x-gateway/src/security.mjs')).href)
    const saved = { o: process.env.CLAUDE_PLUGIN_OPTION_ADMINTOKEN, e: process.env.RUFLO_ADMIN_TOKEN }
    try {
      delete process.env.CLAUDE_PLUGIN_OPTION_ADMINTOKEN; delete process.env.RUFLO_ADMIN_TOKEN
      expect(checkAdmin(PROBE)).toBe(false)
      process.env.CLAUDE_PLUGIN_OPTION_ADMINTOKEN = PROBE
      expect(checkAdmin(PROBE)).toBe(true)
      expect(checkAdmin('wrong')).toBe(false)
      delete process.env.CLAUDE_PLUGIN_OPTION_ADMINTOKEN
      process.env.RUFLO_ADMIN_TOKEN = 'legacy-env-token'
      expect(checkAdmin('legacy-env-token')).toBe(true)
    } finally {
      if (saved.o === undefined) delete process.env.CLAUDE_PLUGIN_OPTION_ADMINTOKEN; else process.env.CLAUDE_PLUGIN_OPTION_ADMINTOKEN = saved.o
      if (saved.e === undefined) delete process.env.RUFLO_ADMIN_TOKEN; else process.env.RUFLO_ADMIN_TOKEN = saved.e
    }
  })

  it('metaharness redblue: the child gets OPENROUTER_API_KEY from the option, an explicit variable wins', async () => {
    const { judgeEnv } = await import(pathToFileURL(join(REPO, 'plugins/ruflo-metaharness/scripts/_redblue.mjs')).href)
    expect(judgeEnv({ CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE }).OPENROUTER_API_KEY).toBe(PROBE)
    expect(judgeEnv({ CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY: PROBE, OPENROUTER_API_KEY: 'explicit' }).OPENROUTER_API_KEY).toBe('explicit')
    expect(judgeEnv({ PATH: '/bin' })).not.toHaveProperty('OPENROUTER_API_KEY')
  })
})
