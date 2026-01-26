/**
 * Agent Store - Agent state management
 * Manages real-time agent state with optimized updates
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';

/**
 * Agent status types
 */
export type AgentStatus = 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'terminated';

/**
 * Agent type classification
 */
export type AgentType =
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'researcher'
  | 'planner'
  | 'architect'
  | 'coordinator'
  | 'security'
  | 'performance'
  | 'custom';

/**
 * Agent health status
 */
export interface AgentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  issues?: string[];
}

/**
 * Agent metrics
 */
export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  avgTaskDuration: number;
  errorCount: number;
  uptime: number;
  memoryUsageMb?: number;
  cpuPercent?: number;
}

/**
 * Agent state representation
 */
export interface AgentState {
  id: string;
  name: string;
  type: AgentType | string;
  status: AgentStatus;

  // Session info
  sessionId?: string;
  terminalId?: string;
  memoryBankId?: string;

  // Capabilities
  capabilities: string[];
  maxConcurrentTasks: number;
  currentTaskCount: number;

  // Timestamps
  createdAt: Date;
  lastActivity: Date;

  // Health and metrics
  health?: AgentHealth;
  metrics?: AgentMetrics;

  // Configuration
  priority: number;
  timeout?: number;

  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Agent store state shape
 */
export interface AgentStoreState {
  // State
  agents: Map<string, AgentState>;
  agentOrder: string[]; // For maintaining display order

  // Loading state
  isLoading: boolean;
  lastUpdated: Date | null;

  // Actions
  addAgent: (agent: AgentState) => void;
  updateAgent: (agentId: string, updates: Partial<AgentState>) => void;
  removeAgent: (agentId: string) => void;
  clearAgents: () => void;
  setAgents: (agents: AgentState[]) => void;

  // Selectors (as actions for easier use)
  getAgentById: (agentId: string) => AgentState | undefined;
  getAgentsByStatus: (status: AgentStatus) => AgentState[];
  getAgentsByType: (type: AgentType | string) => AgentState[];
  getActiveAgents: () => AgentState[];
  getIdleAgents: () => AgentState[];
  getAgentCount: () => number;
}

/**
 * Agent Zustand store
 */
export const useAgentStore = create<AgentStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      agents: new Map(),
      agentOrder: [],
      isLoading: false,
      lastUpdated: null,

      // Actions
      addAgent: (agent) =>
        set(
          (state) => {
            const newAgents = new Map(state.agents);
            newAgents.set(agent.id, agent);
            const newOrder = state.agentOrder.includes(agent.id)
              ? state.agentOrder
              : [...state.agentOrder, agent.id];
            return {
              agents: newAgents,
              agentOrder: newOrder,
              lastUpdated: new Date(),
            };
          },
          false,
          'addAgent'
        ),

      updateAgent: (agentId, updates) =>
        set(
          (state) => {
            const existing = state.agents.get(agentId);
            if (!existing) return state;

            const newAgents = new Map(state.agents);
            newAgents.set(agentId, {
              ...existing,
              ...updates,
              lastActivity: new Date(),
            });
            return {
              agents: newAgents,
              lastUpdated: new Date(),
            };
          },
          false,
          'updateAgent'
        ),

      removeAgent: (agentId) =>
        set(
          (state) => {
            const newAgents = new Map(state.agents);
            newAgents.delete(agentId);
            return {
              agents: newAgents,
              agentOrder: state.agentOrder.filter((id) => id !== agentId),
              lastUpdated: new Date(),
            };
          },
          false,
          'removeAgent'
        ),

      clearAgents: () =>
        set(
          {
            agents: new Map(),
            agentOrder: [],
            lastUpdated: new Date(),
          },
          false,
          'clearAgents'
        ),

      setAgents: (agents) =>
        set(
          () => {
            const newAgents = new Map<string, AgentState>();
            const order: string[] = [];
            for (const agent of agents) {
              newAgents.set(agent.id, agent);
              order.push(agent.id);
            }
            return {
              agents: newAgents,
              agentOrder: order,
              lastUpdated: new Date(),
            };
          },
          false,
          'setAgents'
        ),

      // Selector actions
      getAgentById: (agentId) => get().agents.get(agentId),

      getAgentsByStatus: (status) => {
        const result: AgentState[] = [];
        for (const agent of get().agents.values()) {
          if (agent.status === status) {
            result.push(agent);
          }
        }
        return result;
      },

      getAgentsByType: (type) => {
        const result: AgentState[] = [];
        for (const agent of get().agents.values()) {
          if (agent.type === type) {
            result.push(agent);
          }
        }
        return result;
      },

      getActiveAgents: () => {
        const result: AgentState[] = [];
        for (const agent of get().agents.values()) {
          if (agent.status === 'active' || agent.status === 'busy') {
            result.push(agent);
          }
        }
        return result;
      },

      getIdleAgents: () => {
        const result: AgentState[] = [];
        for (const agent of get().agents.values()) {
          if (agent.status === 'idle') {
            result.push(agent);
          }
        }
        return result;
      },

      getAgentCount: () => get().agents.size,
    })),
    { name: 'AgentStore' }
  )
);

/**
 * Selector hooks for optimized re-renders
 */
export const useAgents = () => useAgentStore((state) => state.agents);
export const useAgentOrder = () => useAgentStore((state) => state.agentOrder);
export const useAgentCount = () => useAgentStore((state) => state.agents.size);

/**
 * Get agents as array (sorted by order)
 */
export const useAgentsArray = (): AgentState[] => {
  const agents = useAgentStore((state) => state.agents);
  const order = useAgentStore((state) => state.agentOrder);
  return order.map((id) => agents.get(id)).filter((a): a is AgentState => a !== undefined);
};

/**
 * Get agent by ID with reactive updates
 */
export const useAgent = (agentId: string): AgentState | undefined => {
  return useAgentStore((state) => state.agents.get(agentId));
};
