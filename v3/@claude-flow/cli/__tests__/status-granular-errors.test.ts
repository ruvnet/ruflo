/**
 * Behavioral regression tests for #984.
 *
 * Before the fix, getSystemStatus wrapped every MCP call in one try/catch, so
 * a single failing service (e.g. task_summary) dropped the whole status into
 * the "stopped" fallback and hid healthy services. These tests mock the MCP
 * layer so one service fails while others succeed, and assert the healthy
 * services survive and `running` reflects that at least one service responded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callMCPTool = vi.fn();

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: (...args: unknown[]) => callMCPTool(...args),
  MCPClientError: class MCPClientError extends Error {},
}));

import { getSystemStatus } from '../src/commands/status.js';

const HEALTHY_SWARM = {
  swarmId: 'swarm-1',
  topology: 'hierarchical',
  agents: { total: 3, active: 2, idle: 1, terminated: 0 },
  health: 'healthy',
  uptime: 1234,
};
const RUNNING_MCP = { running: true, port: 3000, transport: 'stdio' };
const MEMORY_STATS = {
  entries: 42,
  size: 2048,
  backend: 'hybrid',
  performance: { avgSearchTime: 1.5, cacheHitRate: 0.9 },
};

function mockPerService(overrides: Record<string, () => unknown>) {
  callMCPTool.mockImplementation(async (tool: string) => {
    const handler = overrides[tool];
    if (!handler) throw new Error(`${tool} not running`);
    return handler();
  });
}

describe('Status command granular error handling (#984)', () => {
  beforeEach(() => {
    callMCPTool.mockReset();
  });

  it('keeps healthy services visible when one service fails', async () => {
    // swarm/mcp/memory healthy, task_summary down
    mockPerService({
      swarm_status: () => HEALTHY_SWARM,
      mcp_status: () => RUNNING_MCP,
      memory_stats: () => MEMORY_STATS,
    });

    const status = await getSystemStatus();

    // A single failed service must NOT hide the healthy ones (the #984 bug).
    expect(status.running).toBe(true);
    expect(status.swarm.id).toBe('swarm-1');
    expect(status.swarm.health).toBe('healthy');
    expect(status.mcp.running).toBe(true);
    expect(status.memory.entries).toBe(42);
    // The failed service degrades to its default without throwing.
    expect(status.tasks.total).toBe(0);
  });

  it('reports running: true when only one service responds', async () => {
    mockPerService({ memory_stats: () => MEMORY_STATS });

    const status = await getSystemStatus();

    expect(status.running).toBe(true);
    expect(status.memory.backend).toBe('hybrid');
    expect(status.swarm.health).toBe('stopped');
    expect(status.mcp.running).toBe(false);
  });

  it('includes task totals when task_summary responds', async () => {
    mockPerService({
      swarm_status: () => HEALTHY_SWARM,
      task_summary: () => ({ total: 5, pending: 1, running: 2, completed: 1, failed: 0, cancelled: 1 }),
    });

    const status = await getSystemStatus();

    expect(status.running).toBe(true);
    expect(status.tasks.total).toBe(5);
    expect(status.tasks.cancelled).toBe(1);
  });

  it('reports running: false only when every service is down', async () => {
    mockPerService({});

    const status = await getSystemStatus();

    expect(status.running).toBe(false);
    expect(status.swarm.id).toBeNull();
    expect(status.tasks.cancelled).toBe(0);
  });

  it('treats mcp_status running:false as not running without hiding others', async () => {
    mockPerService({
      swarm_status: () => HEALTHY_SWARM,
      mcp_status: () => ({ running: false, port: null, transport: 'stdio' }),
    });

    const status = await getSystemStatus();

    // swarm responded, so overall running is true even though mcp is down
    expect(status.running).toBe(true);
    expect(status.mcp.running).toBe(false);
    expect(status.swarm.health).toBe('healthy');
  });
});
