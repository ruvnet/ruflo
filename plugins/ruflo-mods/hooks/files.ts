import type { FsStat } from 'claude-code'

/**
 * The two `$.fs` calls a reader needs. The engine reads a module's `$` uses
 * off its source, so `$` itself never leaves a hook: the hook builds this
 * from `$.fs.stat` / `$.fs.read` spelled at the call site.
 */
export type FileHost = {
  readonly stat: (path: string) => Promise<FsStat>
  readonly read: (path: string) => Promise<string>
}

/**
 * The `$.fs` calls a guarded write needs, built the same way: the hook
 * spells `$.fs.stat` / `$.fs.write` at the call site.
 */
export type WriteHost = {
  readonly stat: (path: string) => Promise<FsStat>
  readonly write: (path: string, text: string) => Promise<void>
}

/** Under `$.fs.read`'s own 4 MiB bound, so an oversized file reads as too big. */
export const MAX_READ_BYTES = 4 * 1024 * 1024

export type Read<T> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Only ENOENT is "missing" (`$.fs.stat` rejects ENOENT for a missing path).
 * Anything else is an error: for the guard that means failing closed, so a
 * loosely matched message must never read as "no policy here".
 */
export const isMissing = (error: unknown, path?: string) => {
  const message = String((error as Error)?.message ?? error)
  // The path a message quotes is the caller's own word, not the error: a project under ".../ENOENT-x/" is not missing.
  return /\bENOENT\b/.test(path ? message.split(path).join('') : message)
}

/**
 * A reader that parses a project file once per change: one `$.fs.stat` per
 * call, a `$.fs.read` and parse only when its size or mtime moved. Absent is
 * a value, not an error; anything else that fails is `error`, which a guard
 * fails closed on.
 *
 * @param pathOf the file's path, resolved per call (it follows the session root)
 * @param parse turns the text into the value; may throw
 */
export function cachedFile<T>(pathOf: () => string, parse: (text: string) => T) {
  let seen: { key: string; read: Read<T> } | undefined

  return async (fs: FileHost): Promise<Read<T>> => {
    const path = pathOf()
    let key: string
    try {
      const stat = await fs.stat(path)
      if (stat.kind !== 'file') return { kind: 'error', message: `${path} is not a file` }
      if (stat.size > MAX_READ_BYTES) return { kind: 'error', message: `${path} is over 4 MiB` }
      key = `${path}:${stat.size}:${stat.mtimeMs}`
    } catch (error) {
      seen = undefined
      return isMissing(error, path) ? { kind: 'absent' } : { kind: 'error', message: messageOf(error) }
    }
    if (seen?.key === key) return seen.read

    const read = await readAndParse(fs, path, parse)
    seen = { key, read }
    return read
  }
}

const messageOf = (error: unknown) => String((error as Error)?.message ?? error)

/**
 * Only the read may say "absent": a parse error's message can quote the file's
 * own text (JSON.parse does), so a corrupt file containing "ENOENT" must still
 * be an error and never read as "no file here".
 */
async function readAndParse<T>(fs: FileHost, path: string, parse: (text: string) => T): Promise<Read<T>> {
  let text: string
  try {
    text = await fs.read(path)
  } catch (error) {
    return isMissing(error, path) ? { kind: 'absent' } : { kind: 'error', message: messageOf(error) }
  }
  try {
    return { kind: 'ok', value: parse(text) }
  } catch (error) {
    return { kind: 'error', message: messageOf(error) }
  }
}

const isLinkKind = (kind: string | undefined): boolean => kind === 'symlink' || kind === 'link'

/**
 * Writes `text` to `path` only when the way from `root` down to the file
 * holds no link. `$.fs.stat` reports a link (`isLink`, plus the target's
 * kind) instead of following it silently, but `$.fs.write` follows one, so
 * a symlinked `.claude-flow` tree in a cloned project could steer a write
 * outside the project (#4746). Every component below the root that exists
 * must be a real folder, and an existing target must be a regular file; a
 * missing component ends the walk, since nothing below it can exist and
 * the write creates the folders. Only ENOENT is "missing": any other stat
 * failure refuses the write, as does a path that is not lexically under
 * the root. The root itself is never statted: it may legitimately be an
 * alias. Throws on a refusal, naming the component, and writes nothing
 * then. The check and the write are not atomic — a link planted between
 * them still wins — but a planted link is the threat here, not a second
 * writer racing the check.
 */
export async function writeWithoutLinks(fs: WriteHost, root: string, path: string, text: string): Promise<void> {
  const base = root.replace(/\/+$/, '')
  const prefix = base === '' ? '/' : `${base}/`
  const outside = `${path} is outside the project: only paths under ${base === '' ? '/' : base} are written`
  if (!path.startsWith(prefix)) throw new Error(outside)
  const parts = path.slice(prefix.length).split('/').filter(part => part !== '' && part !== '.')
  if (parts.length === 0 || parts.includes('..')) throw new Error(outside)
  let at = base
  for (const [index, part] of parts.entries()) {
    at = `${at}/${part}`
    const last = index === parts.length - 1
    let stat: FsStat
    try {
      stat = await fs.stat(at)
    } catch (error) {
      if (!isMissing(error, at)) throw new Error(`${at.slice(base.length)} cannot be checked, so it is not written through`)
      break
    }
    if (stat.isLink === true || isLinkKind(stat.kind)) throw new Error(`${at.slice(base.length)} is a link: it could lead outside the project, so it is not written through`)
    if (!last && stat.kind !== undefined && stat.kind !== 'dir' && stat.kind !== 'directory') throw new Error(`${at.slice(base.length)} is not a folder, so it is not written through`)
    if (last && stat.kind !== undefined && stat.kind !== 'file') throw new Error(`${at.slice(base.length)} is not a regular file, so it is not written through`)
  }
  await fs.write(path, text)
}
