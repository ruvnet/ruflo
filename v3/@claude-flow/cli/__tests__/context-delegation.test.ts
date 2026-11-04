import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  planContextRead, delegateContextRead, contextBytes, contextSha256,
  type ContextRead, type ContextAdapter, type ContextWorkerRequest,
} from '../src/services/context-delegation.js';
import { contextPlanCommand } from '../src/commands/context-plan.js';

const source = { path: 'src/example.ts', content: `export const answer = 42;\n${'// filler\n'.repeat(1800)}` };
const read: ContextRead = { intent: 'analysis', mode: 'enforce', inputBytes: contextBytes(source.content), fileCount: 1, workerAvailable: true };
const reply = (request: Readonly<ContextWorkerRequest>) => JSON.stringify({ findings: [{
  path: request.sources[0]!.path, sourceSha256: request.sources[0]!.sha256,
  startLine: 1, endLine: 1, quote: request.sources[0]!.content.split('\n')[0], answer: 'The declared answer is 42.',
}] });
const adapter = (invoke = async (request: Readonly<ContextWorkerRequest>) => reply(request)): ContextAdapter => ({ authorize: vi.fn(async () => true), invoke: vi.fn(invoke) });
const run = (changes: Record<string, unknown> = {}) => delegateContextRead({ read, question: 'What is the answer?', sources: [source], adapter: adapter(), ...changes });

describe('core context routing', () => {
  it.each([
    [{ mode: undefined }, 'direct', 'legacy'], [{ mode: 'legacy' }, 'direct', 'legacy'],
    [{ mode: 'observe' }, 'observe', 'bulk-analysis'], [{}, 'delegate', 'bulk-analysis'],
    [{ intent: 'edit' }, 'direct', 'exact-source-required'], [{ intent: 'debug' }, 'direct', 'exact-source-required'],
    [{ intent: 'architecture' }, 'direct', 'exact-source-required'],
    [{ offset: 0 }, 'direct', 'targeted-read'], [{ limit: 100 }, 'direct', 'targeted-read'],
    [{ depth: 1 }, 'direct', 'depth-limit'], [{ workerAvailable: false }, 'direct', 'worker-unavailable'],
    [{ inputBytes: 13999 }, 'direct', 'small-input'], [{ inputBytes: 14000 }, 'delegate', 'bulk-analysis'],
    [{ inputBytes: 120001 }, 'direct', 'input-limit'], [{ fileCount: 17 }, 'direct', 'file-limit'],
    [{ fileCount: 0 }, 'direct', 'file-limit'],
  ])('preserves routing invariants for %j', (change, route, reason) => {
    expect(planContextRead({ ...read, ...change } as ContextRead)).toEqual({ route, reason });
  });
  it.each([{ inputBytes: NaN }, { fileCount: 1.5 }, { depth: -1 }, { offset: -1 }, { mode: 'bad' }, { intent: 'bad' }])('rejects malformed metadata %j', change => {
    expect(() => planContextRead({ ...read, ...change } as ContextRead)).toThrow();
  });
  it('rejects overflowing timeouts', () => expect(() => planContextRead(read, { timeoutMs: 2147483648 })).toThrow());
  it('rejects invalid thresholds', () => expect(() => planContextRead(read, { minInputBytes: 130000 })).toThrow());
  it('uses bytes rather than line count, including Unicode', () => expect(planContextRead({ ...read, inputBytes: contextBytes('界'.repeat(5000)) }).route).toBe('delegate'));
});

