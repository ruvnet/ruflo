/**
 * Which Bash commands count as an independent verifier (#4581, ADR-502).
 *
 * A mod may not run processes, so the loop observes the ones the model runs:
 * a recognised test, build, typecheck or lint command whose exit status the
 * shell reported. Only that exit status decides an outcome, never the
 * model's words.
 *
 * A command whose exit status could be someone else's is refused: a pipe (the
 * last stage's status wins), `||`, `;`, a background `&`, command
 * substitution, a comment, or a segment that is not `cd`/`export`/a verifier. So
 * `npm test || true` and `npm test | tail` never verify anything.
 *
 * A runner asked to print or list instead of run (`--help`, `--version`,
 * `--listTests`, `--collect-only`, `--no-run`, ...) exits 0 without checking
 * anything, so it is not a verifier either.
 */

import { scan } from '../guidance/screen'
import { narrows } from './taint'
import { hasComment, shellWords } from './words'

export type VerifierKind = 'test' | 'build' | 'typecheck' | 'lint'

/** `narrowed`: a segment weakened or narrowed its check (ADR-503 §2.1), judged on the whole command, not the 80-character evidence. */
export type Verifier = { readonly kind: VerifierKind; readonly command: string; readonly narrowed?: boolean }

/** The longest command head kept as evidence. */
export const MAX_EVIDENCE = 80

const RUNNERS = '(?:npm|pnpm|yarn|bun)'
const SCRIPT_KIND: Record<string, VerifierKind> = {
  test: 'test',
  'test:unit': 'test',
  'test:integration': 'test',
  'test:e2e': 'test',
  'test:ci': 'test',
  build: 'build',
  typecheck: 'typecheck',
  'type-check': 'typecheck',
  tsc: 'typecheck',
  lint: 'lint',
  check: 'typecheck',
}

/** One command segment's verifier kind, or null. Matched on the command head only. */
const RULES: ReadonlyArray<readonly [RegExp, VerifierKind | ((m: RegExpMatchArray) => VerifierKind | null)]> = [
  // npm test / pnpm test / yarn test / bun test (with or without run, workspace flags before the script)
  [new RegExp(`^${RUNNERS}(?:\\s+(?:-r|--recursive|-w|--workspaces|--filter\\s+\\S+|--silent|-s))*\\s+(?:run\\s+)?([a-z][a-z:-]*)\\b`), m => SCRIPT_KIND[m[1]!] ?? null],
  [/^(?:npx\s+|pnpm\s+exec\s+|pnpm\s+dlx\s+|yarn\s+|bunx\s+)?(?:vitest|jest|mocha|ava|playwright\s+test)\b/, 'test'],
  [/^(?:npx\s+|pnpm\s+exec\s+|yarn\s+|bunx\s+)?tsc\b/, 'typecheck'],
  [/^(?:npx\s+|pnpm\s+exec\s+|yarn\s+|bunx\s+)?eslint\b/, 'lint'],
  [/^node\s+--test\b/, 'test'],
  [/^cargo\s+(?:\+\S+\s+)?(test|nextest|build|check|clippy)\b/, m => (m[1] === 'build' ? 'build' : m[1] === 'check' ? 'typecheck' : m[1] === 'clippy' ? 'lint' : 'test')],
  [/^go\s+(test|build|vet)\b/, m => (m[1] === 'test' ? 'test' : m[1] === 'build' ? 'build' : 'lint')],
  [/^(?:python3?\s+-m\s+)?pytest\b/, 'test'],
  [/^(?:uv\s+run\s+|poetry\s+run\s+)pytest\b/, 'test'],
  [/^(?:\.\/)?(?:mvnw?|gradlew?)\s+(?:\S+\s+)*?(test|verify|build|check)\b/, m => (m[1] === 'build' ? 'build' : 'test')],
  [/^dotnet\s+(test|build)\b/, m => (m[1] === 'test' ? 'test' : 'build')],
  [/^make\s+(test|check|build)\b/, m => (m[1] === 'build' ? 'build' : 'test')],
  [/^(?:mypy|pyright)\b/, 'typecheck'],
]

/** Segments that only set up where and how the verifier runs. */
const SETUP = /^(?:cd\s+\S+|export\s+[A-Za-z_][A-Za-z0-9_]*=\S*)$/
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/

/** Redirections that are not a background `&`. */
const REDIRECTS = /\s*(?:\d?>&\d|&>>?\s*\S+|\d?>>?\s*\S+|<\s*\S+)/g

/**
 * Flags that make a runner print, list or compile instead of running its checks. Matched as whole shell words on the
 * verifier segment, after the runner (`npm test --help`, `npm test -- --help`, `npx jest --listTests`).
 */
