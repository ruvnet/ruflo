/**
 * The console's mirror of the live Claude conversation (PR-C): the settled turns as ChatMsg, plus the text of the answer still streaming.
 *
 * Kept in a side table keyed by the State (the sessions.ts pattern), so nothing a transcript said can reach the snapshot, an export,
 * persistence or console_state text. Nothing here writes a file or sends text to a model.
 *
 * The store keeps data only: a tool-only assistant message stays `{ text: '', tools: [...] }`, and the view decides how to show it
 * ("… used <tools>").
 */
import type { HookStream, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'
import type { ChatMsg } from './chat-msg'
import { checkLimit, LONG_TEXT_MAX } from './full-text'
import type { Host } from './host'
import { mcOf } from './mission-control'
import { blocksGuidance, screenText } from './mission-options'
import { hasSecret } from './screen'
import type { State } from './state'

/** How many settled messages the store keeps (the newest). */
export const KEEP_MSGS = 200
/** The longest text one message, or the streaming answer, keeps before it is cut. */
export const MAX_TEXT = 20_000
export const CUT_MARK = '… cut'

type StepEvent = Readonly<TurnStepInput>
type StepNext = (e: StepEvent) => HookStream<TurnStepChunk, TurnStepResult>

export type Chat = { msgs: ChatMsg[]; partial: string; pending: 'idle' | 'sending' | 'queued'; error?: string }

const chats = new WeakMap<State, Chat>()
/** Which main-session turn the store is on: a refresh that lands after the next turn began leaves that turn's partial alone. */
const turns = new WeakMap<State, number>()

export function chatOf(state: State): Chat {
  let found = chats.get(state)

  if (found === undefined) {
    found = { msgs: [], partial: '', pending: 'idle' }
    chats.set(state, found)
  }

  return found
}

export function cutText(text: unknown): string {
  const plain = typeof text === 'string' ? text : ''

  return plain.length > MAX_TEXT ? `${plain.slice(0, MAX_TEXT)}${CUT_MARK}` : plain
}

/** The newest KEEP_MSGS messages, each text cut at MAX_TEXT. Only the kept tail is touched, so a 4,096-row transcript costs 200 rows. */
export function keepChat(msgs: readonly ChatMsg[]): ChatMsg[] {
  return msgs.slice(-KEEP_MSGS).map(msg => ({ role: msg.role, text: cutText(msg.text), tools: Array.isArray(msg.tools) ? [...msg.tools] : [] }))
}

/** Re-reads the main conversation into the store. Never throws: a failed read keeps the last messages and says so in `error`. */
export async function refreshChat(host: Host, state: State): Promise<void> {
  const chat = chatOf(state)

  try {
    chat.msgs = keepChat(await host.session.messages())
    delete chat.error
  } catch {
    // The reason is not shown: an engine error could quote the transcript.
    chat.error = 'could not read the conversation'
  }
}

/** Appends a streamed piece of the main answer, up to MAX_TEXT (then marks the cut once). O(piece), never O(answer). */
export function appendPartial(state: State, text: string): void {
  const chat = chatOf(state)

  if (chat.partial.length > MAX_TEXT) return
  const room = MAX_TEXT - chat.partial.length

  chat.partial += text.length > room ? `${text.slice(0, room)}${CUT_MARK}` : text
}

/** A main-session turn begins: the streaming answer starts empty. */
export function startChatTurn(state: State): void {
  turns.set(state, (turns.get(state) ?? 0) + 1)
  chatOf(state).partial = ''
}

/** A main-session turn ended: the settled messages are re-read, then the streaming answer is cleared (unless a newer turn began). */
export async function endChatTurn(host: Host, state: State): Promise<void> {
  const turn = turns.get(state) ?? 0

  await refreshChat(host, state)
  if ((turns.get(state) ?? 0) === turn) chatOf(state).partial = ''
}

/**
 * The body of the `turn.step` hook (register.ts: `return yield* chatStep(e, next, observe)`): every chunk from beneath is yielded
 * unchanged and in order, and beneath's result is returned. A main-session text chunk is also handed to `observe`; a subagent's step is
 * passed straight through, and an `observe` that throws changes nothing. Per chunk it does one kind check and one call.
 */
export async function* chatStep(e: StepEvent, next: StepNext, observe: (text: string) => void): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  if (e.agentId !== undefined) return yield* next(e)
  const stream = next(e)

  for await (const chunk of stream) {
    if (chunk.kind === 'text') {
      try {
        observe(chunk.text)
      } catch {
        // The console's mirror is a bystander: a failed update never alters the response.
      }
    }
    yield chunk
  }

  return await stream.result
}

/** What the person sees when a send did not go. Fixed text: a refusal or an engine error could quote the message, so neither is shown. */
const NOT_SENT = {
  unsafe: 'not sent: AIDefence flagged the message as unsafe',
  pii: 'not sent: AIDefence found personal or secret data in the message',
  long: 'not sent: the message is too long to be screened whole; shorten it',
  rejected: 'not sent: Claude did not take the message',
} as const

/**
 * Types to Claude from the console: the message goes in directly, as a normal user turn (`submitPrompt`), never drafted into the prompt box.
 *
 * - The message is trimmed (that is all that is done to it); an empty one is ignored.
 * - While `pending` is not `idle` another Enter is ignored: `pending` is set before anything is awaited, so a repeated Enter during the
 *   screen or the submit adds nothing. Mid-turn it reads `queued` (the engine runs a submit made during a turn as a turn of its own once the
 *   session is idle) and the submit is still made, once.
 * - It is screened by the same AIDefence screen as a typed question to Claude (`screenText`, unless the person switched the screen off): a
 *   secret-shaped or unsafe message is refused and nothing is submitted. A message over the screen's limit could not be screened whole, so it
 *   is refused too.
 * - `pending` returns to `idle` when the submit settles. That is the one signal tied to this very message, it is the same for success and
 *   failure, and it needs no hook of its own. A rejection leaves a fixed `error` (never the message, never the engine's reason).
 * - The text is kept nowhere: not in the store, an event, the last outcome or an error. Never throws.
 */
export async function sendChat(host: Host, state: State, text: string): Promise<void> {
  const chat = chatOf(state)
  const message = typeof text === 'string' ? text.trim() : ''

  if (message === '' || chat.pending !== 'idle') return

  const redraw = () => {
    try {
      host.invalidate()
    } catch {
      // A refused redraw changes nothing about the send.
    }
  }
  const refuse = (why: string) => {
    chat.pending = 'idle'
    chat.error = why
    redraw()
  }

  chat.pending = state.turnActive ? 'queued' : 'sending'
  delete chat.error
  redraw()

  try {
    if (!checkLimit(message, LONG_TEXT_MAX, 'the message').ok) return refuse(NOT_SENT.long)

    // Screen off, or no detector answering: the dependency-free secret check still stands between a secret and the model.
    const screen = mcOf(state).isScreenOn ? await screenText(state, host, message) : null

    if (blocksGuidance(screen)) return refuse(screen?.status === 'pii' ? NOT_SENT.pii : NOT_SENT.unsafe)
    if ((screen === null || screen.status === 'unavailable') && hasSecret(message)) return refuse(NOT_SENT.pii)

    await host.submitPrompt(message, { asUser: true })
    chat.pending = 'idle'
    redraw()
  } catch {
    refuse(NOT_SENT.rejected)
  }
}
