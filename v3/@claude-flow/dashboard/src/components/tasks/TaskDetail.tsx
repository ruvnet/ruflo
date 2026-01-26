/**
 * TaskDetail Component
 * Slide-out panel showing full task details with status history and error information
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTask, numberToPriority, type TaskState, type TaskStatus } from '../../store/taskStore';

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
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

function formatTimestamp(date: Date): string {
  return date.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

interface StatusHistoryEntry {
  status: TaskStatus;
  timestamp: Date;
  message?: string;
}

const StatusHistoryItem: React.FC<{ entry: StatusHistoryEntry; isLast: boolean }> = ({
  entry,
  isLast,
}) => {
  const color = STATUS_COLORS[entry.status];

  return (
    <div className="flex gap-3">
      {/* Timeline indicator */}
      <div className="flex flex-col items-center">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        {!isLast && <div className="w-px h-full bg-slate-700 mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{ color }}
          >
            {STATUS_LABELS[entry.status]}
          </span>
          <span className="text-xs text-slate-500">
            {formatTimestamp(entry.timestamp)}
          </span>
        </div>
        {entry.message && (
          <p className="text-sm text-slate-400 mt-1">{entry.message}</p>
        )}
      </div>
    </div>
  );
};

export const TaskDetail: React.FC<TaskDetailProps> = ({ taskId, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const task = useTask(taskId);

  // Slide-in animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 200); // Wait for animation
  };

  if (!task) {
    return null;
  }

  const statusColor = STATUS_COLORS[task.status];

  // Build status history from task timestamps
  const statusHistory: StatusHistoryEntry[] = [];
  statusHistory.push({ status: 'pending', timestamp: task.createdAt });
  if (task.startedAt) {
    statusHistory.push({ status: 'running', timestamp: task.startedAt });
  }
  if (task.completedAt) {
    statusHistory.push({ status: task.status, timestamp: task.completedAt, message: task.error });
  }

  // Calculate duration
  const duration = task.result?.duration || (task.completedAt && task.startedAt
    ? task.completedAt.getTime() - task.startedAt.getTime()
    : undefined);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${
          isVisible ? 'opacity-50' : 'opacity-0'
        }`}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative w-full max-w-lg bg-slate-900 border-l border-slate-700 overflow-y-auto transition-transform duration-200 ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-labelledby="task-detail-title"
        aria-modal="true"
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: `${statusColor}20`,
                    color: statusColor,
                  }}
                >
                  {STATUS_LABELS[task.status]}
                </span>
                <span className="text-xs text-slate-500">
                  {formatRelativeTime(task.createdAt)}
                </span>
              </div>
              <h2
                id="task-detail-title"
                className="text-lg font-semibold text-slate-200"
              >
                Task Details
              </h2>
            </div>

            {/* Close Button */}
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              aria-label="Close panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Description */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Description</h3>
            <p className="text-slate-200">{task.description}</p>
          </section>

          {/* Task ID and Type */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Task Info</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">ID</p>
                <code className="text-sm text-slate-300 font-mono break-all">
                  {task.id}
                </code>
              </div>
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Type</p>
                <p className="text-sm text-slate-200">{task.type}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Priority</p>
                <p className="text-sm text-slate-200 capitalize">
                  {numberToPriority(task.priority)} ({task.priority})
                </p>
              </div>
              {task.timeout && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-1">Timeout</p>
                  <p className="text-sm text-slate-200">{formatDuration(task.timeout)}</p>
                </div>
              )}
            </div>
          </section>

          {/* Assigned Agent */}
          {task.assignedAgent && (
            <section>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Assigned Agent</h3>
              <div className="flex items-center gap-3 bg-slate-800 rounded-lg p-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium"
                  style={{
                    backgroundColor: `${statusColor}30`,
                    color: statusColor,
                  }}
                >
                  {task.assignedAgent.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-slate-200 font-medium">
                    {task.assignedAgent}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Timing */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Timing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Created</p>
                <p className="text-sm text-slate-200">{formatTimestamp(task.createdAt)}</p>
              </div>
              {task.startedAt && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-1">Started</p>
                  <p className="text-sm text-slate-200">{formatTimestamp(task.startedAt)}</p>
                </div>
              )}
              {task.completedAt && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-1">Completed</p>
                  <p className="text-sm text-slate-200">{formatTimestamp(task.completedAt)}</p>
                </div>
              )}
              {duration && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-1">Duration</p>
                  <p className="text-sm text-slate-200 font-mono">{formatDuration(duration)}</p>
                </div>
              )}
            </div>
          </section>

          {/* Result Metrics */}
          {task.result?.metrics && (
            <section>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Metrics</h3>
              <div className="grid grid-cols-2 gap-4">
                {task.result.metrics.tokensUsed && (
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-1">Tokens Used</p>
                    <p className="text-sm text-slate-200">{task.result.metrics.tokensUsed.toLocaleString()}</p>
                  </div>
                )}
                {task.result.metrics.memoryPeakMb && (
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-1">Peak Memory</p>
                    <p className="text-sm text-slate-200">{task.result.metrics.memoryPeakMb.toFixed(1)} MB</p>
                  </div>
                )}
                {task.result.metrics.retryCount !== undefined && (
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-1">Retries</p>
                    <p className="text-sm text-slate-200">{task.result.metrics.retryCount}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Error Details */}
          {task.status === 'failed' && task.error && (
            <section>
              <h3 className="text-sm font-medium text-red-400 mb-2">Error Details</h3>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-red-300 font-medium">{task.error}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Status History */}
          <section>
            <h3 className="text-sm font-medium text-slate-400 mb-3">Status History</h3>
            <div className="bg-slate-800 rounded-lg p-4">
              {statusHistory.length > 0 ? (
                statusHistory.map((entry, index) => (
                  <StatusHistoryItem
                    key={`${entry.status}-${entry.timestamp.getTime()}`}
                    entry={entry}
                    isLast={index === statusHistory.length - 1}
                  />
                ))
              ) : (
                <p className="text-sm text-slate-500">No status history available</p>
              )}
            </div>
          </section>

          {/* Input */}
          {task.input && Object.keys(task.input).length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Input</h3>
              <pre className="text-xs text-slate-300 bg-slate-800 rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(task.input, null, 2)}
              </pre>
            </section>
          )}

          {/* Output */}
          {task.output && Object.keys(task.output).length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Output</h3>
              <pre className="text-xs text-slate-300 bg-slate-800 rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(task.output, null, 2)}
              </pre>
            </section>
          )}

          {/* Metadata */}
          {task.metadata && Object.keys(task.metadata).length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Metadata</h3>
              <pre className="text-xs text-slate-300 bg-slate-800 rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(task.metadata, null, 2)}
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskDetail;
