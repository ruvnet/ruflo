import { runCodexHook, hookFailure } from '../../../scripts/lib/codex-mod-runtime.mjs'
import { newStats, STATUS_PATH, statusText } from './status'
import { answer } from './command'
import { verdict, owns } from './guard'

runCodexHook({ name: 'ruflo-adr', verdict, newStats, statusPath: STATUS_PATH, answer,
  statusText: (stats, now) => statusText(stats, { guard: true }, now),
  count: (stats, tool, input, reason) => { if (owns(tool, input)) { stats.calls++; if (reason !== undefined) stats.blocked++; } },
}).catch(() => hookFailure('ruflo-adr'))
