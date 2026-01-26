/**
 * MetricsPanel Component
 * Displays system metrics with sparkline charts
 */

import React, { useMemo } from 'react';

interface MetricData {
  label: string;
  value: number;
  unit: string;
  history: number[];
  color: string;
  icon: React.ReactNode;
}

interface MetricsPanelProps {
  activeAgents: number;
  tasksPerMinute: number;
  messagesPerSecond: number;
  memoryOpsPerSecond: number;
  history: {
    activeAgents: number[];
    tasksPerMinute: number[];
    messagesPerSecond: number[];
    memoryOpsPerSecond: number[];
  };
}

/**
 * Simple sparkline component using SVG
 */
const Sparkline: React.FC<{ data: number[]; color: string; width?: number; height?: number }> = ({
  data,
  color,
  width = 80,
  height = 24,
}) => {
  const points = useMemo(() => {
    if (data.length === 0) return '';

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const xStep = width / (data.length - 1 || 1);

    return data
      .map((value, index) => {
        const x = index * xStep;
        const y = height - ((value - min) / range) * height;
        return `${x},${y}`;
      })
      .join(' ');
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-slate-500 text-xs" style={{ width, height }}>
        --
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/**
 * Individual metric card
 */
const MetricCard: React.FC<MetricData> = ({ label, value, unit, history, color, icon }) => {
  const formattedValue = useMemo(() => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toFixed(value < 10 ? 1 : 0);
  }, [value]);

  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-${color}-400`}>{icon}</span>
          <span className="text-sm text-slate-400">{label}</span>
        </div>
        <Sparkline data={history} color={`var(--tw-${color}-400, ${color})`} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-white">{formattedValue}</span>
        <span className="text-sm text-slate-500">{unit}</span>
      </div>
    </div>
  );
};

export const MetricsPanel: React.FC<MetricsPanelProps> = ({
  activeAgents,
  tasksPerMinute,
  messagesPerSecond,
  memoryOpsPerSecond,
  history,
}) => {
  const metrics: MetricData[] = [
    {
      label: 'Active Agents',
      value: activeAgents,
      unit: 'agents',
      history: history.activeAgents,
      color: '#22c55e', // green-500
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
    {
      label: 'Tasks/min',
      value: tasksPerMinute,
      unit: '/min',
      history: history.tasksPerMinute,
      color: '#3b82f6', // blue-500
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
      ),
    },
    {
      label: 'Messages/sec',
      value: messagesPerSecond,
      unit: '/sec',
      history: history.messagesPerSecond,
      color: '#f59e0b', // amber-500
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      ),
    },
    {
      label: 'Memory ops/sec',
      value: memoryOpsPerSecond,
      unit: '/sec',
      history: history.memoryOpsPerSecond,
      color: '#a855f7', // purple-500
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} />
      ))}
    </div>
  );
};

export default MetricsPanel;
