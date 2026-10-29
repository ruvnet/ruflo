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
