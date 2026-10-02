/**
 * The manager's pure model under plain vitest: parsing the CLI's real output, argv validation, `/mods` parsing, the
 * honest labels, and the views on a surface with and without `Raster`. Run with
 *   npx vitest run --root plugins/ruflo-mods-manager tests/model.spec.ts
 */
import './fixtures/jsx'

import { describe, expect, it } from 'vitest'

import { parseSub } from '../hooks/commands'
import { cliPrefix, modId, scopeOf, toggleArgv } from '../hooks/model/argv'
import { chainOf, effective, enabledFromSettings, parseList, parseStatus, plain } from '../hooks/model/data'
import { newState, optionsOf, type State } from '../hooks/state'
import { freshnessOf, paneModelOf } from '../hooks/views/model'
import { listText, paneView, PULSE_KEY, type Kit, type PaneActions } from '../hooks/views/pane'
import { LIST_JSON, STATUS_JSON } from './fixtures/cli-output'
import { all, KIT, KIT_RASTER, text } from './fixtures/jsx'

const NOW = 1_790_904_000_000
const NOOP: PaneActions = { view: () => undefined, next: () => undefined, prev: () => undefined, enable: () => undefined, disable: () => undefined, refresh: () => undefined, configure: () => undefined, help: () => undefined }

function loaded(at = NOW - 5_000): State {
  const state = newState({})

  state.list = { data: parseList(LIST_JSON), atMs: at, error: null }
  state.status = { data: parseStatus(STATUS_JSON), atMs: at, error: null }
  state.beats = [at]
  state.history = [{ atMs: at - 30_000, pass: 5, warn: 2, fail: 0 }, { atMs: at, pass: 5, warn: 1, fail: 0 }]
  state.pane = { ...state.pane, isOpen: true, isFocused: true }

  return state
}

describe('the CLI output, read as untrusted', () => {
  it('parses the real mods list: four ruflo mods, sorted, with scans and verdicts', () => {
    const list = parseList(LIST_JSON)

    expect(list.mods.map(m => m.id)).toEqual(['ruflo-mods-manager@ruflo', 'ruflo-mods@ruflo', 'ruflo-ruos@ruflo', 'ruflo-swarm@ruflo'])
    expect(list.mods.find(m => m.id === 'ruflo-mods@ruflo')?.verdict).toBe('gate')
    expect(list.mods.find(m => m.id === 'ruflo-swarm@ruflo')?.events).toContain('tool.call')
    expect(list.mods.find(m => m.id === 'ruflo-mods-manager@ruflo')?.events).toBeNull()
    expect(list.claude?.version).toBe('2.1.287')
  })

  it('drops rows whose id is not a ruflo mod, and refuses what is not a list', () => {
    const forged = JSON.stringify({ version: 1, mods: [{ id: 'evil@elsewhere' }, { id: 'ruflo-x@ruflo', trust: { verdict: 'trusted-by-me' } }], gate: {} })
    const list = parseList(forged)

    expect(list.mods.map(m => m.id)).toEqual(['ruflo-x@ruflo'])
    expect(list.mods[0]?.verdict).toBe('unknown')
    expect(() => parseList('not json')).toThrow()
    expect(() => parseList('{"version":2,"mods":[]}')).toThrow()
    expect(() => parseList('[{"name":"ruflo-mods plugin","status":"warn"}]')).toThrow('predates ADR-406')
  })

  it('reads JSON after a banner line, and strips terminal escapes and control characters', () => {
    expect(parseList(`npm warn something\n${LIST_JSON}`).mods).toHaveLength(4)
    expect(plain('\u001b[31mred\u001b[0m ‮evil\u0007 \u001b]0;title\u0007ok')).toBe('red evil ok')
  })

  it('parses the real status findings into the init chain; a link with no finding says why', () => {
    const chain = chainOf(parseStatus(STATUS_JSON))

    expect(chain.map(link => link.link)).toEqual(['settings', 'marketplace', 'plugin', 'helpers'])
    expect(chain[0]?.status).toBe('warn')
    expect(chain[1]).toMatchObject({ status: 'unknown', message: 'not checked: ruflo-mods is not enabled here' })
  })

  it('enabled follows the most specific settings source that names the plugin', () => {
    const by = enabledFromSettings('ruflo-swarm@ruflo', { user: { enabledPlugins: { 'ruflo-swarm@ruflo': true } }, project: {}, local: { enabledPlugins: { 'ruflo-swarm@ruflo': false } } })

    expect(by).toEqual({ user: true, project: null, local: false })
    expect(effective(by)).toBe(false)
    expect(effective({ user: true, project: null, local: null })).toBe(true)
    expect(effective({ user: null, project: null, local: null })).toBe(false)
  })
})

