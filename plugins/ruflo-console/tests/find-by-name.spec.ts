/**
 * Any page by name (B6): viewOf matches a label prefix and label words under one ranked rule, `/ruflo go <page>` always opens a page (or says which
 * pages are close), and the palette lists pages and puts the one whose label starts with the query first. Run with
 *   node node_modules/vitest/vitest.mjs run tests/find-by-name.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { parseRuflo, VERBS } from '../hooks/commands'
import { filterPalette, paletteEntries } from '../hooks/palette'
import { newState, pagesLike, viewMatches, viewOf, VIEWS } from '../hooks/state'

describe('viewOf matches names, prefixes and words', () => {
  it('finds a page by a word of its label', () => {
    expect(viewOf('catalog')).toBe('market')
    expect(viewOf('Plugin Catalog')).toBe('market')
    expect(viewOf('doctor')).toBe('secure')
    expect(viewOf('tools')).toBe('devtools')
  })

  it('finds a page by words of its label or a retired name, in any order', () => {
    expect(viewOf('learn lab')).toBe('neural')
    expect(viewOf('lab learn')).toBe('neural')
    expect(viewOf('learning lab')).toBe('neural')
    expect(viewOf('  Neural   LAB ')).toBe('neural')
  })

  it('finds a page by a label prefix', () => {
    expect(viewOf('security')).toBe('secure')
    expect(viewOf('perform')).toBe('perf')
    expect(viewOf('main')).toBe('menu')
  })

  it('ranks exact over alias over id prefix over label prefix over words', () => {
    expect(viewOf('learning')).toBe('learning') // the Learning page, though "learning lab" is a retired name of the Neural Lab
    expect(viewOf('plugin')).toBe('plugins') // an id prefix beats the Plugin Catalog label prefix
    expect(viewOf('plugin catalog')).toBe('market')
    expect(viewMatches('learn')).toEqual(['learning'])
  })

  it('says null when two pages tie at the best rule, and offers both', () => {
    expect(viewOf('lab')).toBeNull()
    expect(viewMatches('lab').sort()).toEqual(['memory', 'neural', 'vector'])
    expect(viewOf('board')).toBeNull()
    expect(viewOf('zzzz')).toBeNull()
  })

  it('keeps a single letter meaning the page key, never a prefix', () => {
    for (const view of VIEWS) if (view.key !== '') expect(viewOf(view.key), view.key).toBe(view.id)
    // 'k' and 'o' are no page key (reserved), so a letter that starts several labels opens nothing.
    expect(viewOf('k')).toBeNull()
    expect(viewOf('o')).toBeNull()
    expect(viewOf('ti')).toBeNull()
  })

  it('pagesLike lists close pages for a name that opened nothing', () => {
    expect(pagesLike('lab')).toEqual(expect.arrayContaining(['neural', 'vector']))
    expect(pagesLike('zzzz')).toEqual([])
  })
})

describe('/ruflo go', () => {
  it('is a verb', () => {
    expect(VERBS).toContain('go')
  })

  it('always opens the page the name means', () => {
    expect(parseRuflo('go catalog')).toEqual({ kind: 'open', view: 'market' })
    expect(parseRuflo('go learn lab')).toEqual({ kind: 'open', view: 'neural' })
    expect(parseRuflo('go missions')).toEqual({ kind: 'open', view: 'missions' })
    expect(parseRuflo('go swarm')).toEqual({ kind: 'open', view: 'swarm' })
    expect(parseRuflo('go')).toEqual({ kind: 'open', view: null })
  })

  it('says there is no such page, with the close ones, when nothing (or two pages) match', () => {
    expect(parseRuflo('go lab')).toEqual({ kind: 'nopage', query: 'lab' })
    expect(parseRuflo('go zzzz')).toEqual({ kind: 'nopage', query: 'zzzz' })
  })

  it('leaves /ruflo mission and /ruflo catalog meaning what they did', () => {
    expect(parseRuflo('mission')).toMatchObject({ kind: 'run', paletteId: 'mission-status' })
    expect(parseRuflo('catalog')).toEqual({ kind: 'commands', query: '' })
  })
})

describe('the palette finds pages', () => {
  const rank = (query: string): string[] => filterPalette(paletteEntries(newState({}), Date.now()), query, 'all').map(entry => entry.id)

  it('lists the Timeline page first for "time"', () => {
    expect(rank('time')[0]).toBe('view-timeline')
  })

  it('puts a page whose label starts with the query ahead of one that merely contains it', () => {
    expect(rank('cost')[0]).toBe('view-cost')
    expect(rank('settings')[0]).toBe('view-settings')
  })

  it('lists a page by the words viewOf understands', () => {
    expect(rank('catalog')).toContain('view-market')
    expect(rank('learn lab')).toContain('view-neural')
  })
})
