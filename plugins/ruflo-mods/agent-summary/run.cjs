#!/usr/bin/env node
'use strict'
// Process scoped launcher. It does not modify shell settings or stop daemons.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const [mode, ...args] = process.argv.slice(2)
if (!['observe', 'suppress'].includes(mode)) {
  console.error('Usage: node run.cjs observe|suppress [Claude arguments]')
  process.exit(2)
}
const hook = path.resolve(__dirname, 'preload.cjs')
if (/\s/.test(hook) || !fs.existsSync(hook)) {
  console.error('Preload path must exist and contain no whitespace; Claude was not started')
  process.exit(2)
}
const previous = process.env.BUN_OPTIONS || ''
const env = { ...process.env, RUFLO_AGENT_SUMMARY_MODE: mode, BUN_OPTIONS: `${previous}${previous ? ' ' : ''}--preload=${hook}` }
const result = spawnSync('claude', args, { env, stdio: 'inherit' })
if (result.error) { console.error(`Claude launch failed: ${result.error.message}`); process.exit(1) }
if (result.signal) { try { process.kill(process.pid, result.signal) } catch { process.exit(1) } }
process.exit(result.status === null ? 1 : result.status)