const NO_RUN = /^(?:-h|--help|-V|--version|--listTests|--list-tests|--showConfig|--show-config|--collect-only|--co|--no-run|--list|-list|--dry-run|--print-config)(?:=.*)?$/
/** Per-program flags that also stop a run (`tsc -v` is a version, `pytest -v` is not: only the named program). */
const NO_RUN_FOR: Record<string, RegExp> = {
  tsc: /^(?:-v|--listFilesOnly|--dry|--init)$/,
  eslint: /^(?:-v|--env-info|--init)$/,
  vitest: /^-v$/,
  jest: /^-v$/,
  mvn: /^(?:-v|-h)$/,
  mvnw: /^(?:-v|-h)$/,
  gradle: /^(?:-m)$/,
  gradlew: /^(?:-m)$/,
  // make -n/-q (and clusters such as -nk) print or test targets without running their recipes.
  make: /^(?:--just-print|--recon|--question|-[A-Za-z]*[nq][A-Za-z]*)$/,
  pytest: /^(?:--fixtures|--fixtures-per-test|--markers|--setup-plan)$/,
  dotnet: /^(?:-t)$/,
  // A package script run with --if-present exits 0 when the project has no such script.
  npm: /^--if-present$/,
  pnpm: /^--if-present$/,
  yarn: /^--if-present$/,
  bun: /^--if-present$/,
}

/** Index of the program a verifier segment runs, past launchers (`npx`, `pnpm exec`, `python -m`, `uv run`). */
function programAt(words: readonly string[]): number {
  const name = (i: number) => (words[i] ?? '').split('/').at(-1)!
  let i = 0
  if (['npx', 'bunx'].includes(name(i))) i++
  else if (name(i) === 'pnpm' && ['exec', 'dlx'].includes(words[1] ?? '')) i += 2
  else if (['python', 'python3'].includes(name(i)) && words[1] === '-m') i += 2
  else if (['uv', 'poetry'].includes(name(i)) && words[1] === 'run') i += 2
  return i
}

/** Whether a verifier segment asks its runner to do anything but run the checks. */
export function runsNothing(segment: string): boolean {
  const words = shellWords(segment)
  const at = programAt(words)
  const program = (words[at] ?? '').split('/').at(-1)!
  const args = words.slice(at + 1)
  if (program === 'vitest' && args[0] === 'list') return true
  if (program === 'cargo' && args.filter(a => !a.startsWith('+'))[0] === 'nextest' && args.filter(a => !a.startsWith('+'))[1] === 'list') return true
  // go test -c / -n build or print the test binary without running it.
  if (program === 'go' && args[0] === 'test' && args.some(a => a === '-c' || a === '-n')) return true
  const own = NO_RUN_FOR[program]
  return args.some(word => NO_RUN.test(word) || (own !== undefined && own.test(word)))
}

/** The command as kept for evidence: a command carrying a secret shape anywhere is kept as `[redacted]`. */
function evidence(bare: string): string {
  const flat = bare.replace(/\s+/g, ' ')
  // Screen the command as given and as stored: folding can split a shape the screen recognises in the original.
  return scan(bare).secrets.length > 0 || scan(flat).secrets.length > 0 ? '[redacted]' : flat.slice(0, MAX_EVIDENCE)
}

/**
 * The verifier a Bash command is, or null. Pure; bounded input.
 *
 * @param command the Bash tool's `command` argument
 */
export function classify(command: unknown): Verifier | null {
  if (typeof command !== 'string' || command.length === 0 || command.length > 2000) return null
  // Bash removes a backslash-newline outright (`--ver\\<newline>sion` is `--version`), so join without a space.
  const flat = command.replace(/\\\n/g, '').trim()
  if (/[\n\r`]|\$\(|\|\||;|\|/.test(flat)) return null
  // A comment hides what follows from the shell: `npm run build # && npm test` runs only the build.
  if (hasComment(flat)) return null
  const segments = flat.split('&&').map(s => s.replace(REDIRECTS, '').trim())
  if (segments.some(s => s.length === 0 || s.includes('&'))) return null

  let found = null as Verifier | null
  for (const segment of segments) {
    if (SETUP.test(segment)) continue
    const bare = segment.replace(ENV_PREFIX, '')
    const kind = kindOf(bare)
    if (kind === null) return null // something else ran: its status is not the verifier's
    if (runsNothing(bare)) return null // help, version or a listing: exit 0 says nothing about the code
    found = { kind: rank(found?.kind, kind), command: evidence(bare), narrowed: found?.narrowed === true || narrows(bare, kind) }
  }
  return found
}

function kindOf(segment: string): VerifierKind | null {
  for (const [re, kind] of RULES) {
    const m = segment.match(re)
    if (m) return typeof kind === 'function' ? kind(m) : kind
  }
  return null
}

/** A chain is named for its strongest check: test over build over typecheck over lint. */
const ORDER: readonly VerifierKind[] = ['lint', 'typecheck', 'build', 'test']
const rank = (a: VerifierKind | undefined, b: VerifierKind): VerifierKind => (a !== undefined && ORDER.indexOf(a) > ORDER.indexOf(b) ? a : b)

/**
 * What a finished Bash call says about its verifier: passed, failed, or
 * nothing (interrupted, backgrounded, timed out, or denied before it ran).
 */
export function verdict(result: unknown): boolean | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { deny?: unknown; isError?: unknown; result?: unknown }
  if (r.deny !== undefined) return null
  const out = (r.result ?? {}) as { interrupted?: unknown; backgroundTaskId?: unknown; timedOutAfterMs?: unknown }
  if (out.interrupted === true || typeof out.backgroundTaskId === 'string' || typeof out.timedOutAfterMs === 'number') return null
  return r.isError !== true
}
