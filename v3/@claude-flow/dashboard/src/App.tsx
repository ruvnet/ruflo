/**
 * Live Operations Dashboard - Main App Component
 * Real-time visibility into Claude Flow agent activities
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Stores
import { useDashboardStore } from './store/dashboardStore';
import { useAgentStore, useAgentsArray, type AgentState } from './store/agentStore';
import { useTaskStore, type TaskState } from './store/taskStore';
import { useMessageStore, type Message } from './store/messageStore';
import { useMemoryStore } from './store/memoryStore';

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
 * Main App Component
 */
const App: React.FC = () => {
  const addAgent = useAgentStore((s) => s.addAgent);
  const addTask = useTaskStore((s) => s.addTask);
  const addMessage = useMessageStore((s) => s.addMessage);

  // Add demo data on mount so the UI isn't empty
  useEffect(() => {
    // Demo agents
    const demoAgents: AgentState[] = [
      { id: 'coord-1', name: 'Coordinator', type: 'coordinator', status: 'active', capabilities: ['orchestrate'], maxConcurrentTasks: 5, currentTaskCount: 2, createdAt: new Date(), lastActivity: new Date(), priority: 10 },
      { id: 'coder-1', name: 'Coder-Alpha', type: 'coder', status: 'busy', capabilities: ['write', 'edit'], maxConcurrentTasks: 3, currentTaskCount: 1, createdAt: new Date(), lastActivity: new Date(), priority: 5 },
      { id: 'test-1', name: 'Tester-Beta', type: 'tester', status: 'idle', capabilities: ['test', 'validate'], maxConcurrentTasks: 2, currentTaskCount: 0, createdAt: new Date(), lastActivity: new Date(), priority: 3 },
      { id: 'review-1', name: 'Reviewer-Gamma', type: 'reviewer', status: 'active', capabilities: ['review', 'analyze'], maxConcurrentTasks: 2, currentTaskCount: 1, createdAt: new Date(), lastActivity: new Date(), priority: 4 },
    ];
    demoAgents.forEach((agent) => addAgent(agent));

    // Demo tasks
    const demoTasks: TaskState[] = [
      { id: 'task-1', type: 'implementation', description: 'Implement WebSocket connection', status: 'completed', priority: 10, createdAt: new Date(Date.now() - 300000), completedAt: new Date() },
      { id: 'task-2', type: 'implementation', description: 'Create agent grid component', status: 'running', priority: 5, createdAt: new Date(Date.now() - 200000), startedAt: new Date(), assignedAgent: 'coder-1' },
      { id: 'task-3', type: 'testing', description: 'Write unit tests', status: 'pending', priority: 5, createdAt: new Date(Date.now() - 100000) },
      { id: 'task-4', type: 'review', description: 'Review PR for topology', status: 'running', priority: 8, createdAt: new Date(Date.now() - 50000), startedAt: new Date(), assignedAgent: 'review-1' },
    ];
    demoTasks.forEach((task) => addTask(task));

    // Demo messages
    const demoMessages: Message[] = [
      { id: 'msg-1', source: 'coord-1', target: 'coder-1', type: 'task', direction: 'outbound', content: 'Implement feature X', timestamp: new Date(Date.now() - 60000) },
      { id: 'msg-2', source: 'coder-1', target: 'coord-1', type: 'response', direction: 'inbound', content: 'Feature X completed', timestamp: new Date(Date.now() - 30000) },
      { id: 'msg-3', source: 'coord-1', target: 'test-1', type: 'task', direction: 'outbound', content: 'Run tests for feature X', timestamp: new Date(Date.now() - 15000) },
    ];
    demoMessages.forEach((msg) => addMessage(msg));
  }, [addAgent, addTask, addMessage]);

  return (
    <DashboardLayout>
      <ViewRouter />
    </DashboardLayout>
  );
};

export default App;
