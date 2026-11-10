// _claude-calls.mjs: count each Claude Code response once.
//
// Claude Code writes one assistant line per content block (text, thinking, each
// tool call) and repeats the whole response's usage on every one of them, so
// summing lines counts a response once per block. _ledger.mjs already
// de-duplicates by message.id + requestId; track.mjs and session.mjs use this
// helper to do the same. Each field keeps its largest value across a response's
// lines, which equals the shared value when the lines agree.

export const USAGE_FIELDS = [
  'input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens',
];

export function mergeCall(calls, m) {
  const key = `${m.message.id ?? m.uuid}|${m.requestId ?? ''}`;
  const u = m.message.usage;
  const prev = calls.get(key);
  if (prev) {
    for (const f of USAGE_FIELDS) prev.usage[f] = Math.max(prev.usage[f], u[f] || 0);
    return;
  }
  calls.set(key, {
    model: m.message.model || 'unknown',
    timestamp: m.timestamp || null,
    usage: Object.fromEntries(USAGE_FIELDS.map((f) => [f, u[f] || 0])),
  });
}
