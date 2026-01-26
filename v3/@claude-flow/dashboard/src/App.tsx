/**
 * Main App Component
 * Live Operations Dashboard for Claude Flow
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { DashboardLayout } from './components/layout';
import { MetricsPanel } from './components/metrics';
import { useWebSocket } from './hooks';
import { useDashboardStore } from './store/dashboardStore';
import type { DashboardView } from './types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

interface AppProps {
  wsUrl?: string;
}

/**
 * Overview view with metrics and summaries
 */
const OverviewView: React.FC = () => {
  const metrics = useDashboardStore((state) => state.metrics);
  const agents = useDashboardStore((state) => state.agents);
  const tasks = useDashboardStore((state) => state.tasks);

  const activeAgentCount = Array.from(agents.values()).filter(
    (a) => a.status === 'active' || a.status === 'busy'
  ).length;

  return (
    <div className="space-y-6">
      <MetricsPanel
        activeAgents={metrics.activeAgents || activeAgentCount}
        tasksPerMinute={metrics.tasksPerMinute}
        messagesPerSecond={metrics.messagesPerSecond}
        memoryOpsPerSecond={metrics.memoryOpsPerSecond}
        history={metrics.history}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agents summary */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Agents ({agents.size})</h2>
          {agents.size === 0 ? (
            <p className="text-slate-400 text-sm">No agents connected. Start a swarm to see agents here.</p>
          ) : (
            <div className="space-y-2">
              {Array.from(agents.values())
                .slice(0, 5)
                .map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          agent.status === 'active'
                            ? 'bg-green-500'
                            : agent.status === 'busy'
                              ? 'bg-amber-500'
                              : agent.status === 'error'
                                ? 'bg-red-500'
                                : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-white font-medium">{agent.name}</span>
                    </div>
                    <span className="text-sm text-slate-400 capitalize">{agent.status}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Tasks summary */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Tasks ({tasks.size})</h2>
          {tasks.size === 0 ? (
            <p className="text-slate-400 text-sm">No tasks yet. Tasks will appear here as they are created.</p>
          ) : (
            <div className="space-y-2">
              {Array.from(tasks.values())
                .sort((a, b) => b.lastUpdate - a.lastUpdate)
                .slice(0, 5)
                .map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{task.description}</p>
                    </div>
                    <span
                      className={`ml-2 px-2 py-0.5 text-xs rounded ${
                        task.status === 'completed'
                          ? 'bg-green-500/20 text-green-400'
                          : task.status === 'in_progress'
                            ? 'bg-amber-500/20 text-amber-400'
                            : task.status === 'failed'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-slate-500/20 text-slate-400'
                      }`}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Agents view placeholder
 */
const AgentsView: React.FC = () => (
  <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
    <h2 className="text-lg font-semibold text-white mb-4">Agent Grid</h2>
    <p className="text-slate-400">Agent grid view coming soon. Will display all agents with detailed status.</p>
  </div>
);

/**
 * Tasks view placeholder
 */
const TasksView: React.FC = () => (
  <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
    <h2 className="text-lg font-semibold text-white mb-4">Task Timeline</h2>
    <p className="text-slate-400">Task timeline view coming soon. Will show task execution flow.</p>
  </div>
);

/**
 * Messages view with stream
 */
const MessagesView: React.FC = () => {
  const messages = useDashboardStore((state) => state.messages);
  const messagesPaused = useDashboardStore((state) => state.messagesPaused);
  const togglePaused = useDashboardStore((state) => state.toggleMessagesPaused);

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Message Stream ({messages.length})</h2>
        <button
          onClick={togglePaused}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            messagesPaused
              ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
          }`}
        >
          {messagesPaused ? 'Resume' : 'Pause'}
        </button>
      </div>
      {messages.length === 0 ? (
        <p className="text-slate-400">No messages yet. Messages between agents will appear here.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {messages.slice(0, 50).map((msg) => (
            <div key={msg.id} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm">
                  <span className="text-blue-400">{msg.source}</span>
                  <span className="text-slate-500 mx-2">-&gt;</span>
                  <span className="text-green-400">{msg.target}</span>
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-slate-300 text-sm truncate">
                {typeof msg.payload === 'string'
                  ? msg.payload
                  : JSON.stringify(msg.payload).slice(0, 100)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Memory view with operations log
 */
const MemoryView: React.FC = () => {
  const memoryOps = useDashboardStore((state) => state.memoryOps);

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Memory Operations ({memoryOps.length})</h2>
      {memoryOps.length === 0 ? (
        <p className="text-slate-400">No memory operations yet. Operations will appear here in real-time.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {memoryOps.slice(0, 50).map((op) => (
            <div key={op.id} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`px-2 py-0.5 text-xs rounded ${
                    op.operation === 'store'
                      ? 'bg-green-500/20 text-green-400'
                      : op.operation === 'retrieve'
                        ? 'bg-blue-500/20 text-blue-400'
                        : op.operation === 'search'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {op.operation}
                </span>
                <span className="text-xs text-slate-500">{op.latency.toFixed(1)}ms</span>
              </div>
              <p className="text-slate-300 text-sm">
                {op.namespace}::{op.key || op.query}
              </p>
              {op.cacheHit !== undefined && (
                <span
                  className={`text-xs ${op.cacheHit ? 'text-green-400' : 'text-amber-400'}`}
                >
                  {op.cacheHit ? 'Cache hit' : 'Cache miss'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Topology view placeholder
 */
const TopologyView: React.FC = () => {
  const topology = useDashboardStore((state) => state.topology);

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 h-full min-h-[400px]">
      <h2 className="text-lg font-semibold text-white mb-4">
        Live Topology ({topology.type})
      </h2>
      {topology.nodes.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-slate-400">No topology data. Initialize a swarm to see the topology.</p>
        </div>
      ) : (
        <div className="flex items-center justify-center h-64">
          <p className="text-slate-400">
            D3 topology visualization coming soon. {topology.nodes.length} nodes, {topology.edges.length} edges.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * View router component
 */
const ViewRouter: React.FC<{ view: DashboardView }> = ({ view }) => {
  switch (view) {
    case 'overview':
      return <OverviewView />;
    case 'agents':
      return <AgentsView />;
    case 'tasks':
      return <TasksView />;
    case 'messages':
      return <MessagesView />;
    case 'memory':
      return <MemoryView />;
    case 'topology':
      return <TopologyView />;
    default:
      return <OverviewView />;
  }
};

/**
 * Main App component
 */
export const App: React.FC<AppProps> = ({ wsUrl }) => {
  const url = wsUrl || WS_URL;

  // Dashboard store state
  const currentView = useDashboardStore((state) => state.currentView);
  const connectionStatus = useDashboardStore((state) => state.connectionStatus);
  const reconnectAttempts = useDashboardStore((state) => state.reconnectAttempts);
  const setConnectionStatus = useDashboardStore((state) => state.setConnectionStatus);
  const setReconnectAttempts = useDashboardStore((state) => state.setReconnectAttempts);
  const setCurrentView = useDashboardStore((state) => state.setCurrentView);
  const setSelectedAgent = useDashboardStore((state) => state.setSelectedAgent);
  const setSelectedTask = useDashboardStore((state) => state.setSelectedTask);
  const handleAgentStatus = useDashboardStore((state) => state.handleAgentStatus);
  const handleTaskUpdate = useDashboardStore((state) => state.handleTaskUpdate);
  const handleMessage = useDashboardStore((state) => state.handleMessage);
  const handleMemoryOperation = useDashboardStore((state) => state.handleMemoryOperation);
  const handleTopologyChange = useDashboardStore((state) => state.handleTopologyChange);
  const handleMetricsUpdate = useDashboardStore((state) => state.handleMetricsUpdate);
  const toggleMessagesPaused = useDashboardStore((state) => state.toggleMessagesPaused);

  // WebSocket connection
  const { connect, connectionStatus: wsStatus, on } = useWebSocket(url, {
    autoConnect: true,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    heartbeatInterval: 30000,
    onStatusChange: (status) => {
      setConnectionStatus(status);
    },
  });

  // Track reconnect attempts
  const reconnectCountRef = useRef(0);

  // Subscribe to WebSocket events
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // Agent status events
    unsubscribers.push(
      on('agent:status', (event: any) => {
        handleAgentStatus(event);
      })
    );

    // Task update events
    unsubscribers.push(
      on('task:update', (event: any) => {
        handleTaskUpdate(event);
      })
    );

    // Message events
    unsubscribers.push(
      on('message:sent', (event: any) => {
        handleMessage(event);
      })
    );

    // Memory operation events
    unsubscribers.push(
      on('memory:operation', (event: any) => {
        handleMemoryOperation(event);
      })
    );

    // Topology change events
    unsubscribers.push(
      on('topology:change', (event: any) => {
        handleTopologyChange(event);
      })
    );

    // Metrics update events
    unsubscribers.push(
      on('metrics:update', (event: any) => {
        if (event.metrics) {
          handleMetricsUpdate({
            type: 'metrics:update',
            activeAgents: event.metrics.activeAgents || 0,
            tasksPerMinute: event.metrics.pendingTasks || 0,
            messagesPerSecond: event.metrics.messagesPerSecond || 0,
            memoryOpsPerSecond: event.metrics.memoryOpsPerSecond || 0,
            timestamp: event.timestamp || Date.now(),
          });
        }
      })
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    on,
    handleAgentStatus,
    handleTaskUpdate,
    handleMessage,
    handleMemoryOperation,
    handleTopologyChange,
    handleMetricsUpdate,
  ]);

  // Reconnect handler
  const handleReconnect = useCallback(async () => {
    reconnectCountRef.current += 1;
    setReconnectAttempts(reconnectCountRef.current);
    try {
      await connect();
      reconnectCountRef.current = 0;
      setReconnectAttempts(0);
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }, [connect, setReconnectAttempts]);

  // Close panel handler
  const handleClosePanel = useCallback(() => {
    setSelectedAgent(null);
    setSelectedTask(null);
  }, [setSelectedAgent, setSelectedTask]);

  // Search focus handler (placeholder)
  const handleSearch = useCallback(() => {
    // TODO: Focus search input when implemented
    console.log('Search focus requested');
  }, []);

  return (
    <DashboardLayout
      currentView={currentView}
      connectionStatus={connectionStatus}
      reconnectAttempts={reconnectAttempts}
      onViewChange={setCurrentView}
      onReconnect={handleReconnect}
      onTogglePause={toggleMessagesPaused}
      onClosePanel={handleClosePanel}
      onSearch={handleSearch}
    >
      <ViewRouter view={currentView} />
    </DashboardLayout>
  );
};

export default App;
