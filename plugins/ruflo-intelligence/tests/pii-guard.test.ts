import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

// #4861: `piiGuard` turns off only the email refusal on hooks_transfer; secrets stay refused while `guard` is on.

const ROOT = '/work'
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const SECRET = `ghp_${'a1B2'.repeat(10)}`
const STATUS = `${ROOT}/.claude-flow/intelligence-mod/status.json`
const TRANSFER = 'mcp__plugin_ruflo-core_ruflo__hooks_transfer'

function world(on: On) {
  const files = new Map<string, string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('tool.call', () => ({ result: 'published' }))
  return { status: () => JSON.parse(files.get(STATUS) ?? '{}') as Record<string, unknown> }
}

async function attempt($: { tool: { call: (i: never) => Promise<unknown> } }, input: Record<string, unknown>): Promise<string> {
  try {
    return JSON.stringify(await $.tool.call(input as never))
  } catch (e) {
    return String(e)
  }
}

const transfer = (patterns: string) => ({ tool: TRANSFER, action: 'store', patterns })

describe('piiGuard', () => {
  test('default config still refuses an email in a transfer, and the status file says piiGuard is on', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await attempt($, transfer('owner is jane.doe@example.com'))).toContain('IPFS is public')
    expect(w.status()).toMatchObject({ guard: true, piiGuard: true })
  })

  test('piiGuard: off lets a PII-only transfer publish', { options: { piiGuard: 'off' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await attempt($, transfer('owner is jane.doe@example.com'))).toContain('published')
    expect(w.status()).toMatchObject({ guard: true, piiGuard: false })
  })

  test('piiGuard: off still refuses a secret, alone or beside an email, and never echoes it', { options: { piiGuard: 'off' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    for (const patterns of [`auth uses ${SECRET}`, `owner jane.doe@example.com auth ${SECRET}`]) {
      const r = await attempt($, transfer(patterns))
      expect(r).toContain('secret')
      expect(r).not.toContain('"result"')
      expect(r).not.toContain('ghp_')
    }
  })

  test('guard: off lets everything through as before, whatever piiGuard says', { options: { guard: 'off', piiGuard: 'on' } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(await attempt($, transfer('owner is jane.doe@example.com'))).toContain('published')
    expect(await attempt($, transfer(`auth uses ${SECRET}`))).toContain('published')
  })
})
