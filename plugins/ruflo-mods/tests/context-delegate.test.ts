import { describe, expect, test, tier } from 'claude-code/testing'

import { decide, LIMITS } from '../hooks/context-delegate/plan'
import { renderExtract, verifyReply, workerPrompt } from '../hooks/context-delegate/verify'
import { METRICS_PATH } from '../hooks/context-delegate/stats'
import { START, ROOT, world } from './fixtures/world'

tier('user')

const FILE = `${ROOT}/src/config.ts`
const LINES = Array.from({ length: 1200 }, (_, i) => `export const pad_${i} = ${i}; // filler line for a large module`)
LINES.push('export const MAX_RETRIES = 7;', 'export const TIMEOUT_MS = 30000;')
const BIG = LINES.join('\n') + '\n'
const MAX_LINE = LINES.indexOf('export const MAX_RETRIES = 7;') + 1
const reply = (quote = 'export const MAX_RETRIES = 7;', line = MAX_LINE) =>
  JSON.stringify({ findings: [{ startLine: line, endLine: line, quote, answer: 'MAX_RETRIES is 7' }] })
const readResult = (content: string) => ({ type: 'text', file: { filePath: FILE, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } })
const facts = (over: Partial<Parameters<typeof decide>[0]> = {}) =>
  ({ tool: 'Read', hasRange: false, bytes: 50_000, prompt: 'explore the config and find the retry limit', routedAgent: 'researcher', seen: false, ...over })

describe('context delegation, pure (ADR-522)', () => {
  test('only a whole-file main-loop analysis read in the size window delegates', () => {
    expect(decide(facts())).toEqual({ route: 'delegate', reason: 'bulk-analysis' })
    expect(decide(facts({ tool: 'Grep' })).reason).toBe('not-read')
    expect(decide(facts({ agentId: 'a1' })).reason).toBe('nested-worker')
    expect(decide(facts({ hasRange: true })).reason).toBe('targeted-read')
    expect(decide(facts({ seen: true })).reason).toBe('already-read')
    expect(decide(facts({ bytes: LIMITS.minInputBytes - 1 })).reason).toBe('small-input')
    expect(decide(facts({ bytes: LIMITS.maxInputBytes + 1 })).reason).toBe('input-limit')
    expect(decide(facts({ prompt: '  ' })).reason).toBe('no-question')
    expect(decide(facts({ prompt: 'find the retry limit and change it to 9' })).reason).toBe('change-intent')
    expect(decide(facts({ routedAgent: 'coder' })).reason).toBe('not-analysis')
  })

  test('a reply passes only when every quote is the exact lines it cites', () => {
    expect(verifyReply(reply(), BIG)).toMatchObject({ ok: true })
    expect(verifyReply('```json\n' + reply() + '\n```', BIG)).toMatchObject({ ok: true })
    expect(verifyReply(reply('export const MAX_RETRIES = 3;'), BIG)).toEqual({ ok: false, reason: 'quote-mismatch' })
    // a cited line up to 3 away is relocated to where the quote really is
    const moved = verifyReply(reply('export const MAX_RETRIES = 7;', MAX_LINE - 2), BIG)
    expect(moved.ok && moved.findings[0]!.startLine).toBe(MAX_LINE)
    expect(verifyReply(reply('export const MAX_RETRIES = 7;', MAX_LINE - 10), BIG)).toEqual({ ok: false, reason: 'quote-mismatch' })
    // dropped indentation is forgiven, and the model is shown the file's own line, indentation included
    const indented = BIG.replace('export const MAX_RETRIES = 7;', '    export const MAX_RETRIES = 7;')
    const dropped = verifyReply(reply('export const MAX_RETRIES = 7;'), indented)
    expect(dropped.ok && dropped.findings[0]!.quote).toBe('    export const MAX_RETRIES = 7;')
    expect(verifyReply(reply('export  const MAX_RETRIES = 7;'), BIG)).toEqual({ ok: false, reason: 'quote-mismatch' })
    expect(verifyReply(reply('MAX_RETRIES = 7'), BIG)).toEqual({ ok: false, reason: 'quote-mismatch' })
    expect(verifyReply(reply('export const MAX_RETRIES = 7;', 99_999), BIG)).toEqual({ ok: false, reason: 'quote-mismatch' })
    expect(verifyReply('not json', BIG)).toEqual({ ok: false, reason: 'invalid-reply' })
    expect(verifyReply('{"findings":[]}', BIG)).toEqual({ ok: false, reason: 'invalid-findings' })
    expect(verifyReply('x'.repeat(LIMITS.maxOutputBytes + 1), BIG)).toEqual({ ok: false, reason: 'output-limit' })
  })

  test('the extract says what it is, where the lines are and how to read the rest; answers are cut', () => {
    const long = JSON.stringify({ findings: [{ startLine: MAX_LINE, endLine: MAX_LINE, quote: 'export const MAX_RETRIES = 7;', answer: 'a'.repeat(5_000) }] })
    const v = verifyReply(long, BIG)
    if (!v.ok) throw new Error('expected ok')
    const text = renderExtract(FILE, BIG, v.findings)
    expect(text).toContain('[ruflo context delegation]')
    expect(text).toContain(`lines ${MAX_LINE}-${MAX_LINE}`)
    expect(text).toContain('Read this file with offset/limit')
    expect(text.length).toBeLessThan(1_000)
    expect(workerPrompt(FILE, 'q', 'a\nb')).toContain('1| a\n2| b')
  })
})

