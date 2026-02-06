/**
 * TDD Tests for TeammateBridge
 *
 * Test suite following London School TDD approach:
 * - Outside-in development
 * - Mock external dependencies
 * - Focus on behavior, not implementation
 *
 * @module @claude-flow/teammate-plugin/tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock child_process before importing
vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('claude --version')) {
      return '2.1.19';
    }
    if (cmd.includes('git rev-parse')) {
      return 'main';
    }
    if (cmd.includes('git config')) {
      return 'https://github.com/test/repo.git';
    }
    if (cmd.includes('which tmux')) {
      return '/usr/bin/tmux';
    }
    throw new Error('Command not found');
  }),
  spawn: vi.fn(),
}));

import {
  TeammateBridge,
  TeammateError,
  createTeammateBridge,
} from '../src/teammate-bridge.js';

import {
  TeammateErrorCode,
  MINIMUM_CLAUDE_CODE_VERSION,
} from '../src/types.js';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_TEAMS_DIR = path.join(os.tmpdir(), 'claude-flow-test-teams');

function cleanupTestDir(): void {
  if (fs.existsSync(TEST_TEAMS_DIR)) {
    fs.rmSync(TEST_TEAMS_DIR, { recursive: true });
  }
}

// ============================================================================
// Initialization Tests
// ============================================================================

describe('TeammateBridge Initialization', () => {
  let bridge: TeammateBridge;

  beforeEach(() => {
    cleanupTestDir();
    bridge = new TeammateBridge();
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should detect Claude Code version on initialize', async () => {
    const versionInfo = await bridge.initialize();

    expect(versionInfo.claudeCode).toBe('2.1.19');
    expect(versionInfo.compatible).toBe(true);
    expect(versionInfo.plugin).toBe('1.0.0-alpha.1');
  });

  it('should report compatible when version >= 2.1.19', async () => {
    await bridge.initialize();

    expect(bridge.isAvailable()).toBe(true);
    expect(bridge.getClaudeCodeVersion()).toBe('2.1.19');
  });

  it('should return version info', async () => {
    await bridge.initialize();

    const info = bridge.getVersionInfo();

    expect(info.claudeCode).toBe('2.1.19');
    expect(info.compatible).toBe(true);
    expect(info.missingFeatures).toEqual([]);
  });
});

// ============================================================================
// Team Management Tests
// ============================================================================

describe('Team Management', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  describe('spawnTeam', () => {
    it('should create a new team with default config', async () => {
      const team = await bridge.spawnTeam({ name: 'test-team' });

      expect(team.name).toBe('test-team');
      expect(team.topology).toBe('hierarchical');
      expect(team.teammates).toEqual([]);
      expect(team.activePlans).toEqual([]);
      expect(team.context.teamName).toBe('test-team');
    });

    it('should create team with custom topology', async () => {
      const team = await bridge.spawnTeam({
        name: 'mesh-team',
        topology: 'mesh',
        maxTeammates: 10,
      });

      expect(team.topology).toBe('mesh');
    });

    it('should set environment variable for team context', async () => {
      await bridge.spawnTeam({ name: 'env-team' });

      expect(process.env.CLAUDE_CODE_TEAM_NAME).toBe('env-team');
    });

    it('should emit team:spawned event', async () => {
      const eventSpy = vi.fn();
      bridge.on('team:spawned', eventSpy);

      await bridge.spawnTeam({ name: 'event-team' });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          team: 'event-team',
        })
      );
    });
  });

  describe('discoverTeams', () => {
    it('should return array of teams', async () => {
      // Note: Due to test isolation, other teams may exist from previous tests
      // This test validates discoverTeams returns an array
      const teams = await bridge.discoverTeams();

      expect(Array.isArray(teams)).toBe(true);
    });

    it('should discover existing teams', async () => {
      await bridge.spawnTeam({ name: 'team-1' });
      await bridge.spawnTeam({ name: 'team-2' });

      const teams = await bridge.discoverTeams();

      expect(teams).toContain('team-1');
      expect(teams).toContain('team-2');
    });
  });
});

// ============================================================================
// Teammate Spawning Tests
// ============================================================================

describe('Teammate Spawning', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
    await bridge.spawnTeam({ name: 'spawn-test-team' });
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should spawn a teammate and return TeammateInfo', async () => {
    const teammate = await bridge.spawnTeammate({
      name: 'coder-1',
      role: 'coder',
      prompt: 'Write code',
      teamName: 'spawn-test-team',
    });

    expect(teammate.name).toBe('coder-1');
    expect(teammate.role).toBe('coder');
    expect(teammate.status).toBe('active');
    expect(teammate.id).toMatch(/^teammate-/);
  });

  it('should add teammate to team state', async () => {
    await bridge.spawnTeammate({
      name: 'tester-1',
      role: 'tester',
      prompt: 'Write tests',
      teamName: 'spawn-test-team',
    });

    const team = bridge.getTeamState('spawn-test-team');

    expect(team?.teammates).toHaveLength(1);
    expect(team?.teammates[0].name).toBe('tester-1');
  });

  it('should build correct AgentInput', async () => {
    const agentInput = bridge.buildAgentInput({
      name: 'reviewer-1',
      role: 'reviewer',
      prompt: 'Review code',
      teamName: 'spawn-test-team',
      model: 'opus',
      allowedTools: ['Read', 'Grep'],
      mode: 'plan',
    });

    expect(agentInput.description).toBe('reviewer: reviewer-1');
    expect(agentInput.subagent_type).toBe('reviewer');
    expect(agentInput.model).toBe('opus');
    expect(agentInput.team_name).toBe('spawn-test-team');
    expect(agentInput.allowed_tools).toEqual(['Read', 'Grep']);
    expect(agentInput.mode).toBe('plan');
    expect(agentInput.run_in_background).toBe(false);
  });

  it('should remap general-purpose subagent type on legacy Claude Code', async () => {
    const agentInput = bridge.buildAgentInput({
      name: 'worker-1',
      role: 'general-purpose',
      prompt: 'Handle generic tasks',
      teamName: 'spawn-test-team',
    });

    expect(agentInput.subagent_type).toBe('researcher');
    expect(agentInput.description).toBe('general-purpose: worker-1');
  });

  it('should preserve explicit runInBackground=true in AgentInput', async () => {
    const agentInput = bridge.buildAgentInput({
      name: 'reviewer-bg',
      role: 'reviewer',
      prompt: 'Review code in background',
      teamName: 'spawn-test-team',
      runInBackground: true,
    });

    expect(agentInput.run_in_background).toBe(true);
  });
});

// ============================================================================
// Messaging Tests
// ============================================================================

describe('Messaging', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
    await bridge.spawnTeam({ name: 'msg-team' });
    await bridge.spawnTeammate({
      name: 'sender',
      role: 'coder',
      prompt: 'Send messages',
      teamName: 'msg-team',
    });
    await bridge.spawnTeammate({
      name: 'receiver',
      role: 'tester',
      prompt: 'Receive messages',
      teamName: 'msg-team',
    });
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should send message to specific teammate', async () => {
    const team = bridge.getTeamState('msg-team')!;
    const sender = team.teammates[0];
    const receiver = team.teammates[1];

    const message = await bridge.sendMessage('msg-team', sender.id, receiver.id, {
      type: 'task',
      payload: { action: 'test' },
    });

    expect(message.from).toBe(sender.id);
    expect(message.to).toBe(receiver.id);
    expect(message.type).toBe('task');
    expect(message.id).toMatch(/^msg-/);
  });

  it('should broadcast message to all teammates', async () => {
    const team = bridge.getTeamState('msg-team')!;
    const sender = team.teammates[0];

    const message = await bridge.broadcast('msg-team', sender.id, {
      type: 'status',
      payload: { status: 'ready' },
    });

    expect(message.to).toBe('broadcast');
    expect(message.type).toBe('status');
  });

  it('should increment message count', async () => {
    const team = bridge.getTeamState('msg-team')!;
    const sender = team.teammates[0];
    const receiver = team.teammates[1];

    await bridge.sendMessage('msg-team', sender.id, receiver.id, {
      type: 'task',
      payload: {},
    });

    const updatedTeam = bridge.getTeamState('msg-team')!;
    expect(updatedTeam.messageCount).toBe(1);
  });
});

// ============================================================================
// Plan Approval Tests
// ============================================================================

describe('Plan Approval', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
    await bridge.spawnTeam({ name: 'plan-team' });
    await bridge.spawnTeammate({
      name: 'coordinator',
      role: 'coordinator',
      prompt: 'Coordinate',
      teamName: 'plan-team',
    });
    await bridge.spawnTeammate({
      name: 'worker',
      role: 'coder',
      prompt: 'Work',
      teamName: 'plan-team',
    });
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should submit a plan', async () => {
    const team = bridge.getTeamState('plan-team')!;
    const coordinator = team.teammates[0];

    const plan = await bridge.submitPlan('plan-team', {
      description: 'Implement feature',
      proposedBy: coordinator.id,
      steps: [
        { order: 1, action: 'Write code', tools: ['Edit'] },
        { order: 2, action: 'Write tests', tools: ['Edit'] },
      ],
      requiredApprovals: 1,
    });

    expect(plan.status).toBe('pending');
    expect(plan.steps).toHaveLength(2);
    expect(plan.id).toMatch(/^plan-/);
  });

  it('should approve a plan', async () => {
    const team = bridge.getTeamState('plan-team')!;
    const coordinator = team.teammates[0];
    const worker = team.teammates[1];

    const plan = await bridge.submitPlan('plan-team', {
      description: 'Test plan',
      proposedBy: coordinator.id,
      steps: [{ order: 1, action: 'Test', tools: [] }],
      requiredApprovals: 1,
    });

    await bridge.approvePlan('plan-team', plan.id, worker.id);

    const updatedTeam = bridge.getTeamState('plan-team')!;
    const approvedPlan = updatedTeam.activePlans.find(p => p.id === plan.id);

    expect(approvedPlan?.status).toBe('approved');
    expect(approvedPlan?.approvals).toContain(worker.id);
  });

  it('should launch swarm for approved plan', async () => {
    const team = bridge.getTeamState('plan-team')!;
    const coordinator = team.teammates[0];
    const worker = team.teammates[1];

    const plan = await bridge.submitPlan('plan-team', {
      description: 'Swarm plan',
      proposedBy: coordinator.id,
      steps: [
        { order: 1, action: 'Step 1', tools: ['Bash'] },
        { order: 2, action: 'Step 2', tools: ['Bash'] },
      ],
      requiredApprovals: 1,
    });

    await bridge.approvePlan('plan-team', plan.id, worker.id);

    const exitPlanInput = await bridge.launchSwarm('plan-team', plan.id);

    expect(exitPlanInput.launchSwarm).toBe(true);
    expect(exitPlanInput.teammateCount).toBe(2);
    expect(exitPlanInput.allowedPrompts).toHaveLength(2);
  });
});

// ============================================================================
// Delegation Tests
// ============================================================================

describe('Delegation', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
    await bridge.spawnTeam({ name: 'delegate-team' });
    await bridge.spawnTeammate({
      name: 'lead',
      role: 'coordinator',
      prompt: 'Lead',
      teamName: 'delegate-team',
    });
    await bridge.spawnTeammate({
      name: 'dev',
      role: 'coder',
      prompt: 'Code',
      teamName: 'delegate-team',
    });
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should delegate authority to teammate', async () => {
    const team = bridge.getTeamState('delegate-team')!;
    const lead = team.teammates[0];
    const dev = team.teammates[1];

    const delegation = await bridge.delegateToTeammate(
      'delegate-team',
      lead.id,
      dev.id,
      ['approve_plan', 'spawn_teammate']
    );

    expect(delegation.fromId).toBe(lead.id);
    expect(delegation.toId).toBe(dev.id);
    expect(delegation.permissions).toContain('approve_plan');
    expect(delegation.active).toBe(true);
  });

  it('should update teammate delegated permissions', async () => {
    const team = bridge.getTeamState('delegate-team')!;
    const lead = team.teammates[0];
    const dev = team.teammates[1];

    await bridge.delegateToTeammate('delegate-team', lead.id, dev.id, ['write_code']);

    const updatedTeam = bridge.getTeamState('delegate-team')!;
    const updatedDev = updatedTeam.teammates.find(t => t.id === dev.id);

    expect(updatedDev?.delegatedPermissions).toContain('write_code');
    expect(updatedDev?.delegatedFrom).toBe(lead.id);
  });

  it('should revoke delegation', async () => {
    const team = bridge.getTeamState('delegate-team')!;
    const lead = team.teammates[0];
    const dev = team.teammates[1];

    await bridge.delegateToTeammate('delegate-team', lead.id, dev.id, ['review']);
    await bridge.revokeDelegation('delegate-team', lead.id, dev.id);

    const updatedTeam = bridge.getTeamState('delegate-team')!;
    const delegation = updatedTeam.delegations.find(
      d => d.fromId === lead.id && d.toId === dev.id
    );

    expect(delegation?.active).toBe(false);
  });
});

// ============================================================================
// Team Context Tests
// ============================================================================

describe('Team Context', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
    await bridge.spawnTeam({ name: 'context-team' });
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should update shared variables', async () => {
    const context = await bridge.updateTeamContext('context-team', {
      sharedVariables: { apiKey: 'test-key', version: '1.0.0' },
    });

    expect(context.sharedVariables.apiKey).toBe('test-key');
    expect(context.sharedVariables.version).toBe('1.0.0');
  });

  it('should update inherited permissions', async () => {
    await bridge.updateTeamContext('context-team', {
      inheritedPermissions: ['read', 'write'],
    });

    const context = bridge.getTeamContext('context-team');

    expect(context.inheritedPermissions).toContain('read');
    expect(context.inheritedPermissions).toContain('write');
  });

  it('should update working directory', async () => {
    await bridge.updateTeamContext('context-team', {
      workingDirectory: '/tmp/test-dir',
    });

    const context = bridge.getTeamContext('context-team');

    expect(context.workingDirectory).toBe('/tmp/test-dir');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should throw TeammateError for non-existent team', async () => {
    await expect(
      bridge.sendMessage('nonexistent', 'a', 'b', { type: 'task', payload: {} })
    ).rejects.toThrow(TeammateError);
  });

  it('should include error code in TeammateError', async () => {
    try {
      await bridge.sendMessage('nonexistent', 'a', 'b', { type: 'task', payload: {} });
    } catch (error) {
      expect(error).toBeInstanceOf(TeammateError);
      expect((error as TeammateError).code).toBe(TeammateErrorCode.TEAM_NOT_FOUND);
    }
  });

  it('should throw for unapproved plan launch', async () => {
    await bridge.spawnTeam({ name: 'error-team' });
    await bridge.spawnTeammate({
      name: 'test',
      role: 'coder',
      prompt: 'test',
      teamName: 'error-team',
    });

    const team = bridge.getTeamState('error-team')!;
    const plan = await bridge.submitPlan('error-team', {
      description: 'Test',
      proposedBy: team.teammates[0].id,
      steps: [{ order: 1, action: 'Test', tools: [] }],
      requiredApprovals: 1,
    });

    await expect(bridge.launchSwarm('error-team', plan.id)).rejects.toThrow(
      'not approved'
    );
  });
});

// ============================================================================
// Cleanup Tests
// ============================================================================

describe('Cleanup', () => {
  let bridge: TeammateBridge;

  beforeEach(async () => {
    cleanupTestDir();
    bridge = new TeammateBridge();
    await bridge.initialize();
    await bridge.spawnTeam({ name: 'cleanup-team' });
  });

  afterEach(async () => {
    cleanupTestDir();
  });

  it('should cleanup team resources', async () => {
    await bridge.cleanup('cleanup-team');

    expect(bridge.getTeamState('cleanup-team')).toBeUndefined();
  });

  it('should clear environment variable on cleanup', async () => {
    process.env.CLAUDE_CODE_TEAM_NAME = 'cleanup-team';

    await bridge.cleanup('cleanup-team');

    expect(process.env.CLAUDE_CODE_TEAM_NAME).toBeUndefined();
  });

  it('should emit cleanup event', async () => {
    const eventSpy = vi.fn();
    bridge.on('team:cleanup', eventSpy);

    await bridge.cleanup('cleanup-team');

    expect(eventSpy).toHaveBeenCalledWith({ team: 'cleanup-team' });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createTeammateBridge', () => {
  beforeEach(() => {
    cleanupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should create and initialize bridge', async () => {
    const bridge = await createTeammateBridge();

    expect(bridge).toBeInstanceOf(TeammateBridge);
    expect(bridge.isAvailable()).toBe(true);
  });

  it('should accept custom config', async () => {
    const bridge = await createTeammateBridge({
      fallbackToMCP: false,
      mailbox: {
        pollingIntervalMs: 500,
        maxMessages: 500,
        retentionMs: 1800000,
      },
    });

    expect(bridge).toBeInstanceOf(TeammateBridge);
  });
});
