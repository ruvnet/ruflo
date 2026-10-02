import { describe, expect, mock, test } from 'claude-code/testing'

import { command, PANE, PANE_ID, paneAt, PLUGIN, SESSION } from './fixtures/inputs'
import { elementsOf, realCli, textOf, worldOf } from './fixtures/world'

const LIST = ['mods', 'list', '--json']

describe('the mods pane', () => {
  test('/mods registers once, opens as the documented dialog with the list view\'s rows, and polls only then', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    expect(world.commands).toEqual(['mods'])
    expect(world.runs).toEqual([])

    const out = await $.command.run(command())

    await clock.settle()
    expect(out.text).toBe('mods pane: list')
    expect(world.opened[0]).toEqual({ id: PANE_ID, title: 'Mods', focus: true, closeOnEscape: true, holdToasts: true, rows: 18 })
    expect(world.runs.map(argv => argv.slice(-3))).toEqual(expect.arrayContaining([LIST, ['mods', 'status', '--json']]))
    // No project CLI on disk: the cached CLI, offline.
    expect(world.runs[0]?.slice(0, 4)).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest'])
  })

  test('draws the real list: every ruflo mod, its marks, trust and a MEASURED age', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on, { now: 1_790_904_000_000 })

    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()

    const text = textOf(await $.ui.render(PANE))

    for (const name of ['ruflo-mods-manager', 'ruflo-mods', 'ruflo-ruos', 'ruflo-swarm', 'the gate', 'no gate', 'MEASURED']) {
      expect(text).toContain(name)
    }

    expect(text).toContain('last refusal: not recorded on disk')
  })

  test('hotkeys: each view, j/k, e, d, r, c and h is a Button with its key, and pressing one acts', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()

    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE.props })
    const hotkeys = (await pane.findAll({ type: 'Button' })).map(button => [button.key, button.props.hotkey])

    expect(hotkeys).toEqual([
      ['view-list', '1'],
      ['view-diagrams', '2'],
      ['view-health', '3'],
      ['refresh', 'r'],
      ['help', 'h'],
      ['next', 'j'],
      ['prev', 'k'],
      ['enable', 'e'],
      ['disable', 'd'],
      ['configure', 'c'],
    ])

    await pane.press({ key: 'view-diagrams' })
    await clock.settle()
    expect(world.opened.at(-1)).toMatchObject({ id: PANE_ID, rows: 22 })
    expect(await pane.find({ type: 'Text', text: 'Hook map' })).toBeDefined()
    expect(await pane.find({ type: 'Raster', key: 'hook-map' })).toBeDefined()

    await pane.press({ key: 'view-list' })
    await pane.press({ key: 'next' })
    await pane.press({ key: 'enable' })
    await clock.settle()
    expect(world.runs.some(argv => argv.join(' ').endsWith('mods enable ruflo-mods@ruflo --scope local --json'))).toBe(true)
    expect(await pane.find({ type: 'Text', text: /enabled ruflo-mods@ruflo \(local\)/ })).toBeDefined()
    expect(world.toasts, 'held while the pane is up: the outcome row says it').toEqual([])

    await pane.press({ key: 'configure' })
    await clock.settle()
    expect(world.fills).toEqual(['! claude plugin configure ruflo-mods@ruflo'])
    await pane.unmount()
  })

  test('d asks first and disables only on the second press', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()

    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: PANE.props })
    const disables = () => world.runs.filter(argv => argv.includes('disable')).length

    await pane.press({ key: 'disable' })
    await clock.settle()
    expect(disables()).toBe(0)
    expect(await pane.find({ type: 'Text', text: /press d again to confirm/ })).toBeDefined()

    await pane.press({ key: 'disable' })
    await clock.settle()
    expect(disables()).toBe(1)
    await pane.unmount()
  })

  test('blits the pulse at the mounted size on the clock, and stops when the pane closes', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: 1_790_904_000_000 })

    await $.session.start(SESSION)
    await $.command.run(command('health'))
    await clock.settle()

    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE_ID, props: paneAt(81, 16).props })
    const raster = await pane.find({ type: 'Raster', key: 'pulse' })

    expect(raster?.props).toMatchObject({ columns: 80, rows: 3 })

    for (let i = 0; i < 4; i += 1) {
      await clock.advance(125)
    }

    const pulses = world.blits.filter(blit => blit.key === 'pulse')

    expect(pulses.length).toBeGreaterThanOrEqual(3)
    expect(pulses.every(blit => blit.columns === 80 && blit.rows === 3)).toBe(true)
    expect(new Set(pulses.map(blit => blit.cells)).size, 'the frames move with time').toBeGreaterThan(1)

    await $.command.run(command('close'))
    const after = world.blits.length

    for (let i = 0; i < 4; i += 1) {
      await clock.advance(125)
    }

    expect(world.blits.length).toBe(after)
    await pane.unmount()
  })

  test('a failed refresh keeps the last data under STALE, never as live', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: 1_790_904_000_000 })

    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()
    world.respond = argv => (argv.includes('list') ? { exitCode: 1, stdout: '', stderr: 'npx: cache miss' } : realCli(argv))
    await $.command.run(command('refresh'))

    const text = textOf(await $.ui.render(PANE))

    expect(text).toContain('STALE')
    expect(text).toContain('last refresh failed: exit 1: npx: cache miss')
    expect(text).toContain('ruflo-swarm')
  })

  test('says when the keys go to the prompt', async ($, on) => {
    worldOf(on)
    mock.clock(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(paneAt(101, 22, false)))).toContain('keys go to the prompt')
  })

  test('every view draws on the terminal and the desktop (no Raster there: text instead)', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on)

    on('ui.render', () => ({ type: 'Text', children: [''] }))
    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      for (const view of ['list', 'diagrams', 'health', 'help']) {
        await $.command.run(command(view))
        await clock.settle()

        const mounted = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE_ID, props: paneAt(70, 24).props })
        const rasters = await mounted.findAll({ type: 'Raster' })

        expect(surface === 'desktop' ? rasters : [], `${surface} ${view}`).toEqual([])
        await mounted.unmount()
      }
    }
  })
})

