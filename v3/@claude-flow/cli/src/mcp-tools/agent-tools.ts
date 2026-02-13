/**
 * Agent MCP Tools for CLI
 *
 * Tool definitions for agent lifecycle management with file persistence.
 * Includes model routing integration for intelligent model selection.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MCPTool } from './types.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const AGENT_DIR = 'agents';
const AGENT_FILE = 'store.json';

// Model types matching Claude Agent SDK
type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';

// Model tier for ClawRouter-inspired routing
type ModelTier = 'fast' | 'balanced' | 'capable';

interface AgentRecord {
  agentId: string;
  agentType: string;
  status: 'idle' | 'busy' | 'terminated';
  health: number;
  taskCount: number;
  config: Record<string, unknown>;
  createdAt: string;
  domain?: string;
  model?: ClaudeModel;  // Model assigned to this agent
  modelRoutedBy?: 'explicit' | 'router' | 'agent-booster' | 'default';  // How model was determined (ADR-026)
  modelTier?: ModelTier;  // Tier classification for cost tracking
  costEstimate?: AgentCostEstimate;  // Estimated cost for this agent's work
}

interface AgentCostEstimate {
  tier: ModelTier;
  costPerRequestUsd: number;
  totalRequests: number;
  totalCostUsd: number;
  savedVsOpusUsd: number;
}

interface AgentStore {
  agents: Record<string, AgentRecord>;
  version: string;
  costTracking?: SwarmCostTracking;
}

interface SwarmCostTracking {
  sessionStart: string;
  totalCostUsd: number;
  totalSavedVsAllOpusUsd: number;
  byModel: Record<string, { requests: number; costUsd: number }>;
  byAgentType: Record<string, { requests: number; costUsd: number; model: string }>;
}

function getAgentDir(): string {
  return join(process.cwd(), STORAGE_DIR, AGENT_DIR);
}

function getAgentPath(): string {
  return join(getAgentDir(), AGENT_FILE);
}

function ensureAgentDir(): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadAgentStore(): AgentStore {
  try {
    const path = getAgentPath();
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return empty store on error
  }
  return { agents: {}, version: '3.0.0' };
}

function saveAgentStore(store: AgentStore): void {
  ensureAgentDir();
  writeFileSync(getAgentPath(), JSON.stringify(store, null, 2), 'utf-8');
}

// Estimated cost per request by model (USD, approximate for typical agent tasks)
const MODEL_COST_PER_REQUEST: Record<ClaudeModel, number> = {
  haiku: 0.0003,    // ~$0.25/MTok input, ~$1.25/MTok output
  sonnet: 0.003,    // ~$3/MTok input, ~$15/MTok output
  opus: 0.015,      // ~$15/MTok input, ~$75/MTok output
  inherit: 0.003,   // Default to sonnet estimate
};

// Default model mappings for agent types (ClawRouter-inspired tier routing)
// Tier mapping: haiku=fast/cheap, sonnet=balanced, opus=capable/expensive
const AGENT_TYPE_MODEL_DEFAULTS: Record<string, ClaudeModel> = {
  // --- Capable tier (opus) — deep reasoning, architecture, security ---
  'architect': 'opus',
  'security-architect': 'opus',
  'system-architect': 'opus',
  'core-architect': 'opus',
  'integration-architect': 'opus',
  'security': 'opus',
  'planner': 'opus',
  'reviewer': 'opus',           // Upgraded: reviews need deep reasoning

  // --- Balanced tier (sonnet) — code gen, testing, analysis ---
  'coder': 'sonnet',
  'tester': 'sonnet',
  'analyst': 'sonnet',
  'researcher': 'sonnet',
  'optimizer': 'sonnet',
  'performance': 'sonnet',
  'devops': 'sonnet',
  'specialist': 'sonnet',
  'worker': 'sonnet',

  // --- Fast tier (haiku) — coordination, monitoring, simple tasks ---
  'coordinator': 'haiku',
  'queen': 'haiku',             // Dispatching, not reasoning
  'monitor': 'haiku',
  'formatter': 'haiku',
  'linter': 'haiku',
  'documenter': 'haiku',
};

// Model tier classification
const MODEL_TO_TIER: Record<ClaudeModel, ModelTier> = {
  haiku: 'fast',
  sonnet: 'balanced',
  opus: 'capable',
  inherit: 'balanced',
};

// Fallback chains: if a model fails or hits context limits, escalate
// Inspired by ClawRouter's fallback chain pattern
const MODEL_FALLBACK_CHAINS: Record<ClaudeModel, ClaudeModel[]> = {
  haiku: ['haiku', 'sonnet', 'opus'],   // Fast → balanced → capable
  sonnet: ['sonnet', 'opus'],            // Balanced → capable
  opus: ['opus'],                         // Already at max capability
  inherit: ['sonnet', 'opus'],           // Default chain
};

// Lazy-loaded model router
let modelRouterInstance: Awaited<ReturnType<typeof import('../ruvector/model-router.js').getModelRouter>> | null = null;

async function getModelRouter() {
  if (!modelRouterInstance) {
    try {
      const { getModelRouter } = await import('../ruvector/model-router.js');
      modelRouterInstance = getModelRouter();
    } catch (e) {
      // Log but don't fail - model router is optional
      console.error('[agent-tools] Model router load failed:', (e as Error).message);
    }
  }
  return modelRouterInstance;
}

/**
 * Determine model for agent based on (ADR-026 3-tier routing + ClawRouter-inspired enhancements):
 * 1. Explicit model in config
 * 2. Enhanced task-based routing with Agent Booster AST (if task provided)
 * 3. Agent type defaults (expanded with full type coverage)
 * 4. Fallback to sonnet (balanced)
 *
 * Returns model selection with tier classification, cost estimate, and fallback chain.
 */
