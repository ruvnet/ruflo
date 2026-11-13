import { afterEach, describe, expect, it, vi } from 'vitest'

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }))
vi.mock('../src/services/config-file-manager.js', () => ({ configManager: { getConfig } }))
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_target, name) => name === 'writeln' ? () => {} : (value: unknown) => value,
  }),
}))
import { providersCommand } from '../src/commands/providers.js'

const testCommand = providersCommand.subcommands!.find((command) => command.name === 'test')!

afterEach(() => {
  vi.unstubAllGlobals()
  getConfig.mockReset()
})

/** Run `providers test -p openai` with one saved provider entry. */
async function runTest(baseUrl?: string): Promise<{ calls: string[]; success: boolean }> {
  getConfig.mockReturnValue({
    agents: {
      providers: [{ name: 'openai', enabled: true, apiKey: 'sk-test', ...(baseUrl === undefined ? {} : { baseUrl }) }],
    },
  })
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    return { ok: true, status: 200 }
  }))
  const result = await testCommand.action!({
    args: [], flags: { provider: 'openai' }, cwd: '/tmp/project', interactive: false,
  })
  return { calls, success: result?.success === true }
}

describe('providers test -p openai probes the endpoint saved by configure (#4834)', () => {
  it('uses the saved base URL instead of api.openai.com', async () => {
    const { calls, success } = await runTest('https://proxy.example.com/v1')
    expect(calls).toEqual(['https://proxy.example.com/v1/models'])
    expect(success).toBe(true)
  })

  it('adds /v1 when the saved base carries no version segment', async () => {
    const { calls } = await runTest('https://proxy.example.com')
    expect(calls).toEqual(['https://proxy.example.com/v1/models'])
  })

  it('keeps the public endpoint when nothing is saved', async () => {
    const { calls } = await runTest()
    expect(calls).toEqual(['https://api.openai.com/v1/models'])
  })

  it('ignores a saved value that is not an http(s) URL', async () => {
    const { calls } = await runTest('ftp://proxy.example.com')
    expect(calls).toEqual(['https://api.openai.com/v1/models'])
  })
})
