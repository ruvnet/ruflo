/**
 * AgentCard Component
 * Displays agent information in a card format with status, task preview, and metrics
 */

import React from 'react';
import { motion } from 'framer-motion';
import { AgentStatusIndicator } from './AgentStatusIndicator';
import type { AgentState } from '../../store';

interface AgentCardProps {
  agent: AgentState;
  onClick?: (agent: AgentState) => void;
  isSelected?: boolean;
}

// Agent type icons using simple SVG representations
const TYPE_ICONS: Record<string, React.ReactNode> = {
  coder: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  reviewer: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  tester: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  researcher: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  planner: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  architect: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  coordinator: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  security: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  performance: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  memory: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  ),
  custom: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

const getTypeIcon = (type: string): React.ReactNode => {
  return TYPE_ICONS[type] || TYPE_ICONS.custom;
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
};

const formatPercentage = (value: number): string => {
  return `${Math.round(value)}%`;
};

export const AgentCard: React.FC<AgentCardProps> = ({ agent, onClick, isSelected = false }) => {
  const handleClick = () => {
    onClick?.(agent);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  // Get CPU/Memory from metrics (with fallbacks)
  const cpuPercent = agent.metrics?.cpuPercent ?? 0;
  const memoryMb = agent.metrics?.memoryUsageMb ?? 0;
  // Normalize memory to percentage (assuming max 512MB for visualization)
  const memoryPercent = Math.min((memoryMb / 512) * 100, 100);

  return (
    <motion.div
      className={`
        relative p-4 rounded-lg border cursor-pointer
        transition-colors duration-200
        ${
          isSelected
            ? 'bg-slate-700 border-blue-500 ring-2 ring-blue-500/20'
            : 'bg-slate-800 border-slate-700 hover:border-slate-600 hover:bg-slate-750'
        }
      `}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`Agent ${agent.name}, status: ${agent.status}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      layout
    >
      {/* Header: Icon, Name, Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-700 rounded-lg text-slate-300">
            {getTypeIcon(agent.type)}
          </div>
          <div>
            <h3 className="font-semibold text-white text-sm">{agent.name}</h3>
            <span className="text-xs text-slate-400 capitalize">{agent.type}</span>
          </div>
        </div>
        <AgentStatusIndicator status={agent.status} size="md" />
      </div>

      {/* Current Task Preview */}
      {agent.currentTaskCount > 0 ? (
        <div className="mb-3 p-2 bg-slate-900/50 rounded">
          <div className="text-xs text-slate-400 mb-1">Current Tasks</div>
          <div className="text-sm text-slate-200">
            {agent.currentTaskCount} active task{agent.currentTaskCount > 1 ? 's' : ''}
          </div>
        </div>
      ) : (
        <div className="mb-3 p-2 bg-slate-900/50 rounded">
          <div className="text-xs text-slate-400">No active task</div>
        </div>
      )}

      {/* Resource Usage Bars */}
      <div className="space-y-2 mb-3">
        {/* CPU Usage */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">CPU</span>
            <span className="text-slate-300">{formatPercentage(cpuPercent)}</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
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

        {/* Memory Usage */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Memory</span>
            <span className="text-slate-300">{memoryMb > 0 ? `${memoryMb.toFixed(0)}MB` : '0MB'}</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
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

      {/* Footer: Task Stats */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-700">
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{agent.metrics?.tasksCompleted ?? 0} completed</span>
        </div>

        {/* Error count badge */}
        {(agent.metrics?.tasksFailed ?? 0) > 0 && (
          <span className="px-2 py-0.5 text-xs bg-red-900/50 text-red-300 rounded-full">
            {agent.metrics?.tasksFailed} failed
          </span>
        )}
      </div>
    </motion.div>
  );
};

export default AgentCard;
