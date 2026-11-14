import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));

import { normalizeAgentIdList, taskTools } from '../src/mcp-tools/task-tools.js';

const call = (name: string, input: Record<string, unknown>): Promise<any> =>
  taskTools.find((t) => t.name === name)!.handler(input) as Promise<any>;

const swarmPath = () => join(state.cwd, '.claude-flow/swarm/swarm-state.json');
const agentsPath = () => join(state.cwd, '.claude-flow/agents/store.json');

describe('task/swarm telemetry and assignee alias normalization', () => {
  beforeEach(() => {
    state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-telemetry-'));
    mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
    mkdirSync(join(state.cwd, '.claude-flow/swarm'), { recursive: true });
    mkdirSync(join(state.cwd, '.swarm'), { recursive: true });

    writeFileSync(
      agentsPath(),
      JSON.stringify({
        agents: {
          'agent-coder': { agentId: 'agent-coder', agentType: 'coder', status: 'idle', currentTask: null, taskCount: 0 },
          'agent-uiux': { agentId: 'agent-uiux', agentType: 'ui-ux-designer', status: 'idle', currentTask: null, taskCount: 0 },
          'agent-tester': { agentId: 'agent-tester', agentType: 'tester', status: 'idle', currentTask: null, taskCount: 0 },
        },
        version: '3.0.0',
      }),
    );

    const staleTime = '2025-01-01T00:00:00.000Z';
    writeFileSync(
      swarmPath(),
      JSON.stringify({
        swarms: {
          'swarm-1': {
            swarmId: 'swarm-1',
            status: 'running',
            topology: 'hierarchical-mesh',
            maxAgents: 8,
            agents: ['agent-coder', 'agent-uiux', 'agent-tester'],
            tasks: [],
            createdAt: staleTime,
            updatedAt: staleTime,
          },
        },
        version: '3.0.0',
      }),
    );
    writeFileSync(
      join(state.cwd, '.swarm/state.json'),
      JSON.stringify({ swarmId: 'swarm-1', updatedAt: staleTime }),
    );
  });

  afterEach(() => {
    rmSync(state.cwd, { recursive: true, force: true });
  });

  it('normalizes assignedTo, agentIds, and single-string agentId aliases while enforcing strict assignTo array errors', () => {
    expect(normalizeAgentIdList({ assignedTo: ['a1', 'a1'] })).toEqual({ ids: ['a1'], provided: true });
    expect(normalizeAgentIdList({ agentIds: 'a2' })).toEqual({ ids: ['a2'], provided: true });
    expect(normalizeAgentIdList({ agentId: 'a3' })).toEqual({ ids: ['a3'], provided: true });
    expect(normalizeAgentIdList({})).toEqual({ ids: [], provided: false });

    const strictErr = normalizeAgentIdList({ assignTo: 'a1' }, { requireArrayForAssignTo: true });
    expect(strictErr.error).toBe('assignTo must be an array of agent ids');
  });

  it('auto-matches idle running-swarm workers by task domain and refreshes swarm telemetry', async () => {
    const uiTask = await call('task_create', {
      type: 'ui_ux_design',
      description: 'Redesign mobile checkout cards with Tailwind UI',
    });

    expect(uiTask.assignedTo).toEqual(['agent-uiux']);
    expect(uiTask.status).toBe('in_progress');

    const agentsAfterCreate = JSON.parse(readFileSync(agentsPath(), 'utf8')).agents;
    expect(agentsAfterCreate['agent-uiux']).toMatchObject({
      status: 'busy',
      currentTask: uiTask.taskId,
    });

    const swarmAfterCreate = JSON.parse(readFileSync(swarmPath(), 'utf8')).swarms['swarm-1'];
    expect(swarmAfterCreate.tasks).toContain(uiTask.taskId);
    expect(swarmAfterCreate.updatedAt).not.toBe('2025-01-01T00:00:00.000Z');

    const legacyAfterCreate = JSON.parse(readFileSync(join(state.cwd, '.swarm/state.json'), 'utf8'));
    expect(legacyAfterCreate.updatedAt).toBe(swarmAfterCreate.updatedAt);

    await call('task_complete', { taskId: uiTask.taskId });

    const swarmAfterComplete = JSON.parse(readFileSync(swarmPath(), 'utf8')).swarms['swarm-1'];
    expect(swarmAfterComplete.tasks).not.toContain(uiTask.taskId);

    const agentsAfterComplete = JSON.parse(readFileSync(agentsPath(), 'utf8')).agents;
    expect(agentsAfterComplete['agent-uiux']).toMatchObject({
      status: 'idle',
      currentTask: null,
      taskCount: 1,
    });
  });

  it('supports assignedTo on task_create and agentId on task_assign', async () => {
    const t1 = await call('task_create', {
      type: 'feature',
      description: 'Implement feature',
      assignedTo: ['agent-coder'],
    });
    expect(t1.assignedTo).toEqual(['agent-coder']);
    expect(t1.status).toBe('in_progress');

    const t2 = await call('task_create', {
      type: 'testing',
      description: 'Run verification tests',
      assignTo: [],
    });
    expect(t2.assignedTo).toEqual([]);
    expect(t2.status).toBe('pending');

    const assigned = await call('task_assign', {
      taskId: t2.taskId,
      agentId: 'agent-tester',
    });
    expect(assigned.assignedTo).toEqual(['agent-tester']);
    expect(assigned.status).toBe('in_progress');
    expect(existsSync(swarmPath())).toBe(true);
  });
});