async function determineAgentModel(
  agentType: string,
  config: Record<string, unknown>,
  task?: string
): Promise<{
  model: ClaudeModel;
  routedBy: 'explicit' | 'router' | 'agent-booster' | 'default';
  canSkipLLM?: boolean;
  agentBoosterIntent?: string;
  tier?: 1 | 2 | 3;
  modelTier: ModelTier;
  fallbackChain: ClaudeModel[];
  costEstimate: AgentCostEstimate;
}> {
  let model: ClaudeModel;
  let routedBy: 'explicit' | 'router' | 'agent-booster' | 'default';
  let canSkipLLM: boolean | undefined;
  let agentBoosterIntent: string | undefined;
  let routingTier: 1 | 2 | 3 | undefined;

  // 1. Explicit model in config
  if (config.model && ['haiku', 'sonnet', 'opus', 'inherit'].includes(config.model as string)) {
    model = config.model as ClaudeModel;
    routedBy = 'explicit';
  }
  // 2. Enhanced task-based routing with Agent Booster AST
  else if (task) {
    let routed = false;
    try {
      const { getEnhancedModelRouter } = await import('../ruvector/enhanced-model-router.js');
      const enhancedRouter = getEnhancedModelRouter();
      const routeResult = await enhancedRouter.route(task, { filePath: config.filePath as string });

      if (routeResult.tier === 1 && routeResult.canSkipLLM) {
        model = 'haiku';
        routedBy = 'agent-booster';
        canSkipLLM = true;
        agentBoosterIntent = routeResult.agentBoosterIntent?.type;
        routingTier = 1;
        routed = true;
      } else {
        model = routeResult.model!;
        routedBy = 'router';
        routingTier = routeResult.tier;
        routed = true;
      }
    } catch {
      // Enhanced router not available, try basic router
      const router = await getModelRouter();
      if (router) {
        try {
          const result = await router.route(task);
          model = result.model;
          routedBy = 'router';
          routed = true;
        } catch {
          // Fall through to defaults
        }
      }
    }
    if (!routed) {
      model = AGENT_TYPE_MODEL_DEFAULTS[agentType] || 'sonnet';
      routedBy = 'default';
    }
  }
  // 3. Agent type defaults
  else {
    model = AGENT_TYPE_MODEL_DEFAULTS[agentType] || 'sonnet';
    routedBy = 'default';
  }

  // Compute tier, fallback chain, and cost estimate
  const modelTier = MODEL_TO_TIER[model!] || 'balanced';
  const fallbackChain = MODEL_FALLBACK_CHAINS[model!] || ['sonnet', 'opus'];
  const costPerRequest = MODEL_COST_PER_REQUEST[model!] || MODEL_COST_PER_REQUEST.sonnet;
  const opusCostPerRequest = MODEL_COST_PER_REQUEST.opus;

  const costEstimate: AgentCostEstimate = {
    tier: modelTier,
    costPerRequestUsd: costPerRequest,
    totalRequests: 0,
    totalCostUsd: 0,
    savedVsOpusUsd: opusCostPerRequest - costPerRequest,
  };

  return {
    model: model!,
    routedBy,
    canSkipLLM,
    agentBoosterIntent,
    tier: routingTier,
    modelTier,
    fallbackChain,
    costEstimate,
  };
}

