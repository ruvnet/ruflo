import { describe, expect, mock, test } from 'claude-code/testing'

import { TOOL_SPECS } from '../hooks/model-tools'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { SESSION, worldOf } from './fixtures/world'

/**
 * Claude Code 2.1.293 `isDeferred` on `$.tool.register`: the console lists only the two tools every console turn calls
 * (console_state, console_run) in the prompt from the start, and leaves console_open and console_set behind tool search.
 * Hosts before 2.1.293 drop the field (the tool is then deferred, as it always was), so this reads what the engine sent on.
 */
describe('console tools reach the model (isDeferred)', () => {
  test('console_state and console_run are listed up front; console_open and console_set stay deferred', { timeoutMs: 30_000, options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    const registered: { name: string; isDeferred?: unknown }[] = []
    on('tool.register', ($, e) => {
      registered.push({ name: e.name, isDeferred: (e as { isDeferred?: unknown }).isDeferred })
      return { value: e as never }
    })
    await $.session.start(SESSION)

    expect(registered.map(tool => tool.name)).toEqual(TOOL_SPECS.map(spec => spec.name))
    // A host before 2.1.293 drops the field on the way to the engine: every tool then stays deferred, as before.
    if (registered.every(tool => tool.isDeferred === undefined)) return
    const listed = registered.filter(tool => tool.isDeferred === false).map(tool => tool.name)
    expect(listed).toEqual(['console_state', 'console_run'])
    expect(registered.filter(tool => tool.isDeferred !== false).map(tool => tool.name)).toEqual(['console_open', 'console_set'])
  })
})
