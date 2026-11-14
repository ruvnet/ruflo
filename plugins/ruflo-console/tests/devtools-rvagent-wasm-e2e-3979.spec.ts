/**
 * #3979 / ADR-532, end to end and the gaps the unit spec leaves: the real `agent wasm-status` command (no mocks) feeding the
 * console's real probe, `withNeeds` with both programs missing, n/a rows having no runnable spec, and the probe running only
 * for Dev Tools. Run with
 *   npx vitest run plugins/ruflo-console/tests/devtools-rvagent-wasm-e2e-3979.spec.ts
 */
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wasmStatusCommand } from '../../../v3/@claude-flow/cli/src/commands/agent-wasm'
import { DEV, devPalette, devSpec, probeRvagentWasm, withNeeds } from '../hooks/devtools'
import { newState } from '../hooks/state'
import { openLoaders } from '../hooks/view-open'

const WASM_IDS = ['dt-wasm-gallery', 'dt-wasm-categories', 'dt-wasm-search', 'dt-wasm-list']
const entry = (id: string) => DEV.find(candidate => candidate.id === id)!

/** Is the package resolvable from the CLI source? Decides which side of the real run is asserted (CI has neither network nor the package). */
const installed = (() => {
  try {
    createRequire(new URL('../../../v3/@claude-flow/cli/package.json', import.meta.url)).resolve('@ruvector/rvagent-wasm')

    return true
  } catch {
    return false
  }
})()

let out = ''
let err = ''

beforeEach(() => {
  out = ''
  err = ''
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => ((out += String(chunk)), true)) as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => ((err += String(chunk)), true)) as never)
})
afterEach(() => vi.restoreAllMocks())

const runCli = (format?: string) => wasmStatusCommand.action!({ args: [], flags: format ? { format } : {}, cwd: process.cwd() } as never)

describe('the real CLI feeding the real probe', () => {
  it('prints one JSON document that the console parses to the matching state', async () => {
    await runCli('json')
    const stdout = out

    vi.restoreAllMocks()

    const doc = JSON.parse(stdout)
    const state = newState({})
    const host = { run: async () => ({ exitCode: 0, stdout }), invalidate: () => undefined }

    await probeRvagentWasm(state, host as never)

    expect(stdout).toBe(`${stdout.trim()}\n`)
    expect(doc.available).toBe(installed)
    if (!installed) expect(doc.install).toMatch(/npm install .*@ruvector\/rvagent-wasm/)
    expect(state.devtools.rvagentWasm).toBe(installed ? 'present' : 'missing')
  })

  it('renders the WASM rows n/a with the install text after a missing probe, and keeps the rest runnable', async () => {
    if (installed) return

    await runCli('json')
    const stdout = out

    vi.restoreAllMocks()

    const state = newState({})

    await probeRvagentWasm(state, { run: async () => ({ exitCode: 0, stdout }), invalidate: () => undefined } as never)

    for (const id of WASM_IDS) {
      const row = withNeeds(entry(id), state.devtools)

      expect(row.na).toContain('npm install -g @ruvector/rvagent-wasm')
      expect(devSpec(row, state.devtools.fields)).toBeNull()
    }

    const ids = devPalette(state).map(candidate => candidate.id)

    for (const id of WASM_IDS) expect(ids).not.toContain(id)
    expect(ids).toContain('dt-diff')
  })

  it('human mode keeps the warning on stderr and puts nothing but a blank line on stdout when missing', async () => {
    if (installed) return

    await runCli()

    expect(out.trim()).toBe('')
    expect(err).toMatch(/@ruvector\/rvagent-wasm is not installed/)
    expect(err).toMatch(/npm install/)
  })
})

describe('withNeeds with several programs', () => {
  const tmuxRow = DEV.find(candidate => candidate.needs === 'tmux')!

  it('marks the tmux rows and the WASM rows n/a together when both are missing', () => {
    const both = { tmux: 'missing', rvagentWasm: 'missing' } as const

    expect(withNeeds(tmuxRow, both).na).toMatch(/tmux/)
    expect(withNeeds(entry('dt-wasm-list'), both).na).toMatch(/rvagent-wasm/)
  })

  it('does not cross the reasons: tmux missing leaves WASM rows alone and the reverse', () => {
    expect(withNeeds(entry('dt-wasm-list'), { tmux: 'missing', rvagentWasm: 'present' })).toBe(entry('dt-wasm-list'))
    expect(withNeeds(tmuxRow, { tmux: 'present', rvagentWasm: 'missing' })).toBe(tmuxRow)
  })

  it('keeps an entry that is already n/a on its own reason', () => {
    const fixed = entry('dt-wasm-agent')

    expect(fixed.na).toBeDefined()
    expect(withNeeds(fixed, { tmux: 'missing', rvagentWasm: 'missing' }).na).toBe(fixed.na)
  })
})

describe('n/a WASM rows cannot be run', () => {
  it('give no spec, so console_run has nothing to run, while a runnable row gives one', () => {
    const state = newState({})

    for (const id of ['dt-wasm-gallery', 'dt-wasm-categories', 'dt-wasm-list']) {
      expect(devSpec(entry(id), state.devtools.fields)).not.toBeNull()
      expect(devSpec(withNeeds(entry(id), { tmux: 'unknown', rvagentWasm: 'missing' }), state.devtools.fields)).toBeNull()
    }

    state.devtools.fields.query = 'planner'
    expect(devSpec(entry('dt-wasm-search'), state.devtools.fields)).not.toBeNull()
    expect(devSpec(withNeeds(entry('dt-wasm-search'), { tmux: 'unknown', rvagentWasm: 'missing' }), state.devtools.fields)).toBeNull()
  })
})

describe('when the probe runs', () => {
  const calls = async (view: Parameters<typeof openLoaders>[2]) => {
    const argvs: string[][] = []
    const host = { run: async (argv: string[]) => (argvs.push(argv), { exitCode: 0, stdout: '{"available":false}' }), listCommands: async () => [], invalidate: () => undefined }
    const state = newState({})

    try {
      openLoaders(state, host as never, view)
    } catch {
      // a loader of another view may need more of the host: only the probe call matters here
    }
    await new Promise(resolve => setTimeout(resolve, 10))

    return { probed: argvs.some(argv => argv.includes('wasm-status')), state }
  }

  it('runs for Dev Tools only', async () => {
    expect((await calls('devtools')).probed).toBe(true)

    for (const view of ['sandbox', 'market', 'adrs'] as const) {
      const result = await calls(view)

      expect(result.probed, view).toBe(false)
      expect(result.state.devtools.rvagentWasm, view).toBe('unknown')
    }
  })
})
