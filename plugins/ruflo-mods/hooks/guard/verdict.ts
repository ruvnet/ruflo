/**
 * Verdict arithmetic for `tool.check`: this mod only ever tightens.
 *
 * `deny` > `ask` > `allow`. The merged verdict is the stricter of the chain's
 * and ruflo's; on a tie the chain's stands untouched, so its `rule` (what
 * sec-default reads to hold a deny) is never rewritten or erased.
 */

export type Decision = 'allow' | 'ask' | 'deny'

export type Verdict = {
  readonly decision: Decision
  readonly reason?: string
  readonly rule?: string
  /**
   * Claude Code 2.1.304: `'person'` lets only the permission dialog or a host's callback approve this ask (no
   * classifier or auto mode); where nobody can be asked it is refused with the reason. Older hosts ignore it.
   */
  readonly decider?: 'person'
  /** Claude Code 2.1.290: the approval an organization requires for the tool. Opaque here: carried, never set. */
  readonly ceiling?: unknown
}

const RANK: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 }

export function isDecision(value: unknown): value is Decision {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

/**
 * The stricter of two verdicts; `ours` absent means ruflo has no opinion.
 * When ours wins, the chain's `ceiling` rides along on it, so an organization's
 * required approval is never dropped by a tightening.
 *
 * @param chain what `next(e)` resolved to (the engine's verdict and beneath)
 * @param ours ruflo's tightening, if any
 */
export function stricter<V extends Verdict>(chain: V, ours: Verdict | undefined): V | Verdict {
  if (!ours) return chain
  // A chain answer of an unknown shape is treated as the loosest verdict, so
  // ruflo's opinion still holds; it never makes ruflo's verdict looser.
  const chainRank = isDecision(chain.decision) ? RANK[chain.decision] : -1
  if (RANK[ours.decision] <= chainRank) return chain
  return chain.ceiling === undefined || ours.ceiling !== undefined ? ours : { ...ours, ceiling: chain.ceiling }
}

/** Whether nothing could make `verdict` stricter: a deny already holds, so ruflo has nothing to add. */
export const isFinal = (verdict: Verdict) => verdict.decision === 'deny'
