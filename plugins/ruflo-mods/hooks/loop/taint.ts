/**
 * Tamper signals inside one turn (ADR-503 §2.1). Pure.
 *
 * A verifier's exit status is honest, but the model chooses what the verifier
 * checks: it can weaken a test, skip it, edit the `test` script, or narrow the
 * command to one file. Each of those exits 0. A `verified-success` record
 * therefore carries taints naming what the turn did to its own check; the CLI
 * ingest never trains a tainted record unless the project opts that class in.
 * A taint never changes the outcome word.
 */

export type Taint = 'edited-tests' | 'edited-verifier-config' | 'narrowed-verifier'

export const TAINTS: readonly Taint[] = ['edited-tests', 'edited-verifier-config', 'narrowed-verifier']

/** A test file by name: `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.go`, `*_test.rs`. */
const TEST_FILE = /(?:\.(?:test|spec)\.[A-Za-z0-9]+|^test_[^/]*\.py|_test\.(?:go|rs))$/
/** Directories whose files are tests. */
const TEST_DIRS = new Set(['__tests__', 'tests'])
/** Files that change what a verifier checks. */
const VERIFIER_CONFIG = /^(?:package\.json|vitest\.config\.[^/]+|jest\.config\.[^/]+|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|Cargo\.toml|go\.mod|tsconfig[^/]*\.json|\.eslintrc[^/]*|eslint\.config\.[^/]+|Makefile)$/

const parts = (path: string) => path.replace(/\\/g, '/').split('/').filter(p => p !== '' && p !== '.')

/** The project-relative form of an edited path: an absolute path under `root` loses the root, so `root` itself never matches. */
export function relativePath(root: string, path: string): string {
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p
}

/** Whether a (project-relative) path is a test file. */
export function isTestPath(path: string): boolean {
  const segs = parts(path)
  const base = segs.at(-1)
  if (base === undefined) return false
  return TEST_FILE.test(base) || segs.slice(0, -1).some(d => TEST_DIRS.has(d))
}

/** Whether a path is a file that can change what a verifier checks. */
export function isVerifierConfig(path: string): boolean {
  const base = parts(path).at(-1)
  return base !== undefined && VERIFIER_CONFIG.test(base)
}

/** Flags that weaken any verifier. */
const WEAKEN = /^(?:--passWithNoTests|--exclude|--testPathIgnorePatterns)(?:=|$)/
/** Flags that select a subset of tests. `-run` is `go test`'s name filter. */
const SELECT = /^(?:-t|--testNamePattern|-k|--skip|-run)(?:=|$)/

const unquote = (token: string) => token.replace(/^['"]|['"]$/g, '')

/**
 * Whether one verifier segment weakens or narrows its check: a weakening flag,
 * a test-name selector, or a test runner given a test-file argument (a pytest
 * node id `file.py::name` counts). A directory argument (`pytest tests/`) does not.
 */
export function narrows(segment: string, kind: string): boolean {
  const tokens = segment.split(/\s+/).map(unquote).filter(Boolean)
  if (tokens.some(t => WEAKEN.test(t))) return true
  if (kind !== 'test') return false
  if (tokens.some(t => SELECT.test(t))) return true
  return tokens.some(t => !t.startsWith('-') && (t.includes('::') || isTestPath(t.split('::')[0]!)))
}

/** Programs that write, move or delete the files they name. */
const WRITERS = new Set(['rm', 'unlink', 'shred', 'mv', 'cp', 'tee', 'truncate', 'patch', 'dd', 'ln', 'install', 'rsync', 'touch'])
/** `git` subcommands that rewrite or delete working-tree files. */
const GIT_WRITERS = new Set(['rm', 'mv', 'checkout', 'restore', 'apply', 'am', 'reset', 'stash', 'clean'])
/** Wrappers and assignments in front of the program. */
const WRAPPERS = new Set(['sudo', 'env', 'command', 'xargs', 'time', 'nice', 'nohup'])
/** An in-place flag of `sed`/`perl` (`-i`, `-i.bak`, `-pi`, `--in-place`). */
const IN_PLACE = /^(?:-[A-Za-z]*i|--in-place)/
/** An output redirection (`>`, `>>`, `1>`, `>file`), not a descriptor copy (`2>&1`). */
const REDIRECT = /(?:^|[^<>&])\d*>>?(?!&)/

/** Whether one shell segment writes, moves or deletes the files it names. */
function writes(tokens: readonly string[]): boolean {
  if (tokens.some(t => REDIRECT.test(t))) return true
  let i = 0
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!) || WRAPPERS.has(tokens[i]!))) i++
  const prog = tokens[i]?.split('/').at(-1)
  if (prog === undefined) return false
  if (WRITERS.has(prog)) return true
  if (prog === 'sed' || prog === 'perl') return tokens.slice(i + 1).some(t => IN_PLACE.test(t))
  if (prog === 'git') return tokens.slice(i + 1).some(t => GIT_WRITERS.has(t))
  return false
}

/** A token names test code: a test file, or a path through a test directory (`tests/`, `src/__tests__`). */
const namesTests = (token: string) => isTestPath(token) || parts(token).some(d => TEST_DIRS.has(d))

/**
 * Which taint classes a Bash command earns by changing test files or verifier config through the shell
 * (`rm`, `sed -i`, `cat > file`, `git checkout -- tests/`, ...), as an Edit of the same file would (ADR-503 §2.1).
 * Conservative by design, since a taint can only stop a success from training: a write verb or redirection
 * anywhere in a segment that also names a test path or a verifier config is enough. A segment without one
 * (`cat`, `grep`, a test run) earns nothing here; a narrowed test run is `narrows`' job. Code that writes from
 * inside an interpreter (`node -e`, `python -c`) is not seen.
 */
export function shellTouches(command: unknown): { tests: boolean; config: boolean } {
  const out = { tests: false, config: false }
  if (typeof command !== 'string' || command.length > 16_384) return out
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.split(/\s+/).map(unquote).filter(Boolean)
    if (tokens.length === 0 || !writes(tokens)) continue
    for (const raw of tokens) {
      const token = raw.replace(/^\d*>>?/, '')
      if (!token || token.startsWith('-')) continue
      if (namesTests(token)) out.tests = true
      if (isVerifierConfig(token)) out.config = true
    }
  }
  return out
}