describe('argv: fixed, validated, never from event input', () => {
  it('accepts ruflo mod ids and the three scopes only', () => {
    expect(modId('ruflo-swarm')).toBe('ruflo-swarm@ruflo')
    expect(modId('RUFLO-MODS@ruflo')).toBe('ruflo-mods@ruflo')

    for (const bad of ['swarm', 'ruflo-swarm@evil', 'ruflo-$(rm)@ruflo', 'ruflo-a b@ruflo', '--scope', 'ruflo-@ruflo']) {
      expect(modId(bad)).toBeNull()
    }

    expect(scopeOf(undefined)).toBe('local')
    expect(scopeOf('user')).toBe('user')
    expect(scopeOf('global')).toBeNull()
  })

  it('builds enable and disable argv and refuses anything else', () => {
    expect(toggleArgv(['ruflo'], 'disable', 'ruflo-swarm@ruflo', 'project')).toEqual(['ruflo', 'mods', 'disable', 'ruflo-swarm@ruflo', '--scope', 'project', '--json'])
    expect(() => toggleArgv(['ruflo'], 'enable', 'x; rm -rf ~', 'local')).toThrow()
    expect(() => toggleArgv(['ruflo'], 'enable', 'ruflo-swarm@ruflo', 'everywhere' as never)).toThrow()
  })

  it('auto prefers the project CLI, then the cached one offline', () => {
    expect(cliPrefix('auto', '/work/node_modules/@claude-flow/cli/bin/cli.js')).toEqual(['node', '/work/node_modules/@claude-flow/cli/bin/cli.js'])
    expect(cliPrefix('auto', null)).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest'])
    expect(optionsOf({ cli: 'sh -c', refreshSeconds: 1, animate: 'no' } as never)).toEqual({ cli: 'auto', refreshSeconds: 10, animate: true })
  })
})

describe('/mods mirrors every key', () => {
  it.each([
    ['', { kind: 'toggle' }],
    ['1', { kind: 'view', view: 'list' }],
    ['diagrams', { kind: 'view', view: 'diagrams' }],
    ['3', { kind: 'view', view: 'health' }],
    ['j', { kind: 'step', by: 1 }],
    ['prev', { kind: 'step', by: -1 }],
    ['enable ruflo-swarm', { kind: 'toggle-mod', action: 'enable', id: 'ruflo-swarm@ruflo', scope: 'local' }],
    ['disable ruflo-swarm@ruflo user', { kind: 'toggle-mod', action: 'disable', id: 'ruflo-swarm@ruflo', scope: 'user' }],
    ['refresh', { kind: 'refresh' }],
    ['configure ruflo-mods', { kind: 'configure', id: 'ruflo-mods@ruflo' }],
    ['help', { kind: 'help' }],
    ['?', { kind: 'help' }],
    ['close', { kind: 'close' }],
  ])('/mods %s', (args, sub) => {
    expect(parseSub(args)).toEqual(sub)
  })

  it('refuses a bad id, a bad scope, and unknown words', () => {
    expect(parseSub('enable evil@else').kind).toBe('error')
    expect(parseSub('disable ruflo-swarm global').kind).toBe('error')
    expect(parseSub('format-disk').kind).toBe('error')
  })
})

