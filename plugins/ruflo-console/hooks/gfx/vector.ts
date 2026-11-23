/**
 * Native vector pictures for the surfaces that draw `Svg` (ADR-546): the swarm graph, the budget gauge, sparklines and a neon title,
 * drawn from the data itself rather than from the terminal's cell grid. Each is one self-contained SVG document, shown by the host in a
 * script-less sandboxed frame (`isInteractive`), where CSS animation, `:hover` and `<title>` tooltips work.
 *
 * Pure: no `$`, no Node, no clock. A document is a function of its data alone, so it is the same string until the data changes, and the
 * motion runs in the surface (CSS keyframes), never in the plugin's frame loop. The rules every document keeps (tested in
 * tests/vector-pictures.spec.ts):
 *   - data reaches the markup only through `escapeXml` (text, `<title>`, attributes) or as a finite, rounded number;
 *   - a colour is a validated `#rgb`/`#rrggbb` or the built-in default, and only ever an attribute: `<style>` is a constant;
 *   - no `href`, `<image>`, `<foreignObject>`, `<script>`, `on*` attribute or external `url(...)`, only `url(#local-id)`;
 *   - no motion at all when the console's fps is 0, and none under `prefers-reduced-motion`;
 *   - at most `SVG_SOURCE_MAX` characters, else null (the caller then draws the cell picture).
 */
import { escapeXml, SVG_SOURCE_MAX } from './svg'
import { edges, layout, type TopoModel } from './pictures'

/** The colours a vector picture uses, by role. */
export type VectorPalette = { head: string; ok: string; bad: string; warn: string; info: string; dim: string }
/** How a picture is drawn: its size in CSS px, its colours, and whether it moves. */
export type VectorOptions = { width: number; height: number; palette?: Partial<VectorPalette>; animate: boolean }

/** Reads on a light and on a dark page alike: the console's plain look has no hex colours of its own (it names the terminal's). */
export const DEFAULT_PALETTE: VectorPalette = { head: '#d97757', ok: '#3fb950', bad: '#f85149', warn: '#d29922', info: '#58a6ff', dim: '#8b949e' }

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const FONT = 'font-family="SFMono-Regular, Menlo, Consolas, DejaVu Sans Mono, monospace"'
const MAX_LABEL = 24
/** The widest and tallest picture drawn, in CSS px: a hostile width cannot ask for a huge canvas. */
const MAX_W = 1600
const MAX_H = 900

/** A colour fit for an attribute: a hex colour as given, anything else (a terminal colour name, a typo, markup) the default. */
export const safeColor = (value: string | undefined, fallback: string): string => (value !== undefined && HEX.test(value) ? value : fallback)

export function paletteOf(given: Partial<VectorPalette> | undefined): VectorPalette {
  const p = given ?? {}

  return {
    head: safeColor(p.head, DEFAULT_PALETTE.head),
    ok: safeColor(p.ok, DEFAULT_PALETTE.ok),
    bad: safeColor(p.bad, DEFAULT_PALETTE.bad),
    warn: safeColor(p.warn, DEFAULT_PALETTE.warn),
    info: safeColor(p.info, DEFAULT_PALETTE.info),
    dim: safeColor(p.dim, DEFAULT_PALETTE.dim),
  }
}

/** A finite number, rounded for the markup; anything else 0. */
const num = (value: number, places = 1): string => {
  if (!Number.isFinite(value)) return '0'
  const f = 10 ** places
  const r = Math.round(value * f) / f

  return Object.is(r, -0) ? '0' : String(r)
}

const clampSize = (value: number, max: number): number => Math.max(1, Math.min(max, Number.isFinite(value) ? Math.round(value) : 1))
const short = (label: string): string => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label)

/**
 * The motion, as one constant stylesheet: no data is ever written into it. Classes: `ring` (a node's pulse), `flow` (traffic running
 * along an edge) and `flicker` (a neon sign): only motion that loops. A picture whose data ticks (a sparkline every 5 s, the gauge every
 * turn) is a new document each time, so an entrance animation there would replay on every tick; those pictures are still and hoverable.
 * Reduced motion turns every animation off.
 */
