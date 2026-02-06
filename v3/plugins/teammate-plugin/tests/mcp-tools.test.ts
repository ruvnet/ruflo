import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TeammateBridge } from '../src/teammate-bridge.js';
import { handleMCPTool, TEAMMATE_MCP_TOOLS } from '../src/mcp-tools.js';

describe('MCP tools - teammate_spawn', () => {
  let spawnTeammate: ReturnType<typeof vi.fn>;
  let buildAgentInput: ReturnType<typeof vi.fn>;
  let bridge: TeammateBridge;

  beforeEach(() => {
    spawnTeammate = vi.fn().mockResolvedValue({
      id: 'teammate-1',
      name: 'dev-1',
      role: 'coder',
      status: 'active',
      spawnedAt: new Date(),
      messagesSent: 0,
      messagesReceived: 0,
    });

    buildAgentInput = vi.fn((config: { runInBackground?: boolean; name: string; role: string; prompt: string }) => ({
      description: `${config.role}: ${config.name}`,
      prompt: config.prompt,
      subagent_type: config.role,
      run_in_background: config.runInBackground ?? false,
    }));

    bridge = {
      spawnTeammate,
      buildAgentInput,
    } as unknown as TeammateBridge;
  });

  it('should default runInBackground=false when omitted', async () => {
    const result = await handleMCPTool(bridge, 'teammate_spawn', {
      teamName: 'team-1',
      name: 'dev-1',
      role: 'coder',
      prompt: 'Implement the feature',
    });

    expect(result.success).toBe(true);
    expect(spawnTeammate).toHaveBeenCalledWith(
      expect.objectContaining({
        runInBackground: false,
      })
    );
    expect((result.data as any).agentInput.run_in_background).toBe(false);
  });

  it('should pass runInBackground=true when explicitly requested', async () => {
    const result = await handleMCPTool(bridge, 'teammate_spawn', {
      teamName: 'team-1',
      name: 'dev-1',
      role: 'coder',
      prompt: 'Implement the feature',
      runInBackground: true,
    });

    expect(result.success).toBe(true);
    expect(spawnTeammate).toHaveBeenCalledWith(
      expect.objectContaining({
        runInBackground: true,
      })
    );
    expect((result.data as any).agentInput.run_in_background).toBe(true);
  });

  it('should expose runInBackground in teammate_spawn schema', () => {
    const teammateSpawnTool = TEAMMATE_MCP_TOOLS.find((tool) => tool.name === 'teammate_spawn');
    expect(teammateSpawnTool).toBeDefined();
    expect((teammateSpawnTool?.inputSchema.properties as any).runInBackground).toEqual(
      expect.objectContaining({
        type: 'boolean',
      })
    );
  });
});
