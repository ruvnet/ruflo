/**
 * Live Operations Dashboard - Main App Component
 * Real-time visibility into Claude Flow agent activities
 */

import React, { useEffect, useState, useRef, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Stores
import { useDashboardStore } from './store/dashboardStore';
import { useAgentStore, useAgentsArray, type AgentState } from './store/agentStore';
import { useTaskStore, type TaskState } from './store/taskStore';
import { useMessageStore, type Message } from './store/messageStore';
import { useMemoryStore, type MemoryOperation } from './store/memoryStore';

/**
 * WebSocket context for sharing connection controls
 */
interface WebSocketContextValue {
  reconnect: () => void;
  reconnectAttempts: number;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  reconnect: () => {},
  reconnectAttempts: 0,
});

export const useWebSocketContext = () => useContext(WebSocketContext);

// Components
import { DashboardLayout } from './components/layout/DashboardLayout';
import { AgentGrid } from './components/agents/AgentGrid';
import { AgentDetail } from './components/agents/AgentDetail';
import { TaskTimeline } from './components/tasks/TaskTimeline';
import { TaskKanban } from './components/tasks/TaskKanban';
import { MessageStream } from './components/messages/MessageStream';
import { MemoryLog } from './components/memory/MemoryLog';
import { LiveTopology } from './components/topology/LiveTopology';

/**
 * Get status color class
 */
const getStatusColor = (status: string): string => {
  switch (status) {
    case 'active': return 'bg-green-400';
    case 'busy': return 'bg-amber-400';
    case 'idle': return 'bg-gray-400';
    case 'spawning': return 'bg-blue-400';
    case 'error': return 'bg-red-400';
    default: return 'bg-gray-500';
  }
};

/**
 * Metric Card Component
 */
const MetricCard: React.FC<{
  title: string;
  value: number;
  total?: number;
  color: 'green' | 'blue' | 'amber' | 'purple' | 'red';
}> = ({ title, value, total, color }) => {
  const colors = {
    green: 'text-green-400 bg-green-400/10',
    blue: 'text-blue-400 bg-blue-400/10',
    amber: 'text-amber-400 bg-amber-400/10',
    purple: 'text-purple-400 bg-purple-400/10',
    red: 'text-red-400 bg-red-400/10',
  };

  return (
    <div className={`rounded-lg p-4 ${colors[color]}`}>
      <p className="text-gray-400 text-sm">{title}</p>
      <p className="text-2xl font-bold mt-1">
        {value}
        {total !== undefined && <span className="text-gray-500 text-lg"> / {total}</span>}
      </p>
    </div>
  );
};

/**
 * Overview View - Dashboard summary with metrics
 */
