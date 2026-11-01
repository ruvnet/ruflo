import type { On } from 'claude-code'

import { routeTask } from '../route/route-task'
import { under, type ModState } from '../state'
import { decide, LIMITS, MAX_QUESTION_CHARS, WORKER_MODEL } from './plan'
import { METRICS_PATH, metricsJson, record } from './stats'
import { renderExtract, sha256, verifyReply, WORKER_SYSTEM, workerPrompt } from './verify'

/** Optional modules match every event of a kind another module already holds bare (#4485). */
const ANY = /^[\s\S]*$/

type ReadResult = { type?: unknown; file?: { filePath?: unknown; content?: unknown; numLines?: unknown; startLine?: unknown; totalLines?: unknown } }

/**
 * Automatic context delegation (ADR-522). Off unless the `contextDelegation` option is `observe` or `enforce`.
 *
 * The real Read always runs first (`next(e)`): Claude Code then records the file as read, so a later Edit works, and every
 * failure below returns that real result unchanged. Only a main-loop, whole-file Read of an analysis prompt between 14 KB and
 * 120 KB qualifies (ADR-521's limits). `observe` records what it would have done and changes nothing the model sees.
 * `enforce` asks a no-tools haiku completion for cited findings, verifies every quote against the bytes it read, and only then
 * shows the model those passages instead of the file, with a header saying how to read the rest.
 */
export function registerContextDelegate(on: On, state: ModState, mode: 'observe' | 'enforce') {
  const s = state.contextDelegate
  s.mode = mode

  on('prompt.submit', { text: ANY }, async ($, e, next) => {
    s.prompt = typeof e.text === 'string' ? e.text : ''
    return next(e)
  })

  on('tool.call', { tool: ANY }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== 'Read' || (result as { deny?: unknown } | undefined)?.deny !== undefined) return result
    const input = e as unknown as { file_path?: unknown; offset?: unknown; limit?: unknown; agentId?: string }
    const path = typeof input.file_path === 'string' ? input.file_path : ''
    const real = (result as { result?: ReadResult } | undefined)?.result
    if (!path || real?.type !== 'text' || !real.file) return result

    const seen = s.seen.has(path)
    s.seen.add(path)
    let content: string
    try {
      const stat = await $.fs.stat(path)
      if (stat.kind !== 'file' || stat.isLink === true || stat.size > LIMITS.maxInputBytes * 4) return result
      content = await $.fs.read(path)
    } catch {
      return result
    }
    const bytes = new TextEncoder().encode(content).length
    const plan = decide({
      tool: e.tool, agentId: input.agentId, hasRange: input.offset !== undefined || input.limit !== undefined, bytes,
      prompt: s.prompt, routedAgent: s.prompt ? routeTask(s.prompt).agent : undefined, seen,
    })
    if (plan.route === 'direct') return result

    const at = new Date().toISOString()
    const flush = () => $.fs.write(under(state, METRICS_PATH), metricsJson(s)).catch(() => undefined)
    if (s.mode === 'observe') {
      record(s, { at, path, outcome: 'would-delegate', reason: plan.reason, bytesRead: bytes, bytesShown: bytes })
      await flush()
      return result
    }

    const question = s.prompt.slice(0, MAX_QUESTION_CHARS)
    const key = `${await sha256(content)}|${await sha256(question)}`
    const fallback = async (reason: string, extra: { workerMs?: number; inputTokens?: number; outputTokens?: number } = {}) => {
      record(s, { at, path, outcome: 'fallback', reason, bytesRead: bytes, bytesShown: bytes, ...extra })
      await flush()
      return result
    }

    let raw = s.cache.get(key)
    let usage: { input_tokens: number; output_tokens: number } | undefined
    const started = Date.now()
    if (raw === undefined) {
      try {
        const reply = await $.model.complete({ model: WORKER_MODEL, system: WORKER_SYSTEM, prompt: workerPrompt(path, question, content), maxTokens: 2_048, timeoutMs: LIMITS.timeoutMs })
        usage = reply.usage
        if (!reply.isAnswered) return await fallback(`worker-${reply.reason}`, { workerMs: Date.now() - started, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens })
        raw = reply.text
      } catch {
        return await fallback('worker-error', { workerMs: Date.now() - started })
      }
    }
    const workerMs = Date.now() - started
    const verdict = verifyReply(raw, content)
    if (!verdict.ok) return await fallback(verdict.reason, { workerMs, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens })
    s.cache.set(key, raw)

    const extract = renderExtract(path, content, verdict.findings)
    const shown = new TextEncoder().encode(extract).length
    if (shown >= bytes) return await fallback('extract-not-smaller', { workerMs })
    record(s, { at, path, outcome: 'delegated', reason: plan.reason, bytesRead: bytes, bytesShown: shown, workerMs, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, cached: usage === undefined })
    await flush()
    const lines = extract.split('\n')
    // A fresh object without core's `ref`: returning `ref` makes core reuse its own messages and drop the replacement.
    return { result: { ...real, file: { ...real.file, content: extract, numLines: lines.length, startLine: 1 } } } as unknown as typeof result
  }).catch(($, e, next) => next(e)) // a broken module never blocks a read
}
