import { describe, expect, it } from 'vitest'
import { discover } from '../hooks/adr'
import { resolveTarget } from '../hooks/data/event-export'
import { resolveExportPath } from '../hooks/data/wf-file'
import type { ReaderFs } from '../hooks/data/files'
import { readCatalog, readDoc } from '../hooks/data/plugin-catalog'

// #4356: on Windows `state.cwd` is a drive path (`C:\Users\...`), not `/...`. Each of these
// three sites hardcoded `base.startsWith('/')` (or `root.startsWith('/')`) as its "do we know
// the project folder" guard, so all three fail closed on Windows regardless of settings —
// matching the already-fixed #4175 bug in register.ts.
//
// #4036: PR consolidated path helpers onto `paths.ts`. On a Windows base, `joinPath` now uses
// the base's own separator (`\\`), so the probe path for `C:\Users\dev\project` + `docs` is
// `C:\Users\dev\project\docs` rather than the earlier `C:\Users\dev\project/docs`. The
// semantics are the same on a real Windows filesystem; `fsWithDir` is made separator-agnostic
// here so the test continues to anchor the behaviour, not the exact string.

const WIN_CWD = 'C:\\Users\\dev\\project'

const normSeps = (p: string): string => p.replace(/[\\/]+/g, '/')

function fsWithDir(dirPath: string): Pick<ReaderFs, 'stat' | 'list' | 'read'> {
  const target = normSeps(dirPath)

  return {
    stat: async (path: string) => (normSeps(path) === target ? { kind: 'dir' } : undefined),
    list: async () => [],
    read: async () => '',
  }
}

describe('adr.ts discover() finds a Windows project folder (#4356)', () => {
  it('reads the configured ADR folder when cwd is a Windows drive path', async () => {
    const dir = `${WIN_CWD}/docs`
    const result = await discover({ fs: fsWithDir(dir) }, WIN_CWD, 'docs')

    expect(result).toEqual({ dir: 'docs', why: '' })
  })

  it('still reports "no project folder is known" for a genuinely empty cwd', async () => {
    const result = await discover({ fs: fsWithDir('/anything') }, '', 'docs')

    expect(result.dir).toBeNull()
    expect(result.why).toBe('no project folder is known')
  })
})

describe('event-export.ts resolveTarget() on a Windows drive path (#4356)', () => {
  it('resolves a bare file name under the exports folder, preserving the drive prefix', () => {
    const result = resolveTarget('summary.md', WIN_CWD, ['md'])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path.startsWith('C:')).toBe(true)
      expect(result.path).not.toMatch(/^\/C:/)
      expect(result.path.endsWith('/summary.md')).toBe(true)
    }
  })

  it('refuses a target outside the Windows project root', () => {
    const result = resolveTarget('../../escape.md', WIN_CWD, ['md'])

    expect(result.ok).toBe(false)
  })
})

describe('wf-file.ts resolveExportPath() on a Windows drive path (#4356)', () => {
  it('resolves a relative transcript name under the project, preserving the drive prefix', () => {
    const result = resolveExportPath('.claude-flow/console/exports/transcript.md', { cwd: WIN_CWD })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path.startsWith('C:')).toBe(true)
      expect(result.path).not.toMatch(/^\/C:/)
      expect(result.path.endsWith('/transcript.md')).toBe(true)
    }
  })

  it('refuses a pre-joined absolute Windows path as input, same as the backslash rule always did', () => {
    const result = resolveExportPath(`${WIN_CWD}/.claude-flow/console/exports/transcript.md`, { cwd: WIN_CWD })

    expect(result.ok).toBe(false)
  })
})

describe('wf-convo-live.ts calls resolveExportPath with a relative name, not a pre-joined cwd (#4356)', () => {
  it('saveTranscript no longer prefixes state.cwd onto the resolveExportPath input', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../hooks/wf-convo-live.ts', import.meta.url), 'utf8')

    expect(source).toContain('resolveExportPath(`${EXPORT_DIR}/${transcriptName(target.id, Date.now())}`, roots)')
    expect(source).not.toMatch(/resolveExportPath\(`\$\{state\.cwd/)
  })
})

describe('plugin-catalog.ts reads a Windows marketplace clone', () => {
  // Claude Code records the clone's installLocation as a drive path; the catalog used to refuse anything not starting with `/`
  // and drew "the clone's marketplace.json is not readable" with the file in place.
  const CLONE = 'C:\\Users\\dev\\.claude\\plugins\\marketplaces\\ruflo'
  const files: Record<string, string> = {
    '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'a-plugin', source: './plugins/a-plugin', description: 'Does A things' }] }),
    'plugins/a-plugin/.claude-plugin/plugin.json': '{"version":"1.2.3"}',
    'plugins/a-plugin/skills/alpha/SKILL.md': '---\nname: alpha\ndescription: "Alpha does a"\n---\nbody\n',
    'plugins/a-plugin/commands/go.md': 'x',
    'plugins/a-plugin/.mcp.json': '{}',
  }
  // Keyed by the path below the clone with `/` separators, so the test holds whichever separator a join produces.
  const below = (path: string): string | undefined => {
    const norm = normSeps(path)
    const root = normSeps(CLONE) + '/'

    return norm.startsWith(root) ? norm.slice(root.length) : undefined
  }
  const fs: ReaderFs = {
    read: async path => {
      const key = below(path)

      if (key === undefined || !(key in files)) throw new Error('ENOENT')

      return files[key] as string
    },
    stat: async path => {
      const key = below(path)

      return key !== undefined && key in files ? { size: (files[key] as string).length, kind: 'file' } : undefined
    },
    list: async path => {
      const key = below(path)
      const prefix = key === undefined ? undefined : `${key}/`
      const names = prefix === undefined ? [] : Object.keys(files).filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length))

      if (names.length === 0) throw new Error('ENOENT')

      return [...new Set(names.map(name => name.split('/')[0] as string))].map(name => ({ name, kind: names.includes(name) ? 'file' : 'dir' }))
    },
  }

  it('lists the plugins and what each ships', async () => {
    const plugins = await readCatalog(fs, CLONE)

    expect(plugins).not.toBeNull()
    expect(plugins?.[0]).toMatchObject({ name: 'a-plugin', version: '1.2.3', skills: ['alpha'], commands: ['go'], hasMcp: true })
  })

  it('reads a skill file from a Windows plugin folder', async () => {
    const [plugin] = (await readCatalog(fs, CLONE)) ?? []
    const doc = plugin === undefined ? null : await readDoc(fs, plugin, 'skill', 'alpha')

    expect(doc?.description).toBe('Alpha does a')
  })

  it('still refuses a relative location and one that climbs out', async () => {
    expect(await readCatalog(fs, 'marketplaces\\ruflo')).toBeNull()
    expect(await readCatalog(fs, 'C:\\Users\\dev\\..\\other')).toBeNull()
  })
})