export const agentTools: MCPTool[] = [
  {
    name: 'agent_spawn',
    description: 'Spawn a new agent with intelligent model selection',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: { type: 'string', description: 'Type of agent to spawn' },
        agentId: { type: 'string', description: 'Optional custom agent ID' },
        config: { type: 'object', description: 'Agent configuration' },
        domain: { type: 'string', description: 'Agent domain' },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus', 'inherit'],
          description: 'Claude model to use (haiku=fast/cheap, sonnet=balanced, opus=most capable)'
        },
        task: { type: 'string', description: 'Task description for intelligent model routing' },
      },
      required: ['agentType'],
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agentId = (input.agentId as string) || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const agentType = input.agentType as string;
      const config = (input.config as Record<string, unknown>) || {};

      // Add explicit model to config if provided
      if (input.model) {
        config.model = input.model;
      }

      // Get task from either top-level or config (CLI passes it in config.task)
      const task = (input.task as string) || (config.task as string) || undefined;

      // Determine model using ADR-026 3-tier routing logic
      const routingResult = await determineAgentModel(
        agentType,
        config,
        task
      );

      const agent: AgentRecord = {
        agentId,
        agentType,
        status: 'idle',
        health: 1.0,
        taskCount: 0,
        config,
        createdAt: new Date().toISOString(),
        domain: input.domain as string,
        model: routingResult.model,
        modelRoutedBy: routingResult.routedBy,
        modelTier: routingResult.modelTier,
        costEstimate: routingResult.costEstimate,
      };

      store.agents[agentId] = agent;

      // Initialize cost tracking if not present
      if (!store.costTracking) {
        store.costTracking = {
          sessionStart: new Date().toISOString(),
          totalCostUsd: 0,
          totalSavedVsAllOpusUsd: 0,
          byModel: {},
          byAgentType: {},
        };
      }

      // Track model usage in cost tracking
      const modelKey = routingResult.model;
      if (!store.costTracking.byModel[modelKey]) {
        store.costTracking.byModel[modelKey] = { requests: 0, costUsd: 0 };
      }
      if (!store.costTracking.byAgentType[agentType]) {
        store.costTracking.byAgentType[agentType] = { requests: 0, costUsd: 0, model: modelKey };
      }

      saveAgentStore(store);

      // Include Agent Booster routing info if applicable
      const response: Record<string, unknown> = {
        success: true,
        agentId,
        agentType: agent.agentType,
        model: agent.model,
        modelTier: routingResult.modelTier,
        modelRoutedBy: routingResult.routedBy,
        fallbackChain: routingResult.fallbackChain,
        costPerRequest: `$${routingResult.costEstimate.costPerRequestUsd.toFixed(4)}`,
        savingsVsOpus: `$${routingResult.costEstimate.savedVsOpusUsd.toFixed(4)}/req`,
        status: 'spawned',
        createdAt: agent.createdAt,
      };

      // Add Agent Booster info if task can skip LLM
      if (routingResult.canSkipLLM) {
        response.canSkipLLM = true;
        response.agentBoosterIntent = routingResult.agentBoosterIntent;
        response.tier = routingResult.tier;
        response.note = `Agent Booster can handle "${routingResult.agentBoosterIntent}" - use agent_booster_edit_file MCP tool`;
      } else if (routingResult.tier) {
        response.tier = routingResult.tier;
      }

      return response;
    },
  },
  {
    name: 'agent_terminate',
    description: 'Terminate an agent',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent to terminate' },
        force: { type: 'boolean', description: 'Force immediate termination' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agentId = input.agentId as string;

      if (store.agents[agentId]) {
        store.agents[agentId].status = 'terminated';
        saveAgentStore(store);
        return {
          success: true,
          agentId,
          terminated: true,
          terminatedAt: new Date().toISOString(),
        };
      }

      return {
        success: false,
        agentId,
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'agent_status',
    description: 'Get agent status',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agentId = input.agentId as string;
      const agent = store.agents[agentId];

      if (agent) {
        return {
          agentId: agent.agentId,
          agentType: agent.agentType,
          status: agent.status,
          health: agent.health,
          taskCount: agent.taskCount,
          createdAt: agent.createdAt,
          domain: agent.domain,
        };
      }

      return {
        agentId,
        status: 'not_found',
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'agent_list',
    description: 'List all agents',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        domain: { type: 'string', description: 'Filter by domain' },
        includeTerminated: { type: 'boolean', description: 'Include terminated agents' },
      },
    },
    handler: async (input) => {
      const store = loadAgentStore();
      let agents = Object.values(store.agents);

      // Filter by status
      if (input.status) {
        agents = agents.filter(a => a.status === input.status);
      } else if (!input.includeTerminated) {
        agents = agents.filter(a => a.status !== 'terminated');
      }

      // Filter by domain
      if (input.domain) {
        agents = agents.filter(a => a.domain === input.domain);
      }

      return {
        agents: agents.map(a => ({
          agentId: a.agentId,
          agentType: a.agentType,
          status: a.status,
          health: a.health,
          taskCount: a.taskCount,
          createdAt: a.createdAt,
          domain: a.domain,
        })),
        total: agents.length,
        filters: {
          status: input.status,
          domain: input.domain,
          includeTerminated: input.includeTerminated,
        },
      };
    },
  },
  {
    name: 'agent_pool',
    description: 'Manage agent pool',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'scale', 'drain', 'fill'], description: 'Pool action' },
        targetSize: { type: 'number', description: 'Target pool size (for scale action)' },
        agentType: { type: 'string', description: 'Agent type filter' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agents = Object.values(store.agents).filter(a => a.status !== 'terminated');
      const action = (input.action as string) || 'status';  // Default to status

      if (action === 'status') {
        const byType: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        for (const agent of agents) {
          byType[agent.agentType] = (byType[agent.agentType] || 0) + 1;
          byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
        }
        const idleAgents = agents.filter(a => a.status === 'idle').length;
        const busyAgents = agents.filter(a => a.status === 'busy').length;
        const utilization = agents.length > 0 ? busyAgents / agents.length : 0;
        return {
          action,
          // CLI expected fields
          poolId: 'agent-pool-default',
          currentSize: agents.length,
          minSize: (input.min as number) || 0,
          maxSize: (input.max as number) || 100,
          autoScale: (input.autoScale as boolean) ?? false,
          utilization,
          agents: agents.map(a => ({
            id: a.agentId,
            type: a.agentType,
            status: a.status,
          })),
          // Additional fields
          id: 'agent-pool-default',
          size: agents.length,
          totalAgents: agents.length,
          byType,
          byStatus,
          avgHealth: agents.length > 0 ? agents.reduce((sum, a) => sum + a.health, 0) / agents.length : 0,
        };
      }

      if (action === 'scale') {
        const targetSize = (input.targetSize as number) || 5;
        const agentType = (input.agentType as string) || 'worker';
        const currentSize = agents.filter(a => a.agentType === agentType).length;
        const delta = targetSize - currentSize;
        const added: string[] = [];
        const removed: string[] = [];

        if (delta > 0) {
          for (let i = 0; i < delta; i++) {
            const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            store.agents[agentId] = {
              agentId,
              agentType,
              status: 'idle',
              health: 1.0,
              taskCount: 0,
              config: {},
              createdAt: new Date().toISOString(),
            };
            added.push(agentId);
          }
        } else if (delta < 0) {
          const toRemove = agents.filter(a => a.agentType === agentType && a.status === 'idle').slice(0, -delta);
          for (const agent of toRemove) {
            store.agents[agent.agentId].status = 'terminated';
            removed.push(agent.agentId);
          }
        }

        saveAgentStore(store);
        return {
          action,
          agentType,
          previousSize: currentSize,
          targetSize,
          newSize: currentSize + delta,
          added,
          removed,
        };
      }

      if (action === 'drain') {
        const agentType = input.agentType as string;
        let drained = 0;
        for (const agent of agents) {
          if (!agentType || agent.agentType === agentType) {
            if (agent.status === 'idle') {
              store.agents[agent.agentId].status = 'terminated';
              drained++;
            }
          }
        }
        saveAgentStore(store);
        return {
          action,
          agentType: agentType || 'all',
          drained,
          remaining: agents.length - drained,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    name: 'agent_health',
    description: 'Check agent health',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Specific agent ID (optional)' },
        threshold: { type: 'number', description: 'Health threshold (0-1)' },
      },
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agents = Object.values(store.agents).filter(a => a.status !== 'terminated');
      const threshold = (input.threshold as number) || 0.5;

      if (input.agentId) {
        const agent = store.agents[input.agentId as string];
        if (agent) {
          return {
            agentId: agent.agentId,
            health: agent.health,
            status: agent.status,
            healthy: agent.health >= threshold,
            taskCount: agent.taskCount,
            uptime: Date.now() - new Date(agent.createdAt).getTime(),
          };
        }
        return { agentId: input.agentId, error: 'Agent not found' };
      }

      const healthyAgents = agents.filter(a => a.health >= threshold);
      const degradedAgents = agents.filter(a => a.health >= 0.3 && a.health < threshold);
      const unhealthyAgents = agents.filter(a => a.health < 0.3);
      const avgHealth = agents.length > 0 ? agents.reduce((sum, a) => sum + a.health, 0) / agents.length : 1;
      const avgCpu = agents.length > 0 ? 35 + Math.random() * 30 : 0; // Simulated CPU
      const avgMemory = avgHealth * 0.6; // Correlated with health

      return {
        // CLI expected fields
        agents: agents.map(a => {
          const uptime = Date.now() - new Date(a.createdAt).getTime();
          return {
            id: a.agentId,
            type: a.agentType,
            health: a.health >= threshold ? 'healthy' : (a.health >= 0.3 ? 'degraded' : 'unhealthy'),
            uptime,
            memory: { used: Math.floor(256 * (1 - a.health * 0.3)), limit: 512 },
            cpu: 20 + Math.floor(a.health * 40),
            tasks: { active: a.taskCount > 0 ? 1 : 0, queued: 0, completed: a.taskCount, failed: 0 },
            latency: { avg: 50 + Math.floor((1 - a.health) * 100), p99: 150 + Math.floor((1 - a.health) * 200) },
            errors: { count: a.health < threshold ? 1 : 0 },
          };
        }),
        overall: {
          healthy: healthyAgents.length,
          degraded: degradedAgents.length,
          unhealthy: unhealthyAgents.length,
          avgCpu,
          avgMemory,
          score: Math.round(avgHealth * 100),
          issues: unhealthyAgents.length,
        },
        // Additional fields
        total: agents.length,
        healthyCount: healthyAgents.length,
        unhealthyCount: unhealthyAgents.length,
        threshold,
        avgHealth,
        unhealthyAgents: unhealthyAgents.map(a => ({
          agentId: a.agentId,
          health: a.health,
          status: a.status,
        })),
      };
    },
  },
  {
    name: 'agent_update',
    description: 'Update agent status or config',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
        status: { type: 'string', description: 'New status' },
        health: { type: 'number', description: 'Health value (0-1)' },
        taskCount: { type: 'number', description: 'Task count' },
        config: { type: 'object', description: 'Config updates' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agentId = input.agentId as string;
      const agent = store.agents[agentId];

      if (agent) {
        if (input.status) agent.status = input.status as AgentRecord['status'];
        if (typeof input.health === 'number') agent.health = input.health as number;
        if (typeof input.taskCount === 'number') agent.taskCount = input.taskCount as number;
        if (input.config) {
          agent.config = { ...agent.config, ...(input.config as Record<string, unknown>) };
        }
        saveAgentStore(store);

        return {
          success: true,
          agentId,
          updated: true,
          agent: {
            agentId: agent.agentId,
            status: agent.status,
            health: agent.health,
            taskCount: agent.taskCount,
          },
        };
      }

      return {
        success: false,
        agentId,
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'swarm_cost_stats',
    description: 'Get swarm cost tracking stats — shows model distribution, per-agent costs, and savings vs all-opus baseline (ClawRouter-inspired)',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        reset: { type: 'boolean', description: 'Reset cost tracking stats' },
      },
    },
    handler: async (input) => {
      const store = loadAgentStore();

      if (input.reset) {
        store.costTracking = {
          sessionStart: new Date().toISOString(),
          totalCostUsd: 0,
          totalSavedVsAllOpusUsd: 0,
          byModel: {},
          byAgentType: {},
        };
        saveAgentStore(store);
        return { success: true, message: 'Cost tracking reset' };
      }

      const agents = Object.values(store.agents);
      const activeAgents = agents.filter(a => a.status !== 'terminated');

      // Compute live cost stats from agent records
      const modelDistribution: Record<string, { count: number; costPerReq: number; tier: string }> = {};
      const agentTypeCosts: Record<string, { count: number; model: string; tier: string; costPerReq: number }> = {};
      let totalEstimatedCost = 0;
      let totalIfAllOpus = 0;

      for (const agent of activeAgents) {
        const model = agent.model || 'sonnet';
        const tier = agent.modelTier || 'balanced';
        const costPerReq = MODEL_COST_PER_REQUEST[model] || MODEL_COST_PER_REQUEST.sonnet;
        const taskCount = agent.taskCount || 0;

        // Model distribution
        if (!modelDistribution[model]) {
          modelDistribution[model] = { count: 0, costPerReq, tier };
        }
        modelDistribution[model].count++;

        // Agent type costs
        if (!agentTypeCosts[agent.agentType]) {
          agentTypeCosts[agent.agentType] = { count: 0, model, tier, costPerReq };
        }
        agentTypeCosts[agent.agentType].count++;

        // Cost estimation based on task count
        totalEstimatedCost += costPerReq * taskCount;
        totalIfAllOpus += MODEL_COST_PER_REQUEST.opus * taskCount;
      }

      const totalSaved = totalIfAllOpus - totalEstimatedCost;
      const savingsPercent = totalIfAllOpus > 0
        ? ((totalSaved / totalIfAllOpus) * 100).toFixed(1)
        : '0.0';

      // Compute blended cost per request
      const totalAgents = activeAgents.length;
      const blendedCost = totalAgents > 0
        ? activeAgents.reduce((sum, a) => sum + (MODEL_COST_PER_REQUEST[a.model || 'sonnet'] || 0.003), 0) / totalAgents
        : 0;

      return {
        sessionStart: store.costTracking?.sessionStart || 'unknown',
        activeAgents: totalAgents,
        modelDistribution,
        agentTypeCosts,
        costSummary: {
          blendedCostPerRequest: `$${blendedCost.toFixed(4)}`,
          opusCostPerRequest: `$${MODEL_COST_PER_REQUEST.opus.toFixed(4)}`,
          estimatedTotalCost: `$${totalEstimatedCost.toFixed(4)}`,
          ifAllOpusCost: `$${totalIfAllOpus.toFixed(4)}`,
          totalSaved: `$${totalSaved.toFixed(4)}`,
          savingsPercent: `${savingsPercent}%`,
        },
        tierBreakdown: {
          fast: activeAgents.filter(a => a.modelTier === 'fast').length,
          balanced: activeAgents.filter(a => a.modelTier === 'balanced').length,
          capable: activeAgents.filter(a => a.modelTier === 'capable').length,
        },
        fallbackChains: Object.fromEntries(
          Object.entries(MODEL_FALLBACK_CHAINS).filter(([k]) => k !== 'inherit')
        ),
      };
    },
  },
  {
    name: 'agent_escalate',
    description: 'Escalate an agent to the next model in its fallback chain (e.g., haiku→sonnet→opus)',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent to escalate' },
        reason: { type: 'string', description: 'Reason for escalation (e.g., "context_limit", "task_failed", "quality")' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agentId = input.agentId as string;
      const agent = store.agents[agentId];

      if (!agent) {
        return { success: false, agentId, error: 'Agent not found' };
      }

      const currentModel = agent.model || 'sonnet';
      const chain = MODEL_FALLBACK_CHAINS[currentModel] || ['sonnet', 'opus'];
      const currentIndex = chain.indexOf(currentModel);
      const nextIndex = currentIndex + 1;

      if (nextIndex >= chain.length) {
        return {
          success: false,
          agentId,
          currentModel,
          error: 'Already at maximum capability (opus) — no further escalation possible',
        };
      }

      const newModel = chain[nextIndex];
      const previousModel = currentModel;
      agent.model = newModel;
      agent.modelTier = MODEL_TO_TIER[newModel];

      // Update cost estimate
      if (agent.costEstimate) {
        agent.costEstimate.tier = MODEL_TO_TIER[newModel];
        agent.costEstimate.costPerRequestUsd = MODEL_COST_PER_REQUEST[newModel];
        agent.costEstimate.savedVsOpusUsd = MODEL_COST_PER_REQUEST.opus - MODEL_COST_PER_REQUEST[newModel];
      }

      agent.modelRoutedBy = 'router';
      saveAgentStore(store);

      return {
        success: true,
        agentId,
        previousModel,
        newModel,
        newTier: MODEL_TO_TIER[newModel],
        reason: input.reason || 'manual escalation',
        remainingChain: chain.slice(nextIndex + 1),
        newCostPerRequest: `$${MODEL_COST_PER_REQUEST[newModel].toFixed(4)}`,
      };
    },
  },
];
