/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import { hookMapFrame, pulseFrame, sparkFrame } from './frames'
import { VERDICT_WORDS, type PaneModel, type Row } from './model'
import { ACCENT, BAD, GOOD, HEAD, mark, STATUS_COLORS, STATUS_GLYPHS, VERDICT_COLORS, WARN } from './palette'

type Terminal = Elements['terminal']

/** The elements a view uses. `Raster` and `Markdown` are absent where the surface has none: each has a text form. */
export type Kit = Pick<Terminal, 'Box' | 'Text' | 'Button'> & { Raster?: Terminal['Raster']; Markdown?: Terminal['Markdown'] }

/** What the buttons do: closures over the host, so the view calls nothing on the engine itself. */
export type PaneActions = {
  view: (view: PaneModel['view']) => void
  next: () => void
  prev: () => void
  enable: () => void
  disable: () => void
  refresh: () => void
  configure: () => void
  help: () => void
}

export const HOOK_MAP_KEY = 'hook-map'
export const SPARK_KEY = 'doctor-spark'
export const PULSE_KEY = 'pulse'
/** The pulse's height in rows; its width is the body's. */
export const PULSE_ROWS = 3

export const HELP = [
  '# ruflo mods',
  'Keys work while the pane has the keyboard (click it, or ctrl+x tab). Every key is also a command.',
  '',
  '| key | does | command |',
  '|---|---|---|',
  '| 1 2 3 | list, diagrams, health | /mods list, /mods diagrams, /mods health |',
  '| j k | next, previous mod | /mods next, /mods prev, /mods select <id> |',
  '| e | enable the selected mod | /mods enable <id> [user\\|project\\|local] |',
  '| d | disable it (press twice) | /mods disable <id> [scope] |',
  '| r | refresh now | /mods refresh |',
  '| c | put `claude plugin configure <id>` in the prompt | /mods configure <id> |',
  '| h | this help | /mods help |',
  '| Esc | close | /mods close |',
  '',
  'Enable and disable run `ruflo mods enable|disable`, which runs `claude plugin enable|disable`; they take effect in the next session or after /reload-plugins. Install other mods with /plugin.',
].join('\n')

export const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)
const pad = (text: string, width: number): string => (text.length >= width ? text.slice(0, Math.max(0, width)) : text + ' '.repeat(width - text.length))

/** The tab row: the three views, help and refresh, each a hotkey. */
function tabs(kit: Kit, model: PaneModel, actions: PaneActions): RenderChildren {
  const { Box, Button } = kit
  const tab = (key: string, hotkey: string, label: string, view: PaneModel['view']) => (
    <Button key={key} hotkey={hotkey} plain dimColor={model.view !== view} onPress={() => actions.view(view)}>{label}</Button>
  )

  return (
    <Box columnGap={2} flexWrap="wrap">
      {tab('view-list', '1', 'list', 'list')}
      {tab('view-diagrams', '2', 'diagrams', 'diagrams')}
      {tab('view-health', '3', 'health', 'health')}
      <Button key="refresh" hotkey="r" plain dimColor onPress={actions.refresh}>refresh</Button>
      <Button key="help" hotkey="h" plain dimColor onPress={actions.help}>help</Button>
    </Box>
  )
}

function topLines(kit: Kit, model: PaneModel): RenderChildren[] {
  const { Text } = kit
  const color = model.freshness.word === 'MEASURED' ? GOOD : model.freshness.word === 'LOADING' ? undefined : WARN
  const lines: RenderChildren[] = []

  if (!model.isFocused) {
    lines.push(<Text dimColor wrap="truncate-end">{clip('keys go to the prompt: click the pane or press ctrl+x tab, or type /mods <key>', model.columns)}</Text>)
  }

  lines.push(
    <Text wrap="truncate-end">
      <Text bold color={color}>{model.freshness.word}</Text>
      <Text dimColor>{clip(` ${model.freshness.text}`, Math.max(8, model.columns - 10))}</Text>
    </Text>,
  )

  return lines
}

function footer(kit: Kit, model: PaneModel): RenderChildren | null {
  const { Text } = kit

  if (model.confirm !== null) {
    return <Text bold color={WARN} wrap="truncate-end">{clip(model.confirm, model.columns)}</Text>
  }

  if (model.isActing) {
    return <Text color={ACCENT}>running…</Text>
  }

  if (model.outcome !== null) {
    return <Text color={model.outcome.ok ? GOOD : BAD} wrap="truncate-end">{clip(`${model.outcome.ok ? '✓' : '✗'} ${model.outcome.text}`, model.columns)}</Text>
  }

  return null
}

