/**
 * ADR-508 — the ruflo-mods cost ledger: the shared budget file drives the
 * ladder, cost deltas are attributed to subagent types and tools, and a
 * gateway budget refusal is toasted once.
 */
import { describe, it, expect } from 'vitest';

import { register } from '../../../../../plugins/ruflo-mods/hooks/register';
import { isBudgetRefusal, MAX_KEYS, createAttribution, noteCost, noteTool } from '../../../../../plugins/ruflo-mods/hooks/cost/attribution';
import { parseAttributionLine } from '../../src/cost/attribution';
import { loadMod, memoryWorld, type World } from './harness';

const BUDGET = '/work/.claude-flow/cost/budget.json';
const LEDGER = '/work/.claude-flow/cost/attribution.jsonl';
const mem = (w: World) => w.files as Map<string, { text: string; mtimeMs: number }>;
const put = (w: World, path: string, value: unknown) => mem(w).set(path, { text: typeof value === 'string' ? value : JSON.stringify(value), mtimeMs: (mem(w).get(path)?.mtimeMs ?? 0) + 1 });

async function start(world: World, options: Record<string, unknown> = {}) {
  const mod = loadMod(register, world, options);
  await mod.create();
  await mod.dispatch('session.start', { cwd: world.root, surface: null, isInteractive: false }, (e) => ({ cwd: e.cwd }));
  return mod;
}
type Mod = Awaited<ReturnType<typeof start>>;
const measure = (mod: Mod, usd: number) => mod.dispatch('session.measure', { context: {}, rateLimits: [], cost: { usd }, changed: ['cost'] }, (e) => ({ changed: e.changed }));
const tool = (mod: Mod, name: string, agentId?: string) => mod.dispatch('tool.call', { tool: name, tool_use_id: `t-${name}`, ...(agentId ? { agentId } : {}) }, () => ({ result: 'ok' }));
const spawn = (mod: Mod, subagentType: string, agentId: string) => mod.dispatch('agent.spawn', { prompt: 'p', description: 'd', subagentType }, () => ({ model: 'haiku', agentId }));
const end = (mod: Mod, reason = 'prompt_input_exit') => mod.dispatch('session.end', { reason, sessionId: 's1', resume: {} }, () => ({ sessionId: 's1' }));
const turnError = (mod: Mod, answer: string, reason = 'error') => mod.dispatch('turn.complete', { turnId: 't1', reason, answer, durationMs: 1, isAborted: false }, () => ({ text: answer }));
const ladder = (w: World) => w.toasts.filter((t) => t.includes('ruflo budget'));

describe('ADR-508 budget file drives the ladder', () => {
  it('uses the smallest window when costBudgetUsd is off, and names it', async () => {
    const world = memoryWorld();
    put(world, BUDGET, { version: 1, windows: [{ usd: 100, period: '30d' }, { usd: 10, period: '24h' }] });
    const mod = await start(world);
    for (const usd of [1, 5.5, 7.6, 9.2, 10.5]) await measure(mod, usd);
    expect(ladder(world).map((t) => t.split(':')[0])).toEqual(['› ruflo budget INFO', '⚠ ruflo budget WARNING', '✗ ruflo budget CRITICAL', '✗ ruflo budget HARD_STOP']);
    expect(ladder(world)[0]).toContain('of $10.00 this session (24h window)');
  });

  it('costBudgetUsd wins over the file', async () => {
    const world = memoryWorld();
    put(world, BUDGET, { version: 1, windows: [{ usd: 1, period: '24h' }] });
    const mod = await start(world, { costBudgetUsd: 100 });
    await measure(mod, 5);
    expect(ladder(world)).toEqual([]);
  });

  it('a hostile or broken file is no budget, never a zero budget', async () => {
    for (const bad of ['{not json', { version: 2, windows: [{ usd: 1, period: '24h' }] }, { version: 1, windows: [{ usd: -1, period: '24h' }] }, { version: 1, windows: [{ usd: 1, period: '1mo' }] }, { version: 1, windows: Array.from({ length: 9 }, (_, i) => ({ usd: 1, period: `${i + 1}d` })) }, { version: 1, windows: [{ usd: 0, period: '24h' }] }]) {
      const world = memoryWorld();
      put(world, BUDGET, bad);
      const mod = await start(world);
      await measure(mod, 50);
      expect(ladder(world), JSON.stringify(bad)).toEqual([]);
      expect((await spawn(mod, 'coder', 'a1')).deny).toBeUndefined();
    }
  });

  it('the file hardStop halts new agents at HARD_STOP; without it, agents still start (negative control)', async () => {
    for (const hardStop of [true, false]) {
      const world = memoryWorld();
      put(world, BUDGET, { version: 1, windows: [{ usd: 1, period: '24h' }], hardStop });
      const mod = await start(world);
      await measure(mod, 1.2);
      const r = await spawn(mod, 'coder', 'a1');
      if (hardStop) expect(r.deny).toMatch(/budget\.json hardStop/);
      else expect(r).toEqual({ model: 'haiku', agentId: 'a1' });
    }
  });
});

