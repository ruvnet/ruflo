/**
 * Regression guard for ruvnet/ruflo#3215 — agent_spawn's input schema limited
 * `model` to an enum of five aliases, so an MCP client that validates against
 * the schema could not pass an exact model id (`claude-opus-5-5`,
 * `openrouter/anthropic/claude-sonnet-5.5`) even though the handler already
 * routed non-alias strings through as `modelId` (#2962). The enum is now a
 * bounded string with a safe-character pattern, and the handler applies the
 * same check, including to `config.model` (the `agent spawn -m` path).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Ajv from 'ajv';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSchema } from '../../mcp/src/schema-validator.js';
import { agentTools } from '../src/mcp-tools/agent-tools.js';

const tool = agentTools.find(t => t.name === 'agent_spawn')!;
const spawn = (input: Record<string, unknown>) =>
  tool.handler(input) as Promise<Record<string, any>>;

const ALIASES = ['haiku', 'sonnet', 'opus', 'opus-4.7', 'inherit'];
const EXACT_IDS = [
  'claude-opus-5-5',
  'gpt-6-astra',
  'openrouter/anthropic/claude-sonnet-5.5',
  'openrouter/x/y',
  'qwen3.6:27b',
  'anthropic/claude-opus-4@20260101',
  'model+variant',
];
const BAD_IDS: Array<[string, string]> = [
  ['empty', ''],
  ['over 256 chars', 'a'.repeat(257)],
  ['inner space', 'claude opus'],
  ['leading space', ' claude-opus-5-5'],
  ['trailing newline', 'claude-opus-5-5\n'],
  ['tab', 'claude\topus'],
  ['command substitution', '$(id)'],
  ['backticks', '`id`'],
  ['semicolon', 'a;rm -rf x'],
  ['pipe', 'a|b'],
  ['ampersand', 'a&&b'],
  ['redirect', 'a>b'],
  ['quote', "a'b"],
  ['leading dash (flag-like)', '-leading'],
  ['leading slash', '/etc/passwd'],
  ['leading dot', '../x'],
];

function storedAgent(dir: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, '.claude-flow', 'agents', 'store.json'), 'utf8')).agents[id];
}

describe('#3215 — agent_spawn model schema', () => {
  const ajvValidate = new Ajv().compile(tool.inputSchema);
  const ok = (model: unknown) => ajvValidate({ agentType: 'coder', model });
  const mcpOk = (model: unknown) =>
    validateSchema({ agentType: 'coder', model }, tool.inputSchema as any).valid;

  it('is a bounded string, not an enum', () => {
    const model = (tool.inputSchema.properties as Record<string, any>).model;
    expect(model.type).toBe('string');
    expect(model.enum).toBeUndefined();
    expect(model.minLength).toBe(1);
    expect(model.maxLength).toBe(256);
    expect(typeof model.pattern).toBe('string');
  });

  it('documents the aliases and the exact-id pass-through', () => {
    const d: string = (tool.inputSchema.properties as Record<string, any>).model.description;
    for (const a of ALIASES) expect(d).toContain(a);
    expect(d).toMatch(/exact model id/i);
  });

  it.each(ALIASES)('ajv accepts alias %s', a => expect(ok(a)).toBe(true));
  it.each(EXACT_IDS)('ajv accepts exact id %s', id => expect(ok(id)).toBe(true));
  it('ajv accepts exactly 256 chars', () => expect(ok('a'.repeat(256))).toBe(true));
  it.each(BAD_IDS)('ajv rejects %s', (_label, id) => expect(ok(id)).toBe(false));
  it('ajv rejects a non-string model', () => expect(ok(42)).toBe(false));

  // The @claude-flow/mcp HTTP/stdio server validates with its own validator,
  // which compiles `pattern` with `new RegExp(pattern)` (no `u` flag).
  it.each([...ALIASES, ...EXACT_IDS])('mcp validator accepts %s', id => expect(mcpOk(id)).toBe(true));
  it.each(BAD_IDS)('mcp validator rejects %s', (_label, id) => expect(mcpOk(id)).toBe(false));
});

describe('#3215 — agent_spawn model handler', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-3215-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(ALIASES)('alias %s routes as a tier with no modelId', async alias => {
    const r = await spawn({ agentType: 'coder', model: alias });
    expect(r.success).toBe(true);
    expect(r.model).toBe(alias);
    expect(r.modelRoutedBy).toBe('explicit');
    expect(r).not.toHaveProperty('modelId');
    expect(storedAgent(dir, r.agentId)).not.toHaveProperty('modelId');
  });

  it.each(['claude-opus-5-5', 'openrouter/x/y', 'openrouter/anthropic/claude-sonnet-5.5'])(
    'exact id %s round-trips as modelId',
    async id => {
      const r = await spawn({ agentType: 'coder', model: id });
      expect(r.success).toBe(true);
      expect(r.modelId).toBe(id);
      expect(r.modelRoutedBy).toBe('explicit');
      const stored = storedAgent(dir, r.agentId);
      expect(stored.modelId).toBe(id);
      expect((stored.config as Record<string, unknown>).model).toBe(id);
    },
  );

  it('exact id sent in config.model (agent spawn -m) round-trips as modelId', async () => {
    const r = await spawn({ agentType: 'coder', config: { provider: 'anthropic', model: 'gpt-6-astra' } });
    expect(r.success).toBe(true);
    expect(r.modelId).toBe('gpt-6-astra');
  });

  it.each(BAD_IDS)('rejects top-level model: %s', async (_label, id) => {
    const r = await spawn({ agentType: 'coder', model: id });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Input validation failed: model/);
  });

  it.each(BAD_IDS.filter(([, id]) => id !== ''))('rejects config.model: %s', async (_label, id) => {
    const r = await spawn({ agentType: 'coder', config: { model: id } });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Input validation failed: config\.model/);
  });

  it('rejects a non-string model', async () => {
    const r = await spawn({ agentType: 'coder', config: { model: { evil: true } } });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/config\.model must be a non-empty string/);
  });

  it('an empty or absent config.model still means no explicit model', async () => {
    const a = await spawn({ agentType: 'coder', config: { model: '' } });
    expect(a.success).toBe(true);
    expect(a.modelRoutedBy).not.toBe('explicit');
    const b = await spawn({ agentType: 'coder', config: { model: undefined } });
    expect(b.success).toBe(true);
    expect(b.modelRoutedBy).not.toBe('explicit');
  });

  it('a null top-level model is treated as absent', async () => {
    const r = await spawn({ agentType: 'coder', model: null });
    expect(r.success).toBe(true);
    expect(r.modelRoutedBy).not.toBe('explicit');
  });

  it('a rejected model does not register an agent', async () => {
    const r = await spawn({ agentType: 'coder', agentId: 'bad-model-1', model: '$(id)' });
    expect(r.success).toBe(false);
    let stored: unknown;
    try { stored = storedAgent(dir, 'bad-model-1'); } catch { stored = undefined; }
    expect(stored).toBeUndefined();
  });
});