describe('/mods mirrors', () => {
  test('/mods enable and disable run the CLI with the typed id and scope; a bad id runs nothing', async ($, on) => {
    const world = worldOf(on)

    mock.clock(on)
    await $.session.start(SESSION)

    const enabled = await $.command.run(command('enable ruflo-swarm project'))
    const disabled = await $.command.run(command('disable ruflo-swarm@ruflo'))
    const bad = await $.command.run(command('enable ruflo-swarm;rm'))

    expect(enabled.text).toContain('enabled ruflo-swarm@ruflo (project)')
    expect(disabled.text).toContain('disabled ruflo-swarm@ruflo (local)')
    expect(bad.exitCode).toBe(2)
    expect(world.runs.filter(argv => argv.includes('enable') || argv.includes('disable')).map(argv => argv.slice(-6))).toEqual([
      ['mods', 'enable', 'ruflo-swarm@ruflo', '--scope', 'project', '--json'],
      ['mods', 'disable', 'ruflo-swarm@ruflo', '--scope', 'local', '--json'],
    ])
    // The pane was closed: outcomes go to toasts.
    expect(world.toasts.length).toBe(2)
  })

  test('a failed enable says so and names the manual command', async ($, on) => {
    worldOf(on, argv => (argv.includes('enable') ? { exitCode: 1, stdout: JSON.stringify({ version: 1, ok: false, error: 'no runnable claude on PATH', manual: 'claude plugin enable ruflo-swarm@ruflo --scope local' }), stderr: '' } : realCli(argv)))
    mock.clock(on)
    await $.session.start(SESSION)

    const out = await $.command.run(command('enable ruflo-swarm'))

    expect(out.exitCode).toBe(1)
    expect(out.text).toContain('enable ruflo-swarm@ruflo failed: no runnable claude on PATH · run: claude plugin enable ruflo-swarm@ruflo --scope local')
  })

  test('/mods list answers as text, and its transcript row draws as a table', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on)

    on('ui.render', () => ({ type: 'Text', children: [''] }))
    await $.session.start(SESSION)

    const out = await $.command.run(command('list'))

    await clock.settle()
    expect(out.text).toContain('ruflo-swarm@ruflo 0.2.1 · enabled yes')

    const row = await $.ui.render({ component: 'CommandOutput', surface: 'terminal', requestId: 'row-1', viewport: { columns: 120, rows: 40, isFullscreen: false }, props: { command: 'mods', args: 'list', text: out.text ?? '', isErrored: false } } as never)

    expect(textOf(row)).toContain('● ruflo-swarm@ruflo 0.2.1')
    expect(elementsOf(row, 'Text').length).toBe(5)
  })

  test('/mods configure fills the prompt and runs nothing', async ($, on) => {
    const world = worldOf(on)

    mock.clock(on)
    await $.session.start(SESSION)

    const out = await $.command.run(command('configure ruflo-mods'))

    expect(out.text).toContain('press Enter to run it')
    expect(world.fills).toEqual(['! claude plugin configure ruflo-mods@ruflo'])
    expect(world.runs).toEqual([])
  })

  test('the project\'s own CLI is preferred when it is on disk', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    world.files.set('node_modules/@claude-flow/cli/bin/cli.js', '')
    await $.session.start(SESSION)
    await $.command.run(command('refresh'))
    await clock.settle()
    expect(world.runs[0]?.slice(0, 2)).toEqual(['node', '/work/node_modules/@claude-flow/cli/bin/cli.js'])
  })
})

describe('lifecycle', () => {
  test('after a reload with the pane still up, the engine\'s record resumes polling', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    world.panes = [{ id: PANE_ID, title: 'Mods', isShown: true, isFocused: false, isPlaced: true }]
    await $.session.start(SESSION)
    await clock.settle()
    expect(world.runs.length).toBeGreaterThan(0)
  })

  test('polls every refreshSeconds while open; nothing after session.end; the status segment is cleared', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()

    const first = world.runs.length

    await clock.advance(30_000)
    expect(world.runs.length).toBeGreaterThan(first)
    expect(world.statuses.at(-1)).toBe('ruflo mods: 1 on')

    await $.session.end({ reason: 'other' } as never)
    const ended = world.runs.length

    await clock.advance(90_000)
    expect(world.runs.length).toBe(ended)
    expect(world.statuses.at(-1)).toBeUndefined()
  })

  test('a draw that lands after the close does not restart polling (seen live on 2.1.287)', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.command.run(command())
    await clock.settle()
    await $.command.run(command('close'))
    await $.ui.render(PANE)
    await clock.settle()

    const closed = world.runs.length

    await clock.advance(90_000)
    expect(world.runs.length).toBe(closed)
  })

  test('the doctor timeline survives in the store and comes back next session', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on)

    world.stored.set('ruflo-mods-manager/history:/work', [{ atMs: 1, pass: 4, warn: 2, fail: 0 }, { bad: true }])
    await $.session.start(SESSION)
    await $.command.run(command('health'))
    await clock.settle()

    const kept = world.stored.get('ruflo-mods-manager/history:/work') as unknown[]

    expect(kept.length).toBe(2)
    expect(textOf(await $.ui.render(paneAt(101, 16)))).toContain('2 refreshes')
  })
})