function rowLine(kit: Kit, row: Row, columns: number): RenderChildren {
  const { Box, Text } = kit
  const name = Math.max(10, Math.min(24, columns - 46))
  const left = `${row.isSelected ? '▸' : ' '} ${pad(clip(row.name, name), name)} ${pad(clip(row.version, 8), 8)} ${pad(clip(row.scope, 14), 14)} ${mark(row.enabled)}${mark(row.installed)}${mark(row.resolvable)} `
  const verdict = VERDICT_WORDS[row.verdict]

  return (
    <Box key={`row:${row.id}`}>
      <Text bold={row.isSelected} dimColor={!row.isSelected && !row.enabled} wrap="truncate-end">{left}</Text>
      <Text color={VERDICT_COLORS[row.verdict]} dimColor={VERDICT_COLORS[row.verdict] === undefined}>{pad(verdict, 10)}</Text>
      <Text dimColor>{row.events === null ? ' ?' : ` ${row.events}`}</Text>
      <Box position="absolute" top={1} left={4} display="none" hover={{ display: 'flex' }} borderStyle="round" paddingX={1}>
        <Text>{clip(`${row.id}: enabled ${mark(row.enabled)} installed ${mark(row.installed)} resolvable ${mark(row.resolvable)}`, Math.max(10, columns - 8))}</Text>
      </Box>
    </Box>
  )
}

function listView(kit: Kit, model: PaneModel, actions: PaneActions, budget: number): RenderChildren {
  const { Box, Text, Button } = kit
  const name = Math.max(10, Math.min(24, model.columns - 46))
  const detail = model.selected?.detail ?? []
  const room = Math.max(1, budget - 2 - detail.length - 1)
  const at = Math.max(0, model.rows_.findIndex(row => row.isSelected))
  const start = Math.max(0, Math.min(at - Math.floor(room / 2), model.rows_.length - room))
  const shown = model.rows_.slice(start, start + room)

  if (model.rows_.length === 0) {
    return <Text dimColor>No ruflo mods known yet: no list from the CLI, and no ruflo-*@ruflo id in settings.</Text>
  }

  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{clip(`  ${pad('mod', name)} ${pad('version', 8)} ${pad('enabled in', 14)} E I R trust      hooks`, model.columns)}</Text>
      {shown.map(row => rowLine(kit, row, model.columns))}
      {model.rows_.length > shown.length ? <Text dimColor>{`  ${model.rows_.length - shown.length} more (j/k)`}</Text> : null}
      {detail.map(line => <Text dimColor wrap="truncate-end">{clip(`  ${line}`, model.columns)}</Text>)}
      <Box columnGap={2} flexWrap="wrap">
        <Button key="next" hotkey="j" plain dimColor onPress={actions.next}>next</Button>
        <Button key="prev" hotkey="k" plain dimColor onPress={actions.prev}>prev</Button>
        <Button key="enable" hotkey="e" plain onPress={actions.enable}>enable</Button>
        <Button key="disable" hotkey="d" plain onPress={actions.disable}>disable…</Button>
        <Button key="configure" hotkey="c" plain dimColor onPress={actions.configure}>configure</Button>
      </Box>
    </Box>
  )
}

