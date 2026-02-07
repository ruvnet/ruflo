/**
 * MCP Tools for TeammateTool Integration
 *
 * Exposes 21 MCP tools for multi-agent orchestration via Claude Code:
 * - 16 core TeammateTool integration tools
 * - 5 BMSSP optimization tools (10-15x faster with WASM)
 *
 * @module @claude-flow/teammate-plugin/mcp
 * @version 1.0.0-alpha.1
 */

import type { TeammateBridge } from './teammate-bridge.js';
import type {
  TeamConfig,
  TeammateSpawnConfig,
  TeamPlan,
  PlanStep,
  TeleportTarget,
  MessageType,
} from './types.js';

import { MCP_PARAM_LIMITS } from './types.js';

// Use centralized security constants from types.ts
const { MAX_PARAM_LENGTH, MAX_ARRAY_ITEMS } = MCP_PARAM_LIMITS;

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate string parameter
 */
function validateStringParam(value: unknown, name: string, maxLength: number = MAX_PARAM_LENGTH): string {
  if (typeof value !== 'string') {
    throw new Error(`Parameter '${name}' must be a string`);
  }
  if (value.length > maxLength) {
    throw new Error(`Parameter '${name}' exceeds maximum length of ${maxLength}`);
  }
  return value;
}

/**
 * Validate array parameter
 */
