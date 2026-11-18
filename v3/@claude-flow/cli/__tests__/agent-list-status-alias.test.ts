/**
 * agent_list compared its status filter literally, so `all`, aliases such as
 * `active`, and any other letter case (`Idle`) matched nothing and returned
 * an empty list. Same reader as task_list: trim, case-fold, known aliases,
 * and `all` / empty means no status filter.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentListStatusFilter, agentStatusOf, agentTools } from '../src/mcp-tools/agent-tools.js';
import { agentCommand } from '../src/commands/agent.js';
import type { CommandContext } from '../src/types.js';

const tool = (name: string) => {
  const t = agentTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type ListResult = { agents: Array<{ agentId: string; status: string }>; total: number; error?: string };

describe('agent_list status filter aliases', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let idle: string;
  let busy: string;
  let stopped: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-agent-list-status-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;

    const spawn = tool('agent_spawn').handler;
    const update = tool('agent_update').handler;
    idle = (await spawn({ agentType: 'coder' }) as { agentId: string }).agentId;
    busy = (await spawn({ agentType: 'tester' }) as { agentId: string }).agentId;
    stopped = (await spawn({ agentType: 'reviewer' }) as { agentId: string }).agentId;
    await update({ agentId: busy, status: 'busy' });
    await tool('agent_terminate').handler({ agentId: stopped });
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const list = async (status?: string, extra: Record<string, unknown> = {}) =>
    (await tool('agent_list').handler({ ...extra, ...(status === undefined ? {} : { status }) })) as ListResult;

  const ids = (result: ListResult) => result.agents.map(a => a.agentId).sort();

  it.each([
    ['idle', 'idle'],
    ['Idle', 'idle'],
    ['IDLE', 'idle'],
    ['ready', 'idle'],
    ['busy', 'busy'],
    ['active', 'busy'],
    ['running', 'busy'],
    ['Working', 'busy'],
    ['terminated', 'terminated'],
    ['Stopped', 'terminated'],
    ['inactive', 'terminated'],
  ])('status "%s" lists the %s agents', async (written, canonical) => {
    const result = await list(written);
    expect(result.error).toBeUndefined();
    expect(result.agents.map(a => a.status)).toEqual([canonical]);
    expect(result.total).toBe(1);
  });

  it('resolves each entry of a comma-separated filter', async () => {
    const result = await list('active, Idle');
    expect(ids(result)).toEqual([busy, idle].sort());
    expect(result.total).toBe(2);
  });

  it('treats all, empty, and whitespace as no status filter', async () => {
    const visible = [busy, idle].sort();
    expect(ids(await list('all'))).toEqual(visible);
    expect(ids(await list('ALL'))).toEqual(visible);
    expect(ids(await list(''))).toEqual(visible);
    expect(ids(await list('   '))).toEqual(visible);
    expect(ids(await list())).toEqual(visible);
    expect((await list('all')).total).toBe(2);
  });

  it('all with includeTerminated returns every agent, including terminated', async () => {
    const result = await list('all', { includeTerminated: true });
    expect(ids(result)).toEqual([busy, idle, stopped].sort());
  });

  it('keeps an unknown status and prototype keys from matching anything', async () => {
    expect((await list('bogus')).total).toBe(0);
    expect((await list('constructor')).total).toBe(0);
    expect(['constructor', '__proto__', 'toString', ' Idle ', 42, null].map(agentStatusOf))
      .toEqual([null, null, null, 'idle', null, null]);
    expect(agentListStatusFilter('all')).toBeNull();
    expect(agentListStatusFilter('')).toBeNull();
    expect(agentListStatusFilter('active, idle')).toEqual(['busy', 'idle']);
  });

  it('agent list --status all lists the non-terminated agents', async () => {
    const listCommand = agentCommand.subcommands!.find(c => c.name === 'list')!;
    const ctx = {
      args: [],
      flags: { format: 'json', status: 'all' },
      cwd: process.cwd(),
      interactive: false,
    } as unknown as CommandContext;
    const result = await listCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const agents = (result!.data as { agents: Array<{ agentId: string }> }).agents;
    expect(agents.map(a => a.agentId).sort()).toEqual([busy, idle].sort());
  });
});
