/**
 * AgentStatusIndicator Component
 * Renders a colored circle with pulse animation for active states
 *
 * Colors per PRD:
 * - active: #22c55e (green)
 * - idle: #64748b (slate)
 * - busy: #f59e0b (amber)
 * - error: #ef4444 (red)
 * - spawning: #3b82f6 (blue)
 */

import React from 'react';
import { motion } from 'framer-motion';
import type { AgentStatus } from '../../store';

/**
 * Size variants for the indicator
 */
export type SizeVariant = 'sm' | 'md' | 'lg';

interface AgentStatusIndicatorProps {
  status: AgentStatus;
  size?: SizeVariant;
  showLabel?: boolean;
  className?: string;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  active: '#22c55e',
  idle: '#64748b',
  busy: '#f59e0b',
  error: '#ef4444',
  spawning: '#3b82f6',
  terminated: '#6b7280',
};

const STATUS_BG_CLASSES: Record<AgentStatus, string> = {
  active: 'bg-green-500',
  idle: 'bg-slate-500',
  busy: 'bg-amber-500',
  error: 'bg-red-500',
  spawning: 'bg-blue-500',
  terminated: 'bg-gray-500',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  busy: 'Busy',
  error: 'Error',
  spawning: 'Spawning',
  terminated: 'Terminated',
};

const SIZE_CLASSES: Record<SizeVariant, { dot: string; pulse: string; text: string }> = {
  sm: { dot: 'w-2 h-2', pulse: 'w-4 h-4', text: 'text-xs' },
  md: { dot: 'w-3 h-3', pulse: 'w-6 h-6', text: 'text-sm' },
  lg: { dot: 'w-4 h-4', pulse: 'w-8 h-8', text: 'text-base' },
};

const PULSING_STATUSES: AgentStatus[] = ['active', 'busy', 'spawning'];

export const AgentStatusIndicator: React.FC<AgentStatusIndicatorProps> = ({
  status,
  size = 'md',
  showLabel = false,
  className = '',
}) => {
  const shouldPulse = PULSING_STATUSES.includes(status);
  const sizeClasses = SIZE_CLASSES[size];
  const bgClass = STATUS_BG_CLASSES[status];
  const color = STATUS_COLORS[status];

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex items-center justify-center">
        {/* Pulse animation ring */}
        {shouldPulse && (
          <motion.div
            className={`absolute ${sizeClasses.pulse} rounded-full opacity-40`}
            style={{ backgroundColor: color }}
            initial={{ scale: 0.8, opacity: 0.6 }}
            animate={{
              scale: [0.8, 1.2, 0.8],
              opacity: [0.6, 0, 0.6],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}

        {/* Main status dot */}
        <motion.div
          className={`relative ${sizeClasses.dot} rounded-full ${bgClass}`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </div>

      {/* Optional label */}
      {showLabel && (
        <span className={`${sizeClasses.text} text-slate-300 font-medium`}>
          {STATUS_LABELS[status]}
        </span>
      )}
    </div>
  );
};

export default AgentStatusIndicator;
