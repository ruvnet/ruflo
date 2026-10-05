#!/usr/bin/env node
/**
 * Overlapping `memory_store` guards: a domain plugin (music, neural-trader, migrations, observability, rvf, ruvector) screens `memory_store`
 * only in its own namespaces, so an unrelated plugin never refuses (or labels) another plugin's write; ruflo-agentdb is the catch-all and
 * refuses a secret in any namespace. Plugin tests cannot import across plugin folders, so the guards are bundled here.
 *
 * Run via:  node --test scripts/__tests__/guard-overlap.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(HERE))
const tmp = mkdtempSync(join(tmpdir(), 'guard-overlap-test-'))
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }))

function esbuild() {
  if (process.env.ESBUILD) return process.env.ESBUILD
  const roots = [REPO]
  try { roots.push(dirname(resolve(REPO, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim()))) } catch { /* not a git checkout */ }
  for (const r of roots) { const p = join(r, 'node_modules', '.bin', 'esbuild'); if (existsSync(p)) return p }
  throw new Error('esbuild not found (set ESBUILD=/path/to/esbuild)')
}

const WITH_STATS = ['music', 'neural-trader', 'migrations', 'observability']
const NAMES = ['agentdb', ...WITH_STATS, 'rvf', 'ruvector']
const entry = NAMES.map(n => {
  const g = JSON.stringify(join(REPO, 'plugins', `ruflo-${n}`, 'hooks', 'guard.ts'))
  return WITH_STATS.includes(n)
    ? `import { verdict as v_${n.replace('-', '_')} } from ${g}\nimport { newStats as s_${n.replace('-', '_')} } from ${JSON.stringify(join(REPO, 'plugins', `ruflo-${n}`, 'hooks', 'status.ts'))}`
    : `import { verdict as v_${n} } from ${g}`
}).join('\n') + `\nexport const guards = {\n${NAMES.map(n => {
  const id = n.replace('-', '_')
  return WITH_STATS.includes(n) ? `  'ruflo-${n}': (t: string, i: unknown) => v_${id}(t, i, {} as never, s_${id}()),` : `  'ruflo-${n}': (t: string, i: unknown) => v_${id}(t, i),`
}).join('\n')}\n}\n`
writeFileSync(join(tmp, 'entry.ts'), entry)
execFileSync(esbuild(), [join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${join(tmp, 'guards.mjs')}`, '--log-level=error'])
const { guards } = await import(pathToFileURL(join(tmp, 'guards.mjs')).href)

const SECRET = ['ghp', 'a1B2'.repeat(10)].join('_') // built, never a literal
const TOOL = 'mcp__plugin_ruflo-core_ruflo__memory_store'
const write = (namespace, value = SECRET) => ({ key: 'k', ...(namespace === undefined ? {} : { namespace }), value })
const refusers = input => Object.entries(guards).filter(([, g]) => g(TOOL, input) !== undefined).map(([n]) => n)

const OWNER = {
  'ruflo-music': 'music-briefs',
  'ruflo-neural-trader': 'trading-risk',
  'ruflo-migrations': 'migrations',
  'ruflo-observability': 'observability-traces',
  'ruflo-rvf': 'rvf-sessions',
  'ruflo-ruvector': 'vector-patterns',
}

for (const [name, ns] of Object.entries(OWNER)) {
  test(`${name}: a secret in its own namespace (${ns}) is refused, alone, naming itself, never echoed`, () => {
    for (const input of [write(ns), { input: write(ns) }]) {
      const reason = guards[name](TOOL, input)
      assert.ok(reason?.startsWith(`${name}:`), `${name} did not refuse: ${reason}`)
      assert.ok(!reason.includes(SECRET))
    }
  })

  test(`${name}: with every guard enabled it is the only domain plugin that refuses ${ns}`, () => {
    assert.deepEqual(refusers(write(ns)).filter(n => n !== 'ruflo-agentdb'), [name])
    assert.ok(refusers(write(ns)).includes('ruflo-agentdb'), 'the catch-all must also refuse')
  })
}

test('ruflo-agentdb refuses a secret in any namespace, or none', () => {
  for (const ns of [undefined, ...Object.values(OWNER), 'unowned-ns']) assert.match(guards['ruflo-agentdb'](TOOL, write(ns)), /^ruflo-agentdb:/)
})

test('an unowned or missing namespace is refused by the catch-all alone', () => {
  assert.deepEqual(refusers(write('unowned-ns')), ['ruflo-agentdb'])
  assert.deepEqual(refusers(write(undefined)), ['ruflo-agentdb'])
})

test('a clean write goes through every guard', () => {
  for (const ns of [undefined, ...Object.values(OWNER)]) assert.deepEqual(refusers(write(ns, 'a note about the weekly review')), [])
})

test('the other writers of a domain plugin keep their un-gated screen', () => {
  for (const name of ['ruflo-music', 'ruflo-neural-trader', 'ruflo-migrations', 'ruflo-observability']) {
    assert.ok(guards[name]('agentdb_pattern-store', write(undefined))?.startsWith(`${name}:`))
  }
})