describe('honest labels', () => {
  it('MEASURED while fresh, STALE past three periods or after a failed refresh, LOADING and FAILED before any data', () => {
    expect(freshnessOf(loaded(), NOW).word).toBe('MEASURED')
    expect(freshnessOf(loaded(NOW - 91_000), NOW).word).toBe('STALE')

    const failed = loaded()

    failed.list.error = 'exit 1: boom'
    expect(freshnessOf(failed, NOW)).toMatchObject({ word: 'STALE', text: expect.stringContaining('last refresh failed: exit 1: boom') })
    expect(freshnessOf(newState({}), NOW).word).toBe('LOADING')

    const never = newState({})

    never.list.error = 'npx: not found'
    expect(freshnessOf(never, NOW).word).toBe('FAILED')
  })

  it('says the last refusal is not recorded rather than inventing one, and labels the pulse', () => {
    const model = paneModelOf(loaded(), 100, 18, NOW)

    expect(model.selected?.detail.join('\n')).toContain('last refusal: not recorded on disk')
    expect(model.pulseLabel).toContain('MEASURED')
    expect(model.pulseLabel).toContain('STALE')
  })

  it('a mod with no scan is "scan unavailable" in the hook table, never left out silently', () => {
    expect(paneModelOf(loaded(), 100, 18, NOW).hookTable.join('\n')).toContain('ruflo-mods-manager: scan unavailable')
  })

  it('warns when the gate would refuse the manager', () => {
    const state = loaded()

    state.list.data!.gate = { enabled: true, modTrust: 'refuse-risky', allow: [] }
    expect(paneModelOf(state, 100, 18, NOW).notes.join('\n')).toContain('add ruflo-mods-manager@ruflo to its modTrustAllow')
  })
})

describe('views with and without Raster', () => {
  const draw = (kit: Kit, view: State['view'], focused = true) => {
    const state = loaded()

    state.view = view
    state.pane.isFocused = focused

    return paneView(kit, paneModelOf(state, 100, 22, NOW), NOOP, NOW)
  }

  it('a surface without Raster gets text in place of every picture', () => {
    for (const view of ['list', 'diagrams', 'health'] as const) {
      const tree = draw(KIT as unknown as Kit, view)

      expect(all(tree, 'Raster')).toHaveLength(0)
    }

    expect(text(draw(KIT as unknown as Kit, 'diagrams'))).toContain('tool.call ←')
    expect(text(draw(KIT as unknown as Kit, 'health'))).toContain('ruflo mods list')
  })

  it('a terminal gets the hook map, the sparkline and the pulse as Rasters sized to the body', () => {
    const diagrams = all(draw(KIT_RASTER as unknown as Kit, 'diagrams'), 'Raster')
    const health = all(draw(KIT_RASTER as unknown as Kit, 'health'), 'Raster')

    expect(diagrams).toHaveLength(1)
    expect(health.map(r => r.props.key)).toEqual(['doctor-spark', PULSE_KEY])

    for (const raster of [...diagrams, ...health]) {
      expect(raster.props.columns).toBe(100)
    }
  })

  it('every key is a button with its hotkey: 1 2 3 r h, and j k e d c on the list', () => {
    const hotkeys = all(draw(KIT as unknown as Kit, 'list'), 'Button').map(b => b.props.hotkey)

    expect(hotkeys).toEqual(['1', '2', '3', 'r', 'h', 'j', 'k', 'e', 'd', 'c'])
  })

  it('says when the keys go to the prompt', () => {
    expect(text(draw(KIT as unknown as Kit, 'list', false))).toContain('keys go to the prompt')
    expect(text(draw(KIT as unknown as Kit, 'list', true))).not.toContain('keys go to the prompt')
  })

  it('/mods list as text names every mod with its state', () => {
    const out = listText(paneModelOf(loaded(), 100, 22, NOW))

    expect(out).toContain('ruflo-swarm@ruflo 0.2.1 · enabled')
    expect(out.split('\n')).toHaveLength(5)
  })
})
