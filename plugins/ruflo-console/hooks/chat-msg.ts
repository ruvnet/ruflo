import type { SessionMessage } from 'claude-code'

/**
 * One turn of the live conversation as the console shows it. `tools` holds tool NAMES only: tool inputs and tool result bodies are
 * dropped here, so transcript detail never reaches disk, console_state text or a model.
 */
export type ChatMsg = { role: 'user' | 'assistant'; text: string; tools: string[] }

/** Maps engine rows to ChatMsg: role and text kept, `toolUses` reduced to names, `toolResults` and every other field dropped. */
export function toChatMsgs(rows: readonly SessionMessage[]): ChatMsg[] {
  return rows.map(row => ({ role: row.role, text: row.text, tools: row.toolUses.map(use => use.tool) }))
}