const MOTION =
  '.ring{transform-box:fill-box;transform-origin:center;animation:ring 1.8s ease-out infinite}' +
  '.once{animation-iteration-count:3}' +
  '@keyframes ring{from{transform:scale(1);opacity:.85}to{transform:scale(2.8);opacity:0}}' +
  '.flow{stroke-dasharray:3 9;animation:flow .9s linear infinite}' +
  '@keyframes flow{to{stroke-dashoffset:-24}}' +
  '.flicker{animation:flicker 6s linear infinite}' +
  '@keyframes flicker{0%,18%,22%,62%,64%,100%{opacity:1}20%,63%{opacity:.55}}' +
  '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
/** Hover works with or without motion: the node or sample under the pointer stands out, and its `<title>` is the tooltip. */
const HOVER = '.n{cursor:default}.n:hover .dot{stroke-width:3}.n:hover text{opacity:1}.pt{opacity:0}.pt:hover{opacity:.35}'

/** One document: the size, the alt as its accessible name and `<title>`, the constant style, the body; null past the host's limit. */
function doc(width: number, height: number, alt: string, body: string, animate: boolean, defs = ''): string | null {
  const w = clampSize(width, MAX_W)
  const h = clampSize(height, MAX_H)
  const label = escapeXml(alt)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">` +
    `<title>${label}</title><style>${HOVER}${animate ? MOTION : ''}</style>${defs === '' ? '' : `<defs>${defs}</defs>`}${body}</svg>`

  return source.length <= SVG_SOURCE_MAX ? source : null
}

/** A node's colour by the status ruflo wrote: busy amber, error red, stopped grey, the leader the heading colour, else blue. */
export function statusColor(status: string, isLeader: boolean, p: VectorPalette): string {
  if (isLeader) return p.head
  if (/busy|active|running|working/i.test(status)) return p.warn
  if (/error|fail/i.test(status)) return p.bad
  if (/stop|terminat|offline|dead/i.test(status)) return p.dim

  return p.info
}

const isBusy = (status: string): boolean => /busy|active|running|working/i.test(status)

/**
 * The swarm graph: the same layout and edges as the terminal's (gfx/pictures.ts), scaled from braille dots to px. Every node is a
 * group with a `<title>` (label, status, id) and a hover state; a busy node pulses and traffic runs along its edges; a node the
 * console just saw an event about rings a few times. Labels are drawn while there is room for them (24 nodes or fewer).
 */
export function topologySvg(model: TopoModel, alt: string, options: VectorOptions): string | null {
  const p = paletteOf(options.palette)
  const w = clampSize(options.width, MAX_W)
  const h = clampSize(options.height, MAX_H)
  // The layout works in braille dots (2 per cell across, 4 down); a cell is 8 by 16 px.
  // Labels hang under their nodes, so the layout leaves a strip at the bottom for them.
  const hasLabels = model.nodes.length <= 24
  const dotsW = Math.max(8, Math.floor(w / 4))
  const dotsH = Math.max(8, Math.floor((h - (hasLabels ? 16 : 0)) / 4))
  const at = layout(model, dotsW, dotsH).map(pt => ({ x: pt.x * 4, y: pt.y * 4 }))
  const pairs = edges(model)
  const lines: string[] = []
  const flows: string[] = []

  for (const [a, b] of pairs) {
    const from = at[a]
    const to = at[b]
    const node = model.nodes[b]

    if (from === undefined || to === undefined || node === undefined) continue
    const d = `M${num(from.x)} ${num(from.y)}L${num(to.x)} ${num(to.y)}`

    lines.push(d)
    if (options.animate && (isBusy(node.status) || isBusy(model.nodes[a]?.status ?? ''))) flows.push(d)
  }

  const parts: string[] = []

  if (lines.length > 0) parts.push(`<path d="${lines.join('')}" fill="none" stroke="${p.dim}" stroke-opacity=".45" stroke-width="1.2"/>`)
  if (flows.length > 0) parts.push(`<path class="flow" d="${flows.join('')}" fill="none" stroke="${p.warn}" stroke-width="2" stroke-linecap="round"/>`)

  model.nodes.forEach((node, i) => {
    const pt = at[i]

    if (pt === undefined) return
    const color = statusColor(node.status, node.isLeader, p)
    const r = node.isLeader ? 9 : model.nodes.length > 40 ? 4 : 6
    const tip = escapeXml(`${node.label} · ${node.isLeader ? 'leader' : node.status} · ${node.id}`)
    const x = num(pt.x)
    const y = num(pt.y)
    const ring = options.animate && (isBusy(node.status) || node.pulseAtMs !== undefined)
      ? `<circle class="ring${isBusy(node.status) ? '' : ' once'}" cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${isBusy(node.status) ? color : '#ffffff'}" stroke-width="1.5"/>`
      : ''
    const label = hasLabels ? `<text x="${x}" y="${num(pt.y + r + 12)}" text-anchor="middle" font-size="10" fill="${p.dim}" opacity=".85" ${FONT}>${escapeXml(short(node.label))}</text>` : ''
    const star = node.isLeader ? `<text x="${x}" y="${num(pt.y + 3.5)}" text-anchor="middle" font-size="10" fill="#ffffff" ${FONT}>★</text>` : ''

    parts.push(`<g class="n"><title>${tip}</title>${ring}<circle class="dot" cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity=".9" stroke="${color}" stroke-width="1"/>${star}${label}</g>`)
  })

  return doc(w, h, alt, parts.join(''), options.animate)
}

