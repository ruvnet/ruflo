import type { RenderElement } from 'claude-code'

import { catalogOf } from '../plugin-catalog'
import { AI_BUDGETS, CLAUDE_MODELS, CORE, DEFAULT_AI, LOOP_ROWS, pluginNames, SIMPLE, settingsOf, type CoreKey, type Level, type PluginConfig } from '../settings'
import { NAV_STYLES } from '../state'
import { UPDATES_MODES, type UpdatesMode } from '../updates'
import { button, clip, col, row, rule, section, text, THEME, type Ctx } from './common'

/** One setting, whatever it belongs to, so a search, a level and "changed only" filter one list. */
type Item = { id: string; source: string; title: string; haystack: string; level: Level; changed: boolean; rows: () => RenderElement[] }

/** The choices of one setting as chips on the title's own row: the current one filled, every other a press that asks to set it. */
function chips(ctx: Ctx, keyPrefix: string, options: readonly string[], current: string, onPick: (value: string) => void): RenderElement[] {
  return options.map(option => ctx.kit.Button({ key: `${keyPrefix}-${option}`, label: ` ${option === current ? '●' : '○'} ${option} `, plain: true, ...(option === current && { variant: 'primary' as const }), onPress: () => onPick(option) }))
}

/** A free-text or number field: Enter asks to set it, and the field empties. */
function field(ctx: Ctx, key: string, label: string, placeholder: string, onSubmit: (value: string) => void): RenderElement {
  const Input = ctx.kit.Input

  return Input === undefined ? text(ctx, `   ${label}: set it from the palette (p): settings-set`, { dimColor: true }) : Input({ key, label: `   ✎ ${label}`, placeholder, submitLabel: 'set', onSubmit })
}

/** The two ask links: one click sends a prompt about this setting to claude -p or codex exec; the reply streams into the AI terminal. */
function asks(ctx: Ctx, key: string, title: string, description: string, current: string, where: string): RenderElement[] {
  return (['claude', 'codex'] as const).map(agent => ctx.kit.Button({ key: `st-ask-${agent}-${key}`, label: ` ✦ ${agent}`, plain: true, dimColor: true, onPress: () => ctx.act.settings.ask(agent, title, description, current, where) }))
}

type RowSpec = {
  key: string
  title: string
  description: string
  current: string
  isChanged: boolean
  isSecret?: boolean
  choices: readonly string[]
  defaultText: string
  onChoice: (value: string) => void
  fieldKey: string
  fieldLabel: string
  fieldHint: string
  where: string
}

/** A setting's two lines: its title with a changed marker and its choices inline, then what it is, dim; a field below when it takes text. */
function settingRows(ctx: Ctx, o: RowSpec): RenderElement[] {
  const rows: RenderElement[] = [
    row(
      ctx,
      [
        ctx.kit.Text({ color: o.isChanged ? THEME.ok : THEME.info, children: o.isChanged ? ' ● ' : ' · ' }),
        ctx.kit.Button({
          key: `st-name-${o.key}`,
          label: `${o.title} `.padEnd(26, '.'),
          plain: true,
          onPress: () => {
            if (o.choices.length === 0 && o.isSecret !== true) ctx.act.focus(o.fieldKey)
          },
        }),
        o.isSecret === true
          ? ctx.kit.Text({ color: THEME.warn, children: ' hidden: set it in /plugin configure' })
          : o.choices.length > 0
            ? row(ctx, chips(ctx, `st-opt-${o.key}`, o.choices, o.current, o.onChoice), `st-chips-${o.key}`)
            : ctx.kit.Text({ bold: true, color: THEME.info, children: ` ${o.current === '' ? 'n/a' : o.current}` }),
        ...(o.isSecret === true ? [] : asks(ctx, o.key, o.title, o.description, o.current, o.where)),
      ],
      `st-row-${o.key}`,
    ),
    text(ctx, `     ${clip(o.description, Math.max(20, ctx.columns - 8))}${o.defaultText === '' ? '' : `  · ${o.defaultText}`}`, { dimColor: true }),
  ]

  if (o.isSecret !== true && o.choices.length === 0) rows.push(field(ctx, o.fieldKey, o.fieldLabel, o.fieldHint, value => o.onChoice(value)))

  return rows
}

