import { describe, expect, test, tier } from 'claude-code/testing'

import { CHECK_FAILED, checkPath, FAST_PATH_TTL_MS, forAgent } from '../hooks/guard'
import { policyOpinion } from '../hooks/guard/policy'
import { askFor } from '../hooks/guard/research'
import { stricter } from '../hooks/guard/verdict'
import { ROOT, START, world, type World } from './fixtures/world'

tier('user')

/**
 * The guard on Claude Code 2.1.290–2.1.304 fields: `isReadOnly` takes a fast path that skips the policy file stat,
 * `agentId` names the subagent on ruflo's reasons, `ceiling` survives a tightening, `decider: "person"` marks every
 * ask ruflo raises, and `.catch` (2.1.301: only on a throw or timeout) still fails closed. Older hosts send none of
 * these fields, so every case without them is the full check it always was.
 */

const PROJECTION = `${ROOT}/.claude-flow/policy/claude-code.json`
const MARKER = `${ROOT}/.claude-flow/research-active.json`

/** How often the guard stat-ed the projection file. */
const projectionStats = (w: World) => w.stats.filter(path => path === PROJECTION).length

const enforce = (rules: unknown[]) => JSON.stringify({ version: 1, mode: 'enforce', generatedAt: 1, rules })
const read = (file = 'a.ts') => ({ tool: 'Read', input: { file_path: file }, isReadOnly: true }) as never

describe('guard: read-only fast path (2.1.304 isReadOnly)', () => {
  test('a read-only call skips the policy stat while no projection was found; a write call always looks', async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    expect((await $.tool.check(read())).decision).toBe('allow') // first: a full check finds no projection
    const afterFirst = projectionStats(w)
    expect(afterFirst).toBeGreaterThan(0)
    for (let i = 0; i < 5; i++) expect((await $.tool.check(read(`f${i}.ts`))).decision).toBe('allow')
    expect(projectionStats(w)).toBe(afterFirst) // the fast path read nothing

    expect((await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' } })).decision).toBe('allow')
    expect(projectionStats(w)).toBeGreaterThan(afterFirst) // not read-only: the full check
  })

  test('a projection that exists keeps every read-only call on the full check, so an enforce deny on Read holds', async ($, on) => {
    const rule = { id: 'no-secrets', effect: 'deny', actions: ['claude-code.tool.Read'], resources: ['/work/.env'] }
    world(on, {}, { [PROJECTION]: enforce([rule]) })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    for (let i = 0; i < 3; i++) {
      expect(await $.tool.check(read('/work/.env'))).toMatchObject({ decision: 'deny', reason: 'ruflo policy: denied-by:no-secrets' })
    }
    expect((await $.tool.check(read('/work/a.ts'))).decision).toBe('allow')
  })

  test('a projection written mid-session reaches read-only calls once a write call or the window has looked', async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)
    expect((await $.tool.check(read('/work/.env'))).decision).toBe('allow') // no projection yet

    w.files.set(PROJECTION, enforce([{ id: 'no-secrets', effect: 'deny', actions: ['claude-code.tool.Read'], resources: ['/work/.env'] }]))
    expect((await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' } })).decision).toBe('allow') // a write call reads it
    expect((await $.tool.check(read('/work/.env'))).decision).toBe('deny')
  })

  test('the dangerous-command list still applies on the fast path', async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)
    await $.tool.check(read()) // primes "no projection"

    const out = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' }, isReadOnly: true } as never)
    expect(out.decision).toBe('deny')
    expect(out.reason).toContain('dangerous command blocked')
  })

  test('web tools never take the fast path: the research guard still asks on the first fetch of a run', async ($, on) => {
    const startedAt = new Date(Date.now() - 1000).toISOString()
    world(on, {}, { [MARKER]: JSON.stringify({ question: 'How do indexes scale?', capUsd: 2, startedAt }) })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)
    await $.tool.check(read()) // primes "no projection"

    expect((await $.tool.check({ tool: 'WebFetch', input: { url: 'https://example.com' }, isReadOnly: true } as never)).decision).toBe('ask')
  })

  test('a chain that already denies is returned as it came, with no file read', async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'deny', reason: 'host rule', rule: 'Read(.env)' }))
    await $.session.start(START)

    expect(await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' } })).toMatchObject({ decision: 'deny', reason: 'host rule', rule: 'Read(.env)' })
    expect(projectionStats(w)).toBe(0)
  })
})

