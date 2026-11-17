import { describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'
import { MANAGED_PATH, LEARNING_PATH, managedRuns, parseManaged, parseManagedLearning, readManaged } from '../hooks/data/managed'
import { managedAction } from '../hooks/managed-actions'
import { workflowsModelOf } from '../hooks/wf-live'
import { workflowsView } from '../hooks/views/workflows'
import { managedApprovalRows, managedBudgetRows, managedLearningRows } from '../hooks/views/managed'
import { newState } from '../hooks/state'
import { newWfUi } from '../hooks/data/workflows-nav'
import { THEME, type Ctx, type Kit } from '../hooks/views/common'

const NOW = 1_000_000
const session = (extra = {}) => ({ sessionId: 'sesn_a', status: 'idle', stopReason: 'end_turn', budgetCents: 2500, listCostCents: 100,
  providerFinished: true, workersInspected: true, acceptancePassed: true, verification: 'verified',
  runs: [{ id: 'wrun_a', status: 'ended', result: 'completed' }], threads: [{ id: 'thread_a', runId: 'wrun_a', status: 'completed' }],
  blockedEventIds: [], observedFailures: 0, ...extra })
const snapshot = (sessions: unknown[] = [session()], extra = {}) => JSON.stringify({ version: 1, updatedMs: NOW, sessions, ...extra })
const tree = (node: unknown, out: any[] = []): any[] => {
  if (Array.isArray(node)) node.forEach(n => tree(n, out))
  else if (node && typeof node === 'object') { out.push(node); tree((node as any).props?.children, out) }
  return out
}
const textOf = (node: unknown) => tree(node).filter(n => n.kind === 'Text').map(n => n.props.children).join('\n')
const kit = Object.fromEntries(['Text', 'Box', 'Button'].map(kind => [kind, (props: any) => ({ kind, props })])) as unknown as Kit
function context(facts = parseManaged(snapshot())): Ctx {
  const state = newState({})
  state.snapshot = { managed: facts } as any
  return { kit, state, nowMs: NOW, columns: 100, pictures: new Map(), act: { workflows: { ask: vi.fn() } } as any }
}

describe('managed run state shown in the console', () => {
  // The console used to show anything that was not literally `running` as `finished`.
  it.each([
    ['rescheduling is still running', { status: 'rescheduling', stopReason: null, providerFinished: false }, 'running'],
    ['a budget stop is not finished', { status: 'idle', stopReason: 'budget_reached', providerFinished: false }, 'active'],
    ['waiting on a required action is not finished', { status: 'idle', stopReason: 'requires_action', providerFinished: false }, 'active'],
    ['an open tool request is not finished', { blockedEventIds: ['evt_a'] }, 'active'],
    ['a completed turn is finished', {}, 'finished'],
  ])('%s', (_name, extra, state) => {
    const facts = parseManaged(snapshot([session(extra)]))!
    expect(managedRuns(facts, NOW)[0]!.state).toBe(state)
  })
})

describe('managed local snapshot contract', () => {
  it('never treats snapshot verification booleans as authority', () => {
    const facts = parseManaged(snapshot())!
    expect(facts.sessions[0]).toMatchObject({ providerFinished: true, workersInspected: false, acceptancePassed: false, verification: 'unverified' })
  })
  it.each([null, '{}', snapshot([], { version: 2 }), snapshot([session({ sessionId: '../secret' })]), snapshot([session(), session()])])('refuses malformed input %s', value => {
    expect(parseManaged(value)).toBeNull()
  })
  it('deduplicates 1000 workers and keeps a bounded visible page', () => {
    const threads = Array.from({ length: 1000 }, (_, i) => ({ id: `t_${i}`, runId: 'wrun_a', status: i % 2 ? 'running' : 'completed' }))
    const facts = parseManaged(snapshot([session({ status: 'running', threads: [...threads, ...threads.slice(0, 10)], threadCount: 1000 })]))!
    expect(facts.sessions[0]).toMatchObject({ threadCount: 1000, partial: true, threadCounts: { running: 500, ended: 500 } })
    expect(facts.sessions[0]!.threads).toHaveLength(60)
    expect(managedRuns(facts, NOW)[0]).toMatchObject({ kind: 'managed', total: 1000, running: 500, done: 500 })
  })
  it('preserves provider phase names and worker association', () => {
    const facts = parseManaged(snapshot([session({ runs: [{ id: 'wrun_a', status: 'running', phases: [{ id: 'phase_a', name: 'Independent reproduction', status: 'running' }] }], threads: [{ id: 'thread_a', runId: 'wrun_a', phaseId: 'phase_a', status: 'running' }] })]))!
    const run = managedRuns(facts, NOW)[0]!
    expect(run.phases[0]!.title).toContain('Independent reproduction')
    expect(run.phases[0]!.agents[0]!.id).toBe('thread_a')
  })
  it('marks stale snapshots without manufacturing completion', () => {
    const run = managedRuns(parseManaged(snapshot()), NOW + 31_000)[0]!
    expect(run).toMatchObject({ state: 'stalled', isStale: true })
  })
  it('does not freshen another session when the snapshot is refreshed', () => {
    const facts = parseManaged(snapshot([session({ sessionId: 'sesn_old', updatedMs: NOW - 31_000 }), session({ sessionId: 'sesn_new', updatedMs: NOW })]))!
    const runs = managedRuns(facts, NOW)
    expect(runs[0]).toMatchObject({ id: 'sesn_old', isStale: true, state: 'stalled', updatedMs: NOW - 31_000 })
    expect(runs[1]).toMatchObject({ id: 'sesn_new', isStale: false, updatedMs: NOW })
  })
  it('preserves unknown cost instead of turning it into zero', () => {
    expect(parseManaged(snapshot([session({ listCostCents: undefined })]))!.sessions[0]!.listCostCents).toBeNull()
  })
  it('rejects negative and impossible aggregate counts', () => {
    expect(parseManaged(snapshot([session({ threadCount: 1, threadCounts: { running: 2, ended: 0, failed: 0, idle: 0 } })]))).toBeNull()
  })
  it('reuses unchanged parsed snapshot and summary without rereading file contents', async () => {
    const files = new Map([[`/work/${MANAGED_PATH}`, snapshot()], [`/work/${LEARNING_PATH}`, '{}']])
    const read = vi.fn(async (p: string) => files.get(p)!)
    const fs = { read, stat: async (p: string) => ({ kind: 'file', size: files.get(p)!.length, mtimeMs: 1 }), list: async () => [] }
    const cache = new Map()
    const a = await readManaged(fs, cache, '/work'), b = await readManaged(fs, cache, '/work')
    expect(read).toHaveBeenCalledTimes(2)
    expect(a.managed).toBe(b.managed)
  })
})

describe('first class managed views and safe controls', () => {
  it('renders managed runs before native workflow discovery and never gives a green correctness badge', () => {
    const ctx = context(), model = workflowsModelOf(ctx.state, NOW)!
    expect(model.runs[0]!.kind).toBe('managed')
    const result = workflowsView(ctx, model, newWfUi(), { ask: vi.fn(), show: vi.fn() })
    expect(textOf(result)).toContain('correctness remains unverified')
    expect(textOf(result)).toContain('workers')
    expect(tree(result).filter(n => n.kind === 'Text' && n.props.color === THEME.ok)).toHaveLength(0)
    expect(tree(result).filter(n => n.kind === 'Button').map(n => n.props.label)).toEqual(expect.arrayContaining(['Inspect', 'Interrupt', 'Terminate']))
  })
  it('renders measured budgets, pending decisions and advisory evidence separately', () => {
    const ctx = context(parseManaged(snapshot([session({ stopReason: 'requires_action', blockedEventIds: ['sevt_a'] })])))
    expect(textOf(managedBudgetRows(ctx))).toContain('$1.00 reported / $25.00 budget')
    expect(textOf(managedApprovalRows(ctx))).toContain('requires_action')
    ctx.state.snapshot!.managedLearning = parseManagedLearning(JSON.stringify({ version: 1, updatedMs: NOW, advisory: true, defaultsChanged: false, observations: 8, verified: 6, quarantined: 2, training: 3, holdout: 3, lastRecommendation: { selected: { strategy: { id: 'small' }, samples: 3, successesPerDollar: 2, p95Ms: 10, evidenceIds: ['a'.repeat(64)] } } }))
    const lines = textOf(managedLearningRows(ctx))
    expect(lines).toContain('small')
    expect(lines).toContain('Defaults remain unchanged')
    expect(lines).toContain('aaaaaaaaaaaa')
  })
  it('builds fixed argv, asks first and never passes snapshot approval fields', () => {
    for (const action of ['inspect', 'interrupt', 'terminate'] as const) {
      const spec = managedAction('sesn_a', action)!
      expect(spec.isReadOnly).not.toBe(true)
      expect(spec.args.slice(0, 5)).toEqual(['mcp', 'exec', '-t', 'managed_agent_control', '-p'])
      expect(JSON.parse(spec.args[5]!)).toEqual({ sessionId: 'sesn_a', action })
      expect(spec.expect).toContain('fresh provider')
    }
    expect(managedAction('sesn_a;rm', 'terminate')).toBeNull()
  })
  it('pages worker inspection through fixed confirm-gated controls', () => {
    const ctx = context(parseManaged(snapshot([session({ threads: Array.from({ length: 60 }, (_, i) => ({ id: `t_${i}`, runId: 'wrun_a', status: 'running' })), threadCount: 1000, threadOffset: 60 })])))
    const ask = vi.fn(), model = workflowsModelOf(ctx.state, NOW)!
    const view = workflowsView(ctx, model, newWfUi(), { ask, show: vi.fn() })
    const next = tree(view).find(n => n.kind === 'Button' && n.props.label === 'Next workers')
    next.props.onPress()
    expect(JSON.parse(ask.mock.calls[0][0].args[5])).toEqual({ sessionId: 'sesn_a', action: 'inspect', threadOffset: 120 })
    expect(managedAction('sesn_a', 'terminate', 60)).toBeNull()
    expect(managedAction('sesn_a', 'inspect', -1)).toBeNull()
  })
  it('does not call a provider while rendering a hidden or inactive snapshot', () => {
    const ctx = context(), ask = vi.fn()
    workflowsView(ctx, workflowsModelOf(ctx.state, NOW), newWfUi(), { ask, show: vi.fn() })
    managedBudgetRows(ctx); managedApprovalRows(ctx); managedLearningRows(ctx)
    expect(ask).not.toHaveBeenCalled()
  })
  it('keeps warm bounded managed render below 16ms median on the local fixture', () => {
    const threads = Array.from({ length: 1000 }, (_, i) => ({ id: `t_${i}`, runId: 'wrun_a', status: 'running' }))
    const ctx = context(parseManaged(snapshot([session({ threads, threadCount: 1000, status: 'running' })])))
    const model = workflowsModelOf(ctx.state, NOW)!, samples: number[] = []
    for (let i = 0; i < 30; i++) {
      const start = performance.now()
      workflowsView(ctx, model, newWfUi(), { ask: () => {}, show: () => {} })
      samples.push(performance.now() - start)
    }
    expect(samples.sort((a, b) => a - b)[15]).toBeLessThan(16)
  })
})
