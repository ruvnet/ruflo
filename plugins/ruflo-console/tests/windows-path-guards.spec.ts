import { describe, expect, it } from 'vitest'

import { under } from '../hooks/data/files'
import { parseInstalled } from '../hooks/data/facts'
import { baseOf, insideOrSame } from '../hooks/data/paths'
import { safeInstallPath } from '../hooks/data/research'
import { isRunFile } from '../hooks/data/wf-drill-io'
import { isUnder } from '../hooks/wf-cost-live'
import { installedEntries } from '../hooks/updates'
import { isRunPath } from '../hooks/wf-actions'

// The console builds paths as `<root>/<name>` even when the root is `C:\Users\x\.claude`, so a run's folder is `C:\Users\x\.claude/projects/...`.
// Its guards must see `..` under either separator, and a config folder that ends in a backslash must still match.
const CONFIG = 'C:\\Users\\x\\.claude'
const RUN = `${CONFIG}/projects/-C--proj/sess/subagents/workflows/wf_1`

describe('the run-path guards on a Windows config folder', () => {
  it('accept a run folder and file under projects/', () => {
    expect(isRunPath(RUN, CONFIG)).toBe(true)
    expect(isRunFile(`${RUN}/agent.jsonl`, CONFIG)).toBe(true)
    expect(isUnder(`${CONFIG}/projects/x`, CONFIG)).toBe(true)
  })

  it('refuse a .. segment written with a backslash, which the old "/"-only split missed', () => {
    for (const path of [`${CONFIG}/projects/..\\..\\secret.txt`, `${CONFIG}/projects/a\\..\\b`, `${CONFIG}/projects/../x`]) {
      expect(isRunPath(path, CONFIG), path).toBe(false)
      expect(isRunFile(path, CONFIG), path).toBe(false)
      expect(isUnder(path, CONFIG), path).toBe(false)
    }
  })

  it('still match when the config folder ends in a backslash or a slash', () => {
    for (const config of [`${CONFIG}\\`, `${CONFIG}/`]) {
      expect(isRunPath(RUN, config), config).toBe(true)
      expect(isRunFile(`${RUN}/a.jsonl`, config), config).toBe(true)
      expect(isUnder(`${config.replace(/[\\/]+$/, '')}/projects/x`, config), config).toBe(true)
      expect(under(config, 'projects/x'), config).toBe(`${CONFIG}/projects/x`)
    }
  })

  it('keep the POSIX rules exactly', () => {
    expect(isRunPath('/h/.claude/projects/a/wf_1', '/h/.claude')).toBe(true)
    expect(isRunPath('/h/.claude/projects/../x', '/h/.claude')).toBe(false)
    expect(isRunPath('/h/.claude-other/projects/a', '/h/.claude')).toBe(false)
    expect(under('/h/.claude/', 'projects')).toBe('/h/.claude/projects')
    expect(isUnder('/h/.claude/projects/a..b/c', '/h/.claude')).toBe(true)
  })
})

describe('a plugin install path on Windows (the research reader)', () => {
  it('accepts a drive path and refuses a climbing, relative or shell-looking one, as on POSIX', () => {
    expect(safeInstallPath('C:\\Users\\x\\.claude\\plugins\\cache\\ruflo\\ruflo-goals\\0.3.0')).toBeDefined()
    expect(safeInstallPath('/home/u/.claude/plugins/cache/ruflo/ruflo-goals/0.3.0')).toBeDefined()

    for (const bad of ['relative', 'C:\\a\\..\\b', 'C:\\x; calc', 'C:\\x$(id)', '', undefined, 42]) expect(safeInstallPath(bad), String(bad)).toBeUndefined()
  })
})

describe('the project name shown on the menu and boot screen', () => {
  it('is the last folder under either separator, a trailing separator included', () => {
    expect(baseOf('/work/proj')).toBe('proj')
    expect(baseOf('/work/proj/')).toBe('proj')
    expect(baseOf('C:\\Users\\x\\proj')).toBe('proj')
    expect(baseOf('C:\\Users\\x\\proj\\')).toBe('proj')
    expect(baseOf('C:/Users/x/proj')).toBe('proj')
    expect(baseOf('\\\\srv\\share\\proj')).toBe('proj')
    expect(baseOf('')).toBe('')
  })
})