/** Where a share of the budget sits on the ladder (ADR-437): green below half, blue to 75%, amber to 90%, red past it. */
export const ladderColor = (ratio: number, p: VectorPalette): string => (ratio < 0.5 ? p.ok : ratio < 0.75 ? p.info : ratio < 0.9 ? p.warn : p.bad)

const dollars = (value: number): string => `$${value >= 100 ? value.toFixed(0) : value.toFixed(2)}`

/**
 * The budget as a half-ring gauge: the arc fills to spend/limit, with ticks at 50, 75, 90 and 100%, and the dollars in
 * the middle. No limit: the spend alone, said in words. No spend: n/a, never $0.
 */
export function gaugeSvg(spend: number | null, limit: number | null, alt: string, options: VectorOptions): string | null {
  const p = paletteOf(options.palette)
  const w = clampSize(options.width, MAX_W)
  const h = clampSize(options.height, MAX_H)
  const cx = w / 2
  const r = Math.max(10, Math.min(w / 2 - 12, h - 34))
  const cy = r + 12
  const arc = `M${num(cx - r)} ${num(cy)}A${num(r)} ${num(r)} 0 0 1 ${num(cx + r)} ${num(cy)}`
  const hasSpend = spend !== null && Number.isFinite(spend) && spend >= 0
  const hasLimit = limit !== null && Number.isFinite(limit) && limit > 0
  const ratio = hasSpend && hasLimit ? Math.min(1, (spend as number) / (limit as number)) : 0
  const color = ladderColor(ratio, p)
  const parts = [`<path d="${arc}" fill="none" stroke="${p.dim}" stroke-opacity=".25" stroke-width="12" stroke-linecap="round"/>`]

  if (hasSpend && hasLimit) {
    parts.push(`<path d="${arc}" pathLength="100" stroke-dasharray="${num(ratio * 100)} 100" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"><title>${escapeXml(`${dollars(spend as number)} of ${dollars(limit as number)} (${Math.round(ratio * 100)}%)`)}</title></path>`)
    for (const step of [0.5, 0.75, 0.9, 1]) {
      const a = Math.PI * (1 - step)
      const x1 = cx + Math.cos(a) * (r - 9)
      const y1 = cy - Math.sin(a) * (r - 9)
      const x2 = cx + Math.cos(a) * (r + 9)
      const y2 = cy - Math.sin(a) * (r + 9)

      parts.push(`<g class="n"><title>${Math.round(step * 100)}% · ${escapeXml(dollars((limit as number) * step))}</title><path d="M${num(x1)} ${num(y1)}L${num(x2)} ${num(y2)}" stroke="${p.dim}" stroke-width="2"/></g>`)
    }
  }

  const main = hasSpend ? dollars(spend as number) : 'n/a'
  const sub = hasLimit ? `of ${dollars(limit as number)}${hasSpend ? ` · ${Math.round(ratio * 100)}%` : ''}` : 'no budget set'

  parts.push(`<text x="${num(cx)}" y="${num(cy - 6)}" text-anchor="middle" font-size="22" font-weight="600" fill="${hasSpend && hasLimit ? color : p.info}" ${FONT}>${escapeXml(main)}</text>`)
  parts.push(`<text x="${num(cx)}" y="${num(cy + 14)}" text-anchor="middle" font-size="11" fill="${p.dim}" ${FONT}>${escapeXml(sub)}</text>`)

  return doc(w, h, alt, parts.join(''), options.animate)
}

