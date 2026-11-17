import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { removeTree } from './fixtures/rm-tree'

import { taskIdOf, windowsSearchArgv } from '../hooks/data/wf-control'

// Finding a run's task id in a session transcript too large to read whole: `grep -o` on Linux and macOS, PowerShell's Select-String on Windows.
const LAUNCH = (task: string, run: string): string => `{"type":"tool","content":"{\\"taskId\\":\\"${task}\\",\\"taskType\\":\\"local_workflow\\",\\"runId\\":\\"${run}\\"}"}`.replace(/\\"/g, '"')

describe('windowsSearchArgv', () => {
  it('is a PowerShell command whose script has no double quote, and carries the path and the pattern only as base64', () => {
    const argv = windowsSearchArgv('C:\\Users\\John Smith\\.claude\\projects\\a$b\'c;d&e\\s.jsonl', 'wf_abc12345') as readonly string[]

    expect(argv[0]).toMatch(/System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i)
    expect(argv.slice(1, 4)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(argv).toHaveLength(5)
    expect(argv[4]).not.toContain('"')
    expect(argv[4]).not.toContain('John Smith')
    expect(argv[4]).not.toContain('wf_abc12345')
    expect(argv[4]).toContain('Select-String -LiteralPath $p -Pattern $q -AllMatches')
  })

  it('refuses a run id that is not one, an empty path and a NUL', () => {
    expect(windowsSearchArgv('C:\\s.jsonl', 'wf_x"; Remove-Item *')).toBeNull()
    expect(windowsSearchArgv('C:\\s.jsonl', 'not-a-run')).toBeNull()
    expect(windowsSearchArgv('', 'wf_abc12345')).toBeNull()
    expect(windowsSearchArgv('C:\\s\0.jsonl', 'wf_abc12345')).toBeNull()
  })
})

describe('taskIdOf on what a search printed (any platform)', () => {
  it('takes the latest launch when the output holds two of one run (a resume), as the whole-file reader does', () => {
    const printed = [`"taskId":"first0task","taskType":"local_workflow","runId":"wf_abc12345"`, `"taskId":"resumed9tk","taskType":"local_workflow","runId":"wf_abc12345"`].join('\n')

    expect(taskIdOf(printed, 'wf_abc12345')).toBe('resumed9tk')
    expect(taskIdOf(printed.split('\n')[0] as string, 'wf_abc12345')).toBe('first0task')
  })
})

describe.skipIf(process.platform !== 'win32')('the Windows search, through a real PowerShell', () => {
  const root = mkdtempSync(join(tmpdir(), 'wf search '))
  const folder = join(root, "o'brien $x & y; z")

  mkdirSync(folder)
  afterAll(() => removeTree(root))

  const file = join(folder, 's.jsonl')
  const filler = Array.from({ length: 20_000 }, (_unused, i) => JSON.stringify({ type: 'user', i, pad: 'x'.repeat(120) }))

  writeFileSync(file, [...filler.slice(0, 50), LAUNCH('first0task', 'wf_abc12345'), ...filler.slice(50, 900), LAUNCH('resumed9tk', 'wf_abc12345'), LAUNCH('other1task', 'wf_zzz99999'), ...filler.slice(900)].join('\r\n'))

  const search = (path: string, runId: string): Promise<{ code: number; stdout: string }> =>
    new Promise(resolve => {
      const argv = windowsSearchArgv(path, runId) as readonly string[]

      execFile(argv[0] as string, argv.slice(1), { timeout: 30_000, windowsHide: true }, (error, stdout) => resolve({ code: error === null ? 0 : 1, stdout }))
    })

  it('prints only the launch lines of that run, through a path with a space, a quote, $, & and ;', { timeout: 30_000 }, async () => {
    const found = await search(file, 'wf_abc12345')

    expect(found.code).toBe(0)
    expect(found.stdout).toContain('first0task')
    expect(found.stdout).toContain('resumed9tk')
    expect(found.stdout).not.toContain('other1task')
    expect(found.stdout).not.toContain('"user"')
  })

  it('gives the same answer as the in-process reader: the last launch of the run wins (a resume), another run is not found', { timeout: 30_000 }, async () => {
    expect(taskIdOf((await search(file, 'wf_abc12345')).stdout, 'wf_abc12345')).toBe('resumed9tk')
    expect(taskIdOf((await search(file, 'wf_zzz99999')).stdout, 'wf_zzz99999')).toBe('other1task')
    expect(taskIdOf((await search(file, 'wf_missing00')).stdout, 'wf_missing00')).toBeNull()
  })
})
