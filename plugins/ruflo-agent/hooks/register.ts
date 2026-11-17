import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { owns, verdict } from './guard'
import { managedCapabilities, managedName, managedVerdict } from './managed'
import { readOptions } from './options'
import { newStats, STATUS_PATH, statusText, type Stats } from './status'
import type { ModOptions } from './options'

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters and the project root. */
type Session = { readonly opts: ModOptions; readonly stats: Stats; root?: string }

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, s.opts, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * Agent as a mod (ADR-445 pattern): a tighten-only guard on text sent into an agent runtime (`wasm_agent_prompt`, `wasm_agent_tool`, `wasm_agent_create`, `wasm_gallery_create`, `managed_agent_create`, `managed_agent_prompt`), `/agent-mod`, and a status file the console reads.
 * No network, no process: only the hooks API.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    s.stats.startedMs = await $.clock.now()
    try {
      await $.command.register({ name: 'agent-mod', description: 'Agent mod: status, scan <text>, guarded, capabilities' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  {
    on('tool.call', async ($, e, next) => {
      if (!owns(e.tool, e) && !managedName(e.tool)) return next(e)
      s.stats.calls++
      const policyReason = managedVerdict(e.tool, e, s.opts)
      const reason = policyReason ?? (s.opts.guard ? verdict(e.tool, e) : undefined)
      if (reason !== undefined) { s.stats.blocked++; s.stats.lastDenied = policyReason ? 'policy' : 'secret' }
      await flush($, s)
      return reason === undefined ? next(e) : { deny: reason }
    })
  }

  /** `/agent-mod` (a markdown command of the plugin cannot be answered by a hook, so the mod owns this name). */
  on('command.run', { command: 'agent-mod' }, async ($, e) => {
    const args = typeof e.args === 'string' ? e.args : ''
    if (args.trim() === 'capabilities') {
      try { return { text: managedCapabilities((await $.tool.list()).map(t => t.name), s.opts) } }
      catch { return { text: 'Tool discovery unavailable; managed runtime readiness is unknown.' } }
    }
    return { text: answer(args, { opts: s.opts, stats: s.stats }) }
  })
}
