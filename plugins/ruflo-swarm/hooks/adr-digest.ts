/**
 * The ADRs a mission carries, for the subagents it spawns (ADR-480 in ruflo-console). The console writes a small, masked digest of the
 * project's ADRs attached to the active mission to `.claude-flow/console/adr-digest.json`; this reads it when a subagent is spawned and
 * hands the block to the agent as data. Nothing is written here, nothing is fetched, and a file that is missing, large, stale or oddly
 * shaped is simply no digest. The block names the decisions in force; it does not prove the agent follows them.
 */
import type { ReaderFs } from './reader/snapshot'
import { plain } from './reader/parse'

export const ADR_DIGEST_FILE = '.claude-flow/console/adr-digest.json'
const MAX_BYTES = 16 * 1024
const MAX_BLOCK = 1400
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** A terminal escape sequence: removed whole, so no remnant such as `[31m` is left behind by the control-character wash. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

export type AdrDigest = { block: string; numbers: number[] }

/** The digest for the project, or null. `nowMs` decides staleness (a digest older than a day is not trusted). */
export async function readAdrDigest(fs: ReaderFs, nowMs: number): Promise<AdrDigest | null> {
  try {
    const stat = await fs.stat(ADR_DIGEST_FILE)

    if (stat === undefined || (stat.size ?? 0) > MAX_BYTES) return null

    const parsed = JSON.parse(await fs.read(ADR_DIGEST_FILE)) as Record<string, unknown>

    if (typeof parsed !== 'object' || parsed === null || parsed.v !== 1 || typeof parsed.block !== 'string' || parsed.block === '') return null
    if (typeof parsed.atMs !== 'number' || !Number.isFinite(parsed.atMs) || nowMs - parsed.atMs > MAX_AGE_MS || parsed.atMs - nowMs > MAX_AGE_MS) return null

    const block = parsed.block.split('\n').slice(0, 12).map(line => plain(line.replace(ANSI, ''), 320)).filter(line => line !== '').join('\n').slice(0, MAX_BLOCK)
    const numbers = Array.isArray(parsed.adrs) ? parsed.adrs.flatMap(each => (typeof each === 'object' && each !== null && typeof (each as { number?: unknown }).number === 'number' && (each as { status?: unknown }).status === 'accepted' ? [(each as { number: number }).number] : [])).filter(Number.isSafeInteger).slice(0, 8) : []

    return block === '' ? null : { block, numbers }
  } catch {
    return null
  }
}