describe('ADR-508 attribution', () => {
  it('charges each delta to the subagent type and the tool before it, and writes one line at session end', async () => {
    const world = memoryWorld();
    const mod = await start(world);
    await measure(mod, 0.1); // a plain answer, no tool yet
    await tool(mod, 'Read');
    await measure(mod, 0.3);
    await spawn(mod, 'researcher', 'agent-7');
    await tool(mod, 'WebFetch', 'agent-7');
    await measure(mod, 1.0);
    await tool(mod, 'Bash', 'agent-unknown');
    await measure(mod, 1.5);
    expect(mem(world).has(LEDGER)).toBe(false); // nothing written mid-session
    await end(mod);
    const line = parseAttributionLine(mem(world).get(LEDGER)!.text.trim())!;
    expect(line.totalUsd).toBeCloseTo(1.5, 6);
    expect(line.byAgent).toEqual({ researcher: 0.7, main: 0.3, subagent: 0.5 });
    expect(line.byTool).toEqual({ WebFetch: 0.7, Bash: 0.5, Read: 0.2, '(model)': 0.1 });
    expect(line.refusals).toBe(0);
  });

  it('a /clear writes the session and starts the next one from zero', async () => {
    const world = memoryWorld();
    const mod = await start(world);
    await tool(mod, 'Edit');
    await measure(mod, 2);
    await end(mod, 'clear');
    await measure(mod, 0.5); // the host counts the new session from zero
    await end(mod);
    const lines = mem(world).get(LEDGER)!.text.trim().split('\n').map((l) => parseAttributionLine(l)!);
    expect(lines.map((l) => l.totalUsd)).toEqual([2, 0.5]);
    expect(lines[1]!.byTool).toEqual({ '(model)': 0.5 });
  });

  it('writes nothing outside a ruflo project, with costLedger off, or for a session that cost nothing', async () => {
    const outside = memoryWorld();
    outside.dirs.delete('/work/.claude-flow');
    const a = await start(outside);
    await measure(a, 1);
    await end(a);
    expect(mem(outside).has(LEDGER)).toBe(false);

    const off = memoryWorld();
    const b = await start(off, { costLedger: false });
    await measure(b, 1);
    await end(b);
    expect(mem(off).has(LEDGER)).toBe(false);
    expect(b.events()).not.toContain('session.measure');

    const free = memoryWorld();
    const c = await start(free);
    await end(c);
    expect(mem(free).has(LEDGER)).toBe(false);
  });

  it('never overwrites a ledger it cannot read', async () => {
    const world = memoryWorld();
    put(world, LEDGER, 'x');
    world.failRead = (p) => (p === LEDGER ? new Error('EACCES: permission denied') : undefined);
    const mod = await start(world);
    await measure(mod, 1);
    await end(mod);
    expect(mem(world).get(LEDGER)!.text).toBe('x');
  });

  it('bounds names and keys', () => {
    const a = createAttribution();
    for (let i = 0; i < MAX_KEYS + 10; i++) {
      noteTool(a, `tool${i}`, undefined);
      noteCost(a, i + 1);
    }
    noteTool(a, 'rm -rf $(evil)', undefined);
    noteCost(a, 1000);
    expect(a.byTool.size).toBe(MAX_KEYS + 1);
    expect(a.byTool.has('other')).toBe(true);
  });
});

describe('ADR-508 gateway refusal', () => {
  it('toasts once and counts every refusal; only on a turn that ended on an API error', async () => {
    const world = memoryWorld();
    put(world, BUDGET, { version: 1, windows: [{ usd: 10, period: '24h' }] });
    const mod = await start(world);
    await measure(mod, 0.01);
    // Negative control: a model answer that talks about budgets is never read.
    await turnError(mod, 'Your budget has been exceeded, I think', 'answer');
    expect(world.toasts.filter((t) => t.includes('gateway refused'))).toEqual([]);
    const litellm = 'API Error: 400 {"error":{"message":"Authentication Error, ExceededTokenBudget: Current spend for token: 7.2e-05; Max Budget for Token: 2e-07","type":"budget_exceeded","param":null,"code":"400"}}';
    await turnError(mod, litellm);
    await turnError(mod, litellm);
    await turnError(mod, 'API Error: 529 overloaded');
    const refused = world.toasts.filter((t) => t.includes('gateway refused'));
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('budget: the gateway refused the request (24h window spent)');
    await end(mod);
    expect(parseAttributionLine(mem(world).get(LEDGER)!.text.trim())!.refusals).toBe(2);
  });

  it('reads the synthetic API Error message when the turn carries no answer (Claude Code 2.1.289), and only that', async () => {
    const world = memoryWorld();
    const mod = await start(world);
    const error = 'API Error: 400 Authentication Error, ExceededTokenBudget: Current spend for token: 10.2; Max Budget for Token: 10.0';
    // Negative control: the model's own last words are not an API error message, so they are never read.
    world.messages = [{ role: 'user', text: 'hi', toolUses: [] }, { role: 'assistant', text: 'ExceededTokenBudget is what LiteLLM says', toolUses: [] }];
    await turnError(mod, '');
    expect(world.toasts.filter((t) => t.includes('gateway refused'))).toEqual([]);
    world.messages = [{ role: 'user', text: 'hi', toolUses: [] }, { role: 'assistant', text: error, toolUses: [] }];
    await turnError(mod, '');
    expect(world.toasts.filter((t) => t.includes('gateway refused'))).toEqual(['✗ budget: the gateway refused the request (budget spent)']);
    await end(mod, 'other');
    expect(parseAttributionLine(mem(world).get(LEDGER)!.text.trim())).toMatchObject({ totalUsd: 0, refusals: 1 });
  });

  it('recognises LiteLLM refusals and nothing else', () => {
    for (const yes of ['"type":"budget_exceeded"', 'ExceededTokenBudget: Current spend', 'Budget has been exceeded! Current cost: 10.2', 'Max budget exceeded for key']) expect(isBudgetRefusal(yes), yes).toBe(true);
    for (const no of ['', 'API Error: 429 rate_limit_error', 'overloaded_error', 'budget_tokens must be less than max_tokens', undefined, 42]) expect(isBudgetRefusal(no), String(no)).toBe(false);
  });
});
