import { describe, expect, it, vi } from 'vitest'
import { parseManaged } from '../hooks/data/managed'
import type { Host } from '../hooks/host'
import { callTool, classOf, landingRefusal, type ModelToolDeps } from '../hooks/model-tools'
import { paletteEntries } from '../hooks/palette'
import { createRunner } from '../hooks/runner'
import { settingsOf } from '../hooks/settings'
import { newState } from '../hooks/state'

function setup(level: 'read' | 'write' | 'manage' | 'full' = 'full', confirm: 'ask' | 'auto' = 'ask') {
  const state = newState({})
  state.view = 'workflows'
  state.options.cli = 'ruflo'
  Object.assign(settingsOf(state).ai, { modelControl: level, modelConfirm: confirm })
  state.snapshot = { managed: parseManaged(JSON.stringify({ version: 1, updatedMs: Date.now(), sessions: ['sesn_a', 'sesn_b'].map(sessionId => ({
    sessionId, status: 'running', providerFinished: false, workersInspected: true, acceptancePassed: true, verification: 'verified',
    runs: [], threads: [], blockedEventIds: [], observedFailures: 0,
  })) })) } as any
  const run = vi.fn(async (_argv: readonly string[]) => ({ exitCode: 0, stdout: '{"success":true}', stderr: '' }))
  const host = { run, invalidate: () => undefined, after: () => ({ cancel: () => undefined }) } as unknown as Host
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined, landingRefusal: pending => landingRefusal(state, pending) })
  const deps = { state, control: { host, runner, actions: { workflows: { ask: () => undefined, show: () => undefined } } } } as unknown as ModelToolDeps
  const entries = () => paletteEntries(state, Date.now()).filter(entry => entry.group === 'managed')
  return { state, run, runner, deps, entries }
}

describe('managed session palette actions', () => {
  it('lists bounded exact session ids, with the selected run first, through console_state', async () => {
    const ctx = setup()
    ctx.state.wf.ui.run = 1
    expect(ctx.entries().map(entry => entry.id)).toEqual(['managed-inspect-sesn_b', 'managed-interrupt-sesn_b', 'managed-terminate-sesn_b', 'managed-inspect-sesn_a', 'managed-interrupt-sesn_a', 'managed-terminate-sesn_a'])
    expect(ctx.entries()[0]!.label).toContain('(selected)')
    const answer = JSON.parse(await callTool('console_state', { filter: 'managed' }, ctx.deps))
    expect(answer.entries.map((entry: { id: string }) => entry.id).filter((id: string) => id.startsWith('managed-'))).toEqual(ctx.entries().map(entry => entry.id))
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it('never offers arbitrary or missing sessions and removes vanished targets', async () => {
    const ctx = setup()
    for (const id of ['managed-inspect', 'managed-inspect-sesn_c', 'managed-inspect-sesn_a;echo', 'managed-inspect-sesn_../../etc']) {
      expect(await callTool('console_run', { id, text: 'sesn_b' }, ctx.deps)).toContain('no palette entry')
    }
    ctx.state.snapshot!.managed!.sessions = []
    expect(ctx.entries()).toEqual([])
    expect(await callTool('console_run', { id: 'managed-inspect-sesn_a' }, ctx.deps)).toContain('no palette entry')
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it.each(['inspect', 'interrupt', 'terminate'] as const)('queues %s through console_run and executes only its fixed confirmed target', async action => {
    const ctx = setup()
    expect(await callTool('console_run', { id: `managed-${action}-sesn_a`, text: 'sesn_b --approved' }, ctx.deps)).toContain('Waiting for the person')
    expect(ctx.run).not.toHaveBeenCalled()
    ctx.state.wf.ui.run = 1
    await ctx.runner.confirm(ctx.state.pending!.id)
    expect(ctx.run).toHaveBeenCalledTimes(1)
    const argv = ctx.run.mock.calls[0]![0]
    expect(argv.slice(0, 6)).toEqual(['ruflo', 'mcp', 'exec', '-t', 'managed_agent_control', '-p'])
    expect(JSON.parse(argv[6]!)).toEqual({ sessionId: 'sesn_a', action })
  })

  it.each([['inspect', 'write', 'network'], ['interrupt', 'manage', 'delete'], ['terminate', 'manage', 'delete']] as const)('denies %s below its existing permission class', async (action, level, kind) => {
    const ctx = setup(level)
    const entry = ctx.entries().find(entry => entry.id === `managed-${action}-sesn_a`)!
    expect(entry.run.kind).toBe('spec')
    if (entry.run.kind === 'spec') expect(classOf(entry.run.spec!)).toBe(kind)
    expect(await callTool('console_run', { id: entry.id }, ctx.deps)).toContain(`is a ${kind} action`)
    expect(ctx.state.pending).toBeNull()
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it('rechecks current console permission at confirmation after a level change', async () => {
    const ctx = setup()
    await callTool('console_run', { id: 'managed-inspect-sesn_a' }, ctx.deps)
    Object.assign(settingsOf(ctx.state).ai, { modelControl: 'read' })
    await ctx.runner.confirm(ctx.state.pending!.id)
    expect(ctx.run).not.toHaveBeenCalled()
    expect(ctx.state.outcome?.detail).toContain('not run')
  })

  it('keeps destructive controls awaiting a person in auto mode', async () => {
    const ctx = setup('full', 'auto')
    expect(await callTool('console_run', { id: 'managed-terminate-sesn_a' }, ctx.deps)).toContain('Waiting for the person')
    expect(ctx.run).not.toHaveBeenCalled()
  })

  it('surfaces fresh backend policy refusal despite optimistic snapshot facts', async () => {
    const ctx = setup()
    ctx.run.mockResolvedValue({ exitCode: 0, stdout: '{"isError":true,"error":"fresh host policy denied"}', stderr: '' })
    await callTool('console_run', { id: 'managed-inspect-sesn_a' }, ctx.deps)
    await ctx.runner.confirm(ctx.state.pending!.id)
    expect(ctx.state.outcome?.ok).toBe(false)
    expect(ctx.run).toHaveBeenCalledTimes(1)
    expect(JSON.parse(ctx.run.mock.calls[0]![0][6]!)).toEqual({ sessionId: 'sesn_a', action: 'inspect' })
  })
})