function validateArrayParam<T>(value: unknown, name: string, maxItems: number = MAX_ARRAY_ITEMS): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Parameter '${name}' must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`Parameter '${name}' exceeds maximum of ${maxItems} items`);
  }
  return value as T[];
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TEAMMATE_MCP_TOOLS: MCPTool[] = [
  // ==========================================================================
  // Team Management Tools
  // ==========================================================================
  {
    name: 'teammate_spawn_team',
    description:
      'Create a new team for multi-agent collaboration using native TeammateTool. ' +
      'Requires Claude Code >= 2.1.19.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique team name',
        },
        topology: {
          type: 'string',
          enum: ['flat', 'hierarchical', 'mesh'],
          description: 'Team topology (default: hierarchical)',
        },
        maxTeammates: {
          type: 'number',
          description: 'Maximum number of teammates (default: 8)',
        },
        planModeRequired: {
          type: 'boolean',
          description: 'Require plan approval before execution',
        },
        autoApproveJoin: {
          type: 'boolean',
          description: 'Auto-approve join requests (default: true)',
        },
        delegationEnabled: {
          type: 'boolean',
          description: 'Allow authority delegation (default: true)',
        },
      },
      required: ['name'],
    },
  },

  {
    name: 'teammate_discover_teams',
    description: 'Discover existing teams in ~/.claude/teams/',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'teammate_spawn',
    description:
      'Spawn a new teammate in a team. Returns AgentInput for Claude Code Task tool.',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: {
          type: 'string',
          description: 'Team to join',
        },
        name: {
          type: 'string',
          description: 'Teammate name',
        },
        role: {
          type: 'string',
          description: 'Teammate role (coder, tester, reviewer, etc.)',
        },
        prompt: {
          type: 'string',
          description: 'Task prompt for the teammate',
        },
        model: {
          type: 'string',
          enum: ['sonnet', 'opus', 'haiku'],
          description: 'Model to use',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tools to grant (e.g., ["Edit", "Write", "Bash"])',
        },
        mode: {
          type: 'string',
          enum: ['acceptEdits', 'bypassPermissions', 'default', 'delegate', 'dontAsk', 'plan'],
          description: 'Permission mode',
        },
        delegateAuthority: {
          type: 'boolean',
          description: 'Can this teammate delegate to others',
        },
        runInBackground: {
          type: 'boolean',
          description: 'Run teammate task in background (default: false)',
        },
      },
      required: ['teamName', 'name', 'role', 'prompt'],
    },
  },

  // ==========================================================================
  // Messaging Tools
  // ==========================================================================
  {
    name: 'teammate_send_message',
    description: 'Send a message to a specific teammate',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        fromId: { type: 'string', description: 'Sender teammate ID' },
        toId: { type: 'string', description: 'Recipient teammate ID' },
        type: {
          type: 'string',
          enum: ['task', 'result', 'status', 'plan', 'approval', 'delegation', 'context_update'],
          description: 'Message type',
        },
        payload: { description: 'Message payload (any JSON)' },
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'normal', 'low'],
          description: 'Message priority',
        },
      },
      required: ['teamName', 'fromId', 'toId', 'type', 'payload'],
    },
  },

  {
    name: 'teammate_broadcast',
    description: 'Broadcast message to all teammates in a team',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        fromId: { type: 'string', description: 'Sender teammate ID' },
        type: {
          type: 'string',
          enum: ['task', 'result', 'status', 'plan', 'approval', 'delegation', 'context_update'],
          description: 'Message type',
        },
        payload: { description: 'Message payload (any JSON)' },
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'normal', 'low'],
          description: 'Message priority',
        },
      },
      required: ['teamName', 'fromId', 'type', 'payload'],
    },
  },

  // ==========================================================================
  // Plan Management Tools
  // ==========================================================================
  {
    name: 'teammate_submit_plan',
    description: 'Submit a plan for team approval',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        description: { type: 'string', description: 'Plan description' },
        proposedBy: { type: 'string', description: 'Proposer teammate ID' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              order: { type: 'number' },
              action: { type: 'string' },
              assignee: { type: 'string' },
              tools: { type: 'array', items: { type: 'string' } },
              estimatedDuration: { type: 'number' },
            },
            required: ['order', 'action'],
          },
          description: 'Plan steps',
        },
        requiredApprovals: {
          type: 'number',
          description: 'Number of approvals needed (default: majority)',
        },
      },
      required: ['teamName', 'description', 'proposedBy', 'steps'],
    },
  },

  {
    name: 'teammate_approve_plan',
    description: 'Approve a submitted plan',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        planId: { type: 'string' },
        approverId: { type: 'string' },
      },
      required: ['teamName', 'planId', 'approverId'],
    },
  },

  {
    name: 'teammate_launch_swarm',
    description: 'Launch swarm to execute an approved plan',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        planId: { type: 'string' },
        teammateCount: {
          type: 'number',
          description: 'Number of teammates to spawn (default: number of steps)',
        },
      },
      required: ['teamName', 'planId'],
    },
  },

  // ==========================================================================
  // Delegation Tools
  // ==========================================================================
  {
    name: 'teammate_delegate',
    description: 'Delegate authority/permissions to another teammate',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        fromId: { type: 'string', description: 'Delegator teammate ID' },
        toId: { type: 'string', description: 'Recipient teammate ID' },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Permissions to delegate (e.g., ["approve_plan", "spawn_teammate"])',
        },
      },
      required: ['teamName', 'fromId', 'toId', 'permissions'],
    },
  },

  // ==========================================================================
  // Context & Memory Tools
  // ==========================================================================
  {
    name: 'teammate_update_context',
    description: 'Update team shared context',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        sharedVariables: {
          type: 'object',
          description: 'Variables to add/update',
        },
        inheritedPermissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Permissions for new teammates',
        },
        workingDirectory: { type: 'string' },
        environmentVariables: {
          type: 'object',
          description: 'Environment variables',
        },
      },
      required: ['teamName'],
    },
  },

  {
    name: 'teammate_save_memory',
    description: 'Save teammate session memory to disk',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        teammateId: { type: 'string' },
      },
      required: ['teamName', 'teammateId'],
    },
  },

  {
    name: 'teammate_share_transcript',
    description: 'Share message transcript with another teammate',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        fromId: { type: 'string', description: 'Source teammate ID' },
        toId: { type: 'string', description: 'Target teammate ID' },
        start: { type: 'number', description: 'Start message index' },
        end: { type: 'number', description: 'End message index' },
      },
      required: ['teamName', 'fromId', 'toId'],
    },
  },

  // ==========================================================================
  // Remote & Teleport Tools
  // ==========================================================================
  {
    name: 'teammate_push_remote',
    description: 'Push team to Claude.ai remote session',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
      },
      required: ['teamName'],
    },
  },

  {
    name: 'teammate_teleport',
    description: 'Teleport team to a new context/working directory',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
        workingDirectory: { type: 'string' },
        gitRepo: { type: 'string' },
        gitBranch: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['teamName'],
    },
  },

  // ==========================================================================
  // Status & Cleanup Tools
  // ==========================================================================
  {
    name: 'teammate_get_status',
    description: 'Get team and teammate status',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
      },
      required: ['teamName'],
    },
  },

  {
    name: 'teammate_cleanup',
    description: 'Cleanup team resources and save state',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string' },
      },
      required: ['teamName'],
    },
  },

  // ==========================================================================
  // BMSSP Optimization Tools (10-15x faster with WASM)
  // ==========================================================================
  {
    name: 'teammate_enable_optimizers',
    description:
      'Enable BMSSP-powered optimization for team topology and task routing. ' +
      'Uses WebAssembly for 10-15x faster pathfinding and semantic matching.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'teammate_find_optimal_path',
    description:
      'Find optimal message routing path between two teammates using BMSSP graph algorithms.',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        fromId: { type: 'string', description: 'Source teammate ID' },
        toId: { type: 'string', description: 'Target teammate ID' },
      },
      required: ['teamName', 'fromId', 'toId'],
    },
  },

  {
    name: 'teammate_get_topology_stats',
    description:
      'Get topology statistics and optimization suggestions for a team.',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        includeOptimizations: {
          type: 'boolean',
          description: 'Include optimization suggestions (default: true)',
        },
      },
      required: ['teamName'],
    },
  },

  {
    name: 'teammate_route_task',
    description:
      'Route a task to the best-suited teammate using semantic matching ' +
      'based on skills, performance, and neural embeddings.',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        taskId: { type: 'string', description: 'Unique task ID' },
        description: { type: 'string', description: 'Task description' },
        requiredSkills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required skills (e.g., ["typescript", "testing"])',
        },
        priority: {
          type: 'string',
          enum: ['urgent', 'high', 'normal', 'low'],
          description: 'Task priority (default: normal)',
        },
      },
      required: ['teamName', 'taskId', 'description', 'requiredSkills'],
    },
  },

  {
    name: 'teammate_batch_route',
    description:
      'Route multiple tasks to teammates optimally, avoiding over-assignment.',
    inputSchema: {
      type: 'object',
      properties: {
        teamName: { type: 'string', description: 'Team name' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              description: { type: 'string' },
              requiredSkills: { type: 'array', items: { type: 'string' } },
              priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
            },
            required: ['id', 'description', 'requiredSkills'],
          },
          description: 'Tasks to route',
        },
      },
      required: ['teamName', 'tasks'],
    },
  },
];

