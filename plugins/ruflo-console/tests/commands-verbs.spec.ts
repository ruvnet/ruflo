/**
 * /ruflo reads its first word as a verb before it reads a page name (B5 fix round 2): `swarm topology` and `agent timeline` stay the verbs'
 * own arguments, while `learning lab` and `claims board` open their page. Run with
 *   node node_modules/vitest/vitest.mjs run tests/commands-verbs.spec.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseRuflo, VERBS } from '../hooks/commands'

describe('verbs win over page names', () => {
  it('keeps swarm topology a swarm subcommand and agent timeline an agent drill', () => {
    expect(parseRuflo('swarm topology')).toEqual({ kind: 'delegate', owner: 'ruflo-swarm', words: 'topology' })
    expect(parseRuflo('agent timeline')).toEqual({ kind: 'agent', who: 'timeline' })
  })

  it('opens a page by its full or retired name when no verb leads', () => {
    expect(parseRuflo('learning lab')).toEqual({ kind: 'open', view: 'neural' })
    expect(parseRuflo('Claims Board')).toEqual({ kind: 'open', view: 'claims' })
    expect(parseRuflo('learning')).toEqual({ kind: 'open', view: 'learning' })
  })

  it('VERBS is exactly the cases of the switch', () => {
    const source = readFileSync(join(__dirname, '..', 'hooks', 'commands.ts'), 'utf8')
    const body = source.slice(source.indexOf('switch (head)'), source.indexOf('export const HELP'))
    const cases = [...body.matchAll(/case '([^']+)':/g)].map(match => match[1]!)

    expect([...VERBS].sort()).toEqual([...new Set(cases)].sort())
  })

  it('parses every verb-first line of the /ruflo help as the verb, never as a page', () => {
    const source = readFileSync(join(__dirname, '..', 'hooks', 'commands.ts'), 'utf8')
    const lines = [...source.matchAll(/^\s*'\s{2}\/ruflo ([a-z?]+)(?: ([a-z][a-z-]*))?/gm)].map(match => [match[1]!, match[2]])

    for (const [verb, arg] of lines) {
      if (!(VERBS as readonly string[]).includes(verb!)) continue
      const intent = parseRuflo(arg === undefined ? verb! : `${verb} ${arg}`)

      expect(intent.kind === 'open' && verb !== 'open' && verb !== 'agent' && verb !== 'swarm' && verb !== 'events' && verb !== 'timeline', `${verb} ${arg ?? ''}`).toBe(false)
    }
  })
})
