/**
 * The Chat page (PR-C): the live conversation with Claude, drawn for a person, and a field that sends to it. The messages are the
 * settled turns the chat store mirrors (hooks/chat.ts) and, while an answer streams, the text so far as a live "Claude is writing…" block.
 *
 * Privacy (ADR-486): a transcript is drawn only for a person. A text answer (`ctx.text`: console_state, a dump, "Ask Claude about this
 * view") gets counts and never a line of it, and with the sessionPreview setting off the page draws no message text at all.
 * The page is bounded so it can never freeze: only the newest messages are drawn, each message and the streamed block are cut, and the
 * whole conversation is capped in rows.
 */
import type { RenderElement } from 'claude-code'

import { chatOf, CUT_MARK } from '../chat'
import type { ChatMsg } from '../chat-msg'
import type { TermLine } from '../state'
import { button, clip, col, row, rule, text, THEME, type Ctx } from './common'
import { screenOf } from './terminal'

/** The newest messages drawn (the store keeps 200). */
export const SHOWN_MSGS = 50
/** The longest message the page draws before it is cut (the store itself cuts at 20,000). */
export const SHOWN_CHARS = 4_000
/** How much of the streaming answer is drawn: its newest end. */
export const PARTIAL_CHARS = 1_500
/** The most screen rows the conversation takes. */
export const MAX_ROWS = 400

const cut = (body: string, limit: number): string => (body.length > limit && !body.endsWith(CUT_MARK) ? `${body.slice(0, limit)}${CUT_MARK}` : body)

/** One message as the terminal's own turn framing: ╭─ you … for the person, ├─ claude … │ for the answer, with "… used <tools>" for its tools. */
function linesOf(msg: ChatMsg): TermLine[] {
  const body = cut(msg.text, SHOWN_CHARS).split('\n')

  if (msg.role === 'user') return [{ kind: 'in', text: body[0] ?? '' }, ...body.slice(1).map((line): TermLine => ({ kind: 'out', text: line }))]

  const used: TermLine[] = msg.tools.length > 0 ? [{ kind: 'tool', text: `… used ${msg.tools.join(', ')}`, from: 'claude' }] : []

  return [{ kind: 'head', text: 'claude', from: 'claude' }, ...(msg.text === '' ? [] : body.map((line): TermLine => ({ kind: 'out', text: line, from: 'claude' }))), ...used]
}

/** The pending send as a status line; empty when idle. */
const pendingOf = (pending: 'idle' | 'sending' | 'queued'): string => (pending === 'sending' ? 'sending…' : pending === 'queued' ? 'queued — sends when Claude is free' : '')

export function chatView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const chat = chatOf(state)
  const rows: RenderElement[] = []

  if (!state.options.sessionPreview) {
    rows.push(rule(ctx, 'Chat with Claude', 'hidden'))
    rows.push(text(ctx, ' Chat is hidden: Settings → Session preview', { color: THEME.warn }))
    rows.push(text(ctx, ' The conversation is drawn only while session preview is on; nothing of it is shown here.', { dimColor: true }))
    rows.push(button(ctx, 'chat-settings', 'open Settings', () => ctx.act.view('settings')))

    return col(ctx, rows, 'chat')
  }

  // A text answer a model may read: how much there is, never what was said.
  if (ctx.text === true) {
    const count = chat.msgs.length
    const streaming = chat.partial !== '' ? ', a reply is streaming' : ''

    rows.push(text(ctx, `Chat: ${count} message${count === 1 ? '' : 's'}${streaming} (the conversation is not included in text answers)`, { dimColor: true }))
    if (chat.pending !== 'idle') rows.push(text(ctx, `Chat: ${pendingOf(chat.pending)}`, { dimColor: true }))

    return col(ctx, rows, 'chat')
  }

  const width = Math.max(10, ctx.columns - 8)
  const shown = chat.msgs.slice(-SHOWN_MSGS)
  // Each message is framed on its own, so a code fence a cut message left open cannot colour the next one.
  const screen = shown.flatMap(msg => screenOf(linesOf(msg), width))
  const newest = screen.slice(-MAX_ROWS)
  const hidden = chat.msgs.length - shown.length

  rows.push(rule(ctx, 'Chat with Claude', chat.msgs.length === 0 ? 'empty' : `${chat.msgs.length} message${chat.msgs.length === 1 ? '' : 's'}`))
  if (chat.error !== undefined && chat.msgs.length === 0) rows.push(text(ctx, ` ${chat.error}`, { color: THEME.warn }))
  if (hidden > 0 || screen.length > newest.length) rows.push(text(ctx, ` ▲ ${hidden > 0 ? `${hidden} earlier message${hidden === 1 ? '' : 's'}` : 'earlier rows'} not shown`, { dimColor: true }))
  if (newest.length === 0 && chat.partial === '') rows.push(text(ctx, ' nothing yet: type below and press Enter to talk to Claude in this session.', { dimColor: true }))

  for (const [i, entry] of newest.entries()) {
    rows.push(row(ctx, [ctx.kit.Text({ color: entry.gutterColor, children: entry.gutter }), ctx.kit.Text({ wrap: 'truncate-end', ...entry.style, children: clip(entry.text, width) })], `chat-row-${i}`))
  }

  // The answer so far: its newest end, under the last message.
  if (chat.partial !== '') {
    const tail = chat.partial.length > PARTIAL_CHARS ? `…${chat.partial.slice(-PARTIAL_CHARS)}` : chat.partial
    const live = screenOf(tail.split('\n').map((line): TermLine => ({ kind: 'out', text: line, from: 'claude' })), width).slice(-MAX_ROWS)

    rows.push(text(ctx, ' Claude is writing…', { color: THEME.warn, bold: true }))
    for (const [i, entry] of live.entries()) rows.push(row(ctx, [ctx.kit.Text({ color: entry.gutterColor, children: entry.gutter }), ctx.kit.Text({ wrap: 'truncate-end', ...entry.style, children: clip(entry.text, width) })], `chat-live-${i}`))
  }

  const status = pendingOf(chat.pending)

  if (status !== '') rows.push(text(ctx, ` ${status}`, { color: THEME.info }))
  if (chat.error !== undefined && chat.msgs.length > 0) rows.push(text(ctx, ` ${chat.error}`, { color: THEME.warn }))

  rows.push(rule(ctx, 'Say something', 'Enter sends it to Claude as you'))

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Box({
        key: 'chat-box',
        borderStyle: 'round',
        borderColor: THEME.info,
        paddingX: 1,
        children: [
          ctx.kit.Input({
            key: 'chat-send',
            label: '✎',
            placeholder: 'message Claude…',
            autoFocus: true,
            submitLabel: 'Send',
            onSubmit: value => ctx.act.chat.send(value),
          }),
        ],
      }),
    )
  } else {
    rows.push(text(ctx, 'this surface has no text field: Chat needs Claude Code in a terminal', { dimColor: true }))
  }

  rows.push(text(ctx, ' Your words go into this session as a normal turn (screened for secrets first); the answer streams in above. Nothing here is written to disk.', { dimColor: true }))

  return col(ctx, rows, 'chat')
}