describe('bounded execution and proof receipts', () => {
  it.each(['legacy', 'observe'])('never invokes authorization or worker in %s', async mode => {
    const a = adapter();
    expect((await run({ read: { ...read, mode }, adapter: a })).status).toBe('direct');
    expect(a.authorize).not.toHaveBeenCalled(); expect(a.invoke).not.toHaveBeenCalled();
  });
  it('returns verified evidence and exact byte accounting; usage stays unknown', async () => {
    const a = adapter(); const result = await run({ adapter: a });
    expect(result.status).toBe('delegated');
    if (result.status !== 'delegated') throw Error('expected delegation');
    expect(a.invoke).toHaveBeenCalledTimes(1);
    expect(result.receipt.sources[0]!.sha256).toBe(contextSha256(source.content));
    expect(result.receipt.coordinatorBytes).toBe(contextBytes(JSON.stringify(result)));
    expect(result.receipt.workerInputBytes).toBe(contextBytes(JSON.stringify(vi.mocked(a.invoke).mock.calls[0]![0])));
    expect(result.receipt.usage).toBeUndefined();
    expect(result.receipt).not.toHaveProperty('content');
  });
  it('freezes snapshots, limits tools and depth; does not retain caller objects', async () => {
    const a = adapter(async req => {
      expect(req.tools).toEqual([]); expect(req.depth).toBe(1);
      expect(Object.isFrozen(req)).toBe(true); expect(Object.isFrozen(req.sources[0])).toBe(true);
      return reply(req);
    });
    expect((await run({ adapter: a })).status).toBe('delegated');
  });
  it('denies before invocation', async () => {
    const a = adapter(); a.authorize = vi.fn(async () => false);
    expect(await run({ adapter: a })).toMatchObject({ status: 'escalate', reason: 'authorization-failed' });
    expect(a.invoke).not.toHaveBeenCalled();
  });
  it('redacts adapter exceptions', async () => {
    expect(JSON.stringify(await run({ adapter: adapter(async () => { throw Error('secret-provider-key'); }) }))).not.toContain('secret-provider-key');
  });
  it.each(['invalid-json', '{}', '{"findings":[]}', '{"findings":null}'])('escalates invalid worker reply %s', async raw => {
    expect(await run({ adapter: adapter(async () => raw) })).toMatchObject({ status: 'escalate', reason: 'invalid-worker-reply' });
  });
  it.each([
    { sourceSha256: '0'.repeat(64) }, { path: 'src/other.ts' }, { startLine: 0 }, { endLine: 9999 },
    { quote: 'invented' }, { answer: '' }, { startLine: 1.5 },
  ])('rejects forged evidence %j', async change => {
    expect((await run({ adapter: adapter(async req => {
      const r = JSON.parse(reply(req)); Object.assign(r.findings[0], change); return JSON.stringify(r);
    }) })).status).toBe('escalate');
  });
  it('rejects a citation from an older source snapshot', async () => {
    expect((await run({ sources: [{ ...source, content: source.content + '// changed' }], adapter: adapter(async req => {
      const r = JSON.parse(reply(req)); r.findings[0].sourceSha256 = contextSha256(source.content); return JSON.stringify(r);
    }) })).status).toBe('escalate');
  });
  it('strips extra worker fields before returning', async () => {
    const result = await run({ adapter: adapter(async req => {
      const r = JSON.parse(reply(req)); r.secret = 'do-not-return'; r.findings[0].tool = 'do-not-return'; return JSON.stringify(r);
    }) });
    expect(result.status).toBe('delegated'); expect(JSON.stringify(result)).not.toContain('do-not-return');
  });
  it('captures provider usage without inventing prices', async () => {
    const result = await run({ adapter: adapter(async req => {
      return JSON.stringify({ ...JSON.parse(reply(req)), usage: { inputTokens: 4000, outputTokens: 200, costUsd: 0.002 } });
    }) });
    expect(result.status === 'delegated' && result.receipt.usage).toEqual({ inputTokens: 4000, outputTokens: 200, costUsd: 0.002 });
  });
  it.each([{ inputTokens: -1, outputTokens: 1 }, { inputTokens: 1.2, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1, costUsd: -1 }])('rejects invalid usage %j', async usage => {
    expect((await run({ adapter: adapter(async req => JSON.stringify({ ...JSON.parse(reply(req)), usage })) })).status).toBe('escalate');
  });
  it('bounds serialized input including escaping and envelope overhead', async () => {
    const a = adapter();
    expect((await run({ sources: [{ ...source, content: '"'.repeat(80000) }], adapter: a })).status).toBe('escalate');
    expect(a.invoke).not.toHaveBeenCalled();
  });
  it('bounds worker output', async () => expect((await run({ adapter: adapter(async () => 'x'.repeat(8001)) })).status).toBe('escalate'));
  it('bounds the complete coordinator payload, including receipts', async () => {
    expect((await run({ limits: { maxOutputBytes: 400 } })).status).toBe('escalate');
  });
  it('bounds finding count', async () => {
    expect((await run({ adapter: adapter(async req => {
      const r = JSON.parse(reply(req)); r.findings = Array(33).fill(r.findings[0]); return JSON.stringify(r);
    }) })).status).toBe('escalate');
  });
  it.each(['../secret', '/etc/passwd', 'src/../secret', 'src//file', 'src/file\nname'])('rejects invalid identifier %j before authorization', async path => {
    const a = adapter(); expect((await run({ sources: [{ ...source, path }], adapter: a })).status).toBe('escalate');
    expect(a.authorize).not.toHaveBeenCalled();
  });
  it('rejects duplicate paths', async () => expect((await run({ sources: [source, source] })).status).toBe('escalate'));
  it('rejects binary input before authorization', async () => {
    const a = adapter(); expect((await run({ sources: [{ ...source, content: source.content + '\0' }], adapter: a })).status).toBe('escalate');
    expect(a.authorize).not.toHaveBeenCalled();
  });
  it('times out a noncooperative adapter without returning raw corpus', async () => {
    let signal: AbortSignal | undefined;
    const a = adapter(async (_, s?: AbortSignal) => { signal = s; return new Promise<string>(() => {}); });
    const result = await run({ adapter: a, limits: { timeoutMs: 10 } });
    expect(result).toMatchObject({ status: 'escalate', reason: 'timeout' }); expect(signal?.aborted).toBe(true);
  });
  it('also bounds noncooperative authorization', async () => {
    const a = adapter(); a.authorize = async () => new Promise(() => {});
    expect(await run({ adapter: a, limits: { timeoutMs: 10 } })).toMatchObject({ status: 'escalate', reason: 'timeout' });
    expect(a.invoke).not.toHaveBeenCalled();
  });
  it('does not launch after external cancellation', async () => {
    const c = new AbortController(); c.abort(); const a = adapter();
    expect(await run({ adapter: a, signal: c.signal })).toMatchObject({ status: 'escalate', reason: 'cancelled' });
    expect(a.authorize).not.toHaveBeenCalled(); expect(a.invoke).not.toHaveBeenCalled();
  });
  it('cancels after an in-flight authorization and prevents late launch', async () => {
    const c = new AbortController(); let unblock!: () => void;
    const a = adapter(); a.authorize = () => new Promise<boolean>(r => { unblock = () => r(true); });
    const running = run({ adapter: a, signal: c.signal }); c.abort();
    expect(await running).toMatchObject({ status: 'escalate', reason: 'cancelled' });
    unblock(); await Promise.resolve(); expect(a.invoke).not.toHaveBeenCalled();
  });
});

