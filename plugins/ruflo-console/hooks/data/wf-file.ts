/**
 * The two files the Workflows page may write (ADR-461): a run summary the person asks for (markdown), and the page's own
 * saved views. The host's `fs` is read-only, so a write is a fixed-argv command with the content on stdin and no shell: `dd
 * of=<path>` where the folder exists (`conv=excl` makes it fail rather than replace a file), else GNU `install -D`, which makes the
 * folders first. The path is one argv element, never part of a script.
 *
 * A path is accepted only if, after normalising, it sits under an allowed root (the project, or the scratchpad where one is known)
 * with no `..`, no link on the way down to it and, for a summary, no file already there to overwrite.
 */
import type { ReaderFs } from './files'

export type Roots = { cwd: string; /** The session scratchpad, when the host tells the console where it is. */ scratch?: string | null }
export type PathCheck = { ok: true; path: string } | { ok: false; why: string }

/** Where a run summary goes by default, under the project's console folder. */
export const EXPORT_DIR = '.claude-flow/console/exports'

const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}\.md$/
const MAX_PATH = 300

const trimRoot = (root: string): string => root.replace(/\/+$/, '')

/** The normalised absolute path of a markdown file the person named, or why it cannot be written. Lexical only: see `checkNoLinks` for the disk half. */
export function resolveExportPath(input: string, roots: Roots): PathCheck {
  const raw = input.trim()

  if (raw === '') return { ok: false, why: 'give a file name ending in .md' }
  if (raw.length > MAX_PATH) return { ok: false, why: `a path over ${MAX_PATH} characters is refused` }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(raw)) return { ok: false, why: 'a path with control characters or a backslash is refused' }
  if (raw.startsWith('~')) return { ok: false, why: 'write the path out: ~ is not expanded here' }
  if (raw.split('/').includes('..')) return { ok: false, why: 'a path with .. is refused: name the file inside the project or the scratchpad' }

  const base = trimRoot(roots.cwd)

  if (base === '' || !base.startsWith('/')) return { ok: false, why: 'no project folder is known, so a relative path cannot be placed' }

  const absolute = raw.startsWith('/') ? raw : `${base}/${raw}`
  const parts = absolute.split('/').filter(part => part !== '' && part !== '.')
  const path = `/${parts.join('/')}`
  const name = parts[parts.length - 1] ?? ''
  const inside = [roots.cwd, roots.scratch ?? ''].map(trimRoot).filter(root => root.startsWith('/') && root.length > 1).find(root => path.startsWith(`${root}/`))

  if (!NAME.test(name)) return { ok: false, why: 'the file name must be letters, digits, dots, dashes, underscores or spaces, and end in .md' }
  if (inside === undefined) return { ok: false, why: `outside the project${roots.scratch === undefined || roots.scratch === null ? '' : ' and the scratchpad'}: only paths under ${trimRoot(roots.cwd)}${roots.scratch === undefined || roots.scratch === null ? '' : ` or ${trimRoot(roots.scratch)}`} are written` }

  return { ok: true, path }
}

/**
 * The disk half of the check: no folder on the way from the root down to the file is a link (a link could lead out of the root), and
 * no file is already there. A path that does not exist yet is fine; `stat` refusing is "missing".
 */
export async function checkNoLinks(fs: Pick<ReaderFs, 'stat'>, path: string, roots: Roots, options: { allowExisting?: boolean } = {}): Promise<PathCheck> {
  const root = [roots.cwd, roots.scratch ?? ''].map(trimRoot).find(entry => entry !== '' && path.startsWith(`${entry}/`))

  if (root === undefined) return { ok: false, why: 'outside the allowed folders' }

  const parts = path.slice(root.length + 1).split('/')
  let at = root

  for (const [index, part] of parts.entries()) {
    at = `${at}/${part}`

    const stat = await fs.stat(at).catch(() => undefined)

    if (stat === undefined) return { ok: true, path }
    if (stat.isLink === true) return { ok: false, why: `${at.slice(root.length)} is a link: it could lead outside the folder, so it is not written through` }
    if (index < parts.length - 1 && stat.kind !== undefined && stat.kind !== 'dir' && stat.kind !== 'directory') return { ok: false, why: `${at.slice(root.length)} is not a folder` }
    if (index === parts.length - 1 && options.allowExisting !== true) return { ok: false, why: `${at.slice(root.length)} already exists: the console does not overwrite a file; pick another name` }
  }

  return { ok: true, path }
}

/** A new file, content on stdin: `dd` with `conv=excl` where the folder is there (it fails if the file appeared meanwhile), `install -D` (GNU: makes the folders; not on macOS) where it is not. */
export const newFileArgv = (path: string, hasDir: boolean): readonly string[] => (hasDir ? ['dd', `of=${path}`, 'conv=excl', 'status=none'] : INSTALL(path))

/** The page's own state file, content on stdin: replaced in place where the folder is there, created (with its folders) where it is not. A torn write is a corrupt file, which the reader tolerates. */
export const replaceFileArgv = (path: string, hasDir: boolean): readonly string[] => (hasDir ? ['dd', `of=${path}`, 'status=none'] : INSTALL(path))

const INSTALL = (path: string): readonly string[] => ['install', '-D', '-m', '0644', '/dev/stdin', '--', path]

/** The folder a path sits in. */
export const dirOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf('/')))

/** Removes the one state file; nothing else. */
export const removeFileArgv = (path: string): readonly string[] => ['rm', '-f', '--', path]
