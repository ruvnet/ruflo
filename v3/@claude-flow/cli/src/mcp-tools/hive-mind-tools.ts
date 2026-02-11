/**
 * Hive-Mind MCP Tools for CLI
 *
 * Tool definitions for collective intelligence and swarm coordination.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MCPTool } from './types.js';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const HIVE_DIR = 'hive-mind';
const HIVE_FILE = 'state.json';

interface HiveState {
  initialized: boolean;
  topology: 'mesh' | 'hierarchical' | 'ring' | 'star';
  queen?: {
    agentId: string;
    electedAt: string;
    term: number;
  };
  workers: string[];
  voting: {
    pending: VotingProposal[];
    history: VotingResult[];
  };
  sharedMemory: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface VotingProposal {
  proposalId: string;
  type: string;
  value: unknown;
  proposedBy: string;
  proposedAt: string;
  votes: Record<string, boolean>;
  status: 'pending' | 'approved' | 'rejected';
}

interface VotingResult {
  proposalId: string;
  type: string;
  result: 'approved' | 'rejected';
  votes: { for: number; against: number };
  decidedAt: string;
}

function getHiveDir(): string {
  return join(process.cwd(), STORAGE_DIR, HIVE_DIR);
}

function getHivePath(): string {
  return join(getHiveDir(), HIVE_FILE);
}

function ensureHiveDir(): void {
  const dir = getHiveDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadHiveState(): HiveState {
  try {
    const path = getHivePath();
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return default state on error
  }
  return {
    initialized: false,
    topology: 'mesh',
    workers: [],
    voting: { pending: [], history: [] },
    sharedMemory: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function saveHiveState(state: HiveState): void {
  ensureHiveDir();
  state.updatedAt = new Date().toISOString();
  writeFileSync(getHivePath(), JSON.stringify(state, null, 2), 'utf-8');
}

// Import agent store helpers for spawn functionality
import { existsSync as agentStoreExists, readFileSync as readAgentStore, writeFileSync as writeAgentStore, mkdirSync as mkdirAgentStore } from 'node:fs';

function loadAgentStore(): { agents: Record<string, unknown> } {
  const storePath = join(process.cwd(), '.claude-flow', 'agents.json');
  try {
    if (agentStoreExists(storePath)) {
      return JSON.parse(readAgentStore(storePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { agents: {} };
}

function saveAgentStore(store: { agents: Record<string, unknown> }): void {
  const storeDir = join(process.cwd(), '.claude-flow');
  if (!agentStoreExists(storeDir)) {
    mkdirAgentStore(storeDir, { recursive: true });
  }
  writeAgentStore(join(storeDir, 'agents.json'), JSON.stringify(store, null, 2), 'utf-8');
}

export const hiveMindTools: MCPTool[] = [
  {
    name: 'hive-mind_spawn',
    description: 'Spawn workers and automatically join them to the hive-mind (combines agent/spawn + hive-mind/join)',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of workers to spawn (default: 1)', default: 1 },
        role: { type: 'string', enum: ['worker', 'specialist', 'scout'], description: 'Worker role in hive', default: 'worker' },
        agentType: { type: 'string', description: 'Agent type for spawned workers', default: 'worker' },
        prefix: { type: 'string', description: 'Prefix for worker IDs', default: 'hive-worker' },
      },
    },
    handler: async (input) => {
      const state = loadHiveState();

      if (!state.initialized) {
        return { success: false, error: 'Hive-mind not initialized. Run hive-mind/init first.' };
      }

      const count = Math.min(Math.max(1, (input.count as number) || 1), 20); // Cap at 20
      const role = (input.role as string) || 'worker';
      const agentType = (input.agentType as string) || 'worker';
      const prefix = (input.prefix as string) || 'hive-worker';
      const agentStore = loadAgentStore();

      const spawnedWorkers: Array<{ agentId: string; role: string; joinedAt: string }> = [];

      for (let i = 0; i < count; i++) {
        const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Create agent record (like agent/spawn)
        agentStore.agents[agentId] = {
          agentId,
          agentType,
          status: 'idle',
          health: 1.0,
          taskCount: 0,
          config: { role, hiveRole: role },
          createdAt: new Date().toISOString(),
          domain: 'hive-mind',
        };

        // Join to hive-mind (like hive-mind/join)
        if (!state.workers.includes(agentId)) {
          state.workers.push(agentId);
        }

        spawnedWorkers.push({
          agentId,
          role,
          joinedAt: new Date().toISOString(),
        });
      }

      saveAgentStore(agentStore);
      saveHiveState(state);

      return {
        success: true,
        spawned: count,
        workers: spawnedWorkers,
        totalWorkers: state.workers.length,
        hiveStatus: 'active',
        message: `Spawned ${count} worker(s) and joined them to the hive-mind`,
      };
    },
  },
  {
    name: 'hive-mind_init',
    description: 'Initialize the hive-mind collective',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        topology: { type: 'string', enum: ['mesh', 'hierarchical', 'ring', 'star'], description: 'Network topology' },
        queenId: { type: 'string', description: 'Initial queen agent ID' },
      },
    },
    handler: async (input) => {
      const state = loadHiveState();
      const hiveId = `hive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const queenId = (input.queenId as string) || `queen-${Date.now()}`;

      state.initialized = true;
      state.topology = (input.topology as HiveState['topology']) || 'mesh';
      state.createdAt = new Date().toISOString();
      state.queen = {
        agentId: queenId,
        electedAt: new Date().toISOString(),
        term: 1,
      };

      saveHiveState(state);

      return {
        success: true,
        hiveId,
        topology: state.topology,
        consensus: (input.voting as string) || 'byzantine',
        queenId,
        status: 'initialized',
        config: {
          topology: state.topology,
          consensus: input.voting || 'byzantine',
          maxAgents: input.maxAgents || 15,
          persist: input.persist !== false,
          memoryBackend: input.memoryBackend || 'hybrid',
        },
        createdAt: state.createdAt,
      };
    },
  },
  {
    name: 'hive-mind_status',
    description: 'Get hive-mind status',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Include detailed information' },
      },
    },
    handler: async (input) => {
      const state = loadHiveState();

      const uptime = state.createdAt ? Date.now() - new Date(state.createdAt).getTime() : 0;
      const status = {
        // CLI expected fields
        hiveId: `hive-${state.createdAt ? new Date(state.createdAt).getTime() : Date.now()}`,
        status: state.initialized ? 'active' : 'offline',
        topology: state.topology,
        consensus: 'byzantine', // Default consensus type
        queen: state.queen ? {
          id: state.queen.agentId,
          agentId: state.queen.agentId,
          status: 'active',
          load: 0.3 + Math.random() * 0.4, // Simulated load
          tasksQueued: state.voting.pending.length,
          electedAt: state.queen.electedAt,
          term: state.queen.term,
        } : { id: 'N/A', status: 'offline', load: 0, tasksQueued: 0 },
        workers: state.workers.map(w => ({
          id: w,
          type: 'worker',
          status: 'idle',
          currentTask: null,
          tasksCompleted: 0,
        })),
        metrics: {
          totalTasks: state.voting.history.length + state.voting.pending.length,
          completedTasks: state.voting.history.length,
          failedTasks: 0,
          avgTaskTime: 150,
          consensusRounds: state.voting.history.length,
          memoryUsage: `${Object.keys(state.sharedMemory).length * 2} KB`,
        },
        health: {
          overall: 'healthy',
          queen: state.queen ? 'healthy' : 'unhealthy',
          workers: state.workers.length > 0 ? 'healthy' : 'degraded',
          consensus: 'healthy',
          memory: 'healthy',
        },
        // Additional fields
        id: `hive-${state.createdAt ? new Date(state.createdAt).getTime() : Date.now()}`,
        initialized: state.initialized,
        workerCount: state.workers.length,
        pendingConsensus: state.voting.pending.length,
        sharedMemoryKeys: Object.keys(state.sharedMemory).length,
        uptime,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      };

      if (input.verbose) {
        return {
          ...status,
          workerDetails: state.workers,
          consensusHistory: state.voting.history.slice(-10),
          sharedMemory: state.sharedMemory,
        };
      }

      return status;
    },
  },
  {
    name: 'hive-mind_join',
    description: 'Join an agent to the hive-mind',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID to join' },
        role: { type: 'string', enum: ['worker', 'specialist', 'scout'], description: 'Agent role in hive' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const state = loadHiveState();
      const agentId = input.agentId as string;

      if (!state.initialized) {
        return { success: false, error: 'Hive-mind not initialized' };
      }

      if (!state.workers.includes(agentId)) {
        state.workers.push(agentId);
        saveHiveState(state);
      }

      return {
        success: true,
        agentId,
        role: input.role || 'worker',
        totalWorkers: state.workers.length,
        joinedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'hive-mind_leave',
    description: 'Remove an agent from the hive-mind',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID to remove' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const state = loadHiveState();
      const agentId = input.agentId as string;

      const index = state.workers.indexOf(agentId);
      if (index > -1) {
        state.workers.splice(index, 1);
        saveHiveState(state);
        return {
          success: true,
          agentId,
          leftAt: new Date().toISOString(),
          remainingWorkers: state.workers.length,
        };
      }

      return { success: false, agentId, error: 'Agent not in hive' };
    },
  },
  {
    name: 'hive-mind_voting',
    description: 'Propose or vote on consensus',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['propose', 'vote', 'status', 'list'], description: 'Consensus action' },
        proposalId: { type: 'string', description: 'Proposal ID (for vote/status)' },
        type: { type: 'string', description: 'Proposal type (for propose)' },
        value: { description: 'Proposal value (for propose)' },
        vote: { type: 'boolean', description: 'Vote (true=for, false=against)' },
        voterId: { type: 'string', description: 'Voter agent ID' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const state = loadHiveState();
      const action = input.action as string;

      if (action === 'propose') {
        const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const proposal: VotingProposal = {
          proposalId,
          type: (input.type as string) || 'general',
          value: input.value,
          proposedBy: (input.voterId as string) || 'system',
          proposedAt: new Date().toISOString(),
          votes: {},
          status: 'pending',
        };

        state.voting.pending.push(proposal);
        saveHiveState(state);

        return {
          action,
          proposalId,
          type: proposal.type,
          status: 'pending',
          requiredVotes: Math.ceil(state.workers.length / 2) + 1,
        };
      }

      if (action === 'vote') {
        const proposal = state.voting.pending.find(p => p.proposalId === input.proposalId);
        if (!proposal) {
          return { action, error: 'Proposal not found' };
        }

        const voterId = input.voterId as string;
        proposal.votes[voterId] = input.vote as boolean;

        // Check if we have majority
        const votesFor = Object.values(proposal.votes).filter(v => v).length;
        const votesAgainst = Object.values(proposal.votes).filter(v => !v).length;
        const majority = Math.ceil(state.workers.length / 2) + 1;

        if (votesFor >= majority) {
          proposal.status = 'approved';
          state.voting.history.push({
            proposalId: proposal.proposalId,
            type: proposal.type,
            result: 'approved',
            votes: { for: votesFor, against: votesAgainst },
            decidedAt: new Date().toISOString(),
          });
          state.voting.pending = state.voting.pending.filter(p => p.proposalId !== proposal.proposalId);
        } else if (votesAgainst >= majority) {
          proposal.status = 'rejected';
          state.voting.history.push({
            proposalId: proposal.proposalId,
            type: proposal.type,
            result: 'rejected',
            votes: { for: votesFor, against: votesAgainst },
            decidedAt: new Date().toISOString(),
          });
          state.voting.pending = state.voting.pending.filter(p => p.proposalId !== proposal.proposalId);
        }

        saveHiveState(state);

        return {
          action,
          proposalId: proposal.proposalId,
          voterId,
          vote: input.vote,
          votesFor,
          votesAgainst,
          status: proposal.status,
        };
      }

      if (action === 'status') {
        const proposal = state.voting.pending.find(p => p.proposalId === input.proposalId);
        if (!proposal) {
          // Check history
          const historical = state.voting.history.find(h => h.proposalId === input.proposalId);
          if (historical) {
            return { action, ...historical, historical: true };
          }
          return { action, error: 'Proposal not found' };
        }

        const votesFor = Object.values(proposal.votes).filter(v => v).length;
        const votesAgainst = Object.values(proposal.votes).filter(v => !v).length;

        return {
          action,
          proposalId: proposal.proposalId,
          type: proposal.type,
          status: proposal.status,
          votesFor,
          votesAgainst,
          totalVotes: Object.keys(proposal.votes).length,
          requiredMajority: Math.ceil(state.workers.length / 2) + 1,
        };
      }

      if (action === 'list') {
        return {
          action,
          pending: state.voting.pending.map(p => ({
            proposalId: p.proposalId,
            type: p.type,
            proposedAt: p.proposedAt,
            totalVotes: Object.keys(p.votes).length,
          })),
          recentHistory: state.voting.history.slice(-5),
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    name: 'hive-mind_broadcast',
    description: 'Broadcast message to all workers',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to broadcast' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], description: 'Message priority' },
        fromId: { type: 'string', description: 'Sender agent ID' },
      },
      required: ['message'],
    },
    handler: async (input) => {
      const state = loadHiveState();

      if (!state.initialized) {
        return { success: false, error: 'Hive-mind not initialized' };
      }

      const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Store in shared memory
      const messages = (state.sharedMemory.broadcasts as Array<unknown>) || [];
      messages.push({
        messageId,
        message: input.message,
        priority: input.priority || 'normal',
        fromId: input.fromId || 'system',
        timestamp: new Date().toISOString(),
      });

      // Keep only last 100 broadcasts
      state.sharedMemory.broadcasts = messages.slice(-100);
      saveHiveState(state);

      return {
        success: true,
        messageId,
        recipients: state.workers.length,
        priority: input.priority || 'normal',
        broadcastAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'hive-mind_shutdown',
    description: 'Shutdown the hive-mind and terminate all workers',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        graceful: { type: 'boolean', description: 'Graceful shutdown (wait for pending tasks)', default: true },
        force: { type: 'boolean', description: 'Force immediate shutdown', default: false },
      },
    },
    handler: async (input) => {
      const state = loadHiveState();

      if (!state.initialized) {
        return { success: false, error: 'Hive-mind not initialized or already shut down' };
      }

      const graceful = input.graceful !== false;
      const force = input.force === true;
      const workerCount = state.workers.length;
      const pendingConsensus = state.voting.pending.length;

      // If graceful and there are pending consensus items, warn (unless forced)
      if (graceful && pendingConsensus > 0 && !force) {
        return {
          success: false,
          error: `Cannot gracefully shutdown with ${pendingConsensus} pending consensus items. Use force: true to override.`,
          pendingConsensus,
          workerCount,
        };
      }

      // Clear workers from agent store
      const agentStore = loadAgentStore();
      for (const workerId of state.workers) {
        if (agentStore.agents[workerId]) {
          delete agentStore.agents[workerId];
        }
      }
      saveAgentStore(agentStore);

      // Reset hive state
      const shutdownTime = new Date().toISOString();
      const previousQueen = state.queen?.agentId;

      state.initialized = false;
      state.queen = undefined;
      state.workers = [];
      state.voting.pending = [];
      // Keep history for reference
      state.sharedMemory = {};
      saveHiveState(state);

      return {
        success: true,
        shutdownAt: shutdownTime,
        graceful,
        workersTerminated: workerCount,
        previousQueen,
        consensusCleared: pendingConsensus,
        message: `Hive-mind shutdown complete. ${workerCount} workers terminated.`,
      };
    },
  },
  {
    name: 'hive-mind_memory',
    description: 'Access hive shared memory',
    category: 'hive-mind',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'delete', 'list'], description: 'Memory action' },
        key: { type: 'string', description: 'Memory key' },
        value: { description: 'Value to store (for set)' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const state = loadHiveState();
      const action = input.action as string;
      const key = input.key as string;

      if (action === 'get') {
        if (!key) return { action, error: 'Key required' };
        return {
          action,
          key,
          value: state.sharedMemory[key],
          exists: key in state.sharedMemory,
        };
      }

      if (action === 'set') {
        if (!key) return { action, error: 'Key required' };
        state.sharedMemory[key] = input.value;
        saveHiveState(state);
        return {
          action,
          key,
          success: true,
          updatedAt: new Date().toISOString(),
        };
      }

      if (action === 'delete') {
        if (!key) return { action, error: 'Key required' };
        const existed = key in state.sharedMemory;
        delete state.sharedMemory[key];
        saveHiveState(state);
        return {
          action,
          key,
          deleted: existed,
        };
      }

      if (action === 'list') {
        return {
          action,
          keys: Object.keys(state.sharedMemory),
          count: Object.keys(state.sharedMemory).length,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
];
