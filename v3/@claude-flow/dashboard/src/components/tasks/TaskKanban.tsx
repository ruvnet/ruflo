/**
 * TaskKanban Component
 * Kanban board view with columns for each status, draggable cards (visual only)
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useTaskStore, useTasksArray, useTaskHistory, type TaskState, type TaskStatus } from '../../store/taskStore';
import { TaskCard } from './TaskCard';

// Kanban columns map to task statuses - per PRD spec
type KanbanColumn = 'pending' | 'in_progress' | 'completed' | 'failed';

const COLUMN_ORDER: KanbanColumn[] = ['pending', 'in_progress', 'completed', 'failed'];
const VIRTUAL_ITEM_HEIGHT = 180;
const VIRTUAL_BUFFER = 3;

// Status colors per PRD spec
const STATUS_COLORS: Record<KanbanColumn, string> = {
  pending: '#64748b',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
};

const STATUS_LABELS: Record<KanbanColumn, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
};

// Map task status to kanban column
const statusToColumn = (status: TaskStatus): KanbanColumn => {
  switch (status) {
    case 'pending':
    case 'queued':
      return 'pending';
    case 'assigned':
    case 'running':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'cancelled':
    case 'timeout':
      return 'failed';
    default:
      return 'pending';
  }
};

interface KanbanColumnComponentProps {
  column: KanbanColumn;
  tasks: TaskState[];
  onTaskClick: (task: TaskState) => void;
}

const KanbanColumnComponent: React.FC<KanbanColumnComponentProps> = ({ column, tasks, onTaskClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  // Virtual scrolling calculations
  const virtualData = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_BUFFER);
    const visibleCount = Math.ceil(containerHeight / VIRTUAL_ITEM_HEIGHT) + VIRTUAL_BUFFER * 2;
    const endIndex = Math.min(tasks.length, startIndex + visibleCount);

    return {
      startIndex,
      endIndex,
      visibleTasks: tasks.slice(startIndex, endIndex),
      totalHeight: tasks.length * VIRTUAL_ITEM_HEIGHT,
      offsetTop: startIndex * VIRTUAL_ITEM_HEIGHT,
    };
  }, [tasks, scrollTop, containerHeight]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Update container height on resize
  React.useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const statusColor = STATUS_COLORS[column];

  return (
    <div className="flex flex-col h-full min-w-[300px] max-w-[350px] bg-slate-800/50 rounded-lg">
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <h3 className="text-sm font-semibold text-slate-200">
            {STATUS_LABELS[column]}
          </h3>
        </div>
        {/* Count Badge */}
        <span
          className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
          }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Cards Container with Virtual Scrolling */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-2"
        onScroll={handleScroll}
      >
        {tasks.length > 0 ? (
          <div
            className="relative"
            style={{ height: `${virtualData.totalHeight}px` }}
          >
            <div
              className="absolute left-0 right-0"
              style={{ transform: `translateY(${virtualData.offsetTop}px)` }}
            >
              {virtualData.visibleTasks.map((task) => (
                <div key={task.id} className="mb-2">
                  <TaskCard task={task} onClick={onTaskClick} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
};

export const TaskKanban: React.FC = () => {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const activeTasks = useTasksArray();
  const taskHistory = useTaskHistory();

  // Combine active tasks and history, then group by kanban column
  const tasksByColumn = useMemo(() => {
    const result: Record<KanbanColumn, TaskState[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      failed: [],
    };

    // Add active tasks
    activeTasks.forEach((task) => {
      const column = statusToColumn(task.status);
      result[column].push(task);
    });

    // Add historical tasks
    taskHistory.forEach((task) => {
      const column = statusToColumn(task.status);
      result[column].push(task);
    });

    // Sort each column by creation date (newest first)
    COLUMN_ORDER.forEach((column) => {
      result[column].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    });

    return result;
  }, [activeTasks, taskHistory]);

  const handleTaskClick = useCallback((task: TaskState) => {
    setSelectedTaskId(task.id);
  }, []);

  // Total task count
  const totalTasks = useMemo(() => {
    return COLUMN_ORDER.reduce((sum, column) => sum + tasksByColumn[column].length, 0);
  }, [tasksByColumn]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-slate-200">Task Board</h2>
        <span className="text-sm text-slate-400">
          {totalTasks} task{totalTasks !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 h-full min-h-[400px]">
          {COLUMN_ORDER.map((column) => (
            <KanbanColumnComponent
              key={column}
              column={column}
              tasks={tasksByColumn[column]}
              onTaskClick={handleTaskClick}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 p-3 border-t border-slate-700">
        {COLUMN_ORDER.map((column) => (
          <div key={column} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[column] }}
            />
            <span className="text-xs text-slate-400">
              {STATUS_LABELS[column]} ({tasksByColumn[column].length})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TaskKanban;
