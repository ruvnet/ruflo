/**
 * The desktop look (ADR-546): which of this frame's pictures a surface that draws `Svg` gets as a native vector picture (gfx/vector.ts)
 * in place of the cell picture written as SVG. The same keys and the same data as views/frames.ts, so every page keeps one picture per
 * key on every surface; a key with no vector form, or a vector past the host's size limit, keeps its cell picture.
 */
import { activeTheme } from '../themes'
import { recentByAgent } from '../data/events'
import { gaugeSvg, neonTitleSvg, sparklineSvg, topologySvg, type VectorPalette } from '../gfx/vector'
import { PULSE_MS } from '../gfx/pictures'
import { isBooting, isCompactPane, VIEWS, type State } from '../state'
import { CELL_H, CELL_W } from '../gfx/svg'
import { CARD_COLUMNS, hasCards } from './card'
import { topoModelOf, topologyRows } from './frames'

/** One vector picture of this frame: its size in CSS px and its document for a given alt (the caller's words), or null past the limit. */
export type VectorSpec = { width: number; height: number; draw: (alt: string) => string | null }

/** The BBS look's neon, as hex (views/common.ts NEON). */
const NEON: Partial<VectorPalette> = { head: '#ff2a6d', ok: '#39ff14', bad: '#ff3355', warn: '#ffd319', info: '#05d9e8' }

function paletteFor(state: State): Partial<VectorPalette> | undefined {
  if (state.options.look === 'bbs') return NEON
  if (state.options.look === 'orbital') {
    const { head, ok, bad, warn, info } = activeTheme(state).palette

    return { head, ok, bad, warn, info }
  }

  return undefined
}

const usd = (value: number): string => `$${value.toFixed(2)}`

/**
 * This frame's vector pictures, by picture key. Empty while the boot screen owns the pane (it stays a cell picture), for the `cells`
 * setting, and for a page with no vector form. Built per render from data alone: the motion is the surface's (CSS), and stops when the
 * console's fps is 0.
 */
export function vectorsOf(state: State, columns: number, nowMs: number): Map<string, VectorSpec> {
  const vectors = new Map<string, VectorSpec>()

  if (state.desktopArt !== 'rich' || isBooting(state, nowMs)) return vectors

  const cells = Math.max(20, Math.min(200, hasCards(columns, isCompactPane(state)) ? columns - CARD_COLUMNS : columns))
  const width = cells * CELL_W
  const palette = paletteFor(state)
  const animate = state.options.fps > 0
  const options = (w: number, h: number) => ({ width: w, height: h, animate, ...(palette !== undefined && { palette }) })
  const add = (key: string, w: number, h: number, draw: (alt: string, o: ReturnType<typeof options>) => string | null): void => {
    vectors.set(key, { width: w, height: h, draw: alt => draw(alt, options(w, h)) })
  }

  // The BBS look's neon sign: the menu's banner and every page's title, as lit tubes rather than block letters.
  if (state.options.look === 'bbs') {
    if (state.view === 'menu') add('header', Math.min(width, 640), 72, (alt, o) => neonTitleSvg('ruflo', 'agent swarm console', alt, o))
    const page = state.isHelp ? 'help' : state.palette.isOpen ? 'palette' : state.view === 'agent' ? 'agent' : (VIEWS.find(view => view.id === state.view)?.label ?? state.view)

    add('title', Math.min(width, 720), 56, (alt, o) => neonTitleSvg(state.view === 'menu' && !state.isHelp && !state.palette.isOpen ? 'ruflo bbs' : `ruflo | ${page}`, '', alt, o))
  }

  switch (state.view) {
    case 'overview':
      add('activity', width, 96, (alt, o) => sparklineSvg([{ label: 'tool calls / 5 s', values: state.activity }, { label: 'state writes', values: state.writes }], alt, o, v => String(Math.round(v))))
      break
    case 'swarm': {
      const model = topoModelOf(state.snapshot, recentByAgent(state.events, nowMs, PULSE_MS + 600), nowMs)

      if (model !== null) add('topology', width, topologyRows(cells, model.nodes.length) * CELL_H, (alt, o) => topologySvg(model, alt, o))
      break
    }
    case 'cost': {
      const budget = state.ruflo.snapshot?.budget
      const spend = budget?.usd ?? state.usage?.costUsd ?? null

      add('gauge', Math.min(width, 60 * CELL_W), 9 * CELL_H, (alt, o) => gaugeSvg(spend, budget?.limit ?? null, alt, o))
      add('burn', width, 56, (alt, o) => sparklineSvg([{ label: 'spend since load', values: state.history.spend.map(sample => sample.value) }], alt, o, usd))
      break
    }
    default:
      break
  }

  return vectors
}