function diagramsView(kit: Kit, model: PaneModel, budget: number): RenderChildren {
  const { Box, Text, Raster } = kit
  const chainRows = model.chain.length === 0 ? 1 : model.chain.length + model.chain.filter(link => link.fix !== null && link.status !== 'pass').length
  const mapRows = Math.max(3, Math.min(14, budget - chainRows - 3, Math.max(model.hookMap.mods.length, model.hookMap.events.length)))
  const map =
    model.hookMap.mods.length === 0 ? (
      <Text dimColor>No scanned mods: ruflo mods list has no hook scan (needs claude on PATH).</Text>
    ) : Raster !== undefined ? (
      <Raster {...hookMapFrame(model.hookMap, { columns: model.columns, rows: mapRows }).toRaster(HOOK_MAP_KEY)} />
    ) : (
      <Box flexDirection="column">{model.hookTable.slice(0, mapRows).map(line => <Text wrap="truncate-end">{clip(line, model.columns)}</Text>)}</Box>
    )

  return (
    <Box flexDirection="column">
      <Text bold color={HEAD}>Hook map</Text>
      <Text dimColor wrap="truncate-end">{clip('mod → engine event, from claude plugin validate; risky events (ruflo-mods trust list) in the warning colour', model.columns)}</Text>
      {map}
      <Text bold color={HEAD}>Init chain</Text>
      {model.chain.length === 0 ? <Text dimColor>no ruflo mods status yet</Text> : null}
      {model.chain.map(link => (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={STATUS_COLORS[link.status]}>{`${STATUS_GLYPHS[link.status]} ${pad(link.link, 12)}`}</Text>
            <Text dimColor>{clip(link.message, Math.max(8, model.columns - 15))}</Text>
          </Text>
          {link.fix !== null && link.status !== 'pass' ? <Text dimColor wrap="truncate-end">{clip(`    fix: ${link.fix}`, model.columns)}</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

function healthView(kit: Kit, model: PaneModel, nowMs: number): RenderChildren {
  const { Box, Text, Raster } = kit
  const values = model.history.map(p => p.warn + p.fail)
  const span = model.history.length > 1 ? `${model.history.length} refreshes over ${Math.round((model.history[model.history.length - 1]!.atMs - model.history[0]!.atMs) / 60_000)} min` : `${model.history.length} refresh`
  const counts = model.counts

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color={HEAD}>Doctor </Text>
        <Text dimColor>{counts === null ? 'no ruflo mods status yet' : `pass ${counts.pass} · warn ${counts.warn} · fail ${counts.fail} (MEASURED)`}</Text>
      </Text>
      {Raster !== undefined && values.length > 0 ? <Raster {...sparkFrame(values, { columns: model.columns, rows: 2 }).toRaster(SPARK_KEY)} /> : <Text dimColor>{values.length > 0 ? `warn+fail: ${values.slice(-12).join(' ')}` : 'timeline: no points yet'}</Text>}
      <Text dimColor wrap="truncate-end">{clip(`timeline: warn+fail per refresh, ${span}`, model.columns)}</Text>
      {Raster !== undefined ? <Raster {...pulseFrame(model.pulse, { columns: model.columns, rows: PULSE_ROWS }, nowMs).toRaster(PULSE_KEY)} /> : <Text dimColor>{model.freshness.text}</Text>}
      <Text dimColor wrap="truncate-end">{clip(model.pulseLabel, model.columns)}</Text>
      {model.notes.map(note => <Text color={note.includes('refuses') ? WARN : undefined} dimColor={!note.includes('refuses')} wrap="truncate-end">{clip(note, model.columns)}</Text>)}
    </Box>
  )
}

function helpView(kit: Kit, model: PaneModel): RenderChildren {
  const { Box, Text, Markdown } = kit

  return Markdown !== undefined ? (
    <Markdown key="help-text" text={HELP} />
  ) : (
    <Box flexDirection="column">{HELP.split('\n').map(line => <Text wrap="truncate-end">{clip(line, model.columns)}</Text>)}</Box>
  )
}

/** The manager's pane: tabs, freshness, the view, and the outcome or confirm row. */
export function paneView(kit: Kit, model: PaneModel, actions: PaneActions, nowMs: number): RenderElement {
  const { Box } = kit
  const top = topLines(kit, model)
  const end = footer(kit, model)
  const budget = Math.max(6, model.rows - 1 - top.length - (end === null ? 0 : 1))
  const body = model.isHelp ? helpView(kit, model) : model.view === 'list' ? listView(kit, model, actions, budget) : model.view === 'diagrams' ? diagramsView(kit, model, budget) : healthView(kit, model, nowMs)

  return (
    <Box flexDirection="column">
      {tabs(kit, model, actions)}
      {top}
      {body}
      {end}
    </Box>
  )
}

/** `/mods list` as text: what the model reads and what the transcript falls back to. */
export function listText(model: PaneModel): string {
  if (model.rows_.length === 0) {
    return `ruflo mods: none known (${model.freshness.word}: ${model.freshness.text})`
  }

  const lines = model.rows_.map(row => `- ${row.id} ${row.version} · enabled ${row.enabled ? 'yes' : 'no'} (${row.scope}) · installed ${row.installed === null ? '?' : row.installed ? 'yes' : 'no'} · resolvable ${row.resolvable === null ? '?' : row.resolvable ? 'yes' : 'no'} · trust ${VERDICT_WORDS[row.verdict]} · ${row.events === null ? 'hooks unknown' : `${row.events} hooked events`}`)

  return [`ruflo mods (${model.freshness.word}: ${model.freshness.text})`, ...lines].join('\n')
}
