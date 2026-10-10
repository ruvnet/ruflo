/**
 * The main menu's colours, a leaf with no imports: the drawing code (the animated palette strip in gfx and frames) reads them, and
 * menu-style.ts, which reaches the pages, re-exports them. Each is a step of the xterm 256-colour cube or its grey ramp
 * (tests/menu-style.spec.ts holds that, and the contrast of the ink on each accent).
 */
/**
 * A chip: the colour is its ground, drawn with `inverse`, so the text takes the terminal's own background colour over it. Never a fixed
 * ink on an explicit background: if the host did not draw that background, the ink would be near-black on a dark terminal and the text
 * would be gone. Inverse cannot vanish, and where it is not honoured the chip falls back to text in the colour itself.
 */
export const chip = (ground: string) => ({ color: ground, inverse: true, bold: true }) as const

/** The muted colour of a badge that is only information, and the loud one for a badge that needs a person. */
export const MUTED = '#8a8a8a'
export const LOUD = '#ffaf00'

/** One accent per page group, by the group's title (the nav's: nav-state.ts NAV_GROUPS). The menu's boxes, the nav's chips and the pages' cards all wear it. */
export const ACCENT: Readonly<Record<string, string>> = {
  SWARM: '#ffaf00',
  MIND: '#5fd7ff',
  SAFETY: '#ff5f5f',
  NETWORK: '#5fd75f',
  TOOLS: '#d787ff',
}

/** The palette strip above the groups: the accents in menu order. */
export const PALETTE: readonly string[] = ['#ffaf00', '#5fd7ff', '#ff5f5f', '#5fd75f', '#d787ff']

/** `#rrggbb` as the 0xRRGGBB number a Grid takes. */
export const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

/** The accent of a page's group: the very table the menu's boxes use, so a page wears the colour of the box the menu lists it in. */
export const NAV_ACCENT: Readonly<Record<string, string>> = ACCENT

/** The colour of a mission's status line, by tone: running and done green, ready amber, paused cyan, waiting dim. */
export const TONE = { live: '#5fd75f', ready: '#ffaf00', wait: '#8a8a8a', done: '#5fd75f', paused: '#5fd7ff' } as const

/** The ground of a cost chip in a run row, by how much it asks of the person: a read green, local work or a write cyan, the network amber, spending or deleting red. */
export const COST_CHIP = { ok: '#5fd75f', info: '#5fd7ff', warn: '#ffaf00', bad: '#ff5f5f' } as const
