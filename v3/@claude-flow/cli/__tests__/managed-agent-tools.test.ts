/**
 * Guard for ADR-115 — the managed_agent_* MCP tools (Claude Managed Agents
 * cloud runtime, in the `ruflo-agent` plugin). No-network: every handler must
 * short-circuit with a structured "needs ANTHROPIC_API_KEY → use wasm_agent_*"
 * error when no key is set, so the CLI/MCP server stays up offline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { managedAgentTools } from '../src/mcp-tools/managed-agent-tools.js';

const TOOL_NAMES = [
  'managed_agent_capabilities',
  'managed_agent_learning',
  'managed_agent_control',
  'managed_agent_create',
  'managed_agent_prompt',
  'managed_agent_status',
  'managed_agent_events',
  'managed_agent_list',
  'managed_agent_terminate',
  'managed_agent_interrupt',
] as const;

const tool = (name: string) => {
  const t = managedAgentTools.find(t => t.name === name);
  if (!t) throw new Error(`managed-agent tool not registered: ${name}`);
  return t;
};

describe('ADR-115 — managed_agent_* MCP tools', () => {
  let prevAnth: string | undefined;
  let prevClaude: string | undefined;

  beforeEach(() => {
    prevAnth = process.env.ANTHROPIC_API_KEY;
    prevClaude = process.env.CLAUDE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
  });
  afterEach(() => {
    if (prevAnth === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevAnth;
    if (prevClaude === undefined) delete process.env.CLAUDE_API_KEY; else process.env.CLAUDE_API_KEY = prevClaude;
  });

  it('registers exactly the ten managed_agent_* tools', () => {
    const names = managedAgentTools.map(t => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it('every tool has an inputSchema (object) and an ADR-112-ish description that mentions the wasm_agent_* / native fallback', () => {
    for (const t of managedAgentTools) {
      expect(t.inputSchema?.type).toBe('object');
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThanOrEqual(80);
      // each description should orient the caller toward wasm_agent_* / native when that's the right call
      expect(t.description).toMatch(/wasm_agent_|native/);
      expect(t.category).toBe('agent');
    }
  });

  it('descriptions are unique (no copy-paste)', () => {
    const descs = managedAgentTools.map(t => t.description);
    expect(new Set(descs).size).toBe(descs.length);
  });

  for (const name of TOOL_NAMES.filter(name => name !== 'managed_agent_capabilities' && name !== 'managed_agent_learning')) {
    it(`${name} degrades gracefully with no API key (no throw, structured error, no network)`, async () => {
      // minimal valid-ish input per tool's required fields
      const input: Record<string, unknown> =
        name === 'managed_agent_prompt' ? { sessionId: 's', message: 'm' }
        : name === 'managed_agent_create' ? {}
        : name === 'managed_agent_list' ? {}
        : { sessionId: 's' };
      const res = (await (tool(name).handler as any)(input)) as Record<string, unknown>;
      expect(res).toBeTruthy();
      expect(String(res.error ?? '')).toMatch(/ANTHROPIC_API_KEY/);
      expect(String(res.error ?? '')).toMatch(/wasm_agent_create/);
      // tools that report success should report it false
      if ('success' in res) expect(res.success).toBe(false);
      // list-shaped tools still return an empty list
      if (name === 'managed_agent_list') {
        expect(res.sessions).toEqual([]);
        expect(res.total).toBe(0);
      }
    });
  }

  it('managed_agent_prompt rejects missing sessionId/message (with a key set, but no network call made)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
    const noSession = await (tool('managed_agent_prompt').handler as any)({ message: 'hi' });
    expect(noSession.success).toBe(false);
    expect(String(noSession.error)).toMatch(/sessionId/);
    const noMessage = await (tool('managed_agent_prompt').handler as any)({ sessionId: 's' });
    expect(noMessage.success).toBe(false);
    expect(String(noMessage.error)).toMatch(/message/);
  });
});
