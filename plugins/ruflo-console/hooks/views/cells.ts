/**
 * Terminal-column widths for the band and anything else that lays text out by columns. Leaf: no host, no engine.
 */

/** One character's terminal width: 2 for emoji drawn as emoji (🎯, 💻) and wide CJK, 0 for a variation selector or joiner, else 1. */
const charCells = (ch: string): number => (/[\u200d\ufe0e\ufe0f]/.test(ch) ? 0 : /\p{Emoji_Presentation}|[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/u.test(ch) ? 2 : 1)

/** How many terminal columns `text` takes. `.length` counts UTF-16 units, which is wrong both ways for emoji, so a row measured with it overflows and wraps. */
export const cells = (text: string): number => {
  let n = 0

  for (const ch of text) n += charCells(ch)

  return n
}

/** `clip` measured in terminal columns: the result, ellipsis included, takes at most `width` columns. */
export function clipCells(text: string, width: number): string {
  if (cells(text) <= width) return text

  let out = ''
  let used = 0

  for (const ch of text) {
    const w = charCells(ch)

    if (used + w > width - 1) break
    out += ch
    used += w
  }

  return width <= 0 ? '' : `${out}…`
}
