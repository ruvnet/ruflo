/**
 * TaskTimeline Component
 * Horizontal timeline view with time markers, task bars, and filtering controls
 */

import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { useTaskStore, useTasksArray, type TaskState, type TaskStatus } from '../../store/taskStore';

interface TimeMarker {
  time: number;
  label: string;
  position: number;
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

// Filter status options (subset for UI)
const FILTER_STATUSES: TaskStatus[] = ['pending', 'running', 'completed', 'failed'];

function formatTimeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4, 8];
const PIXELS_PER_SECOND_BASE = 20;

interface TimelineFilter {
  statuses: TaskStatus[];
  agentId: string | null;
  timeStart: number | null;
  timeEnd: number | null;
}

export const TaskTimeline: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [timelineScale, setTimelineScale] = useState(1);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [filter, setFilter] = useState<TimelineFilter>({
    statuses: [],
    agentId: null,
    timeStart: null,
    timeEnd: null,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const allTasks = useTasksArray();
  const taskHistory = useTaskStore((state) => state.taskHistory);

  // Combine active tasks and history for timeline
  const combinedTasks = useMemo(() => {
    return [...allTasks, ...taskHistory];
  }, [allTasks, taskHistory]);

  // Apply filters
  const tasks = useMemo(() => {
    let result = combinedTasks;

    if (filter.statuses.length > 0) {
      result = result.filter((task) => filter.statuses.includes(task.status));
    }

    if (filter.agentId) {
      result = result.filter((task) => task.assignedAgent === filter.agentId);
    }

    if (filter.timeStart !== null) {
      result = result.filter((task) => task.createdAt.getTime() >= filter.timeStart!);
    }

    if (filter.timeEnd !== null) {
      result = result.filter((task) => task.createdAt.getTime() <= filter.timeEnd!);
    }

    return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [combinedTasks, filter]);

  // Get unique agents from tasks
  const uniqueAgents = useMemo(() => {
    const agents = new Map<string, string>();
    combinedTasks.forEach((task) => {
      if (task.assignedAgent) {
        agents.set(task.assignedAgent, task.assignedAgent);
      }
    });
    return Array.from(agents.entries());
  }, [combinedTasks]);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    if (tasks.length === 0) {
      const now = Date.now();
      return { start: now - 60000, end: now };
    }

    let minTime = Infinity;
    let maxTime = -Infinity;

    tasks.forEach((task) => {
      const start = task.startedAt?.getTime() || task.createdAt.getTime();
      const end = task.completedAt?.getTime() || Date.now();
      minTime = Math.min(minTime, start);
      maxTime = Math.max(maxTime, end);
    });

    // Add padding
    const padding = Math.max((maxTime - minTime) * 0.1, 5000);
    return {
      start: minTime - padding,
      end: maxTime + padding,
    };
  }, [tasks]);

  const totalDuration = timelineBounds.end - timelineBounds.start;
  const timelineWidth = Math.max(containerWidth, (totalDuration / 1000) * PIXELS_PER_SECOND_BASE * timelineScale);

  // Generate time markers
  const timeMarkers = useMemo((): TimeMarker[] => {
    const markers: TimeMarker[] = [];
    const interval = Math.max(1000, Math.floor(60000 / timelineScale));

    let time = Math.ceil(timelineBounds.start / interval) * interval;
    while (time <= timelineBounds.end) {
      const position = ((time - timelineBounds.start) / totalDuration) * 100;
      markers.push({
        time,
        label: formatTimeLabel(time),
        position,
      });
      time += interval;
    }
    return markers;
  }, [timelineBounds, totalDuration, timelineScale]);

  // Position task on timeline
  const getTaskPosition = useCallback(
    (task: TaskState) => {
      const start = task.startedAt?.getTime() || task.createdAt.getTime();
      const end = task.completedAt?.getTime() || (task.status === 'running' ? Date.now() : start + 1000);
      const duration = end - start;

      const left = ((start - timelineBounds.start) / totalDuration) * 100;
      const width = Math.max(1, (duration / totalDuration) * 100);

      return { left: `${left}%`, width: `${width}%` };
    },
    [timelineBounds, totalDuration]
  );

  // Handle resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Auto-scroll to newest tasks
  useEffect(() => {
    if (autoScrollEnabled && timelineRef.current) {
      timelineRef.current.scrollLeft = timelineRef.current.scrollWidth;
    }
  }, [tasks, autoScrollEnabled]);

  const handleZoomIn = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(timelineScale);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      setTimelineScale(ZOOM_LEVELS[currentIndex + 1]);
    } else if (currentIndex === -1) {
      const nextLevel = ZOOM_LEVELS.find((l) => l > timelineScale);
      if (nextLevel) setTimelineScale(nextLevel);
    }
  };

  const handleZoomOut = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(timelineScale);
    if (currentIndex > 0) {
      setTimelineScale(ZOOM_LEVELS[currentIndex - 1]);
    } else if (currentIndex === -1) {
      const prevLevel = [...ZOOM_LEVELS].reverse().find((l) => l < timelineScale);
      if (prevLevel) setTimelineScale(prevLevel);
    }
  };

  const handleStatusFilterChange = (status: TaskStatus) => {
    setFilter((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  };

  const handleAgentFilterChange = (agentId: string) => {
    setFilter((prev) => ({
      ...prev,
      agentId: agentId || null,
    }));
  };

  const handleTimeRangeChange = (type: 'start' | 'end', value: string) => {
    const timestamp = value ? new Date(value).getTime() : null;
    setFilter((prev) => ({
      ...prev,
      [type === 'start' ? 'timeStart' : 'timeEnd']: timestamp,
    }));
  };

  const resetFilter = () => {
    setFilter({ statuses: [], agentId: null, timeStart: null, timeEnd: null });
  };

  const handleTaskClick = (task: TaskState) => {
    setSelectedTaskId(task.id);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-lg" ref={containerRef}>
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-4 p-4 border-b border-slate-700">
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 uppercase tracking-wide">Status:</span>
          <div className="flex gap-1">
            {FILTER_STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => handleStatusFilterChange(status)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter.statuses.includes(status) || filter.statuses.length === 0
                    ? 'opacity-100'
                    : 'opacity-40'
                }`}
                style={{
                  backgroundColor: `${STATUS_COLORS[status]}20`,
                  color: STATUS_COLORS[status],
                }}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        {/* Agent Filter */}
        {uniqueAgents.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 uppercase tracking-wide">Agent:</span>
            <select
              className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600"
              value={filter.agentId || ''}
              onChange={(e) => handleAgentFilterChange(e.target.value)}
            >
              <option value="">All Agents</option>
              {uniqueAgents.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Time Range Picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 uppercase tracking-wide">Time:</span>
          <input
            type="datetime-local"
            className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600"
            onChange={(e) => handleTimeRangeChange('start', e.target.value)}
          />
          <span className="text-slate-400">-</span>
          <input
            type="datetime-local"
            className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-600"
            onChange={(e) => handleTimeRangeChange('end', e.target.value)}
          />
        </div>

        {/* Reset Button */}
        <button
          onClick={resetFilter}
          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          Reset Filters
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomOut}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            aria-label="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-xs text-slate-400 w-12 text-center">{timelineScale}x</span>
          <button
            onClick={handleZoomIn}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            aria-label="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* Auto-scroll Toggle */}
        <button
          onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            autoScrollEnabled
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Auto-scroll {autoScrollEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-x-auto overflow-y-auto" ref={timelineRef}>
        <div className="relative min-h-full" style={{ width: `${timelineWidth}px`, minHeight: `${Math.max(200, tasks.length * 40 + 60)}px` }}>
          {/* Time Markers */}
          <div className="h-8 border-b border-slate-700 relative sticky top-0 bg-slate-900 z-10">
            {timeMarkers.map((marker, index) => (
              <div
                key={index}
                className="absolute top-0 h-full flex flex-col items-center"
                style={{ left: `${marker.position}%` }}
              >
                <div className="h-2 w-px bg-slate-600" />
                <span className="text-xs text-slate-500 mt-1 whitespace-nowrap">
                  {marker.label}
                </span>
              </div>
            ))}
          </div>

          {/* Task Bars */}
          <div className="relative py-2">
            {tasks.map((task, index) => {
              const position = getTaskPosition(task);
              return (
                <div
                  key={task.id}
                  className={`absolute h-8 rounded cursor-pointer hover:opacity-80 transition-opacity flex items-center px-2 overflow-hidden ${
                    selectedTaskId === task.id ? 'ring-2 ring-white' : ''
                  }`}
                  style={{
                    ...position,
                    top: `${index * 40 + 8}px`,
                    backgroundColor: STATUS_COLORS[task.status],
                    minWidth: '60px',
                  }}
                  onClick={() => handleTaskClick(task)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleTaskClick(task);
                    }
                  }}
                  aria-label={`Task: ${task.description}`}
                >
                  {/* Agent Avatar */}
                  {task.assignedAgent && (
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs text-white mr-2 flex-shrink-0">
                      {task.assignedAgent.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {/* Task Label */}
                  <span className="text-xs text-white truncate">
                    {task.description.slice(0, 30)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Grid Lines */}
          <div className="absolute inset-0 pointer-events-none" style={{ top: '32px' }}>
            {timeMarkers.map((marker, index) => (
              <div
                key={index}
                className="absolute top-0 bottom-0 w-px bg-slate-800"
                style={{ left: `${marker.position}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500">No tasks to display</p>
        </div>
      )}
    </div>
  );
};

export default TaskTimeline;