describe('guard: agentId, ceiling, decider (2.1.290, 2.1.304)', () => {
  test('a subagent is named on ruflo’s own reason; a malformed id is left out', async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    const sub = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' }, agentId: 'agent-7' } as never)
    expect(sub.reason).toMatch(/dangerous command blocked .*\(subagent agent-7\)$/)
    const odd = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' }, agentId: 'x\u001b[2Jy' } as never)
    expect(odd.reason).not.toContain('subagent')
    const main = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' } })
    expect(main.reason).not.toContain('subagent')
  })

  test('the organization’s ceiling rides on a verdict ruflo tightened', async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    // A kit before 2.1.290 has no ceiling to carry: an untouched allow comes back without one there.
    const untouched = (await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' }, ceiling: 'ask' } as never)) as { ceiling?: unknown }
    if (untouched.ceiling === undefined) return
    const out = (await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf /' }, ceiling: 'ask' } as never)) as { decision: string; ceiling?: unknown }
    expect(out.decision).toBe('deny')
    expect(out.ceiling).toBe('ask')
  })

  test('stricter keeps the chain’s ceiling, and never invents one', () => {
    const chain = { decision: 'allow' as const, ceiling: { approval: 'admin' } }
    expect(stricter(chain, { decision: 'deny', reason: 'r' })).toEqual({ decision: 'deny', reason: 'r', ceiling: { approval: 'admin' } })
    expect(stricter({ decision: 'allow' }, { decision: 'ask' })).toEqual({ decision: 'ask' })
    expect(stricter(chain, { decision: 'allow' })).toBe(chain)
  })

  test('every ask ruflo raises is for a person to answer; denies carry no decider', () => {
    expect(CHECK_FAILED).toMatchObject({ decision: 'ask', decider: 'person' })
    expect(askFor('WebFetch', { question: 'q', capUsd: 1, startedAt: new Date().toISOString() }).decider).toBe('person')
    const projection = { mode: 'enforce' as const, rules: [{ id: 'gate', effect: 'require_approval' as const, actions: ['claude-code.tool.Edit'] }, { id: 'no', effect: 'deny' as const, actions: ['claude-code.tool.Write'] }] }
    expect(policyOpinion(projection, 'Edit', {}).verdict).toMatchObject({ decision: 'ask', decider: 'person' })
    expect(policyOpinion(projection, 'Write', {}).verdict?.decider).toBeUndefined()
  })

  test('an unreadable projection asks with the person as decider, read-only or not', async ($, on) => {
    world(on, {}, { [PROJECTION]: '{torn' })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    expect((await $.tool.check(read())).decision).toBe('ask')
    expect((await $.tool.check(read())).decision).toBe('ask')
  })
})

describe('guard: .catch (2.1.301: only when the hook throws or times out)', () => {
  test('a chain that throws beneath the guard is put to the person, never allowed', async ($, on) => {
    world(on)
    on('tool.check', () => {
      throw new Error('a hook beneath failed')
    })
    await $.session.start(START)

    expect(await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' } })).toMatchObject({ decision: 'ask', reason: CHECK_FAILED.reason })
    expect((await $.tool.check({ ...(read() as object), agentId: 'agent-2' } as never)).reason).toContain('(subagent agent-2)')
  })
})

describe('guard: checkPath, pure', () => {
  const allow = { decision: 'allow' as const }
  test('final on a deny; read-only only for a literal true, a non-web tool and inside the window; full otherwise', () => {
    expect(checkPath({ tool: 'Read', isReadOnly: true }, { decision: 'deny' }, 0, 0)).toBe('final')
    expect(checkPath({ tool: 'Read', isReadOnly: true }, allow, 10, 5)).toBe('read-only')
    expect(checkPath({ tool: 'Read', isReadOnly: true }, { decision: 'ask' }, 10, 5)).toBe('read-only')
    expect(checkPath({ tool: 'Read', isReadOnly: true }, allow, 10, 10)).toBe('full') // window passed
    expect(checkPath({ tool: 'Read', isReadOnly: 'true' }, allow, 10, 5)).toBe('full')
    expect(checkPath({ tool: 'Read' }, allow, 10, 5)).toBe('full') // a host before 2.1.304
    expect(checkPath({ tool: 'WebSearch', isReadOnly: true }, allow, 10, 5)).toBe('full')
    expect(checkPath({ tool: 'Edit', isReadOnly: false }, allow, 10, 5)).toBe('full')
    expect(FAST_PATH_TTL_MS).toBeGreaterThan(0)
  })

  test('forAgent tags only printable ids', () => {
    expect(forAgent({ decision: 'ask', reason: 'r' }, 'a_1').reason).toBe('r (subagent a_1)')
    expect(forAgent({ decision: 'ask', reason: 'r' }, '').reason).toBe('r')
    expect(forAgent({ decision: 'ask', reason: 'r' }, 'x'.repeat(65)).reason).toBe('r')
    expect(forAgent({ decision: 'ask', reason: 'r' }, 42).reason).toBe('r')
  })
})
