/**
 * ADR-508 — `ruflo cost budget set/get/export` and `ruflo cost report`.
 *
 * - the budget file's validation (and parity with the ruflo-mods copy);
 * - the LiteLLM export, field by field against docs.litellm.ai;
 * - `--apply` refuses plain HTTP to a non-loopback host and reads the key only from the environment;
 * - `--gateway meta-llm` fails with a pointer to ADR-508.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { validateBudget as modValidate, ladderWindow as modLadder } from '../../../../plugins/ruflo-mods/hooks/cost/file';
import { attributionLine, createAttribution, noteCost, noteSpawn, noteTool } from '../../../../plugins/ruflo-mods/hooks/cost/attribution';
import { BUDGET_PATH, budgetFromFlags, ladderWindow, readBudget, validateBudget } from '../src/cost/budget-file';
import { applyToLiteLLM, gatewayRefusal, keyFromEnv, keyGenerateUrl, maskKey, toLiteLLMKeyBody } from '../src/cost/litellm';
import { parseAttributionLine, summarize } from '../src/cost/attribution';
import { costCommand } from '../src/commands/cost';
import { output } from '../src/output';

const HOSTILE: unknown[] = [
  null, 1, 'x', [], {},
  { version: 2, windows: [{ usd: 1, period: '24h' }] },
  { version: '1', windows: [{ usd: 1, period: '24h' }] },
  { version: 1 },
  { version: 1, windows: [] },
  { version: 1, windows: {} },
  { version: 1, windows: [{ usd: -1, period: '24h' }] },
  { version: 1, windows: [{ usd: 0, period: '24h' }] },
  { version: 1, windows: [{ usd: Number.NaN, period: '24h' }] },
  { version: 1, windows: [{ usd: '10', period: '24h' }] },
  { version: 1, windows: [{ usd: 1e7, period: '24h' }] },
  { version: 1, windows: [{ usd: 1, period: '1mo' }] },
  { version: 1, windows: [{ usd: 1, period: 'week' }] },
  { version: 1, windows: [{ usd: 1, period: '0d' }] },
  { version: 1, windows: [{ usd: 1, period: '-1d' }] },
  { version: 1, windows: [{ usd: 1, period: '24h\n' }] },
  { version: 1, windows: [{ usd: 1, period: '99999d' }] },
  { version: 1, windows: [{ usd: 1, period: '24h' }, { usd: 2, period: '24h' }] },
  { version: 1, windows: Array.from({ length: 9 }, (_, i) => ({ usd: 1, period: `${i + 1}d` })) },
  { version: 1, windows: Array.from({ length: 10_000 }, () => ({ usd: 1, period: '24h' })) },
  { version: 1, windows: [null] },
  { version: 1, windows: [{ usd: 1, period: '24h' }], hardStop: 'yes' },
  { version: 1, windows: [{ usd: 1, period: '24h' }], fallbackModel: 'haiku; rm -rf /' },
  { version: 1, windows: [{ usd: 1, period: '24h' }], fallbackModel: '' },
  { version: 1, windows: [{ usd: 1, period: '24h' }], fallbackModel: 'x'.repeat(129) },
  { version: 1, windows: [{ usd: 1, period: '24h' }], fallbackModel: 7 },
];
const GOOD: unknown[] = [
  { version: 1, windows: [{ usd: 10, period: '24h' }, { usd: 100, period: '30d' }], hardStop: true, fallbackModel: 'haiku' },
  { version: 1, windows: [{ usd: 0.5, period: '30m' }] },
  { version: 1, windows: [{ usd: 5, period: '7d' }], fallbackModel: 'anthropic/claude-haiku-4-5', extra: 'dropped', __proto__x: 1 },
  { version: 1, windows: Array.from({ length: 8 }, (_, i) => ({ usd: i + 1, period: `${i + 1}d` })) },
];

describe('budget file validation', () => {
  it('rejects every hostile file, in both copies', () => {
    for (const v of HOSTILE) {
      expect(validateBudget(v), JSON.stringify(v)?.slice(0, 80)).toBeUndefined();
      expect(modValidate(v), JSON.stringify(v)?.slice(0, 80)).toBeUndefined();
    }
  });

  it('keeps good files, drops unknown fields, and the two copies agree exactly', () => {
    for (const v of GOOD) {
      const cli = validateBudget(v);
      expect(cli).toBeDefined();
      expect(modValidate(v)).toEqual(cli);
      expect(Object.keys(cli!).sort()).toEqual(['hardStop', 'version', 'windows', ...('fallbackModel' in cli! ? ['fallbackModel'] : [])].sort());
      expect(modLadder(modValidate(v)!)).toEqual(ladderWindow(cli!));
    }
  });

  it('the ladder window is the smallest usd', () => {
    expect(ladderWindow(validateBudget(GOOD[0])!)).toEqual({ usd: 10, period: '24h' });
  });

  it('builds a budget from set flags', () => {
    expect(budgetFromFlags({ daily: 10, monthly: '100' }).budget).toEqual({ version: 1, windows: [{ usd: 10, period: '24h' }, { usd: 100, period: '30d' }], hardStop: false });
    expect(budgetFromFlags({ weekly: 5, hardStop: true, fallbackModel: 'haiku' }).budget).toEqual({ version: 1, windows: [{ usd: 5, period: '7d' }], hardStop: true, fallbackModel: 'haiku' });
    expect(budgetFromFlags({}).error).toMatch(/at least one/);
    expect(budgetFromFlags({ daily: -1 }).error).toMatch(/--daily/);
    expect(budgetFromFlags({ daily: 'ten' }).error).toMatch(/--daily/);
    expect(budgetFromFlags({ daily: 1, fallbackModel: 'a b' }).error).toMatch(/--fallback-model/);
  });
});

describe('LiteLLM export', () => {
  const budget = validateBudget(GOOD[0])!;

  it('maps every window to a budget_limits entry with LiteLLM field names', () => {
    expect(toLiteLLMKeyBody(budget)).toEqual({
      budget_limits: [{ budget_duration: '24h', max_budget: 10 }, { budget_duration: '30d', max_budget: 100 }],
    });
  });

  it('adds model_max_budget and budget_fallbacks only for a named model, with their own documented field names', () => {
    const body = toLiteLLMKeyBody(budget, 'claude-opus-4-5');
    expect(body).toEqual({
      budget_limits: [{ budget_duration: '24h', max_budget: 10 }, { budget_duration: '30d', max_budget: 100 }],
      model_max_budget: { 'claude-opus-4-5': { budget_limit: 10, time_period: '24h' } },
      budget_fallbacks: { 'claude-opus-4-5': ['haiku'] },
    });
    // Field names exactly as docs.litellm.ai documents them (users, budget_fallbacks pages).
    expect(Object.keys(body.budget_limits[0]!).sort()).toEqual(['budget_duration', 'max_budget']);
    expect(Object.keys(body.model_max_budget!['claude-opus-4-5']!).sort()).toEqual(['budget_limit', 'time_period']);
    expect(Array.isArray(body.budget_fallbacks!['claude-opus-4-5'])).toBe(true);
    // No fallback model: no budget_fallbacks, never an invented one.
    expect(toLiteLLMKeyBody(validateBudget(GOOD[1])!, 'm').budget_fallbacks).toBeUndefined();
    expect(() => toLiteLLMKeyBody(budget, 'bad model')).toThrow(/--model/);
  });

  it('refuses meta-llm with a pointer to ADR-508, and unknown gateways', () => {
    expect(gatewayRefusal('litellm')).toBeUndefined();
    expect(gatewayRefusal('meta-llm')).toMatch(/no budget API.*ADR-508/);
    expect(gatewayRefusal('openrouter')).toMatch(/must be one of/);
    expect(gatewayRefusal(undefined)).toMatch(/must be one of/);
  });
});

describe('--apply guards', () => {
  it('refuses plain http to a non-loopback host, credentials in the URL, and non-URLs', () => {
    for (const bad of ['http://proxy.example.com', 'http://10.0.0.5:4000', 'http://0.0.0.0:4000', 'http://localhost.evil.com', 'ftp://localhost', 'https://u:p@proxy.example', 'https://proxy.example?x=1', 'not a url', '', undefined]) {
      expect(keyGenerateUrl(bad).url, String(bad)).toBeUndefined();
    }
  });

  it('allows https anywhere and http to loopback, and appends /key/generate to the base path', () => {
    expect(keyGenerateUrl('https://proxy.example.com').url!.href).toBe('https://proxy.example.com/key/generate');
    expect(keyGenerateUrl('https://proxy.example.com/litellm/').url!.href).toBe('https://proxy.example.com/litellm/key/generate');
    expect(keyGenerateUrl('http://localhost:4000').url!.href).toBe('http://localhost:4000/key/generate');
    expect(keyGenerateUrl('http://127.0.0.1:4000').url!.href).toBe('http://127.0.0.1:4000/key/generate');
    expect(keyGenerateUrl('http://[::1]:4000').url!.href).toBe('http://[::1]:4000/key/generate');
  });

  it('reads the master key only from the named environment variable', () => {
    expect(keyFromEnv('LITELLM_MASTER_KEY', { LITELLM_MASTER_KEY: 'sk-master-123456' }).key).toBe('sk-master-123456');
    expect(keyFromEnv('LITELLM_MASTER_KEY', {}).error).toMatch(/not set/);
    expect(keyFromEnv('sk-master-123456', {}).error).toMatch(/--key-env/); // a key pasted in place of a name is refused
    expect(keyFromEnv(undefined, {}).error).toMatch(/--key-env/);
    expect(maskKey('sk-1234567890abcdef')).toBe('sk-1…(19 chars)');
  });

  it('posts only the budget fields, with the key as a bearer and redirects refused', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ key: 'sk-generated-abcdefgh' }), { status: 200 });
    }) as unknown as typeof fetch;
    const body = toLiteLLMKeyBody(validateBudget(GOOD[0])!);
    const r = await applyToLiteLLM(keyGenerateUrl('http://127.0.0.1:4000').url!, 'sk-master', body, fake);
    expect(r).toEqual({ ok: true, status: 200, generatedKey: 'sk-generated-abcdefgh' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4000/key/generate');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.redirect).toBe('error');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-master');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(body);
  });

  it('reports a gateway refusal without throwing', async () => {
    const fake = (async () => new Response('{"error":"bad key"}', { status: 401 })) as unknown as typeof fetch;
    const r = await applyToLiteLLM(keyGenerateUrl('https://p.example').url!, 'k', { budget_limits: [] }, fake);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});

describe('attribution report', () => {
  it('reads what the mod writes, and skips hostile lines', () => {
    const a = createAttribution();
    noteSpawn(a, 'ag1', 'coder');
    noteTool(a, 'Edit', 'ag1');
    noteCost(a, 0.4);
    noteTool(a, 'Bash', undefined);
    noteCost(a, 0.5);
    const line = attributionLine(a, 'prompt_input_exit', 1000, { usd: 10, period: '24h' });
    expect(parseAttributionLine(line)).toEqual({ endedAt: 1000, totalUsd: 0.5, byAgent: { coder: 0.4, main: 0.1 }, byTool: { Edit: 0.4, Bash: 0.1 }, refusals: 0 });
    const text = [line, line, '{"v":1,"endedAt":1,"totalUsd":-5,"byAgent":{},"byTool":{},"refusals":0}', '{"v":1,"endedAt":1,"totalUsd":1,"byAgent":{"<script>":1},"byTool":{},"refusals":0}', 'garbage', ''].join('\n');
    const report = summarize(text);
    expect(report.sessions).toBe(2);
    expect(report.skipped).toBe(3);
    expect(report.totalUsd).toBeCloseTo(1, 6);
    expect(report.byAgent[0]).toEqual(['coder', 0.8]);
    expect(summarize(text, 2000).sessions).toBe(0);
  });
});

describe('ruflo cost command', () => {
  let cwd: string;
  const sub = (...names: string[]) => names.reduce((cmd, n) => cmd.subcommands!.find((s) => s.name === n)!, costCommand);
  const ctx = (flags: Record<string, unknown>) => ({ args: [], flags: { _: [], ...flags }, cwd, interactive: false }) as never;
  let written: string[];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-cost-'));
    written = [];
    vi.spyOn(output, 'write').mockImplementation((t: string) => void written.push(t));
    vi.spyOn(output, 'writeln').mockImplementation((t = '') => void written.push(t));
    vi.spyOn(output, 'writeErrorln').mockImplementation((t = '') => void written.push(t));
    vi.spyOn(output, 'printError').mockImplementation((t: string) => void written.push(`ERR ${t}`));
    vi.spyOn(output, 'printSuccess').mockImplementation((t: string) => void written.push(t));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('set writes the file the mod reads; export prints LiteLLM YAML', async () => {
    expect((await sub('budget', 'set').action!(ctx({ daily: 10, monthly: 100, hardStop: true, fallbackModel: 'haiku' }))).success).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(cwd, BUDGET_PATH), 'utf8'));
    expect(modValidate(onDisk)).toEqual({ version: 1, windows: [{ usd: 10, period: '24h' }, { usd: 100, period: '30d' }], hardStop: true, fallbackModel: 'haiku' });
    expect(JSON.stringify(onDisk)).not.toMatch(/key|token|secret/i);

    written = [];
    const r = await sub('budget', 'export').action!(ctx({ gateway: 'litellm', model: 'claude-sonnet' }));
    expect(r.success).toBe(true);
    expect(parseYaml(written[0]!)).toEqual(r.data);
  });

  it('export --gateway meta-llm fails and sends nothing', async () => {
    mkdirSync(join(cwd, '.claude-flow/cost'), { recursive: true });
    writeFileSync(join(cwd, BUDGET_PATH), JSON.stringify(GOOD[0]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await sub('budget', 'export').action!(ctx({ gateway: 'meta-llm', apply: true, url: 'https://x.example', keyEnv: 'K' }));
    expect(r.success).toBe(false);
    expect(written.join('\n')).toMatch(/ADR-508/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('--apply to plain http on a non-loopback host is refused before any request', async () => {
    mkdirSync(join(cwd, '.claude-flow/cost'), { recursive: true });
    writeFileSync(join(cwd, BUDGET_PATH), JSON.stringify(GOOD[0]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.RUFLO_TEST_LITELLM_KEY = 'sk-master-test';
    try {
      const r = await sub('budget', 'export').action!(ctx({ gateway: 'litellm', apply: true, url: 'http://proxy.example.com:4000', keyEnv: 'RUFLO_TEST_LITELLM_KEY' }));
      expect(r.success).toBe(false);
      expect(written.join('\n')).toMatch(/refuses http:\/\/proxy\.example\.com/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      delete process.env.RUFLO_TEST_LITELLM_KEY;
    }
  });

  it('get and export fail clearly without a budget file, and on an invalid one', async () => {
    expect((await sub('budget', 'get').action!(ctx({}))).success).toBe(false);
    mkdirSync(join(cwd, '.claude-flow/cost'), { recursive: true });
    writeFileSync(join(cwd, BUDGET_PATH), JSON.stringify(HOSTILE[10]));
    expect(readBudget(cwd).kind).toBe('invalid');
    expect((await sub('budget', 'export').action!(ctx({ gateway: 'litellm' }))).success).toBe(false);
  });

  it('report reads the attribution file', async () => {
    mkdirSync(join(cwd, '.claude-flow/cost'), { recursive: true });
    writeFileSync(join(cwd, '.claude-flow/cost/attribution.jsonl'), '{"v":1,"endedAt":1,"totalUsd":2,"byAgent":{"coder":1.5,"main":0.5},"byTool":{"Bash":2},"refusals":1,"budget":null}\n');
    const r = await sub('report').action!(ctx({ json: true }));
    expect(r.data).toMatchObject({ sessions: 1, totalUsd: 2, refusals: 1, byAgent: [['coder', 1.5], ['main', 0.5]] });
  });
});