// ============================================================================
// Tool Handler
// ============================================================================

export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

export async function handleMCPTool(
  bridge: TeammateBridge,
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  try {
    // Security: Validate tool name
    if (typeof toolName !== 'string' || toolName.length > 100) {
      return { success: false, error: 'Invalid tool name' };
    }

    switch (toolName) {
      // Team Management
      case 'teammate_spawn_team': {
        // Security: Validate required parameters
        const name = validateStringParam(params.name, 'name', 64);
        const config: Partial<TeamConfig> & { name: string } = {
          name,
          topology: (params.topology as TeamConfig['topology']) ?? 'hierarchical',
          maxTeammates: (params.maxTeammates as number) ?? 8,
          planModeRequired: (params.planModeRequired as boolean) ?? false,
          autoApproveJoin: (params.autoApproveJoin as boolean) ?? true,
          delegationEnabled: (params.delegationEnabled as boolean) ?? true,
        };
        const teamState = await bridge.spawnTeam(config);
        return { success: true, data: teamState };
      }

      case 'teammate_discover_teams': {
        const teams = await bridge.discoverTeams();
        return { success: true, data: { teams } };
      }

      case 'teammate_spawn': {
        // Security: Validate required parameters
        const name = validateStringParam(params.name, 'name', 64);
        const role = validateStringParam(params.role, 'role', 64);
        const prompt = validateStringParam(params.prompt, 'prompt', MAX_PARAM_LENGTH);
        const teamName = validateStringParam(params.teamName, 'teamName', 64);
        const allowedTools = params.allowedTools
          ? validateArrayParam<string>(params.allowedTools, 'allowedTools', 50)
          : undefined;

        const spawnConfig: TeammateSpawnConfig = {
          name,
          role,
          prompt,
          teamName,
          model: params.model as TeammateSpawnConfig['model'],
          allowedTools,
          mode: params.mode as TeammateSpawnConfig['mode'],
          delegateAuthority: params.delegateAuthority as boolean,
          runInBackground:
            typeof params.runInBackground === 'boolean' ? params.runInBackground : false,
        };
        const teammate = await bridge.spawnTeammate(spawnConfig);
        const agentInput = bridge.buildAgentInput(spawnConfig);
        return {
          success: true,
          data: {
            teammate,
            agentInput,
            instruction: 'Pass agentInput to Claude Code Task tool to spawn the teammate',
          },
        };
      }

      // Messaging
      case 'teammate_send_message': {
        const message = await bridge.sendMessage(
          params.teamName as string,
          params.fromId as string,
          params.toId as string,
          {
            type: params.type as MessageType,
            payload: params.payload,
            priority: params.priority as any,
          }
        );
        return { success: true, data: { message } };
      }

      case 'teammate_broadcast': {
        const message = await bridge.broadcast(
          params.teamName as string,
          params.fromId as string,
          {
            type: params.type as MessageType,
            payload: params.payload,
            priority: params.priority as any,
          }
        );
        return { success: true, data: { message } };
      }

      // Plan Management
      case 'teammate_submit_plan': {
        const team = bridge.getTeamState(params.teamName as string);
        const requiredApprovals = (params.requiredApprovals as number) ??
          Math.ceil((team?.teammates.length ?? 1) / 2);

        const plan = await bridge.submitPlan(params.teamName as string, {
          description: params.description as string,
          proposedBy: params.proposedBy as string,
          steps: params.steps as PlanStep[],
          requiredApprovals,
        });
        return { success: true, data: { plan } };
      }

      case 'teammate_approve_plan': {
        await bridge.approvePlan(
          params.teamName as string,
          params.planId as string,
          params.approverId as string
        );
        const team = bridge.getTeamState(params.teamName as string);
        const plan = team?.activePlans.find(p => p.id === params.planId);
        return { success: true, data: { plan } };
      }

      case 'teammate_launch_swarm': {
        const exitPlanInput = await bridge.launchSwarm(
          params.teamName as string,
          params.planId as string,
          params.teammateCount as number
        );
        return {
          success: true,
          data: {
            exitPlanInput,
            instruction: 'Use exitPlanInput with ExitPlanMode tool to launch the swarm',
          },
        };
      }

      // Delegation
      case 'teammate_delegate': {
        const delegation = await bridge.delegateToTeammate(
          params.teamName as string,
          params.fromId as string,
          params.toId as string,
          params.permissions as string[]
        );
        return { success: true, data: { delegation } };
      }

      // Context & Memory
      case 'teammate_update_context': {
        const context = await bridge.updateTeamContext(params.teamName as string, {
          sharedVariables: params.sharedVariables as Record<string, unknown>,
          inheritedPermissions: params.inheritedPermissions as string[],
          workingDirectory: params.workingDirectory as string,
          environmentVariables: params.environmentVariables as Record<string, string>,
        });
        return { success: true, data: { context } };
      }

      case 'teammate_save_memory': {
        await bridge.saveTeammateMemory(
          params.teamName as string,
          params.teammateId as string
        );
        return { success: true, data: { saved: true } };
      }

      case 'teammate_share_transcript': {
        await bridge.shareTranscript(
          params.teamName as string,
          params.fromId as string,
          params.toId as string,
          {
            start: params.start as number,
            end: params.end as number,
          }
        );
        return { success: true, data: { shared: true } };
      }

      // Remote & Teleport
      case 'teammate_push_remote': {
        const remoteSession = await bridge.pushTeamToRemote(params.teamName as string);
        return { success: true, data: { remoteSession } };
      }

      case 'teammate_teleport': {
        const target: TeleportTarget = {
          workingDirectory: params.workingDirectory as string,
          gitRepo: params.gitRepo as string,
          gitBranch: params.gitBranch as string,
          sessionId: params.sessionId as string,
        };
        const result = await bridge.teleportTeam(params.teamName as string, target);
        return { success: result.success, data: result };
      }

      // Status & Cleanup
      case 'teammate_get_status': {
        const teamState = bridge.getTeamState(params.teamName as string);
        if (!teamState) {
          return { success: false, error: `Team not found: ${params.teamName}` };
        }
        const backendStatus = await bridge.getBackendStatus();
        return {
          success: true,
          data: {
            team: teamState,
            backends: backendStatus,
            version: bridge.getVersionInfo(),
          },
        };
      }

      case 'teammate_cleanup': {
        await bridge.cleanup(params.teamName as string);
        return { success: true, data: { cleaned: true } };
      }

      // BMSSP Optimization Tools
      case 'teammate_enable_optimizers': {
        const wasmAvailable = await bridge.enableOptimizers();
        return {
          success: true,
          data: {
            enabled: true,
            wasmAccelerated: wasmAvailable,
            message: wasmAvailable
              ? 'BMSSP WASM optimization enabled (10-15x faster)'
              : 'Optimization enabled with JavaScript fallback',
          },
        };
      }

      case 'teammate_find_optimal_path': {
        if (!bridge.areOptimizersEnabled()) {
          return {
            success: false,
            error: 'Optimizers not enabled. Call teammate_enable_optimizers first.',
          };
        }

        const teamName = validateStringParam(params.teamName, 'teamName', 64);
        const fromId = validateStringParam(params.fromId, 'fromId', 64);
        const toId = validateStringParam(params.toId, 'toId', 64);

        const pathResult = await bridge.findOptimalPath(teamName, fromId, toId);
        if (!pathResult) {
          return { success: false, error: 'No path found between teammates' };
        }

        return { success: true, data: { path: pathResult } };
      }

      case 'teammate_get_topology_stats': {
        const teamName = validateStringParam(params.teamName, 'teamName', 64);
        const includeOptimizations = params.includeOptimizations !== false;

        const stats = bridge.getTopologyStats(teamName);
        if (!stats) {
          return {
            success: false,
            error: bridge.areOptimizersEnabled()
              ? `Team not found: ${teamName}`
              : 'Optimizers not enabled. Call teammate_enable_optimizers first.',
          };
        }

        const result: Record<string, unknown> = { stats };

        if (includeOptimizations) {
          const optimizations = bridge.getTopologyOptimizations(teamName);
          if (optimizations) {
            result.optimizations = optimizations;
          }
        }

        return { success: true, data: result };
      }

      case 'teammate_route_task': {
        if (!bridge.areOptimizersEnabled()) {
          return {
            success: false,
            error: 'Optimizers not enabled. Call teammate_enable_optimizers first.',
          };
        }

        const teamName = validateStringParam(params.teamName, 'teamName', 64);
        const taskId = validateStringParam(params.taskId, 'taskId', 64);
        const description = validateStringParam(params.description, 'description', MAX_PARAM_LENGTH);
        const requiredSkills = validateArrayParam<string>(params.requiredSkills, 'requiredSkills', 20);

        const decision = await bridge.findBestTeammateForTask(teamName, {
          id: taskId,
          description,
          requiredSkills,
          priority: (params.priority as 'urgent' | 'high' | 'normal' | 'low') ?? 'normal',
        });

        if (!decision) {
          return { success: false, error: 'Could not determine routing decision' };
        }

        return {
          success: true,
          data: {
            decision,
            selectedTeammate: decision.selectedTeammate,
            alternates: decision.alternates,
            instruction: decision.selectedTeammate
              ? `Route task to teammate "${decision.selectedTeammate}"`
              : 'No suitable teammate found with sufficient confidence',
          },
        };
      }

      case 'teammate_batch_route': {
        if (!bridge.areOptimizersEnabled()) {
          return {
            success: false,
            error: 'Optimizers not enabled. Call teammate_enable_optimizers first.',
          };
        }

        const teamName = validateStringParam(params.teamName, 'teamName', 64);
        const tasks = validateArrayParam<{
          id: string;
          description: string;
          requiredSkills: string[];
          priority?: 'urgent' | 'high' | 'normal' | 'low';
        }>(params.tasks, 'tasks', 50);

        const decisions = await bridge.batchRouteTasksToTeammates(teamName, tasks);

        // Convert Map to object for JSON serialization
        const results: Record<string, unknown> = {};
        for (const [taskId, decision] of decisions) {
          results[taskId] = {
            selectedTeammate: decision.selectedTeammate,
            confidence: decision.matches[0]?.confidence ?? 0,
            alternates: decision.alternates,
          };
        }

        return {
          success: true,
          data: {
            routingResults: results,
            tasksRouted: decisions.size,
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Tool Registration Helper
// ============================================================================

export function listTeammateTools(): MCPTool[] {
  return TEAMMATE_MCP_TOOLS;
}

export function hasTeammateTool(name: string): boolean {
  return TEAMMATE_MCP_TOOLS.some(t => t.name === name);
}

export default {
  tools: TEAMMATE_MCP_TOOLS,
  handleTool: handleMCPTool,
  listTools: listTeammateTools,
  hasTool: hasTeammateTool,
};