describe('core hooks entry', () => {
  it('registers the core hook command and public API', () => {
    const hooks = readFileSync(new URL('../src/commands/hooks.ts', import.meta.url), 'utf8');
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(hooks).toContain("import { contextPlanCommand } from './context-plan.js'");
    expect(hooks).toMatch(/subcommands: \[[\s\S]*contextPlanCommand/);
    expect(index).toContain("export { planContextRead, delegateContextRead, DEFAULT_CONTEXT_LIMITS }");
  });
  it('exposes metadata planning without worker execution', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await contextPlanCommand.action!({ args: [], flags: { _: [], bytes: 20000, mode: 'observe', 'worker-available': true }, cwd: '.', interactive: false });
      expect(result).toMatchObject({ success: true, data: { route: 'observe', reason: 'bulk-analysis' } });
      expect(log).toHaveBeenCalledWith('{"route":"observe","reason":"bulk-analysis"}');
    } finally { log.mockRestore(); }
  });
  it('honours --worker-available through the real CLI parser', async () => {
    const { CommandParser } = await import('../src/parser.js');
    const parser = new CommandParser({ allowUnknownFlags: true });
    parser.registerCommand(contextPlanCommand);
    const parsed = parser.parse(['context-plan', '--bytes', '20000', '--mode', 'observe', '--worker-available']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await contextPlanCommand.action!({ args: [], flags: parsed.flags as any, cwd: '.', interactive: false });
      expect(result).toMatchObject({ success: true, data: { route: 'observe', reason: 'bulk-analysis' } });
    } finally { log.mockRestore(); }
  });
  it('rejects malformed CLI values', async () => {
    expect(await contextPlanCommand.action!({ args: [], flags: { _: [], bytes: 'NaN' }, cwd: '.', interactive: false })).toMatchObject({ success: false, exitCode: 1 });
  });
});
