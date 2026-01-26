/**
 * TaskCard Component
 * Displays a compact task card with status, description, assigned agent, and timing
 */

import React, { useMemo } from 'react';
import type { TaskState, TaskStatus } from '../../store/taskStore';

interface TaskCardProps {
  task: TaskState;
  onClick?: (task: TaskState) => void;
}

// Status colors per PRD spec
const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: '#64748b',
  queued: '#64748b',
  assigned: '#3b82f6',
  running: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  cancelled: '#94a3b8',
  timeout: '#f59e0b',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
  assigned: 'Assigned',
  running: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timeout: 'Timeout',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatElapsedTime(startTime: Date): string {
  const elapsed = Date.now() - startTime.getTime();
  return formatDuration(elapsed);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onClick }) => {
  const statusColor = STATUS_COLORS[task.status];
  const statusLabel = STATUS_LABELS[task.status];

  const timeDisplay = useMemo(() => {
    if (task.result?.duration) {
      return formatDuration(task.result.duration);
    }
    if (task.startedAt && (task.status === 'running' || task.status === 'assigned')) {
      return formatElapsedTime(task.startedAt);
    }
    return null;
  }, [task.result?.duration, task.startedAt, task.status]);

  const handleClick = () => {
    onClick?.(task);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(task);
    }
  };

  // Calculate progress from result metrics or metadata
  const progress = task.metadata?.progress as number | undefined;

  return (
    <div
      className="bg-slate-800 rounded-lg p-4 cursor-pointer hover:bg-slate-700 transition-colors border border-slate-700 hover:border-slate-600"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.description}, Status: ${statusLabel}`}
    >
      {/* Header: Status Badge and Time */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="px-2 py-1 rounded text-xs font-medium"
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
          }}
        >
          {statusLabel}
        </span>
        {timeDisplay && (
          <span className="text-xs text-slate-400 font-mono">
            {timeDisplay}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-slate-200 mb-3 line-clamp-2">
        {truncateText(task.description, 100)}
      </p>

      {/* Progress Bar (if applicable) */}
      {progress !== undefined && (task.status === 'running' || task.status === 'assigned') && (
        <div className="mb-3">
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, progress)}%`,
                backgroundColor: statusColor,
              }}
            />
          </div>
          <span className="text-xs text-slate-400 mt-1">
            {progress}%
          </span>
        </div>
      )}

      {/* Footer: Agent Avatar and Error Indicator */}
      <div className="flex items-center justify-between">
        {/* Agent Avatar */}
        {task.assignedAgent && (
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
              style={{
                backgroundColor: `${statusColor}30`,
                color: statusColor,
              }}
              title={task.assignedAgent}
            >
              {task.assignedAgent.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-slate-400 truncate max-w-[120px]">
              {task.assignedAgent}
            </span>
          </div>
        )}

        {/* Error Indicator */}
        {task.status === 'failed' && task.error && (
          <div
            className="flex items-center gap-1 text-red-400"
            title={task.error}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-xs">Error</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
