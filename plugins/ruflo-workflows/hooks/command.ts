import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/wf-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats; readonly tools: () => Promise<readonly string[]> }

const HELP = ['/wf-mod status', '/wf-mod scan <text>', '/wf-mod lifecycle', '/wf-mod managed'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    const seen = Object.entries(stats.seen).map(([k, n]) => `${k} ${n}`).join(' · ')
    return [`guard ${opts.guard ? 'on' : 'off'} · checked ${stats.checked} · blocked ${stats.blocked}`, seen === '' ? 'no workflow calls this session' : seen].join('\n')
  }

  if (verb === 'managed') {
    try {
      const names = (await deps.tools()).filter(t => t === 'managed_agent_capabilities' || t.endsWith('__managed_agent_capabilities'))
      return names.length ? `Managed adapter registered: ${names.map(n => n.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 160)).slice(0, 8).join(', ')}. Inspect that tool and /agent-mod capabilities before creation. Use persisted workflow_* for approval gates; managed workflows are remote execution with independently verified outputs. Registration does not establish authorization or beta access.` : 'Managed adapter not registered. Install or update ruflo-core and ruflo-agent. Use local workflow_* or native Workflow for current work.'
    } catch { return 'Managed tool discovery unavailable; registration and readiness are unknown.' }
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /wf-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse that (looks like: ${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'lifecycle') return 'created -> running <-> paused -> completed | cancelled. Delete refuses a running workflow, and this mod refuses a delete that names no single id.'

  return `Unknown: ${verb}\n${HELP}`
}
