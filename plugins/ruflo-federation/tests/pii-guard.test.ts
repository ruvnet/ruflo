import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

// #4861: `piiGuard` turns off only the personal-data refusal; secrets and input too large to screen stay refused while `guard` is on.

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const SECRET = `ghp_${'a1B2'.repeat(10)}`
const PUBLISH = 'mcp__plugin_ruflo-core_ruflo__x_federation_publish'

function world(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: 'went through' }))
}

/** A denial comes back as its reason text, an allowed call as the stubbed result. */
async function attempt($: { tool: { call: (i: never) => Promise<unknown> } }, input: Record<string, unknown>): Promise<string> {
  try {
    return JSON.stringify(await $.tool.call(input as never))
  } catch (e) {
    return String(e)
  }
}

const publish = (body: string) => ({ tool: PUBLISH, body })
const fedMemory = (value: string) => ({ tool: 'mcp__plugin_ruflo-core_ruflo__memory_store', namespace: 'federation', key: 'peer', value })

describe('piiGuard', () => {
  test('default config still refuses PII', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, publish('ssn 123-45-6789'))).toContain('personal data')
    expect(await attempt($, fedMemory('card 4111 1111 1111 1111'))).toContain('personal data')
  })

  test('piiGuard: off lets PII-only publishes and federation memory writes through', { options: { piiGuard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, publish('ssn 123-45-6789'))).toContain('went through')
    expect(await attempt($, publish('card 4111 1111 1111 1111'))).toContain('went through')
    expect(await attempt($, fedMemory('card 4111 1111 1111 1111'))).toContain('went through')
  })

  test('piiGuard: off still refuses a secret, alone or beside PII, and never echoes it', { options: { piiGuard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    for (const body of [`token ${SECRET}`, `ssn 123-45-6789 token ${SECRET}`]) {
      const r = await attempt($, publish(body))
      expect(r).toContain('secret')
      expect(r).not.toContain('went through')
      expect(r).not.toContain('ghp_')
    }
    expect(await attempt($, fedMemory(`key ${SECRET}`))).not.toContain('went through')
  })

  test('piiGuard: off still refuses input too large to screen', { options: { piiGuard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, { tool: PUBLISH, items: Array.from({ length: 25_000 }, () => 'x') })).not.toContain('went through')
  })

  test('guard: off lets everything through as before, whatever piiGuard says', { options: { guard: 'off', piiGuard: 'on' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, publish('ssn 123-45-6789'))).toContain('went through')
    expect(await attempt($, publish(`token ${SECRET}`))).toContain('went through')
  })
})