/** One series of a sparkline: its name (the legend and every tooltip) and its values, oldest first. */
export type Series = { label: string; values: readonly number[] }

/** The last 120 finite values: a long session cannot grow the document past the limit. */
const tail = (values: readonly number[]): number[] => values.filter(v => Number.isFinite(v)).slice(-120)

/**
 * Sparklines, one band per series: a line over a soft area, the newest value as a dot, and an invisible column per
 * sample whose `<title>` is its value (hover shows it). Fewer than two samples: the series says so in words.
 */
export function sparklineSvg(series: readonly Series[], alt: string, options: VectorOptions, format: (value: number) => string = v => num(v, 2)): string | null {
  const p = paletteOf(options.palette)
  const colors = [p.info, p.ok, p.warn, p.head]
  const w = clampSize(options.width, MAX_W)
  const shown = series.slice(0, 4)
  const band = Math.max(28, Math.floor((clampSize(options.height, MAX_H) - 4) / Math.max(1, shown.length)))
  const h = band * Math.max(1, shown.length) + 4
  const left = 8
  const right = w - 70
  const parts: string[] = []

  shown.forEach((s, k) => {
    const values = tail(s.values)
    const color = colors[k % colors.length] as string
    const top = k * band + 14
    const bottom = (k + 1) * band - 2
    const name = escapeXml(short(s.label))

    parts.push(`<text x="${left}" y="${top - 3}" font-size="10" fill="${p.dim}" ${FONT}>${name}</text>`)
    if (values.length < 2) {
      parts.push(`<text x="${left}" y="${num((top + bottom) / 2 + 4)}" font-size="11" fill="${p.dim}" ${FONT}>not enough samples yet</text>`)

      return
    }

    const max = Math.max(...values)
    const min = Math.min(0, ...values)
    const span = max - min || 1
    const step = (right - left) / (values.length - 1)
    const pts = values.map((v, i) => ({ x: left + i * step, y: bottom - ((v - min) / span) * (bottom - top) }))
    const line = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${num(pt.x)} ${num(pt.y)}`).join('')
    const last = pts.at(-1) as { x: number; y: number }
    const lastValue = values.at(-1) as number

    parts.push(`<path d="${line}L${num(last.x)} ${bottom}L${left} ${bottom}Z" fill="${color}" fill-opacity=".14"/>`)
    parts.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`)
    parts.push(`<circle cx="${num(last.x)}" cy="${num(last.y)}" r="3" fill="${color}"/>`)
    parts.push(`<text x="${num(right + 8)}" y="${num(last.y + 4)}" font-size="11" fill="${color}" ${FONT}>${escapeXml(format(lastValue))}</text>`)
    pts.forEach((pt, i) => {
      parts.push(`<rect class="pt" x="${num(pt.x - step / 2)}" y="${top}" width="${num(Math.max(1, step))}" height="${bottom - top}" fill="${color}"><title>${name} · #${i + 1}: ${escapeXml(format(values[i] as number))}</title></rect>`)
    })
  })

  return doc(w, h, alt, parts.join(''), options.animate)
}

/**
 * A neon sign: the words in the heading colour with a soft glow (a local blur filter) and, while motion is on, an old tube's
 * flicker. An optional second line sits under it, unlit.
 */
export function neonTitleSvg(words: string, sub: string, alt: string, options: VectorOptions): string | null {
  const p = paletteOf(options.palette)
  const w = clampSize(options.width, MAX_W)
  const main = short(words.toUpperCase())
  const size = Math.max(14, Math.min(40, Math.floor((w - 24) / Math.max(4, main.length) / 0.62)))
  const h = clampSize(size + (sub === '' ? 18 : 34), MAX_H)
  const glow = '<filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
  const parts = [
    `<text${options.animate ? ' class="flicker"' : ''} x="12" y="${size + 4}" font-size="${size}" font-weight="700" letter-spacing="2" fill="${p.head}" filter="url(#glow)" ${FONT}>${escapeXml(main)}</text>`,
    ...(sub === '' ? [] : [`<text x="14" y="${size + 24}" font-size="11" letter-spacing="3" fill="${p.info}" ${FONT}>${escapeXml(short(sub.toUpperCase()))}</text>`]),
  ]

  return doc(w, h, alt, parts.join(''), options.animate, glow)
}
