/**
 * Automatic context delegation (ADR-522) against the real `claude` binary and the scripted mock model.
 *
 * The mock's tool-less requests are the mod's `$.model.complete` worker: it answers them with a scripted reply. The main
 * loop reads a 70 KB file for an analysis prompt, then edits it. The model must see only the cited extract, the Edit must
 * still succeed (the real Read ran first), and a forged worker quote must leave the model with the whole file.
 */
import { describe, expect, it } from 'vitest';
import { describeRun, requestText, runClaude } from './run';

const LINES = Array.from({ length: 1100 }, (_, i) => `export const pad_${i} = ${i}; // filler line for a large module`);
LINES.push('export const MAX_RETRIES = 7;');
const BIG = LINES.join('\n') + '\n';
const LINE = LINES.length;
const PROMPT = 'explore the config module and find the retry limit';
const worker = (quote: string) => (body: any) =>
  JSON.stringify(body?.messages ?? '').includes('Return JSON only') ? JSON.stringify({ findings: [{ startLine: LINE, endLine: LINE, quote, answer: 'MAX_RETRIES is 7' }] }) : undefined;
const script = (p: string) => [
  { content: [{ type: 'tool_use' as const, name: 'Read', input: { file_path: `${p}/config.ts` } }] },
  { content: [{ type: 'tool_use' as const, name: 'Edit', input: { file_path: `${p}/config.ts`, old_string: 'export const MAX_RETRIES = 7;', new_string: 'export const MAX_RETRIES = 9;' } }] },
  { content: [{ type: 'text' as const, text: 'done' }] },
];
const afterRead = (run: Awaited<ReturnType<typeof runClaude>>) => requestText(run.requests.filter((r: any) => r.scripted)[1]?.body);

describe('real binary: automatic context delegation (ADR-522)', () => {
  it('enforce: the model sees the verified extract and the Edit still succeeds', async () => {
    const run = await runClaude({ prompt: PROMPT, script, options: { contextDelegation: 'enforce' }, files: { 'config.ts': BIG }, allowedTools: ['Read', 'Edit'], unscripted: worker('export const MAX_RETRIES = 7;'), timeoutMs: 150_000 });
    expect(run.exitCode, describeRun(run)).toBe(0);
    const seen = afterRead(run);
    expect(seen, describeRun(run)).toContain('[ruflo context delegation]');
    expect(seen).toContain('export const MAX_RETRIES = 7;');
    expect(seen).not.toContain('pad_500');
    expect(run.file('config.ts')).toContain('export const MAX_RETRIES = 9;');
    expect(JSON.parse(run.file('.claude-flow/metrics/context-delegation.json') ?? '{}').totals).toMatchObject({ delegated: 1 });
  }, 200_000);

  it('enforce: a forged worker quote leaves the model with the whole file', async () => {
    const run = await runClaude({ prompt: PROMPT, script, options: { contextDelegation: 'enforce' }, files: { 'config.ts': BIG }, allowedTools: ['Read', 'Edit'], unscripted: worker('export const MAX_RETRIES = 3;'), timeoutMs: 150_000 });
    expect(run.exitCode, describeRun(run)).toBe(0);
    const seen = afterRead(run);
    expect(seen).not.toContain('[ruflo context delegation]');
    expect(seen).toContain('pad_500');
    expect(JSON.parse(run.file('.claude-flow/metrics/context-delegation.json') ?? '{}').totals?.fallbacks).toEqual({ 'quote-mismatch': 1 });
  }, 200_000);

  it('off (default): no worker request is made and the model sees the whole file', async () => {
    const run = await runClaude({ prompt: PROMPT, script, files: { 'config.ts': BIG }, allowedTools: ['Read', 'Edit'], unscripted: worker('export const MAX_RETRIES = 7;'), timeoutMs: 150_000 });
    expect(run.exitCode, describeRun(run)).toBe(0);
    expect(afterRead(run)).toContain('pad_500');
    expect(run.requests.some((r: any) => JSON.stringify(r.body?.messages ?? '').includes('Return JSON only'))).toBe(false);
  }, 200_000);
});
