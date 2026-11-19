/**
 * The autopilot's text checks know Windows (groundwork for the Windows-aware path checks that ap-windows-gate.spec.ts names as the follow-up:
 * a start is still refused there). Each rule here only ever parks or refuses more; none lets anything through that was refused before.
 */
import { describe, expect, it } from 'vitest'

import { classifyTask } from '../hooks/data/ap-guard'
import { pathAllowed, verifyProblem, type Envelope } from '../hooks/data/ap-envelope'

const pathsOf = (title: string): string[] => classifyTask('t1', title).paths ?? []
const denyOf = (title: string): string | null => classifyTask('t1', title).hardDeny

describe('a task that names a Windows path is checked against the envelope folders', () => {
  const env = { paths: ['C:\\proj'] } as unknown as Envelope

  it('finds drive paths in either separator style, a drive root and a share', () => {
    expect(pathsOf('edit C:\\Windows\\System32\\drivers\\etc\\hosts')).toContain('C:\\Windows\\System32\\drivers\\etc\\hosts')
    expect(pathsOf('edit C:/proj/src/a.ts please')).toContain('C:/proj/src/a.ts')
    expect(pathsOf('review "D:\\data\\x.csv"')).toContain('D:\\data\\x.csv')
    expect(pathsOf('wipe C:\\')).toContain('C:\\')
    expect(pathsOf('copy to \\\\srv\\share\\out')).toContain('\\\\srv\\share\\out')
    expect(pathsOf('review //srv/share/out')).toContain('//srv/share/out')
    expect(pathsOf('edit C:\\Program Files\\app\\config.json')).toContain('C:\\Program Files\\app\\config.json')
    expect(pathsOf('review \\\\?\\C:\\Windows\\System32\\cmd.exe')).toContain('\\\\?\\C:\\Windows\\System32\\cmd.exe')
  })

  it('finds a parent, home, drive-relative or variable path written the Windows way', () => {
    expect(pathsOf('read ..\\..\\secrets.txt')).toContain('..\\..\\secrets.txt')
    expect(pathsOf('review ~\\notes.md')).toContain('~\\notes.md')
    expect(pathsOf('review %USERPROFILE%\\Documents\\x')).toContain('%USERPROFILE%\\Documents\\x')
    expect(pathsOf('review $env:USERPROFILE\\Documents')).toContain('$env:USERPROFILE\\Documents')
    expect(pathsOf('edit C:foo\\bar.txt')).toContain('C:foo\\bar.txt')
  })

  it('leaves the POSIX reading exactly as it was', () => {
    expect(pathsOf('edit /work/proj/a.ts')).toEqual(['/work/proj/a.ts'])
    expect(pathsOf('read ../secrets and ~/notes')).toEqual(expect.arrayContaining(['../secrets', '~/notes']))
    expect(pathsOf('refactor the parser, add tests')).toEqual([])
  })

  it('what is found is then refused outside the envelope and allowed inside it', () => {
    expect(pathAllowed(env, 'C:\\proj\\src\\a.ts')).toBe(true)
    expect(pathAllowed(env, 'c:/PROJ/src')).toBe(true)
    expect(pathAllowed(env, 'C:\\Windows\\System32')).toBe(false)
    expect(pathAllowed(env, '..\\..\\secrets.txt')).toBe(false)
    expect(pathAllowed(env, '%USERPROFILE%\\Documents')).toBe(false)
    expect(pathAllowed(env, 'C:\\proj\\..\\Windows')).toBe(false)
    expect(pathAllowed(env, '\\\\?\\C:\\proj\\src\\a.ts')).toBe(false)
    expect(pathAllowed(env, 'C:foo\\bar.txt')).toBe(false)
    expect(pathAllowed(env, 'C:\\proj\\file.txt:stream:$DATA')).toBe(false)
    expect(pathAllowed(env, 'C:\\proj\\.. \\Windows')).toBe(false)
  })
})

describe('the destructive-command deny covers the Windows forms', () => {
  it('denies rmdir /s, del on a drive, format, Remove-Item -Recurse and rm on a drive', () => {
    for (const task of ['run rmdir /s /q C:\\Users\\me', 'then rd /s /q build', 'del /f /q C:\\*.*', 'erase C:\\temp\\x', 'format D: now', 'Remove-Item -Recurse -Force C:\\proj', 'rm -rf C:\\proj', 'rm -rf %USERPROFILE%']) {
      expect(denyOf(task), task).toBe('delete-outside-worktree')
    }
  })

  it('does not deny ordinary Windows text', () => {
    for (const task of ['update the formatting docs', 'format the code with prettier', 'remove the unused import from src\\a.ts', 'explain what del does in cmd']) {
      expect(denyOf(task), task).not.toBe('delete-outside-worktree')
    }
  })
})

describe('a verify command cannot be a Windows shell or a destructive Windows tool', () => {
  it('refuses a program by its basename under either separator, batch files and without .exe', () => {
    for (const argv of [
      ['C:\\Windows\\System32\\cmd.exe', '/c', 'dir'],
      ['cmd', '/c', 'dir'],
      ['cmd.exe.exe', '/c', 'dir'],
      ['powershell', '-Command', 'x'],
      ['pwsh.exe', '-c', 'x'],
      ['bash.exe', '-c', 'x'],
      ['C:/Program Files/Git/bin/bash.exe', '-c', 'x'],
      ['taskkill', '/f', '/im', 'node.exe'],
      ['wsl', 'ls'],
      ['reg', 'delete', 'HKCU\\x'],
      ['pnpm.cmd', 'test'],
      ['foo.bat', 'run'],
    ]) {
      expect(verifyProblem(argv), argv.join(' ')).toMatch(/cannot be a verify command|batch script/)
    }
  })

  it('still accepts the programs a verify command is for, on either platform', () => {
    for (const argv of [['node', 'a.js'], ['C:\\Program Files\\nodejs\\node.exe', 'a.js'], ['pnpm', 'test'], ['npx', 'vitest', 'run'], ['/usr/bin/git', 'status']]) {
      expect(verifyProblem(argv), argv.join(' ')).toBeNull()
    }
  })

  it('keeps refusing the POSIX shells and metacharacters', () => {
    expect(verifyProblem(['/usr/bin/bash', '-c', 'x'])).toMatch(/cannot be a verify command/)
    expect(verifyProblem(['npm', 'test', ';', 'x'])).toMatch(/shell metacharacter/)
  })
})

describe('the envelope-edit deny pattern covers Windows paths', () => {
  it('denies envelope and kill editing under both / and \\', () => {
    for (const task of [
      'edit .claude-flow/console/autopilot/envelope.json',
      'edit .claude-flow\\console\\autopilot\\envelope.json',
      'touch autopilot/kill',
      'touch autopilot\\kill',
      'rm .claude-flow\\protector-mod',
    ]) {
      expect(denyOf(task), task).toBe('envelope-edit')
    }
  })
})