const simpleKeys = (config: PluginConfig): readonly string[] => SIMPLE[config.name] ?? Object.keys(config.schema).slice(0, 4)

function pluginItems(ctx: Ctx, config: PluginConfig): Item[] {
  return Object.entries(config.schema).map(([key, entry]) => {
    const current = config.inputs[key] ?? ''
    const choices = config.choices[key] ?? entry.options ?? []
    const isChanged = config.configured.includes(key)
    const id = `${config.name}-${key}`

    return {
      id,
      source: config.name.replace(/^ruflo-/, ''),
      title: entry.title,
      haystack: `${entry.title} ${entry.description} ${key} ${config.name} ${entry.isSecret ? '' : current}`.toLowerCase(),
      level: simpleKeys(config).includes(key) ? ('simple' as const) : ('advanced' as const),
      changed: isChanged,
      rows: () =>
        settingRows(ctx, {
          key: id,
          title: entry.title,
          description: entry.description,
          current,
          isChanged,
          isSecret: entry.isSecret,
          choices,
          defaultText: entry.default !== undefined ? `default ${entry.default}` : '',
          onChoice: value => ctx.act.settings.option(config.name, key, value),
          fieldKey: `st-in-${id}`,
          fieldLabel: key,
          fieldHint: `${entry.type === 'number' ? 'a number' : 'a value'}: Enter asks to set it`,
          where: `${config.name} option ${key}`,
        }),
    }
  })
}

function coreItems(ctx: Ctx): Item[] {
  const settings = settingsOf(ctx.state)

  return CORE.map((entry: CoreKey) => {
    const current = settings.core.get(entry.key) ?? ''
    const options = entry.kind === 'toggle' ? ['true', 'false'] : (entry.choices ?? [])

    return {
      id: `core-${entry.key}`,
      source: 'ruflo',
      title: entry.title,
      haystack: `${entry.title} ${entry.help} ${entry.key} ruflo config ${current}`.toLowerCase(),
      level: entry.level,
      changed: false,
      rows: () =>
        settingRows(ctx, {
          key: `core-${entry.key}`,
          title: entry.title,
          description: `${entry.help}  (${entry.key})`,
          current,
          isChanged: false,
          choices: options,
          defaultText: '',
          onChoice: value => ctx.act.settings.core(entry.key, value),
          fieldKey: `st-core-in-${entry.key}`,
          fieldLabel: entry.key,
          fieldHint: entry.kind === 'number' ? `a number${entry.min !== undefined ? ` ${entry.min} to ${entry.max}` : ''}: Enter asks` : 'a value: Enter asks',
          where: `ruflo config ${entry.key}`,
        }),
    }
  })
}

