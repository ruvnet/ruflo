/* Experimental Claude Code agent summary timer control.
 * Inspired by https://gist.github.com/flamerix-ai/c3905705cc4205e5de3011fa2e74efce
 * MIT, Copyright (c) 2026 Flamerix AI. See LICENSE.flamerix for attribution.
 */
'use strict'
;(() => {

const marker = Symbol.for('ruflo.agentSummary.timer')
const bunMain = typeof Bun === 'undefined' ? '' : String(Bun.main).replace(/\\/g, '/')
const executable = String(process.execPath).replace(/\\/g, '/')
const base = executable.slice(executable.lastIndexOf('/') + 1).toLowerCase()
const isClaude = ['/$bunfs/root/cli', 'B:/~BUN/root/cli'].includes(bunMain) &&
  (['claude', 'claude.exe', '.claude-wrapped'].includes(base) || /\/claude\/versions\/\d+\.\d+\.\d+$/.test(executable))
const mode = process.env.RUFLO_AGENT_SUMMARY_MODE
if (isClaude && (mode === 'observe' || mode === 'suppress') && !globalThis[marker]) {
  globalThis[marker] = true
  const original = globalThis.setTimeout
  const cache = new WeakMap()
  const matches = fn => {
    if (typeof fn !== 'function') return false
    if (!cache.has(fn)) {
      let match = false
      try { match = ['[AgentSummary] Timer fired', 'agent_summary'].some(s => Function.prototype.toString.call(fn).includes(s)) } catch {}
      cache.set(fn, match)
    }
    return cache.get(fn)
  }
  const report = event => {
    if (!process.env.RUFLO_AGENT_SUMMARY_LOG) return
    try { require('fs').appendFileSync(process.env.RUFLO_AGENT_SUMMARY_LOG, JSON.stringify({event, mode, pid: process.pid, time: new Date().toISOString()}) + '\n', {mode: 0o600}) } catch {}
  }
  const wrapped = function (fn, delay, ...args) {
    if (!matches(fn)) return Reflect.apply(original, this, [fn, delay, ...args])
    report(mode === 'suppress' ? 'timer_suppressed' : 'timer_observed')
    if (mode === 'observe') return Reflect.apply(original, this, [fn, delay, ...args])
    const handle = Reflect.apply(original, this, [() => {}, 2147483647])
    if (handle && typeof handle.unref === 'function') handle.unref()
    return handle
  }
  const custom = Symbol.for('nodejs.util.promisify.custom')
  if (original[custom]) wrapped[custom] = original[custom]
  globalThis.setTimeout = wrapped
  report('preload_active')
}

})()
