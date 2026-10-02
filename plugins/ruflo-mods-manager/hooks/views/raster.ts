/**
 * Terminal cell graphics for `Raster` (2.1.287 RasterProps): a grid of `[codePoint, fg, bg]` little-endian u32
 * triplets, row-major, base64. Pure: no engine call, so it runs under plain vitest and in the module alike.
 */

/** The terminal's own colour (bit 24 alone). */
export const DEFAULT = 0x01000000

export const MAX_COLUMNS = 512
export const MAX_ROWS = 256

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64, by hand: the fallback where `Uint8Array.prototype.toBase64` is absent (Node 22). */
export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0

  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)

    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }

  const rest = bytes.length - i

  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16

    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}==`
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)

    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}${B64[(n >> 6) & 63]!}=`
  }

  return out
}

/** The module environment has `toBase64` (probed on 2.1.287); plain Node 22 does not. Same output either way. */
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64

  return typeof native === 'function' ? native.call(bytes) : encodeBase64(bytes)
}

/** A printable width-1 BMP code point, or a space: anything else would get the whole tree refused. */
export function cellGlyph(ch: string | number): number {
  const cp = typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 0x20)
  const printable = cp >= 0x20 && cp < 0x7f ? true : cp >= 0x2500 && cp <= 0x28ff

  return printable ? cp : 0x20
}

export class Grid {
  readonly columns: number
  readonly rows: number
  readonly cells: Uint32Array

  constructor(columns: number, rows: number) {
    this.columns = Math.max(1, Math.min(MAX_COLUMNS, Math.floor(columns)))
    this.rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(rows)))
    this.cells = new Uint32Array(this.columns * this.rows * 3)

    for (let i = 0; i < this.columns * this.rows; i += 1) {
      this.cells[i * 3] = 0x20
      this.cells[i * 3 + 1] = DEFAULT
      this.cells[i * 3 + 2] = DEFAULT
    }
  }

  set(x: number, y: number, ch: string | number, fg = DEFAULT, bg = DEFAULT): void {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) {
      return
    }

    const at = (y * this.columns + x) * 3

    this.cells[at] = cellGlyph(ch)
    this.cells[at + 1] = fg >>> 0
    this.cells[at + 2] = bg >>> 0
  }

  glyphAt(x: number, y: number): number {
    return this.cells[(y * this.columns + x) * 3] ?? 0x20
  }

  /** ASCII text from (x, y), cut at `width`. */
  text(x: number, y: number, text: string, fg = DEFAULT, width = this.columns - x): void {
    const chars = [...text].slice(0, Math.max(0, width))

    chars.forEach((ch, i) => this.set(x + i, y, ch, fg))
  }

  toBase64(): string {
    return toBase64(new Uint8Array(this.cells.buffer, this.cells.byteOffset, this.cells.byteLength))
  }

  toRaster(key: string): { key: string; columns: number; rows: number; cells: string } {
    return { key, columns: this.columns, rows: this.rows, cells: this.toBase64() }
  }
}

/** Dot bit of braille cell column `dx` (0..1), row `dy` (0..3): U+2800 plus these. */
const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

/**
 * A braille canvas over a region of a Grid: each cell a 2×4 dot grid. One colour per cell, so each dot carries a
 * priority and the highest drawn into a cell sets its colour.
 */
export class Braille {
  readonly width: number
  readonly height: number
  private readonly bits: Uint8Array
  private readonly color: Uint32Array
  private readonly rank: Uint8Array

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.width = columns * 2
    this.height = rows * 4
    this.bits = new Uint8Array(columns * rows)
    this.color = new Uint32Array(columns * rows).fill(DEFAULT)
    this.rank = new Uint8Array(columns * rows)
  }

  dot(x: number, y: number, fg: number, priority = 1): void {
    const px = Math.round(x)
    const py = Math.round(y)

    if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
      return
    }

    const cell = Math.floor(py / 4) * this.columns + Math.floor(px / 2)

    this.bits[cell] = (this.bits[cell] ?? 0) | DOT[py % 4]![px % 2]!

    if (priority >= (this.rank[cell] ?? 0)) {
      this.rank[cell] = priority
      this.color[cell] = fg
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, fg: number, priority = 1): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))

    for (let i = 0; i <= steps; i += 1) {
      this.dot(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, fg, priority)
    }
  }

  /** Paints the dots into `grid` at cell (ox, oy); a cell with no dots is left as it was. */
  paint(grid: Grid, ox: number, oy: number): void {
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.columns; x += 1) {
        const cell = y * this.columns + x
        const bits = this.bits[cell] ?? 0

        if (bits !== 0) {
          grid.set(ox + x, oy + y, 0x2800 + bits, this.color[cell] ?? DEFAULT)
        }
      }
    }
  }
}

/** A colour scaled toward black by `k` (0..1): fades a trace by age. */
export function dim(rgb: number, k: number): number {
  const f = Math.max(0, Math.min(1, k))
  const r = Math.round(((rgb >> 16) & 0xff) * f)
  const g = Math.round(((rgb >> 8) & 0xff) * f)
  const b = Math.round((rgb & 0xff) * f)

  return (r << 16) | (g << 8) | b
}
