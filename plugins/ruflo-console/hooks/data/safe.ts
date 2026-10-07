/**
 * Values from files and CLI answers that another process wrote: a time past what `Date` holds, a negative, fractional-hostile or infinite
 * count, a ratio outside 0..1. Each helper answers undefined (or text) for what it will not draw, and none throws (#3817). A leaf: no imports.
 */

/** The edge of what `Date` can hold: a time past it makes `toISOString()` throw, so no reader keeps one (#3817). */
export const MAX_TIME_MS = 8.64e15
/** The largest count any view draws: a hostile 1e300 is clamped, never a display value. */
export const MAX_COUNT = 1e12

/** A time in epoch milliseconds that `Date` can hold, else undefined. */
export const timeOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_TIME_MS ? value : undefined)

/** A time as ISO text, clamped to `Date`'s range; 'n/a' for anything that is not a finite number. It never throws. */
export const isoOf = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? new Date(Math.min(MAX_TIME_MS, Math.max(-MAX_TIME_MS, value))).toISOString() : 'n/a')

/** A whole, non-negative count capped at MAX_COUNT, else undefined (a negative, fractional-hostile, NaN or infinite value is not a count). */
export const countOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), MAX_COUNT) : undefined)

/** A ratio clamped to 0..1, else undefined. */
export const ratioOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined)