// installed_plugins.json records one entry per install; a project-scope entry names the project it was installed for (a Windows path there).
const record = (version: string, scope: string, projectPath?: string) => ({ scope, version, installPath: `C:\\cache\\ruflo-console\\${version}`, ...(projectPath !== undefined && { projectPath }) })
const INSTALLED = JSON.stringify({
  version: 2,
  plugins: {
    'ruflo-console@ruflo': [record('0.44.7', 'project', 'C:\\Users\\x\\git\\other'), record('0.46.0', 'project', 'C:\\Users\\x\\git\\proj'), record('0.47.0', 'user')],
    'ruflo-swarm@ruflo': [record('0.3.7', 'project', 'C:\\Users\\x\\git\\other')],
  },
})
const versionFor = (cwd?: string, id = 'ruflo-console@ruflo'): string | undefined => parseInstalled(INSTALLED, cwd)?.find(entry => entry.id === id)?.version

describe('which install record applies to a session', () => {
  it('is the project record for this folder, under any separator style, letter case, or a folder inside the project', () => {
    for (const cwd of ['C:\\Users\\x\\git\\proj', 'c:/users/X/git/PROJ', 'C:\\Users\\x\\git\\proj\\packages\\app', 'C:\\Users\\x\\git\\proj\\']) expect(versionFor(cwd), cwd).toBe('0.46.0')
  })

  it("is the user record when no project record is for this folder, and never another project's", () => {
    expect(versionFor('C:\\Users\\x\\git\\elsewhere')).toBe('0.47.0')
    expect(versionFor('C:\\Users\\x\\git\\project-two')).toBe('0.47.0')
    expect(versionFor('C:\\Users\\x\\git\\proj-extra')).toBe('0.47.0')
    expect(versionFor()).toBe('0.47.0')
  })

  it("is no record, not another project's, when none applies and there is no user record (#4496)", () => {
    expect(versionFor('C:\\Users\\x\\git\\elsewhere', 'ruflo-swarm@ruflo')).toBeUndefined()
    expect(versionFor('C:\\Users\\x\\git\\other', 'ruflo-swarm@ruflo')).toBe('0.3.7')
  })

  it('without a folder to judge by, takes the user record, else the first', () => {
    expect(parseInstalled(JSON.stringify({ plugins: { 'a@b': { version: '1.0.0', scope: 'user' } } }))?.[0]?.version).toBe('1.0.0')
    expect(versionFor(undefined, 'ruflo-swarm@ruflo')).toBe('0.3.7')
  })

  it('prefers the record for the exact project over one for a parent folder, in any file order (#4496)', () => {
    const parent = record('0.40.0', 'project', 'C:\\Users\\x\\git')
    const exact = record('0.46.0', 'local', 'C:\\Users\\x\\git\\proj')
    for (const order of [[parent, exact], [exact, parent]]) {
      const text = JSON.stringify({ plugins: { 'a@b': order } })
      expect(parseInstalled(text, 'C:\\Users\\x\\git\\proj\\sub')?.[0]?.version).toBe('0.46.0')
      expect(parseInstalled(text, 'C:\\Users\\x\\git\\sibling')?.[0]?.version).toBe('0.40.0')
    }
  })

  it('the updater applies the same rule: a session in a subfolder of the project updates the project install', () => {
    const list = JSON.stringify([
      { id: 'ruflo-console@ruflo', version: '0.46.0', scope: 'project', projectPath: 'C:\\Users\\x\\git\\proj' },
      { id: 'ruflo-console@ruflo', version: '0.44.7', scope: 'project', projectPath: 'C:\\Users\\x\\git\\other' },
      { id: 'ruflo-console@ruflo', version: '0.47.0', scope: 'user' },
    ])
    const seen = (cwd: string): string[] => installedEntries(list, cwd).map(entry => `${entry.scope}:${entry.version}`).sort()

    expect(seen('C:\\Users\\x\\git\\proj')).toEqual(['project:0.46.0', 'user:0.47.0'])
    expect(seen('c:/users/x/git/proj/sub')).toEqual(['project:0.46.0', 'user:0.47.0'])
    expect(seen('C:\\Users\\x\\git\\elsewhere')).toEqual(['user:0.47.0'])
  })
})

describe('insideOrSame', () => {
  it('holds for the folder itself and what is below it, never for a sibling that shares the prefix', () => {
    expect(insideOrSame('C:\\a\\b', 'C:/A/B/c')).toBe(true)
    expect(insideOrSame('C:\\a\\b', 'C:\\a\\b')).toBe(true)
    expect(insideOrSame('C:\\a\\b', 'C:\\a\\bc')).toBe(false)
    expect(insideOrSame('/a/b', '/a/b/c')).toBe(true)
    expect(insideOrSame('/a/b', '/a/B/c')).toBe(false)
    expect(insideOrSame('', '/a')).toBe(false)
  })
})