function aiItems(ctx: Ctx): Item[] {
  const { ai } = settingsOf(ctx.state)
  const one = (id: string, title: string, description: string, current: string, options: readonly string[], isChanged: boolean, onPick: (value: string) => void, extra: string): Item => ({
    id: `ai-${id}`,
    source: 'AI',
    title,
    haystack: `${title} ${description} ai terminal claude codex ${extra} ${current}`.toLowerCase(),
    level: 'simple',
    changed: isChanged,
    rows: () => settingRows(ctx, { key: `ai-${id}`, title, description, current, isChanged, choices: options, defaultText: '', onChoice: onPick, fieldKey: `st-ai-in-${id}`, fieldLabel: id, fieldHint: '', where: `the AI terminal's ${title}` }),
  })

  return [
    one('model', 'Claude model', 'the model claude -p uses for AI terminal turns (the CLI’s default when unset)', ai.claudeModel, CLAUDE_MODELS, ai.claudeModel !== DEFAULT_AI.claudeModel, value => ctx.act.settings.ai({ claudeModel: value as (typeof CLAUDE_MODELS)[number] }), 'model haiku sonnet opus'),
    one('budget', 'Turn budget (USD)', 'claude -p --max-budget-usd: the most one turn may spend; the sandbox stays read-only', String(ai.budgetUsd), AI_BUDGETS.map(String), ai.budgetUsd !== DEFAULT_AI.budgetUsd, value => ctx.act.settings.ai({ budgetUsd: Number(value) as (typeof AI_BUDGETS)[number] }), 'cost spend cap'),
    one('guidance', 'Mission guidance', 'after a mission goal is entered, claude -p writes detailed guidance by lifecycle stage and suggests ruflo capabilities to bring in (it asks first unless always accept)', ai.guidance ? 'on' : 'off', ['on', 'off'], !ai.guidance, value => ctx.act.settings.ai({ guidance: value === 'on' }), 'mission goal guidance advice suggestions'),
    ...LOOP_ROWS.map(row => one(row.id, row.title, row.description, row.current(ai), row.options, row.isChanged(ai), value => ctx.act.settings.ai(row.patch(value)), row.extra)),
    one('accept', 'Ask before each AI turn', 'always accept sends claude, codex and swarm turns straight out (read-only, plan mode, under the budget); ruflo commands still ask', ai.autoAccept ? 'always accept' : 'ask each time', ['ask each time', 'always accept'], ai.autoAccept, value => ctx.act.settings.ai({ autoAccept: value === 'always accept' }), 'confirm accept approve'),
  ]
}

/** Interface preferences: how the main nav spells its tabs. */
function uiItems(ctx: Ctx): Item[] {
  const style = ctx.state.nav

  return [
    {
      id: 'ui-nav',
      source: 'UI',
      title: 'Navigation style',
      haystack: `navigation style nav tabs icons titles brief full auto ${style}`,
      level: 'simple',
      changed: style !== 'auto',
      rows: () =>
        settingRows(ctx, {
          key: 'ui-nav',
          title: 'Navigation style',
          description: 'how the main nav spells its tabs: auto (names when wide), icons only, icon and a brief title, icon and the full title',
          current: style,
          isChanged: style !== 'auto',
          choices: NAV_STYLES,
          defaultText: 'default auto',
          onChoice: value => ctx.act.nav(value as (typeof NAV_STYLES)[number]),
          fieldKey: 'st-ui-in-nav',
          fieldLabel: 'nav',
          fieldHint: '',
          where: 'the console’s main nav',
        }),
    },
    {
      id: 'ui-updates',
      source: 'UI',
      title: 'Updates',
      haystack: `updates update auto-update automatic version new published github check ${ctx.state.updates}`,
      level: 'simple',
      changed: ctx.state.updates !== 'ask',
      rows: () => [
        ...settingRows(ctx, {
          key: 'ui-updates',
          title: 'Updates',
          description:
            'when a newer ruflo-console is published to github.com/ruvnet/ruflo: ask (offer it at load), auto (install a new minor or patch version without asking; a new major version still asks), or off (never look). One small request to GitHub a day; the install is Claude Code’s own claude plugin update, and takes effect after a restart',
          current: ctx.state.updates,
          isChanged: ctx.state.updates !== 'ask',
          choices: UPDATES_MODES,
          defaultText: 'default ask',
          onChoice: value => ctx.act.updates(value as UpdatesMode),
          fieldKey: 'st-ui-in-updates',
          fieldLabel: 'updates',
          fieldHint: '',
          where: 'the console’s update check',
        }),
        row(
          ctx,
          [
            button(ctx, 'updates-check-now', '↻ check for an update now', () => ctx.act.checkUpdates(), { primary: true }),
            text(ctx, ` ${ctx.state.updateNote === '' ? 'it asks before installing, whatever the setting' : ctx.state.updateNote}`, { dimColor: true }),
          ],
          'updates-check-row',
        ),
      ],
    },
  ]
}

