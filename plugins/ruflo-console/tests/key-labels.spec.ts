/**
 * Every "<page label> (<key>)" hint in the source names the key that page really has (B4): the hints are read out of the hooks sources as text
 * and checked against VIEWS, so a renumbered page cannot leave "Swarm (2)" behind. Run with
 *   node node_modules/vitest/vitest.mjs run tests/key-labels.spec.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { HELP } from '../hooks/commands'
import { TOPICS } from '../hooks/help-topics'
import { keyLabel, VIEWS } from '../hooks/state'

const HOOKS = join(__dirname, '..', 'hooks')

const sourcesOf = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? sourcesOf(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []))

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('keyLabel', () => {
  it('names a page with its key, and a page without one by its label alone', () => {
    expect(keyLabel('cost')).toBe('Cost (c)')
    expect(keyLabel('swarm')).toBe('Swarm (3)')
    expect(keyLabel('memory')).toBe('Memory (9)')
    expect(keyLabel('workflows')).toBe('Workflows')
  })

  it('agrees with VIEWS for every page', () => {
    for (const view of VIEWS) expect(keyLabel(view.id)).toBe(view.key === '' ? view.label : `${view.label} (${view.key})`)
  })
})

describe('every "(key)" hint in the source', () => {
  const labels = VIEWS.map(view => escape(view.label)).sort((a, b) => b.length - a.length)
  const pattern = new RegExp(String.raw`(?<![\w-])(${labels.join('|')}) \(([^)\s]{1,2})\)`, 'g')
  const hints: { file: string; label: string; key: string }[] = []

  for (const file of sourcesOf(HOOKS)) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) hints.push({ file: file.slice(HOOKS.length + 1).replace(/\\/g, '/'), label: match[1]!, key: match[2]! })
  }

  it('finds the hints it is meant to check', () => {
    expect(hints.length).toBeGreaterThan(0)
  })

  it('names the key the page really has', () => {
    const wrong = hints.filter(hint => VIEWS.find(view => view.label === hint.label)?.key !== hint.key).map(hint => `${hint.file}: ${hint.label} (${hint.key})`)

    expect(wrong).toEqual([])
  })
})

describe('the key help', () => {
  const keysTopic = TOPICS.find(topic => topic.id === 'keys')!.steps.map(step => step.text).join('\n')

  it('lists no terminal hotkeys the terminal does not have', () => {
    expect(HELP).not.toMatch(/Tab to s stop/)
    expect(HELP).not.toMatch(/s stop, o new, z clear/)
  })

  it('does not present b as a global back key', () => {
    expect(HELP).not.toMatch(/·\s*b back\s*·/)
    expect(keysTopic).not.toMatch(/·\s*b back\s*·/)
    expect(keysTopic).toMatch(/◂ Back/)
  })
})

describe('terminal messages', () => {
  it('never tell the person to press a key for Stop, New session or Clear (the buttons have none)', () => {
    const bad: string[] = []

    for (const file of ['harness.ts', 'views/terminal.ts', 'commands.ts']) {
      for (const line of readFileSync(join(HOOKS, file), 'utf8').split(/\r?\n/)) {
        if (/\b(stop|new session|clear)\b[^'`]{0,40}\((s|o|z)\)/i.test(line) || /\((s|o|z)\)[^'`]{0,20}\b(stop|clear)\b/i.test(line)) bad.push(`${file}: ${line.trim().slice(0, 120)}`)
      }
    }

    expect(bad).toEqual([])
  })
})
