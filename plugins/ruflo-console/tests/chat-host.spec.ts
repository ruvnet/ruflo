import { describe, expect, it } from 'vitest'
import type { EngineInterface } from 'claude-code'

import { hostOf } from '../hooks/register'

const SECRET = 'TOP-SECRET-RESULT-BODY'
const rows = [
  { role: 'user', text: 'read the file', toolUses: [], toolResults: [{ tool_use_id: 't1', text: SECRET, isError: false, result: { body: SECRET } }], handle: 'h1' },
  {
    role: 'assistant',
    text: 'done',
    toolUses: [
      { tool_use_id: 't1', tool: 'Read', input: { file_path: '/etc/secret-path' }, text: SECRET, result: { body: SECRET } },
      { tool_use_id: 't2', tool: 'mcp__ruflo__memory_store', input: { value: 'in-flight-input' } },
    ],
  },
  { role: 'assistant', text: '', toolUses: [] },
]

function fakeEngine() {
  const calls: unknown[][] = []
  const $ = {
    plugin: { root: '/plugin' },
    session: {
      messages: async (...args: unknown[]) => {
        calls.push(args)
        return rows
      },
      id: async () => 'session-42',
    },
  } as unknown as EngineInterface

  return { host: hostOf($, '/cwd', { prefs: () => ({}) as never, record: () => undefined }), calls }
}

describe('Host.session: the live conversation', () => {
  it('maps role, text and tool names; empty text and no tools stay empty', async () => {
    const { host } = fakeEngine()

    expect(await host.session.messages()).toEqual([
      { role: 'user', text: 'read the file', tools: [] },
      { role: 'assistant', text: 'done', tools: ['Read', 'mcp__ruflo__memory_store'] },
      { role: 'assistant', text: '', tools: [] },
    ])
  })

  it('never carries tool results, tool inputs or the engine handle', async () => {
    const { host } = fakeEngine()
    const mapped = await host.session.messages()
    const json = JSON.stringify(mapped)

    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('secret-path')
    expect(json).not.toContain('in-flight-input')
    expect(json).not.toContain('h1')
    for (const msg of mapped) expect(Object.keys(msg).sort()).toEqual(['role', 'text', 'tools'])
  })

  it('reads the main conversation only (no agentId) and passes the session id through', async () => {
    const { host, calls } = fakeEngine()

    await host.session.messages()
    expect(calls).toEqual([[]])
    expect(await host.session.id()).toBe('session-42')
  })
})