/** The kinds of action remembered with "Always allow": each can be forgotten, or all at once. */
function rememberedRows(ctx: Ctx): RenderElement[] {
  const entries = [...ctx.state.allowed.entries()]

  if (entries.length === 0) return [text(ctx, ' nothing remembered: a low-risk ruflo action offers “Always allow” on its confirm row; one that reaches the network, spends, deletes or publishes never does', { dimColor: true })]

  return [
    ...entries.map(([key, label]) =>
      row(ctx, [ctx.kit.Text({ color: THEME.ok, children: ' ✓ ' }), ctx.kit.Text({ bold: true, children: `${key} ` }), ctx.kit.Text({ dimColor: true, children: clip(`e.g. ${label}`, Math.max(10, ctx.columns - key.length - 24)) }), button(ctx, `st-forget-${key}`, '✕ forget', () => ctx.act.forget(key))], `st-allowed-${key}`),
    ),
    row(ctx, [button(ctx, 'st-forget-all', 'forget all (ask every time again)', () => ctx.act.forget(''))], 'st-allowed-all'),
  ]
}

/** Where the last change landed: the confirm row asks above; this says what came of it. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { outcome } = ctx.state

  if (outcome === null || ctx.nowMs - outcome.atMs > 120_000 || !/^set /.test(outcome.label)) return []

  return [text(ctx, ` ${outcome.ok ? '✓' : '✗'} ${outcome.label}`, { bold: true, color: outcome.ok ? THEME.ok : THEME.bad }), ...(outcome.detail === '' ? [] : [text(ctx, `   ${clip(outcome.detail, 200)}`, { dimColor: true })])]
}

/** The search box: a framed field that applies the search on Enter and empties itself; the active search shows as a chip you can clear. */
function searchRows(ctx: Ctx, query: string, found: number): RenderElement[] {
  const Input = ctx.kit.Input
  const rows: RenderElement[] = []

  if (Input !== undefined) {
    rows.push(
      ctx.kit.Box({
        key: 'st-search-box',
        borderStyle: 'round',
        borderColor: THEME.info,
        paddingX: 1,
        children: [Input({ key: 'st-search', label: '✎ search', placeholder: 'every setting, in every plugin: a name, an option, a word (Enter applies)', submitLabel: 'search', onSubmit: value => ctx.act.settings.search(value) })],
      }),
    )
  }

  if (query !== '') rows.push(row(ctx, [text(ctx, ` search “${clip(query, 40)}” · ${found} found `, { bold: true, color: THEME.ok }), button(ctx, 'st-search-clear', '✕ clear', () => ctx.act.settings.search(''))], 'st-search-chip'))

  return rows
}

/**
 * Settings, simple to advanced, with search. A search box finds any setting across every ruflo plugin with options, ruflo's
 * config and the AI terminal's preferences (in either level); without one, the level picks the few that matter or all.
 * Each setting is two lines (its choices inline, then what it is) with a ● when it differs from its default; ✦ claude and
 * ✦ codex send an explaining prompt to that AI at once. Every change asks first with its exact command.
 */
