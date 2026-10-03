/**
 * The nav, drawn when the page is in cards: a short, bordered card of two or three rows instead of every page at once.
 *   row 1   [0: MAIN]  the five groups (the open one marked)  a search field
 *   row 2+  the pages of the open group (or what the search found), each `[k: icon NAME]`
 * Picking another group shows its pages while the page stays open; searching lists the pages whose name, group or description holds
 * the words (one match opens it). A page's hotkey is the one it had in the flat tab bar, and it keeps working wherever it is
 * drawn: the pages that are not showing are in the card as hidden buttons, so a number or letter reaches any page from any page.
 */
import type { RenderElement } from 'claude-code'

import { findPages, NAV_GROUPS, shownGroup } from '../nav-state'
import { VIEWS, type ViewId } from '../state'
import { CARD_COLUMNS } from './card'
import { isBbs, THEME, type Ctx } from './common'

type View = (typeof VIEWS)[number]

const PER_ROW = 6

export function groupedTabs(ctx: Ctx, hasHotkey: (view: View) => boolean): RenderElement {
  const { state } = ctx
  const inner = ctx.columns - CARD_COLUMNS
  const open = state.view === 'agent' ? state.back : state.view
  const shown = shownGroup(state)
  const query = state.navQuery
  const find = (id: ViewId) => VIEWS.find(entry => entry.id === id)
  const found = query === '' ? null : findPages(query)
  const pages: ViewId[][] = found !== null ? Array.from({ length: Math.ceil(found.length / PER_ROW) }, (_, i) => found.slice(i * PER_ROW, (i + 1) * PER_ROW)) : (NAV_GROUPS.find(group => group.title === shown)?.rows ?? []).map(ids => [...ids])

  // What a page spells: its icon, and from `brief` a short name, from `full` the whole name. The engine puts a hotkey in front ("3: ").
  const spell = (view: View, form: string) => (form === 'icons' ? view.icon : form === 'brief' ? `${view.icon} ${view.short}` : `${view.icon} ${view.label}`)
  const cells = (view: View, form: string) => (hasHotkey(view) && view.key !== '' ? 3 : 0) + spell(view, form).length + 3
  // A row's width: its pages, plus the gap and bar between each two (2 columns).
  const widest = (form: string) => Math.max(0, ...pages.map(ids => ids.reduce((sum, id) => sum + (find(id) === undefined ? 0 : cells(find(id) as View, form)), 0) + 2 * Math.max(0, ids.length - 1)))
  // auto: the richest form whose widest row fits the page; the others are the person's choice (Settings).
  const form = state.nav === 'auto' ? (['full', 'brief'].find(candidate => widest(candidate) <= inner) ?? 'icons') : state.nav

  const tab = (view: View): RenderElement => {
    const words = spell(view, form)
    const prefix = view.key === '' ? '' : `${view.key}: `

    // The open page names itself whatever the style, as the flat tab bar did: [3: 📌 CLAIMS], [0: 📟 MAIN MENU].
    if (view.id === open) return ctx.kit.Box({ key: `tab-${view.id}`, children: [ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: isBbs() ? `[${prefix}${view.icon} ${view.label.toUpperCase()}]` : `${prefix}${view.icon} ${view.label}` })] })

    return ctx.kit.Button({ key: `tab-${view.id}`, label: ` ${words} `, ...(hasHotkey(view) && view.key !== '' && { hotkey: view.key }), plain: true, dimColor: true, onPress: () => ctx.act.view(view.id) })
  }

  const menu = find('menu')
  // The group chips spell their icon only where the row has room; the search field shares their row only where it fits, else it has its own.
  const icons = inner >= 130
  // Each group takes its label, its gap and the bar that follows it (2 columns).
  const chipCells = NAV_GROUPS.reduce((sum, group) => sum + group.title.length + (icons ? 5 : 3) + 2, 12)
  const isSearchInline = inner - chipCells >= 28
  const chips = NAV_GROUPS.map(group =>
    group.title === shown && found === null
      ? ctx.kit.Box({ key: `nav-group-${group.title}`, children: [ctx.kit.Text({ bold: true, color: THEME.head, children: `[${icons ? `${group.icon} ` : ''}${group.title} ▾]` })] })
      : ctx.kit.Button({ key: `nav-group-${group.title}`, label: ` ${icons ? `${group.icon} ` : ''}${group.title} `, plain: true, dimColor: true, onPress: () => ctx.act.navigator.group(group.title) }),
  )
  const Input = ctx.kit.Input
  const search = Input === undefined ? [] : [Input({ key: 'nav-find', label: '🔎', placeholder: 'find a page', submitLabel: 'go', onSubmit: (value: string) => ctx.act.navigator.find(value) })]
  const clear = query === '' ? [] : [ctx.kit.Button({ key: 'nav-find-clear', label: ' ✕ ', plain: true, dimColor: true, onPress: () => ctx.act.navigator.clear() })]
  // A dim bar between the things on a row: the menu, each group and the search. The bar is one column with the row's gap either side.
  const bar = (key: string) => ctx.kit.Text({ key, dimColor: true, color: THEME.info, children: '│' })
  const menuCell = menu === undefined ? ctx.kit.Text({ children: '' }) : open === 'menu' ? tab(menu) : ctx.kit.Button({ key: 'tab-menu', label: ' 📟 MAIN ', plain: true, hotkey: '0', onPress: () => ctx.act.view('menu') })
  const groupCells = chips.flatMap((chip, i) => [bar(`nav-bar-${i}`), chip])
  const searchCells = isSearchInline ? [bar('nav-bar-find'), ...search, ...clear] : []
  const head = ctx.kit.Box({
    flexDirection: 'row',
    gap: 1,
    key: 'tabs-groups',
    children: [menuCell, ...groupCells, ...searchCells],
  })
  const findRow = isSearchInline ? [] : [ctx.kit.Box({ flexDirection: 'row', gap: 1, key: 'tabs-find', children: [...search, ...clear] })]
  const lines =
    found !== null && found.length === 0
      ? [ctx.kit.Text({ dimColor: true, children: ` no page matches “${query}” — try a name, a group or what it does` })]
      : pages.map((ids, i) =>
          ctx.kit.Box({ flexDirection: 'row', gap: 1, key: `tabs-row-${i}`, children: ids.flatMap((id, j) => (find(id) === undefined ? [] : [...(j > 0 ? [bar(`nav-page-bar-${i}-${j}`)] : []), tab(find(id) as View)])) }),
        )
  const note = found === null ? [] : [ctx.kit.Text({ dimColor: true, children: ` ${found.length} found for “${query}”${found.length === 1 ? '' : ' — Enter again on one name opens it'}` })]

  // Every other page with a hotkey stays in the card, hidden: its number or letter works from this page too.
  const visible = new Set<ViewId>(pages.flat())
  const hidden = VIEWS.filter(view => view.id !== 'menu' && view.id !== open && !visible.has(view.id) && hasHotkey(view) && view.key !== '')
  const keys = hidden.length === 0 ? [] : [ctx.kit.Box({ key: 'tabs-keys', display: 'none', children: hidden.map(view => ctx.kit.Button({ key: `tab-${view.id}`, label: view.short, hotkey: view.key, plain: true, onPress: () => ctx.act.view(view.id) })) } as never)]

  return ctx.kit.Box({ key: 'tabs', flexDirection: 'column', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [head, ...findRow, ...lines, ...note, ...keys] })
}