describe('context delegation, wired (ADR-522)', () => {
  const boot = (on: Parameters<typeof world>[0], answer: () => unknown) => {
    const w = world(on, {}, { [FILE]: BIG })
    const asked: string[] = []
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('tool.call', ($, e) => ({ result: readResult(BIG) }) as never)
    on('model.complete', ($, e) => {
      asked.push((e as { prompt: string }).prompt)
      return { value: answer() } as never
    })
    return { w, asked }
  }
  const answered = (text: string) => ({ isAnswered: true, text, usage: { input_tokens: 9000, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  const read = async ($: Parameters<Parameters<typeof test>[2]>[0], over: Record<string, unknown> = {}) =>
    (await $.tool.call({ tool: 'Read', file_path: FILE, ...over } as never)) as { result?: { file?: { content?: string } } }

  test('off by default: the model sees the file and no worker runs', async ($, on) => {
    const { asked } = boot(on, () => answered(reply()))
    await $.session.start(START)
    await $.prompt.submit({ text: 'explore the config and find the retry limit' } as never)
    expect((await read($)).result?.file?.content).toBe(BIG)
    expect(asked).toEqual([])
  })

  test('observe: nothing the model sees changes; the would-be delegation is recorded', { options: { contextDelegation: 'observe' } }, async ($, on) => {
    const { w, asked } = boot(on, () => answered(reply()))
    await $.session.start(START)
    await $.prompt.submit({ text: 'explore the config and find the retry limit' } as never)
    expect((await read($)).result?.file?.content).toBe(BIG)
    expect(asked).toEqual([])
    const metrics = JSON.parse(w.files.get(`${ROOT}/${METRICS_PATH}`)!)
    expect(metrics.totals).toMatchObject({ reads: 1, wouldDelegate: 1, delegated: 0 })
  })

  test('enforce: a verified reply replaces the file with the cited extract', { options: { contextDelegation: 'enforce' } }, async ($, on) => {
    const { w, asked } = boot(on, () => answered(reply()))
    await $.session.start(START)
    await $.prompt.submit({ text: 'explore the config and find the retry limit' } as never)
    const content = (await read($)).result?.file?.content ?? ''
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain(`${MAX_LINE}| export const MAX_RETRIES = 7;`)
    expect(content).toContain('[ruflo context delegation]')
    expect(content).toContain('export const MAX_RETRIES = 7;')
    expect(content).not.toContain('pad_500')
    const metrics = JSON.parse(w.files.get(`${ROOT}/${METRICS_PATH}`)!)
    expect(metrics.totals).toMatchObject({ delegated: 1, inputTokens: 9000, outputTokens: 60 })
    expect(metrics.totals.shownVsReadSavedPct).toBeGreaterThan(90)
  })

  test('enforce: a forged quote, a failed call or a change request shows the whole file', { options: { contextDelegation: 'enforce' } }, async ($, on) => {
    let next: unknown = answered(reply('export const MAX_RETRIES = 3;'))
    const { w } = boot(on, () => next)
    await $.session.start(START)
    await $.prompt.submit({ text: 'explore the config and find the retry limit' } as never)
    expect((await read($)).result?.file?.content).toBe(BIG)
    // a second read of the same file goes straight through, whatever the worker would say
    next = answered(reply())
    expect((await read($)).result?.file?.content).toBe(BIG)
    const metrics = JSON.parse(w.files.get(`${ROOT}/${METRICS_PATH}`)!)
    expect(metrics.totals.fallbacks).toEqual({ 'quote-mismatch': 1 })
  })

  test('enforce: worker failure, ranged reads and change requests read directly', { options: { contextDelegation: 'enforce' } }, async ($, on) => {
    const { asked } = boot(on, () => ({ isAnswered: false, reason: 'api-error', status: 529, error: { type: 'overloaded_error', message: 'x' }, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }))
    await $.session.start(START)
    await $.prompt.submit({ text: 'explore the config and find the retry limit' } as never)
    expect((await read($)).result?.file?.content).toBe(BIG)
    expect(asked).toHaveLength(1)
    expect((await read($, { offset: 1, limit: 10 })).result?.file?.content).toBe(BIG)
    await $.prompt.submit({ text: 'research the config, then change the retry limit to 9' } as never)
    expect(asked).toHaveLength(1)
  })
})
