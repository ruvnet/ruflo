'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const code = fs.readFileSync(require('node:path').join(__dirname, 'preload.cjs'), 'utf8')
function setup(mode, main = '/$bunfs/root/cli', execPath = '/bin/claude') {
  const calls = []
  const original = (...args) => { calls.push(args); return { unref() {} } }
  const ctx = { Bun: {main}, process: {env: {RUFLO_AGENT_SUMMARY_MODE: mode}, execPath, pid: 1}, setTimeout: original, require, console }
  vm.createContext(ctx); vm.runInContext(code, ctx)
  return { ctx, calls, original }
}
const summary = function () { return '[AgentSummary] Timer fired' }
const ordinary = function () { return 'normal' }
test('disabled and non Claude pass through', () => {
  for (const x of [setup(undefined), setup('suppress','/other'), setup('suppress','/$bunfs/root/cli','/bin/bun')]) assert.equal(x.ctx.setTimeout, x.original)
})
test('observe preserves callback, delay, and arguments', () => {
  const x = setup('observe'); x.ctx.setTimeout(summary, 30, 'arg'); assert.deepEqual(x.calls[0], [summary, 30, 'arg'])
})
test('suppress targets summary alone and allows other timers', () => {
  const x = setup('suppress'); x.ctx.setTimeout(summary, 30); x.ctx.setTimeout(ordinary, 10, 'a')
  assert.notEqual(x.calls[0][0], summary); assert.equal(x.calls[0][1], 2147483647)
  assert.deepEqual(x.calls[1], [ordinary, 10, 'a'])
})
test('duplicate preload installs once', () => {
  const x = setup('suppress'); const first = x.ctx.setTimeout; vm.runInContext(code, x.ctx); assert.equal(x.ctx.setTimeout, first)
})
