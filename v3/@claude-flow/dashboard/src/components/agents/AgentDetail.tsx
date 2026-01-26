/**
 * AgentDetail Component
 * Detailed view of a selected agent with full info, task details, and metrics
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentStatusIndicator } from './AgentStatusIndicator';
import { useAgent } from '../../store';

interface AgentDetailProps {
  agentId: string;
  onClose: () => void;
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
};

const formatTimestamp = (date: Date): string => {
  return date.toLocaleTimeString();
};

const formatRelativeTime = (date: Date): string => {
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
};

const MetricCard: React.FC<{ label: string; value: string | number; color?: string }> = ({
  label,
  value,
  color = 'text-white',
}) => (
  <div className="bg-slate-800 rounded-lg p-3">
    <div className="text-xs text-slate-400 mb-1">{label}</div>
    <div className={`text-lg font-semibold ${color}`}>{value}</div>
  </div>
);

export const AgentDetail: React.FC<AgentDetailProps> = ({ agentId, onClose }) => {
  const agent = useAgent(agentId);

  if (!agent) {
    return null;
  }

  // Get metrics with fallbacks
  const cpuPercent = agent.metrics?.cpuPercent ?? 0;
  const memoryMb = agent.metrics?.memoryUsageMb ?? 0;
  const uptime = agent.metrics?.uptime ?? (Date.now() - agent.createdAt.getTime());
  const memoryPercent = Math.min((memoryMb / 512) * 100, 100);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-700 shadow-2xl z-50 overflow-hidden"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AgentStatusIndicator status={agent.status} size="lg" />
              <div>
                <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
                <div className="text-sm text-slate-400 capitalize">{agent.type}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              aria-label="Close detail panel"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-80px)] p-4 space-y-6">
          {/* Agent Info */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Agent Information</h3>
            <div className="bg-slate-800 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">ID</span>
                <span className="text-slate-200 font-mono text-xs">{agent.id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Type</span>
                <span className="text-slate-200 capitalize">{agent.type}</span>
              </div>
              {agent.sessionId && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Session</span>
                  <span className="text-slate-200 font-mono text-xs">{agent.sessionId}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Priority</span>
                <span className="text-slate-200">{agent.priority}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Created</span>
                <span className="text-slate-200">{formatRelativeTime(agent.createdAt)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Last Activity</span>
                <span className="text-slate-200">{formatRelativeTime(agent.lastActivity)}</span>
              </div>
            </div>
          </section>

          {/* Current Tasks */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Current Tasks</h3>
            {agent.currentTaskCount > 0 ? (
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">
                    {agent.currentTaskCount} active task{agent.currentTaskCount > 1 ? 's' : ''}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-600 text-blue-100">
                    In Progress
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  Max concurrent: {agent.maxConcurrentTasks}
                </div>
              </div>
            ) : (
              <div className="bg-slate-800 rounded-lg p-4 text-center text-slate-500">
                No active tasks
              </div>
            )}
          </section>

          {/* Health Status */}
          {agent.health && (
            <section>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Health Status</h3>
              <div className={`rounded-lg p-4 ${
                agent.health.status === 'healthy' ? 'bg-green-900/20 border border-green-800' :
                agent.health.status === 'degraded' ? 'bg-amber-900/20 border border-amber-800' :
                'bg-red-900/20 border border-red-800'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`font-medium capitalize ${
                    agent.health.status === 'healthy' ? 'text-green-300' :
                    agent.health.status === 'degraded' ? 'text-amber-300' :
                    'text-red-300'
                  }`}>
                    {agent.health.status}
                  </span>
                </div>
                {agent.health.issues && agent.health.issues.length > 0 && (
                  <ul className="text-sm text-slate-400 list-disc list-inside">
                    {agent.health.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* Capabilities */}
          {agent.capabilities.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-slate-300 mb-3">Capabilities</h3>
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="flex flex-wrap gap-2">
                  {agent.capabilities.map((cap) => (
                    <span key={cap} className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Metrics */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Metrics</h3>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="Tasks Completed"
                value={agent.metrics?.tasksCompleted ?? 0}
                color="text-green-400"
              />
              <MetricCard
                label="Tasks Failed"
                value={agent.metrics?.tasksFailed ?? 0}
                color={(agent.metrics?.tasksFailed ?? 0) > 0 ? 'text-red-400' : 'text-white'}
              />
              <MetricCard
                label="Avg Duration"
                value={formatDuration(agent.metrics?.avgTaskDuration ?? 0)}
              />
              <MetricCard
                label="Uptime"
                value={formatDuration(uptime)}
              />
              <MetricCard
                label="CPU Usage"
                value={`${Math.round(cpuPercent)}%`}
                color={cpuPercent > 80 ? 'text-red-400' : 'text-white'}
              />
              <MetricCard
                label="Memory"
                value={memoryMb > 0 ? `${memoryMb.toFixed(0)}MB` : 'N/A'}
                color={memoryPercent > 80 ? 'text-red-400' : 'text-white'}
              />
            </div>
          </section>

          {/* Resource Usage Chart */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Resource Usage</h3>
            <div className="bg-slate-800 rounded-lg p-4 space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-400">CPU</span>
                  <span className="text-slate-200">{Math.round(cpuPercent)}%</span>
                </div>
                <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      cpuPercent > 80
                        ? 'bg-red-500'
                        : cpuPercent > 50
                          ? 'bg-amber-500'
                          : 'bg-green-500'
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${cpuPercent}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-400">Memory</span>
                  <span className="text-slate-200">{memoryMb > 0 ? `${memoryMb.toFixed(0)}MB` : 'N/A'}</span>
                </div>
                <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      memoryPercent > 80
                        ? 'bg-red-500'
                        : memoryPercent > 50
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${memoryPercent}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Timeline</h3>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <div className="flex-1">
                    <div className="text-sm text-slate-200">Agent spawned</div>
                    <div className="text-xs text-slate-500">{formatTimestamp(agent.createdAt)}</div>
                  </div>
                </div>
                {agent.currentTaskCount > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <div className="text-sm text-slate-200">Tasks in progress</div>
                      <div className="text-xs text-slate-500">{agent.currentTaskCount} active</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
                  <div className="flex-1">
                    <div className="text-sm text-slate-200">Last activity</div>
                    <div className="text-xs text-slate-500">{formatRelativeTime(agent.lastActivity)}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AgentDetail;
