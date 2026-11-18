/**
 * SECURITY: the agent, task and terminal stores are plain JSON objects keyed by
 * ids from MCP tool input, and validateIdentifier accepted `__proto__`, so
 * `agent_update {agentId: "__proto__"}` wrote onto Object.prototype for the
 * life of the MCP server. Reserved names are now refused and every record map
 * loads with a null prototype.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateIdentifier } from '../src/mcp-tools/validate-input.js';
import { readRecordStore } from '../src/mcp-tools/record-store.js';

vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeStoreEntry: vi.fn(async () => undefined) }));

const originalCwd = process.env.CLAUDE_FLOW_CWD;
let dir: string;
const polluted = () => ['status', 'config', 'error', 'output'].filter(k => k in ({} as object));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-reserved-id-'));
  process.env.CLAUDE_FLOW_CWD = dir;
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalCwd;
  for (const k of ['status', 'config', 'error', 'output', 'health', 'completedAt']) delete (Object.prototype as Record<string, unknown>)[k];
  rmSync(dir, { recursive: true, force: true });
});

describe('validateIdentifier', () => {
  it('refuses names that resolve to Object.prototype or a built-in', () => {
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      expect(validateIdentifier(id, 'agentId').valid, id).toBe(false);
    }
    expect(validateIdentifier('agent-1', 'agentId').valid).toBe(true);
    expect(validateIdentifier('proto', 'agentId').valid).toBe(true);
  });
});

describe('record stores', () => {
  it('load records with a null prototype, even from a store written with a __proto__ key', () => {
    const path = join(dir, 'store.json');
    writeFileSync(path, '{"agents":{"__proto__":{"status":"x"},"a1":{"status":"idle"}}}');
    const store = readRecordStore<{ agents: Record<string, unknown> }>(path, 'agents', () => ({ agents: {} }));
    expect(Object.getPrototypeOf(store.agents)).toBeNull();
    expect(store.agents.constructor).toBeUndefined();
    const empty = readRecordStore<{ agents: Record<string, unknown> }>(join(dir, 'missing.json'), 'agents', () => ({ agents: {} }));
    expect(Object.getPrototypeOf(empty.agents)).toBeNull();
  });

  it('agent, task and terminal handlers refuse reserved ids without touching Object.prototype', async () => {
    const { agentTools } = await import('../src/mcp-tools/agent-tools.js');
    const { taskTools } = await import('../src/mcp-tools/task-tools.js');
    const { terminalTools } = await import('../src/mcp-tools/terminal-tools.js');
    mkdirSync(join(dir, '.claude-flow'), { recursive: true });
    const run = (tools: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<unknown> }>, name: string, input: Record<string, unknown>) =>
      tools.find(t => t.name === name)!.handler(input).catch((e: Error) => ({ error: e.message }));
    for (const id of ['__proto__', 'constructor']) {
      await run(agentTools as any, 'agent_update', { agentId: id, status: 'pwned', config: { a: 1 } });
      await run(agentTools as any, 'agent_terminate', { agentId: id });
      await run(taskTools as any, 'task_complete', { taskId: id, result: { output: 'x' } });
      await run(taskTools as any, 'task_update', { taskId: id, status: 'pwned' });
      await run(taskTools as any, 'task_cancel', { taskId: id });
      await run(terminalTools as any, 'terminal_close', { sessionId: id });
    }
    expect(polluted()).toEqual([]);
  });
});
