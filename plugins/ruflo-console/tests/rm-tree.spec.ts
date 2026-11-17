import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { removeTree } from './fixtures/rm-tree'

const exited = (child: ReturnType<typeof spawn>): Promise<void> => new Promise(resolve => (child.exitCode !== null ? resolve() : void child.once('exit', () => resolve())))

describe('removeTree', () => {
  it('removes a folder and everything in it, and a folder that is already gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rm-tree-'))

    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'f.txt'), 'x')
    await removeTree(root)
    expect(existsSync(root)).toBe(false)
    await expect(removeTree(root)).resolves.toBeUndefined()
  })

  // Windows only: there a folder cannot be removed while a process started in it is still running.
  it.skipIf(process.platform !== 'win32')('waits out a process still running in the folder, which makes rmSync fail with EBUSY', { timeout: 30_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'rm-tree-'))
    const project = join(root, 'project')

    mkdirSync(project)

    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { cwd: project, stdio: 'ignore' })

    await new Promise(resolve => setTimeout(resolve, 300))
    expect(() => rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })).toThrow(/EBUSY/)
    await removeTree(root)
    expect(existsSync(root)).toBe(false)
    await exited(child)
  })
})
