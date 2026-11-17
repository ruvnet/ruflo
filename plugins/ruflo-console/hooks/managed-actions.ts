/** Fixed, confirm-gated remote controls. The MCP handler rechecks provider and host policy at execution. */
import type { ActionSpec } from './actions'

export function managedAction(sessionId: string, action: 'inspect' | 'interrupt' | 'terminate', threadOffset?: number): ActionSpec | null {
  if (!/^sesn_[A-Za-z0-9_-]{1,95}$/.test(sessionId)) return null
  if (threadOffset !== undefined && (action !== 'inspect' || !Number.isSafeInteger(threadOffset) || threadOffset < 0 || threadOffset > 9999)) return null
  return {
    label: `${action} managed session ${sessionId}`,
    args: ['mcp', 'exec', '-t', 'managed_agent_control', '-p', JSON.stringify({ sessionId, action, ...(threadOffset === undefined ? {} : { threadOffset }) })],
    declared: action === 'terminate' ? 'delete' : action === 'inspect' ? 'network' : 'write',
    expect: 'a fresh provider result after current host policy is checked; a local snapshot never grants this action',
    note: action === 'interrupt' ? 'Requests a pause only; it does not confirm cancellation.' : action === 'terminate' ? 'Deletes the remote session after a fresh policy check; no environment is deleted by this button.' : 'Reads current remote status through the managed control tool; no background provider request.',
    timeoutMs: 60_000,
    lines: stdout => {
      try {
        const value = JSON.parse(stdout) as Record<string, unknown>
        return [`Remote ${action}: ${value.success === true ? 'reported success' : 'not confirmed'}.`, 'Provider completion is separate from acceptance and learning verification.']
      } catch { return ['Remote response could not be interpreted; inspect through the managed control tool.', 'No successful cancellation or verification is inferred.'] }
    },
  }
}
