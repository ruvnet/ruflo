/**
 * One group scheme (B5): the nav's groups (NAV_GROUPS) are the only grouping. The main menu's boxes and the Help index's sections are
 * built from them (same names, same order, same pages), and a page has one name in the menu, the tabs, the palette and the help text.
 * Run with
 *   node node_modules/vitest/vitest.mjs run tests/group-scheme.spec.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { GROUP_BLURB, HELP_GROUPS, VIEW_TOPIC } from '../hooks/help-docs'
import { TOPICS } from '../hooks/help-topics'
import { ACCENT, NAV_ACCENT } from '../hooks/menu-colors'
import { groupOf, NAV_GROUPS } from '../hooks/nav-state'
import { parseRuflo } from '../hooks/commands'
import { VIEWS, viewOf } from '../hooks/state'
import { GROUPS, MENU_SECTIONS } from '../hooks/views/menu'

const navTitles = NAV_GROUPS.map(group => group.title)
const navPages = (title: string): string[] => NAV_GROUPS.find(group => group.title === title)!.rows.flat()
const labelOf = (id: string): string => VIEWS.find(view => view.id === id)!.label

describe('the main menu is the nav groups', () => {
  it('has the same groups in the same order, under the same names', () => {
    expect(GROUPS.map(group => group.title)).toEqual(navTitles)
  })

  it('holds the same pages in each group as the nav does (the commands apart)', () => {
    const commands = new Set(['palette', 'help', 'close'])

    for (const group of GROUPS) {
      const pages = group.sections.flatMap(section => section.items.map(item => item.go)).filter(go => !commands.has(go))

      expect([...pages].sort(), group.title).toEqual([...navPages(group.title)].sort())
      expect(new Set(pages).size, `${group.title} lists a page twice`).toBe(pages.length)
    }
  })

  it('only sub-divides a group by pages it really has', () => {
    for (const [title, sections] of Object.entries(MENU_SECTIONS)) {
      expect(navTitles, title).toContain(title)
      for (const section of sections) for (const id of section.ids) expect(groupOf(id as never), `${title} > ${section.name} > ${id}`).toBe(title)
    }
  })

  it('names every page by its one label', () => {
    for (const group of GROUPS) for (const section of group.sections) for (const item of section.items) if (VIEWS.some(view => view.id === item.go)) expect(item.label, item.go).toBe(labelOf(item.go))
  })

  it('has one accent per group, shared by the menu and the nav', () => {
    expect(Object.keys(ACCENT).sort()).toEqual([...navTitles].sort())
    expect(NAV_ACCENT).toEqual(ACCENT)
  })
})

describe('the Help index is the nav groups', () => {
  it('lists Start, then each nav group in order, then Console (usage that is not a page)', () => {
    expect(HELP_GROUPS).toEqual(['Start', ...navTitles, 'Console'])
    for (const group of HELP_GROUPS) expect(GROUP_BLURB[group], group).toBeTruthy()
  })

  it('files the guide for a page under that page group', () => {
    const wrong: string[] = []

    for (const topic of new Set(Object.values(VIEW_TOPIC))) {
      const guide = TOPICS.find(entry => entry.id === topic)!
      const groups = Object.entries(VIEW_TOPIC).filter(([, id]) => id === topic).map(([view]) => groupOf(view as never))

      if (!groups.includes(guide.group)) wrong.push(`${guide.id}: ${guide.group}, its pages are in ${[...new Set(groups)].join(' / ')}`)
    }

    expect(wrong).toEqual([])
  })

  it('keeps Start and Console for guides that are not about one page', () => {
    for (const guide of TOPICS.filter(entry => entry.group === 'Start' || entry.group === 'Console')) expect(Object.values(VIEW_TOPIC), guide.id).not.toContain(guide.id)
  })
})

describe('one name per page', () => {
  it('gives no two pages the same label', () => {
    const labels = VIEWS.map(view => view.label)

    expect(new Set(labels).size).toBe(labels.length)
  })

  it('keeps Learning (7) and the Neural Lab (l) apart by name', () => {
    expect(labelOf('learning')).toBe('Learning')
    expect(labelOf('neural')).toBe('Neural Lab')
  })

  it('never writes a retired page name in what the person reads', () => {
    const retired = ['Learning Lab', 'Plugins & Mods', 'Memory Lab', 'Event Stream', 'Cost & Budget']
    const strings: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name))
        else if (entry.name.endsWith('.ts')) for (const line of readFileSync(join(dir, entry.name), 'utf8').split(/\r?\n/)) if (!/^\s*(\/\*\*|\*|\/\/)/.test(line) && !/^\s*'[^']+': '\w+',?$/.test(line)) strings.push(`${entry.name}: ${line.trim()}`)
      }
    }

    walk(join(__dirname, '..', 'hooks'))
    const found = (name: string): RegExp => new RegExp(`(?<![\w-])${name.replace(/[.*+?^${}()|[]\]/g, '\$&')}(?![\w-])`, 'i')

    expect(strings.filter(line => !line.startsWith('menu-aliases') && retired.some(name => found(name).test(line))).slice(0, 20)).toEqual([])
  })
})

describe('the boot log', () => {
  it('names each area by its page label', async () => {
    const { BOOT_MODULES } = await import('../hooks/gfx/boot')
    const labels = new Set(VIEWS.filter(view => view.id !== 'menu').map(view => view.label))

    expect(BOOT_MODULES.map(entry => entry.name).filter(name => !labels.has(name))).toEqual([])
  })
})

describe('retired page names still reach their page', () => {
  const ALIASES: Record<string, string> = {
    'learning lab': 'neural', 'Learning Lab': 'neural', 'memory lab': 'memory', 'claims board': 'claims', 'plugins & mods': 'plugins', 'plugins and mods': 'plugins',
    'swarm topology': 'swarm', 'agent timeline': 'timeline', 'event stream': 'events', 'cost & budget': 'cost', 'cost and budget': 'cost', 'the room': 'room', 'ai terminal': 'terminal',
    'x.ruv.io board': 'xruv',
  }

  it('resolves through viewOf, in any case', () => {
    for (const [name, id] of Object.entries(ALIASES)) expect(viewOf(name), name).toBe(id)
  })

  it('opens the page from /ruflo <name> and from the menu prompt', () => {
    expect(parseRuflo('learning lab')).toEqual({ kind: 'open', view: 'neural' })
    expect(parseRuflo('claims board')).toEqual({ kind: 'open', view: 'claims' })
    expect(parseRuflo('learning')).toEqual({ kind: 'open', view: 'learning' })
  })

  it('does not teach a retired name in the key help (any case)', () => {
    const text = TOPICS.flatMap(topic => topic.steps.map(step => step.text)).join('\n')

    expect(text).not.toMatch(/\b(learning lab|memory lab|claims board|plugins & mods|swarm topology)\b/i)
  })
})
