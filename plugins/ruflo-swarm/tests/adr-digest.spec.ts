/**
 * The ADRs a console mission carries, as the swarm hands them to a spawned subagent (ADR-480 in ruflo-console): the digest file is read
 * defensively, and the member row of the agent it guided says which ADRs those were. Run with
 *   npx vitest run plugins/ruflo-swarm/tests/adr-digest.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { readAdrDigest } from '../hooks/adr-digest'
import { newActivity, noteSpawn } from '../hooks/model/members'

const PATH = '.claude-flow/console/adr-digest.json'
const fsOf = (text: string | undefined, size = text?.length) => ({ read: async () => text ?? Promise.reject(new Error('ENOENT')), stat: async () => (text === undefined ? undefined : { size }) })
const digest = (patch: Record<string, unknown> = {}) => JSON.stringify({ v: 1, atMs: 5_000, adrs: [{ number: 7, status: 'accepted' }, { number: 8, status: 'superseded' }], block: 'Decisions attached to this work:\n- ADR 7 [accepted] Sessions', ...patch })

describe('reading the digest', () => {
  it('returns the block and the accepted numbers only', async () => {
    expect(await readAdrDigest(fsOf(digest()), 6_000)).toEqual({ block: 'Decisions attached to this work:\n- ADR 7 [accepted] Sessions', numbers: [7] })
  })

  it.each([
    ['missing', undefined],
    ['not json', '{x'],
    ['wrong version', digest({ v: 2 })],
    ['no block', digest({ block: '' })],
    ['block not text', digest({ block: 5 })],
    ['stale', digest({ atMs: 1 })],
    ['from the future', digest({ atMs: 9e12 })],
    ['not an object', '[]'],
  ])('ignores a digest that is %s', async (_name, text) => {
    expect(await readAdrDigest(fsOf(text), 86_400_000 * 3)).toBeNull()
  })

  it('does not read an oversize file, and caps a long block and ignores escapes in it', async () => {
    expect(await readAdrDigest(fsOf(digest(), 99_999), 6_000)).toBeNull()

    const long = await readAdrDigest(fsOf(digest({ block: `${'- ADR 1 [accepted] x\u001b[31m red\n'.repeat(100)}` })), 6_000)

    expect(long?.block.length).toBeLessThanOrEqual(1400)
    expect(long?.block).not.toContain('\u001b')
    expect(long?.block).not.toContain('[31m')
    expect(PATH).toContain('console')
  })
})

describe('citing the ADRs on the member row', () => {
  it('a spawned agent carries the numbers it was told about, in its description and a field; none leaves both alone', () => {
    const activity = newActivity()

    noteSpawn(activity, 'a1', 'coder', 1, 'impl', 'build it', [7, 9])
    noteSpawn(activity, 'a2', 'coder', 1, 'impl2', 'build that')
    expect(activity.loops.get('a1')).toMatchObject({ adrs: [7, 9], description: 'build it [guided by ADR 7, 9]' })
    expect(activity.loops.get('a2')?.adrs).toBeUndefined()
    expect(activity.loops.get('a2')?.description).toBe('build that')
  })
})
