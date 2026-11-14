/**
 * #3979 / ADR-532: the Dev Tools WASM rows go n/a while @ruvector/rvagent-wasm is known missing. The n/a helper, the palette,
 * and the probe's state transitions (a failed probe never hides a working feature). Run with
 *   npx vitest run plugins/ruflo-console/tests/devtools-rvagent-wasm-3979.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { DEV, devPalette, probeRvagentWasm, wasmAvailability, withNeeds, withRvagentWasm } from '../hooks/devtools'
import { openLoaders } from '../hooks/view-open'
import { newState } from '../hooks/state'

const WASM_IDS = ['dt-wasm-gallery', 'dt-wasm-categories', 'dt-wasm-search', 'dt-wasm-list']
const entry = (id: string) => DEV.find(candidate => candidate.id === id)!

describe('the n/a helper', () => {
  it('marks only the four runnable WASM rows as needing the package', () => {
    expect(DEV.filter(candidate => candidate.needs === 'rvagent-wasm').map(candidate => candidate.id)).toEqual(WASM_IDS)
  })

  it('makes a WASM row n/a with the package and the install command while missing', () => {
    for (const id of WASM_IDS) {
      const na = withRvagentWasm(entry(id), 'missing')

      expect(na.na).toContain('@ruvector/rvagent-wasm')
      expect(na.na).toContain('npm install -g @ruvector/rvagent-wasm')
      expect(na.na).toContain('npx ruflo')
    }
  })

  it('leaves the rows alone while unknown or present, and never touches other rows', () => {
    for (const id of WASM_IDS) for (const wasm of ['unknown', 'present'] as const) expect(withRvagentWasm(entry(id), wasm)).toBe(entry(id))
    expect(withRvagentWasm(entry('dt-diff'), 'missing')).toBe(entry('dt-diff'))
    expect(withNeeds(entry('dt-wasm-list'), { tmux: 'missing', rvagentWasm: 'unknown' })).toBe(entry('dt-wasm-list'))
    expect(withNeeds(entry('dt-wasm-list'), { tmux: 'unknown', rvagentWasm: 'missing' }).na).toBeDefined()
  })
})

describe('the palette', () => {
  const ids = (wasm: 'unknown' | 'present' | 'missing') => {
    const state = newState({})

    state.devtools.rvagentWasm = wasm

    return devPalette(state).map(candidate => candidate.id)
  }

  it('drops the WASM entries while missing and keeps them while unknown or present', () => {
    for (const id of WASM_IDS) {
      expect(ids('missing')).not.toContain(id)
      expect(ids('unknown')).toContain(id)
      expect(ids('present')).toContain(id)
    }
  })
})

describe('the probe', () => {
  const probe = async (run: (argv: string[], timeout?: number) => Promise<{ exitCode: number; stdout: string }>, start: 'unknown' | 'present' | 'missing' = 'unknown') => {
    const state = newState({})
    const calls: string[][] = []
    const host = { run: (argv: string[], timeout?: number) => (calls.push(argv), run(argv, timeout)), invalidate: () => undefined }

    state.devtools.rvagentWasm = start
    await probeRvagentWasm(state, host as never)

    return { state: state.devtools.rvagentWasm, calls }
  }

  it('reads available true and false, also after a warning line', async () => {
    expect((await probe(async () => ({ exitCode: 0, stdout: '{"available": true}' }))).state).toBe('present')
    expect((await probe(async () => ({ exitCode: 0, stdout: '{"available": false, "error": "x"}' }))).state).toBe('missing')
    expect((await probe(async () => ({ exitCode: 0, stdout: '[WARN] something\n{\n  "available": false\n}\n' }))).state).toBe('missing')
    expect(wasmAvailability('no json')).toBeNull()
  })

  it('runs the CLI read-only with the configured prefix and a generous timeout', async () => {
    let timeout: number | undefined
    const { calls } = await probe(async (_argv, ms) => ((timeout = ms), { exitCode: 0, stdout: '{"available":true}' }))

    expect(calls[0].slice(-4)).toEqual(['agent', 'wasm-status', '--format', 'json'])
    expect(calls[0][0]).toBe('npx')
    expect(timeout).toBeGreaterThanOrEqual(30_000)
  })

  it('stays unknown on a non-zero exit, garbage, or a throw', async () => {
    expect((await probe(async () => ({ exitCode: 1, stdout: '{"available": false}' }))).state).toBe('unknown')
    expect((await probe(async () => ({ exitCode: 0, stdout: 'garbage' }))).state).toBe('unknown')
    expect((await probe(() => Promise.reject(new Error('timeout')))).state).toBe('unknown')
  })

  it('asks again while missing, so installing the package and reopening the page brings the rows back', async () => {
    const reopened = await probe(async () => ({ exitCode: 0, stdout: '{"available":true}' }), 'missing')

    expect(reopened.calls).toHaveLength(1)
    expect(reopened.state).toBe('present')
  })

  it('does not ask again once the package was found', async () => {
    const present = await probe(async () => ({ exitCode: 0, stdout: '{"available":false}' }), 'present')

    expect(present.calls).toHaveLength(0)
    expect(present.state).toBe('present')
  })

  it('runs one probe at a time for two quick opens', async () => {
    const state = newState({})
    let release: () => void = () => undefined
    const calls: string[][] = []
    const host = { run: (argv: string[]) => (calls.push(argv), new Promise<{ exitCode: number; stdout: string }>(done => { release = () => done({ exitCode: 0, stdout: '{"available":false}' }) })), invalidate: () => undefined }

    const first = probeRvagentWasm(state, host as never)
    const second = probeRvagentWasm(state, host as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    await Promise.all([first, second])

    expect(calls.filter(argv => argv.includes('wasm-status'))).toHaveLength(1)
    expect(state.devtools.rvagentWasm).toBe('missing')
  })

  it('uses the launcher the rows use, and never downloads the CLI (cold npx) just to probe', async () => {
    const state = newState({})
    const calls: string[][] = []
    // Every installed launcher fails, so the npx choice would fall back to `npx -y` (cold).
    const host = { run: async (argv: string[]) => (calls.push(argv), { exitCode: 1, stdout: '' }), invalidate: () => undefined }

    state.options.cli = 'npx'
    await probeRvagentWasm(state, host as never)

    expect(calls.some(argv => argv.includes('wasm-status'))).toBe(false)
    expect(state.devtools.rvagentWasm).toBe('unknown')
  })

  it('probes through a global ruflo when the npx choice finds one on PATH', async () => {
    const state = newState({})
    const calls: string[][] = []
    const host = { run: async (argv: string[]) => (calls.push(argv), argv.includes('wasm-status') ? { exitCode: 0, stdout: '{"available":true}' } : { exitCode: 0, stdout: '3.77.1' }), invalidate: () => undefined }

    state.options.cli = 'npx'
    await probeRvagentWasm(state, host as never)

    const probed = calls.find(argv => argv.includes('wasm-status'))
    expect(probed?.[0]).toBe('ruflo')
    expect(state.devtools.rvagentWasm).toBe('present')
  })

  it('runs when the Dev Tools view opens, and not for another view', async () => {
    const calls: string[][] = []
    const host = { run: async (argv: string[]) => (calls.push(argv), { exitCode: 0, stdout: '{"available":false}' }), listCommands: async () => [], invalidate: () => undefined }
    const state = newState({})

    openLoaders(state, host as never, 'devtools')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.some(argv => argv.includes('wasm-status'))).toBe(true)
    expect(state.devtools.rvagentWasm).toBe('missing')
  })
})