const OverviewView: React.FC = () => {
  const agents = useAgentsArray();
  const tasks = useTaskStore((s) => s.tasks);
  const messages = useMessageStore((s) => s.messages);
  const memoryOps = useMemoryStore((s) => s.operations);

  const activeAgents = agents.filter((a) => a.status === 'active' || a.status === 'busy').length;
  const pendingTasks = Array.from(tasks.values()).filter((t) => t.status === 'pending').length;
  const inProgressTasks = Array.from(tasks.values()).filter((t) => t.status === 'running').length;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Overview</h2>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Active Agents" value={activeAgents} total={agents.length} color="green" />
        <MetricCard title="Pending Tasks" value={pendingTasks} color="amber" />
        <MetricCard title="In Progress" value={inProgressTasks} color="blue" />
        <MetricCard title="Messages" value={messages.length} color="purple" />
      </div>

      {/* Quick Agent Overview */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Agents</h3>
        {agents.length === 0 ? (
          <p className="text-gray-400">No agents spawned yet. Start a swarm to see agents here.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {agents.slice(0, 8).map((agent) => (
              <div key={agent.id} className="bg-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`} />
                  <span className="text-white font-medium truncate">{agent.name}</span>
                </div>
                <p className="text-gray-400 text-sm mt-1">{agent.type}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
        {messages.length === 0 && memoryOps.length === 0 ? (
          <p className="text-gray-400">No activity yet. Events will appear here when agents start communicating.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {messages.slice(0, 5).map((msg, i) => (
              <div key={msg.id || i} className="text-sm text-gray-300">
                <span className="text-blue-400">{msg.source}</span>
                <span className="text-gray-500"> → </span>
                <span className="text-green-400">{msg.target}</span>
                <span className="text-gray-500">: </span>
                <span>{msg.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Agents View
 */
const AgentsView: React.FC = () => {
  const selectedAgent = useDashboardStore((s) => s.selectedAgent);
  const setSelectedAgent = useDashboardStore((s) => s.setSelectedAgent);

  return (
    <div className="h-full">
      <h2 className="text-2xl font-bold text-white mb-6">Agents</h2>
      <AgentGrid onAgentSelect={(agent) => setSelectedAgent(agent.id)} />

      <AnimatePresence>
        {selectedAgent && (
          <AgentDetail agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * Tasks View
 */
const TasksView: React.FC = () => {
  const [viewMode, setViewMode] = useState<'timeline' | 'kanban'>('timeline');

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Tasks</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('timeline')}
            className={`px-3 py-1 rounded ${viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            Timeline
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-1 rounded ${viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            Kanban
          </button>
        </div>
      </div>

      {viewMode === 'timeline' ? <TaskTimeline /> : <TaskKanban />}
    </div>
  );
};

/**
 * Messages View
 */
const MessagesView: React.FC = () => {
  return (
    <div className="h-full">
      <h2 className="text-2xl font-bold text-white mb-6">Messages</h2>
      <MessageStream />
    </div>
  );
};

/**
 * Memory View
 */
const MemoryView: React.FC = () => {
  return (
    <div className="h-full">
      <h2 className="text-2xl font-bold text-white mb-6">Memory Operations</h2>
      <MemoryLog />
    </div>
  );
};

/**
 * Topology View
 */
const TopologyView: React.FC = () => {
  const agents = useAgentsArray();

  // Convert agents to topology nodes
  const nodes = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    type: agent.type,
    status: agent.status as 'active' | 'idle' | 'busy' | 'error' | 'spawning',
    connections: [] as string[],
  }));

  // Create edges between coordinator and other agents
  const coordinator = agents.find((a) => a.type === 'coordinator');
  const edges = coordinator
    ? agents
        .filter((a) => a.id !== coordinator.id)
        .map((a, i) => ({
          id: `edge-${i}`,
          source: coordinator.id,
          target: a.id,
          health: 'healthy' as const,
          isActive: a.status === 'active' || a.status === 'busy',
        }))
    : [];

  return (
    <div className="h-full">
      <h2 className="text-2xl font-bold text-white mb-6">Swarm Topology</h2>
      <div className="bg-gray-800 rounded-lg h-[calc(100%-4rem)]">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            No agents to display. Start a swarm to see the topology.
          </div>
        ) : (
          <LiveTopology
            nodes={nodes}
            edges={edges}
            width={800}
            height={600}
          />
        )}
      </div>
    </div>
  );
};

/**
 * View Router
 */
const ViewRouter: React.FC = () => {
  const selectedView = useDashboardStore((s) => s.selectedView);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={selectedView}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="h-full"
      >
        {selectedView === 'overview' && <OverviewView />}
        {selectedView === 'agents' && <AgentsView />}
        {selectedView === 'tasks' && <TasksView />}
        {selectedView === 'messages' && <MessagesView />}
        {selectedView === 'memory' && <MemoryView />}
        {selectedView === 'topology' && <TopologyView />}
      </motion.div>
    </AnimatePresence>
  );
};

/**
 * WebSocket configuration
 */
const WS_URL = 'ws://localhost:3001';
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;

/**
 * WebSocket event types from the server
 */
interface WSEvent {
  channel: string;
  event: string;
  data: unknown;
  timestamp?: string;
}

/**
 * Demo data for fallback when WebSocket is not connected
 */
const getDemoAgents = (): AgentState[] => [
  { id: 'coord-1', name: 'Coordinator', type: 'coordinator', status: 'active', capabilities: ['orchestrate'], maxConcurrentTasks: 5, currentTaskCount: 2, createdAt: new Date(), lastActivity: new Date(), priority: 10 },
  { id: 'coder-1', name: 'Coder-Alpha', type: 'coder', status: 'busy', capabilities: ['write', 'edit'], maxConcurrentTasks: 3, currentTaskCount: 1, createdAt: new Date(), lastActivity: new Date(), priority: 5 },
  { id: 'test-1', name: 'Tester-Beta', type: 'tester', status: 'idle', capabilities: ['test', 'validate'], maxConcurrentTasks: 2, currentTaskCount: 0, createdAt: new Date(), lastActivity: new Date(), priority: 3 },
  { id: 'review-1', name: 'Reviewer-Gamma', type: 'reviewer', status: 'active', capabilities: ['review', 'analyze'], maxConcurrentTasks: 2, currentTaskCount: 1, createdAt: new Date(), lastActivity: new Date(), priority: 4 },
];

const getDemoTasks = (): TaskState[] => [
  { id: 'task-1', type: 'implementation', description: 'Implement WebSocket connection', status: 'completed', priority: 10, createdAt: new Date(Date.now() - 300000), completedAt: new Date() },
  { id: 'task-2', type: 'implementation', description: 'Create agent grid component', status: 'running', priority: 5, createdAt: new Date(Date.now() - 200000), startedAt: new Date(), assignedAgent: 'coder-1' },
  { id: 'task-3', type: 'testing', description: 'Write unit tests', status: 'pending', priority: 5, createdAt: new Date(Date.now() - 100000) },
  { id: 'task-4', type: 'review', description: 'Review PR for topology', status: 'running', priority: 8, createdAt: new Date(Date.now() - 50000), startedAt: new Date(), assignedAgent: 'review-1' },
];

const getDemoMessages = (): Message[] => [
  { id: 'msg-1', source: 'coord-1', target: 'coder-1', type: 'task', direction: 'outbound', content: 'Implement feature X', timestamp: new Date(Date.now() - 60000) },
  { id: 'msg-2', source: 'coder-1', target: 'coord-1', type: 'response', direction: 'inbound', content: 'Feature X completed', timestamp: new Date(Date.now() - 30000) },
  { id: 'msg-3', source: 'coord-1', target: 'test-1', type: 'task', direction: 'outbound', content: 'Run tests for feature X', timestamp: new Date(Date.now() - 15000) },
];

/**
 * Custom hook for WebSocket connection with reconnection logic
 */
const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const hasReceivedDataRef = useRef(false);

  // Store actions
  const setConnectionStatus = useDashboardStore((s) => s.setConnectionStatus);
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const clearAgents = useAgentStore((s) => s.clearAgents);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const clearTasks = useTaskStore((s) => s.clearTasks);
  const addMessage = useMessageStore((s) => s.addMessage);
  const clearMessages = useMessageStore((s) => s.clearMessages);
  const addOperation = useMemoryStore((s) => s.addOperation);
  const clearOperations = useMemoryStore((s) => s.clearOperations);

  // Load demo data as fallback
  const loadDemoData = useCallback(() => {
    getDemoAgents().forEach((agent) => addAgent(agent));
    getDemoTasks().forEach((task) => addTask(task));
    getDemoMessages().forEach((msg) => addMessage(msg));
  }, [addAgent, addTask, addMessage]);

  // Clear all stores when real data arrives
  const clearAllStores = useCallback(() => {
    clearAgents();
    clearTasks();
    clearMessages();
    clearOperations();
  }, [clearAgents, clearTasks, clearMessages, clearOperations]);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const wsEvent: WSEvent = JSON.parse(event.data);

      // Clear demo data on first real data received
      if (!hasReceivedDataRef.current) {
        hasReceivedDataRef.current = true;
        clearAllStores();
      }

      const data = wsEvent.data as Record<string, unknown>;

      // Route events to appropriate stores based on channel and event type
      switch (wsEvent.channel) {
        case 'agents':
          // Handle agent events
          switch (wsEvent.event) {
            case 'agent:status':
            case 'agent:spawned':
            case 'agent:updated': {
              const agent = data as Partial<AgentState> & { id: string };
              const existingAgent = useAgentStore.getState().agents.get(agent.id);
              if (existingAgent) {
                updateAgent(agent.id, agent);
              } else {
                // Create new agent with required fields
                const createdAtValue = agent.createdAt
                  ? (typeof agent.createdAt === 'string' ? new Date(agent.createdAt) : agent.createdAt)
                  : new Date();
                const lastActivityValue = agent.lastActivity
                  ? (typeof agent.lastActivity === 'string' ? new Date(agent.lastActivity) : agent.lastActivity)
                  : new Date();
                addAgent({
                  ...agent,
                  id: agent.id,
                  name: agent.name ?? agent.id,
                  type: agent.type ?? 'custom',
                  status: agent.status ?? 'spawning',
                  capabilities: agent.capabilities ?? [],
                  maxConcurrentTasks: agent.maxConcurrentTasks ?? 1,
                  currentTaskCount: agent.currentTaskCount ?? 0,
                  createdAt: createdAtValue,
                  lastActivity: lastActivityValue,
                  priority: agent.priority ?? 5,
                });
              }
              break;
            }
            case 'agent:terminated': {
              const agent = data as { id: string };
              updateAgent(agent.id, { status: 'terminated' });
              break;
            }
          }
          break;

        case 'tasks':
          // Handle task events
          switch (wsEvent.event) {
            case 'task:update':
            case 'task:created':
            case 'task:assigned':
            case 'task:started':
            case 'task:completed':
            case 'task:failed': {
              const task = data as Partial<TaskState> & { id: string };
              const existingTask = useTaskStore.getState().tasks.get(task.id);

              // Helper to convert date fields
              const toDate = (val: unknown): Date | undefined => {
                if (!val) return undefined;
                if (val instanceof Date) return val;
                if (typeof val === 'string' || typeof val === 'number') return new Date(val);
                return undefined;
              };

              if (existingTask) {
                updateTask(task.id, {
                  ...task,
                  createdAt: toDate(task.createdAt) ?? existingTask.createdAt,
                  startedAt: toDate(task.startedAt) ?? existingTask.startedAt,
                  completedAt: toDate(task.completedAt) ?? existingTask.completedAt,
                });
              } else {
                // Create new task with required fields
                addTask({
                  ...task,
                  id: task.id,
                  type: task.type ?? 'unknown',
                  description: task.description ?? '',
                  priority: task.priority ?? 5,
                  status: task.status ?? 'pending',
                  createdAt: toDate(task.createdAt) ?? new Date(),
                  startedAt: toDate(task.startedAt),
                  completedAt: toDate(task.completedAt),
                });
              }
              break;
            }
          }
          break;

        case 'messages':
          // Handle message events
          switch (wsEvent.event) {
            case 'message:sent':
            case 'message:received': {
              const msg = data as Partial<Message>;
              const timestamp = msg.timestamp
                ? (msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp as unknown as string | number))
                : new Date();
              addMessage({
                id: msg.id,
                source: msg.source ?? 'unknown',
                target: msg.target,
                type: msg.type ?? 'info',
                direction: msg.direction ?? 'internal',
                content: msg.content ?? '',
                timestamp,
                data: msg.data,
                metadata: msg.metadata,
              });
              break;
            }
          }
          break;

        case 'memory':
          // Handle memory events
          switch (wsEvent.event) {
            case 'memory:operation':
            case 'memory:store':
            case 'memory:retrieve':
            case 'memory:update':
            case 'memory:delete':
            case 'memory:search': {
              const op = data as Partial<MemoryOperation>;
              const timestamp = op.timestamp
                ? (op.timestamp instanceof Date ? op.timestamp : new Date(op.timestamp as unknown as string | number))
                : new Date();
              addOperation({
                id: op.id,
                operation: op.operation ?? 'retrieve',
                status: op.status ?? 'success',
                namespace: op.namespace ?? 'default',
                key: op.key ?? '',
                type: op.type ?? 'session',
                timestamp,
                value: op.value,
                duration: op.duration,
                size: op.size,
                agentId: op.agentId,
                sessionId: op.sessionId,
                error: op.error,
              });
              break;
            }
          }
          break;

        default:
          console.debug('Unknown channel:', wsEvent.channel);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, [clearAllStores, addAgent, updateAgent, addTask, updateTask, addMessage, addOperation]);

  // Subscribe to all channels
  const subscribeToChannels = useCallback((ws: WebSocket) => {
    const channels = ['agents', 'tasks', 'messages', 'memory'];
    channels.forEach((channel) => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel,
      }));
    });
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
        subscribeToChannels(ws);
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error', 'Connection error');
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        wsRef.current = null;

        // Don't reconnect if closed cleanly (code 1000)
        if (event.code === 1000) {
          setConnectionStatus('disconnected');
          return;
        }

        setConnectionStatus('disconnected');

        // Attempt reconnection with exponential backoff
        if (reconnectAttemptsRef.current < RECONNECT_MAX_ATTEMPTS) {
          const currentAttempt = reconnectAttemptsRef.current + 1;
          const delay = Math.min(
            RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptsRef.current),
            RECONNECT_MAX_DELAY
          );
          reconnectAttemptsRef.current = currentAttempt;
          setReconnectAttempts(currentAttempt);

          console.log(`Reconnecting in ${delay}ms (attempt ${currentAttempt}/${RECONNECT_MAX_ATTEMPTS})`);

          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.log('Max reconnection attempts reached');
          // Load demo data as fallback after max retries
          if (!hasReceivedDataRef.current) {
            loadDemoData();
          }
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error', 'Failed to connect');
      // Load demo data as fallback
      if (!hasReceivedDataRef.current) {
        loadDemoData();
      }
    }
  }, [setConnectionStatus, handleMessage, subscribeToChannels, loadDemoData]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnect');
      wsRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, [setConnectionStatus]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    hasReceivedDataRef.current = false;
    connect();
  }, [connect, disconnect]);

  return { connect, disconnect, reconnect, reconnectAttempts };
};

/**
 * Main App Component
 */
const App: React.FC = () => {
  const addAgent = useAgentStore((s) => s.addAgent);
  const addTask = useTaskStore((s) => s.addTask);
  const addMessage = useMessageStore((s) => s.addMessage);

  const { connect, reconnect, reconnectAttempts } = useWebSocket();

  // Track if demo data has been loaded
  const demoDataLoadedRef = useRef(false);

  // Connect to WebSocket on mount, load demo data as initial fallback
  useEffect(() => {
    // Load demo data initially while attempting connection
    if (!demoDataLoadedRef.current) {
      demoDataLoadedRef.current = true;
      getDemoAgents().forEach((agent) => addAgent(agent));
      getDemoTasks().forEach((task) => addTask(task));
      getDemoMessages().forEach((msg) => addMessage(msg));
    }

    // Attempt WebSocket connection
    connect();

    // Cleanup on unmount
    return () => {
      // Connection cleanup handled by useWebSocket
    };
  }, [connect, addAgent, addTask, addMessage]);

  // Context value for WebSocket controls
  const wsContextValue = React.useMemo(
    () => ({ reconnect, reconnectAttempts }),
    [reconnect, reconnectAttempts]
  );

  return (
    <WebSocketContext.Provider value={wsContextValue}>
      <DashboardLayout>
        <ViewRouter />
      </DashboardLayout>
    </WebSocketContext.Provider>
  );
};

export default App;
