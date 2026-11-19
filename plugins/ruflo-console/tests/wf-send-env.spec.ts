import { describe, expect, it } from 'vitest'

import { sendTo, type SendDeps } from '../hooks/data/wf-send'
import { parseConfig, targetsOf, type Target } from '../hooks/data/wf-targets'

// A model key is read from the environment of the process Claude Code runs in. `printenv` does that on Linux and macOS; Windows has none, so
// there the engine's own environment read (host.env) supplies it and no program is run.
const CONFIG = 'endpoint:a=https://a.example.com/v1|KEY_A|m1'

function rig(env?: (name: string) => Promise<string | undefined>) {
  const ran: string[][] = []
  const headers: Record<string, string>[] = []
  const deps = {
    cli: [],
    helper: '',
    trustedPeers: new Set<string>(),
    cwd: 'C:\\proj',
    hive: null,
    config: parseConfig(CONFIG),
    run: async (argv: readonly string[]) => {
      ran.push([...argv])

      return argv[0] === 'printenv' ? { exitCode: 0, stdout: 'from-printenv\n', stderr: '' } : { exitCode: 127, stdout: '', stderr: 'not found' }
    },
    httpSend: async (_url: string, init: { headers: Record<string, string> }) => {
      headers.push(init.headers)

      return { ok: true, status: 200, text: JSON.stringify({ model: 'm1', choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) }
    },
    submitPrompt: async () => undefined,
    ...(env !== undefined && { readEnv: env }),
  } as unknown as SendDeps
  const target = targetsOf({ agents: [], peers: [], config: deps.config, hasHive: false, hasCodex: false }).find(candidate => candidate.id === 'a') as Target

  return { deps, target, ran, headers }
}

describe('reading a model key for an endpoint send', () => {
  it('uses the engine environment read where it is given (Windows) and runs no program', async () => {
    const r = rig(async name => (name === 'KEY_A' ? '  win-secret  ' : undefined))
    const result = await sendTo(r.deps, r.target, 'hello')

    expect(result.ok).toBe(true)
    expect(r.headers[0]?.authorization).toBe('Bearer win-secret')
    expect(r.ran).toEqual([])
  })

  it('refuses, sending nothing, when that read finds no key or fails', async () => {
    for (const env of [async () => undefined, async () => '', async (): Promise<string | undefined> => Promise.reject(new Error('refused'))]) {
      const r = rig(env)
      const result = await sendTo(r.deps, r.target, 'hello')

      expect(result.state).toBe('refused')
      // KEY_A is a custom name: the engine allows only literal variable names, so it says it cannot be read here, not that it is unset
      expect(result.text).toContain('KEY_A cannot be read here')
      expect(result.text).toContain('only $OPENROUTER_API_KEY')
      expect(r.headers).toEqual([])
    }
  })

  it('says the OpenRouter key is not set when that read finds none', async () => {
    const r = rig(async () => undefined)
    const openrouter = targetsOf({ agents: [], peers: [], config: r.deps.config, hasHive: false, hasCodex: false }).find(candidate => candidate.id === 'openrouter') as Target
    const result = await sendTo(r.deps, openrouter, 'hello')

    expect(result).toMatchObject({ ok: false, state: 'refused' })
    expect(result.text).toContain('OPENROUTER_API_KEY is not set')
    expect(r.headers).toEqual([])
  })

  it('keeps `printenv` where no environment read is given (Linux, macOS)', async () => {
    const r = rig()
    const result = await sendTo(r.deps, r.target, 'hello')

    expect(result.ok).toBe(true)
    expect(r.ran).toEqual([['printenv', 'KEY_A']])
    expect(r.headers[0]?.authorization).toBe('Bearer from-printenv')
  })
})

describe('sending to a federation peer', () => {
  const peerRig = (helper: string) => {
    const ran: string[][] = []
    const deps = {
      cli: [],
      helper,
      trustedPeers: new Set(['zenbook']),
      cwd: '/work',
      hive: null,
      config: parseConfig(''),
      run: async (argv: readonly string[]) => (ran.push([...argv]), { exitCode: 0, stdout: 'peer says hi', stderr: '' }),
      httpSend: async () => ({ ok: true, status: 200, text: '' }),
      submitPrompt: async () => undefined,
    } as unknown as SendDeps
    const target = targetsOf({ agents: [], peers: [{ host: 'zenbook', trusted: true }], config: deps.config, hasHive: false, hasCodex: false }).find(candidate => candidate.id === 'peer-zenbook') as Target

    return { deps, target, ran }
  }

  it('is refused on Windows, running nothing: the helper is a bash script and `bash` there is the WSL launcher', async () => {
    for (const helper of ['C:\\Users\\u/.claude/helpers/federation.sh', 'C:/Users/u/.claude/helpers/federation.sh']) {
      const r = peerRig(helper)
      const result = await sendTo(r.deps, r.target, 'hello')

      expect(result).toMatchObject({ ok: false, state: 'refused' })
      expect(result.text).toContain('cannot run from here')
      expect(r.ran).toEqual([])
    }
  })

  it('still runs the helper with bash on a POSIX home', async () => {
    const r = peerRig('/home/u/.claude/helpers/federation.sh')
    const result = await sendTo(r.deps, r.target, 'hello')

    expect(result).toMatchObject({ ok: true, state: 'reply', text: 'peer says hi' })
    expect(r.ran).toEqual([['bash', '/home/u/.claude/helpers/federation.sh', 'dispatch', 'zenbook', 'hello']])
  })
})
