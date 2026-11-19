import { describe, expect, it } from 'vitest'

import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { wireWfConvo } from '../hooks/views/wf-convo'
import { liveOf, refreshFacts, resetConvo } from '../hooks/wf-convo-live'

// The Conversation board offers codex only where it is on the PATH. `which` does that on Linux and macOS; Windows has no `which`, only `where`.
const found = (exitCode: number) => ({ exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

async function factsFor(home: string, hasCodex: boolean): Promise<{ finders: string[]; hasCodex: boolean }> {
  const state = newState({})
  const finders: string[] = []
  const host = {
    home: async () => home,
    fs: { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => undefined, list: async () => [] },
    run: async (argv: readonly string[]) => {
      finders.push(`${argv[0]} ${argv[1]}`)

      // Only the finder the platform has answers; the other "is not recognised".
      const platformFinder = home.startsWith('/') ? 'which' : 'C:\\Windows\\System32\\where.exe'

      return found(argv[0] === platformFinder && hasCodex ? 0 : 127)
    },
    invalidate: () => undefined,
    every: () => ({ cancel: () => undefined }),
  } as unknown as Host

  resetConvo(state)
  wireWfConvo(state, host, '')
  await refreshFacts(state, 1_700_000_000_000)

  return { finders, hasCodex: liveOf(state).hasCodex }
}

describe('finding codex for the Conversation board', () => {
  it('uses `where` on a Windows home (drive path) and finds codex', async () => {
    expect(await factsFor('C:\\Users\\u', true)).toEqual({ finders: ['C:\\Windows\\System32\\where.exe codex'], hasCodex: true })
  })

  it('uses `where` on a share home too, and says no codex when it is not there', async () => {
    expect(await factsFor('\\\\srv\\home\\u', false)).toEqual({ finders: ['C:\\Windows\\System32\\where.exe codex'], hasCodex: false })
  })

  it('keeps `which` on a POSIX home', async () => {
    expect(await factsFor('/home/u', true)).toEqual({ finders: ['which codex'], hasCodex: true })
  })
})
