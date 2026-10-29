/**
 * A scripted Anthropic Messages API server for the real-binary test tier (ADR-504 §2.1).
 *
 * Claude Code reaches it through `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` with a dummy key. It is not a model: it
 * replays a fixed conversation. Each request that offers tools (the main loop asking for its next move) takes the next
 * scripted assistant turn; anything else (title or summary generation, token counting, an unknown path) gets a minimal
 * valid answer so an engine-internal call can never hang the run. Every request is logged, so a test can assert on
 * what context actually reached the model.
 *
 * It accepts unknown request fields and only ever reads `messages`, `system`, `tools` and `stream`, so a request-shape
 * change between Claude Code versions does not break it (ADR-504 §3).
 *
 * Script: an array of assistant turns, each `{ content: Block[] }` where a block is `{ type: 'text', text }` or
 * `{ type: 'tool_use', name, input }`. The stop reason is `tool_use` when a turn carries a tool call, else `end_turn`.
 * When the script runs out, the server answers `done` with `end_turn`.
 *
 * Usage as a module: `const mock = await startMockModel(script); ...; await mock.close()`.
 * Usage from a shell: `node mock-model.mjs script.json` prints `MOCK_URL=<url>` and serves until killed.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isScripted = body => Array.isArray(body?.tools) && body.tools.length > 0 && Array.isArray(body?.messages)

function materialise(turn, index) {
  const content = (turn?.content ?? [{ type: 'text', text: 'done' }]).map((block, j) =>
    block.type === 'tool_use' ? { type: 'tool_use', id: block.id ?? `toolu_mock_${index}_${j}`, name: block.name, input: block.input ?? {} } : { type: 'text', text: String(block.text ?? '') },
  )
  return { content, stop: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn' }
}

function messageJson(id, model, { content, stop }) {
  return { id, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
}

function sse(res, id, model, { content, stop }) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`)
  send('message_start', { message: { ...messageJson(id, model, { content: [], stop: null }), stop_reason: null } })
  content.forEach((block, index) => {
    if (block.type === 'tool_use') {
      send('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } })
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
    } else {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } })
    }
    send('content_block_stop', { index })
  })
  send('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } })
  send('message_stop', {})
  res.end()
}

/**
 * @param {Array<{content: Array<object>}>} script assistant turns, consumed in order by tool-offering requests
 * @returns {Promise<{url: string, port: number, requests: Array<object>, scripted: () => Array<object>, close: () => Promise<void>}>}
 */
export async function startMockModel(script = []) {
  const requests = []
  let next = 0
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body
      try { body = raw ? JSON.parse(raw) : undefined } catch { body = undefined }
      const path = (req.url ?? '/').split('?')[0]
      const entry = { at: Date.now(), method: req.method, path, body, scripted: false, turn: -1 }
      requests.push(entry)

      if (req.method === 'POST' && path.endsWith('/messages/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ input_tokens: 10 }))
      }
      if (req.method === 'POST' && path.endsWith('/messages')) {
        const model = typeof body?.model === 'string' ? body.model : 'mock-model'
        let turn
        if (isScripted(body)) {
          entry.scripted = true
          entry.turn = next
          turn = materialise(script[next], next)
          next++
        } else {
          turn = materialise({ content: [{ type: 'text', text: 'ok' }] }, -1)
        }
        const id = `msg_mock_${requests.length}`
        if (body?.stream === true) return sse(res, id, model, turn)
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify(messageJson(id, model, turn)))
      }
      // Anything else (feature flags, metrics, an endpoint a newer version adds): a valid, empty answer.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    scripted: () => requests.filter(r => r.scripted),
    close: () => new Promise(resolve => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const script = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : []
  const mock = await startMockModel(script)
  console.log(`MOCK_URL=${mock.url}`)
  process.on('SIGTERM', () => mock.close().then(() => process.exit(0)))
}
