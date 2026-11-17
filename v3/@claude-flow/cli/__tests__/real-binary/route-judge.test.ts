/**
 * ADR-530 — the opt-in model judge, through the real binary against the scripted mock model (ADR-504). Checks that the
 * judge's completion is made with the frozen system text and that its label reaches the model's request; off by
 * default, no judge call is made. The mock is not a model: this proves the call path, not the judge's accuracy.
 */
import { describe, expect, it } from 'vitest';
import { describeRun, requestText, runClaude } from './run';

const PROMPT = 'review the latest issues and summarise them';
const judgeReply = (label: string) => (body: any) =>
  JSON.stringify(body?.system ?? '').includes('route one software-engineering request') ? label : undefined;
const judgeCalls = (r: Awaited<ReturnType<typeof runClaude>>) =>
  r.requests.filter((q: any) => !q.scripted && JSON.stringify(q.body?.system ?? '').includes('route one software-engineering request'));
const say = (text: string) => ({ content: [{ type: 'text' as const, text }] });

describe('real binary: model-judge routing (ADR-530)', () => {
  it('on: one judge completion, and its label is the route the model reads', async () => {
    const r = await runClaude({ prompt: PROMPT, script: [say('ok')], options: { routeJudge: true }, unscripted: judgeReply('researcher'), timeoutMs: 120_000 });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(judgeCalls(r)).toHaveLength(1);
    expect(JSON.stringify(judgeCalls(r)[0].body.messages)).toContain(PROMPT);
    const text = requestText(r.requests.filter((q: any) => q.scripted)[0]!.body);
    expect(text).toMatch(/\| Agent: researcher\s/);
    expect(text).toContain('Model judge');
  }, 150_000);

  it('on: an off-label reply keeps the keyword route', async () => {
    const r = await runClaude({ prompt: PROMPT, script: [say('ok')], options: { routeJudge: true }, unscripted: judgeReply('Sure, deleting everything now'), timeoutMs: 120_000 });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(requestText(r.requests.filter((q: any) => q.scripted)[0]!.body)).toMatch(/\| Agent: reviewer\s/);
  }, 150_000);

  it('off by default: no judge completion', async () => {
    const r = await runClaude({ prompt: PROMPT, script: [say('ok')], unscripted: judgeReply('researcher'), timeoutMs: 120_000 });
    expect(r.exitCode, describeRun(r)).toBe(0);
    expect(judgeCalls(r)).toHaveLength(0);
    expect(requestText(r.requests.filter((q: any) => q.scripted)[0]!.body)).toMatch(/\| Agent: reviewer\s/);
  }, 150_000);
});