export function settingsView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const settings = settingsOf(state)
  const names = pluginNames(state, (catalogOf(state).plugins ?? []).filter(plugin => plugin.options.length > 0).map(plugin => plugin.name))
  const words = settings.query.toLowerCase().split(/\s+/).filter(Boolean)

  const loaded = names.flatMap(name => {
    const config = settings.configs.get(name)

    return config === undefined || config === 'error' ? [] : [config]
  })
  const everything: Item[] = [...loaded.flatMap(config => pluginItems(ctx, config)), ...coreItems(ctx), ...aiItems(ctx), ...uiItems(ctx)]
  const isSearching = words.length > 0
  const pass = (item: Item) => (!settings.onlyChanged || item.changed) && (isSearching ? words.every(word => item.haystack.includes(word)) : settings.level === 'advanced' || item.level === 'simple')
  const shown = everything.filter(pass)
  const changed = everything.filter(item => item.changed).length

  const rows: RenderElement[] = [rule(ctx, 'Settings', `${shown.length} shown of ${everything.length} · ${changed} changed`)]

  rows.push(
    row(
      ctx,
      [
        ...(['simple', 'advanced'] as const).map(level => ctx.kit.Button({ key: `st-level-${level}`, label: ` ${settings.level === level ? '●' : '○'} ${level} `, plain: true, ...(settings.level === level && { variant: 'primary' as const }), onPress: () => ctx.act.settings.level(level) })),
        ctx.kit.Button({ key: 'st-changed', label: ` ${settings.onlyChanged ? '●' : '○'} changed only `, plain: true, ...(settings.onlyChanged && { variant: 'primary' as const }), onPress: () => ctx.act.settings.changedOnly(!settings.onlyChanged) }),
        button(ctx, 'st-reload', '↻ read again', () => ctx.act.settings.reload()),
      ],
      'st-levels',
    ),
  )
  rows.push(text(ctx, settings.level === 'simple' ? ' simple shows the few that matter · search finds any setting in either level' : ' advanced shows every option of the plugin you pick', { dimColor: true }))
  rows.push(...searchRows(ctx, settings.query, shown.length))
  rows.push(...resultRows(ctx))

  if (isSearching) {
    const waiting = names.filter(name => !settings.configs.has(name)).length

    if (waiting > 0) rows.push(text(ctx, ` reading ${waiting} more plugin${waiting === 1 ? '' : 's'}…`, { dimColor: true }))
    if (shown.length === 0 && waiting === 0) rows.push(text(ctx, ' nothing matches: try one word, or clear the search', { dimColor: true }))

    let last = ''

    for (const item of shown) {
      if (item.source !== last) {
        rows.push(text(ctx, ` ── ${item.source} `, { bold: true, color: THEME.head }))
        last = item.source
      }

      rows.push(...item.rows())
    }

    return col(ctx, rows, 'settings')
  }

  // No search: the plugin you pick, ruflo's config, and the AI terminal, each a section that folds.
  const config = settings.configs.get(settings.plugin)
  const pluginRows: RenderElement[] = [
    row(ctx, names.map(name => ctx.kit.Button({ key: `st-plugin-${name}`, label: ` ${settings.plugin === name ? '●' : '○'} ${name.replace(/^ruflo-/, '')} `, plain: true, ...(settings.plugin === name && { variant: 'primary' as const }), onPress: () => ctx.act.settings.plugin(name) })), 'st-plugins'),
  ]

  if (config === undefined) pluginRows.push(text(ctx, settings.loading.has(settings.plugin) ? ' reading its options…' : ' not read yet', { dimColor: true }))
  else if (config === 'error') pluginRows.push(text(ctx, ` ${settings.plugin} has no readable options (is it installed? claude plugin configure ${settings.plugin}@ruflo --json)`, { color: THEME.warn }))
  else for (const item of shown.filter(candidate => candidate.id.startsWith(`${settings.plugin}-`))) pluginRows.push(...item.rows())

  rows.push(...section(ctx, 'options', 'Plugin options', `${names.length} ruflo plugins with options`, pluginRows))
  rows.push(...section(ctx, 'config', 'ruflo config', settings.coreLoading ? 'reading…' : 'ruflo config get / set', shown.filter(item => item.id.startsWith('core-')).flatMap(item => item.rows())))
  rows.push(...section(ctx, 'ai', 'AI terminal', 'claude -p and codex exec: saved here, applied to the next turn', [...shown.filter(item => item.id.startsWith('ai-')).flatMap(item => item.rows()), text(ctx, ' claude runs read-only in plan mode and codex in a read-only sandbox: this view never widens either.', { dimColor: true })]))

  rows.push(...section(ctx, 'ui', 'Interface', 'the main nav', shown.filter(item => item.id.startsWith('ui-')).flatMap(item => item.rows())))
  rows.push(...section(ctx, 'allowed', 'Remembered actions', `${ctx.state.allowed.size} kind${ctx.state.allowed.size === 1 ? '' : 's'} not asked again`, rememberedRows(ctx), ctx.state.allowed.size > 0))

  return col(ctx, rows, 'settings')
}
