/**
 * `Text` `weight` (Claude Code 2.1.299, which deprecated `bold`) on every host. The views say `weight`; a host
 * before 2.1.299 refuses a whole tree whose Text carries a prop it does not know (`Text prop "weight" is not
 * allowed`) and draws its own row instead, so there the kit's Text is wrapped to say `bold` again. The host itself
 * reads `bold: true` as `weight: "semibold"`, so the two forms draw the same.
 *
 * Kept identical in ruflo-console and ruflo-swarm: a hooks module may not import outside its own plugin.
 */

export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold'

/** The first Claude Code whose mod `Text` takes `weight`. */
export const TEXT_WEIGHT_SINCE: readonly [number, number, number] = [2, 1, 299]

/**
 * Whether the engine version `$.session.version()` gave takes `weight`. Anything unreadable is an older host:
 * `bold` still draws on 2.1.299 and later (deprecated, not refused), while `weight` is refused before it.
 */
export function hasTextWeight(value: unknown): boolean {
  const { version, base } = (value ?? {}) as { version?: unknown; base?: unknown }
  const text = typeof base === 'string' && base !== '' ? base : version
  const parts = typeof text === 'string' ? /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})/.exec(text) : null
  if (parts === null) return false
  const [major, minor, patch] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const [m, n, p] = TEXT_WEIGHT_SINCE
  return major !== m ? major > m : minor !== n ? minor > n : patch >= p
}

/** A Text's props for a host before 2.1.299: a semibold or bold weight becomes `bold: true`; any other weight is dropped. */
export function legacyTextProps<P extends object>(props: P): P {
  if (!('weight' in props)) return props
  const { weight, ...rest } = props as P & { weight?: unknown }
  return (weight === 'semibold' || weight === 'bold' ? { ...rest, bold: true } : rest) as P
}

/** The kit as this host draws it: unchanged where `weight` is known, its Text saying `bold` where it is not. */
export function withTextWeight<K extends { Text: (props: never) => unknown }>(kit: K, isKnown: boolean): K {
  if (isKnown) return kit
  const text = kit.Text as (props: object) => unknown
  return { ...kit, Text: ((props: object) => text(legacyTextProps(props))) as K['Text'] }
}
