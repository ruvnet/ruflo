/**
 * The confirm-gated "forget the Events and Timeline history" action. Linux and macOS remove the two history files with `rm -f`; Windows
 * (host-fs, data/write-flavor.ts) has no rm and no delete, so there each file is emptied through the host's file API instead.
 */
import type { ActionSpec } from './actions'
import { plain } from './data/parse'
import type { WriteFlavor } from './data/write-flavor'
import { emptyFiles, type WriteHost } from './data/write-via'

const LABEL = 'forget the Events and Timeline history'
const NOTE = "only the console's own history files for this project; saved searches, pins and rules stay"

/** `forgotten` runs once the files are gone (or emptied): the page drops what it holds in memory. */
export function forgetEventsSpec(flavor: WriteFlavor, paths: { events: string; lanes: string }, host: WriteHost, forgotten: () => void): ActionSpec {
  if (flavor !== 'host-fs') {
    return {
      label: LABEL,
      args: [],
      argv: ['rm', '-f', '--', paths.events, paths.lanes],
      expect: 'events.jsonl and lanes.jsonl removed',
      declared: 'delete',
      shows: `rm -f -- ${paths.events} ${paths.lanes}`,
      note: `deletes ${NOTE}`,
      timeoutMs: 10_000,
      onOutput: forgotten,
      verifyLocal: async h => (await h.fs.stat(paths.events).catch(() => undefined)) === undefined,
    }
  }

  return {
    label: LABEL,
    args: [],
    expect: 'events.jsonl and lanes.jsonl emptied',
    declared: 'delete',
    shows: `empty ${paths.events} and ${paths.lanes} (no delete on Windows: the files stay, with no history in them)`,
    note: `empties ${NOTE}`,
    run: async () => {
      const problem = await emptyFiles(host, [paths.events, paths.lanes])

      if (problem === null) forgotten()

      return { label: LABEL, ok: problem === null, detail: problem === null ? 'events.jsonl and lanes.jsonl emptied' : `the write failed: ${plain(problem, 120)}` }
    },
  }
}
