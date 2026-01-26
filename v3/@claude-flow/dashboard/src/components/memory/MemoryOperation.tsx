/**
 * MemoryOperation Component
 * Displays a single memory operation with type icon, namespace::key, cache status, and latency
 */

import React from 'react';
import type { MemoryOperation as MemoryOperationType } from '../../types/memory';

interface MemoryOperationProps {
  operation: MemoryOperationType;
  showValue: boolean;
  onClick?: () => void;
  isSelected?: boolean;
}

const OPERATION_ICONS: Record<string, React.ReactNode> = {
  store: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  retrieve: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  ),
  search: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  delete: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  update: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
};

const OPERATION_COLORS: Record<string, string> = {
  store: 'text-green-400 bg-green-400/10',
  retrieve: 'text-blue-400 bg-blue-400/10',
  search: 'text-purple-400 bg-purple-400/10',
  delete: 'text-red-400 bg-red-400/10',
  update: 'text-amber-400 bg-amber-400/10',
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const formatLatency = (latency: number): string => {
  if (latency < 1) {
    return `${(latency * 1000).toFixed(0)}us`;
  }
  if (latency < 1000) {
    return `${latency.toFixed(1)}ms`;
  }
  return `${(latency / 1000).toFixed(2)}s`;
};

const truncateValue = (value: unknown, maxLength = 100): string => {
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str.length > maxLength) {
      return str.slice(0, maxLength) + '...';
    }
    return str;
  } catch {
    return '[Unable to display]';
  }
};

export const MemoryOperation: React.FC<MemoryOperationProps> = ({
  operation,
  showValue,
  onClick,
  isSelected = false,
}) => {
  const colorClass = OPERATION_COLORS[operation.operation] || 'text-gray-400 bg-gray-400/10';
  const icon = OPERATION_ICONS[operation.operation];
  const isSearchOp = operation.operation === 'search';

  return (
    <div
      onClick={onClick}
      className={`
        flex flex-col gap-1.5 p-3 rounded-lg border transition-all duration-150
        ${onClick ? 'cursor-pointer' : ''}
        ${
          isSelected
            ? 'bg-gray-700 border-purple-500'
            : 'bg-gray-800/50 border-gray-700 hover:bg-gray-700/50 hover:border-gray-600'
        }
      `}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Operation Icon */}
          <div className={`flex items-center justify-center w-6 h-6 rounded ${colorClass}`}>
            {icon}
          </div>

          {/* Timestamp */}
          <span className="text-xs text-gray-500 font-mono">
            {formatTimestamp(operation.timestamp)}
          </span>

          {/* Namespace::Key */}
          <span className="text-sm text-gray-200 font-medium truncate">
            <span className="text-gray-400">{operation.namespace}</span>
            {operation.key && (
              <>
                <span className="text-gray-500">::</span>
                <span className="text-white">{operation.key}</span>
              </>
            )}
          </span>
        </div>

        {/* Right side indicators */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Cache indicator for retrieve operations */}
          {operation.operation === 'retrieve' && operation.cacheHit !== undefined && (
            <span
              className={`
                flex items-center gap-1 text-xs px-1.5 py-0.5 rounded
                ${operation.cacheHit ? 'text-green-400 bg-green-400/10' : 'text-yellow-400 bg-yellow-400/10'}
              `}
              title={operation.cacheHit ? 'Cache hit' : 'Cache miss'}
            >
              {operation.cacheHit ? (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              )}
              <span>{operation.cacheHit ? 'HIT' : 'MISS'}</span>
            </span>
          )}

          {/* Latency indicator */}
          <span
            className={`
              text-xs font-mono px-1.5 py-0.5 rounded
              ${operation.latency < 10 ? 'text-green-400 bg-green-400/10' : ''}
              ${operation.latency >= 10 && operation.latency < 100 ? 'text-yellow-400 bg-yellow-400/10' : ''}
              ${operation.latency >= 100 ? 'text-red-400 bg-red-400/10' : ''}
            `}
            title="Operation latency"
          >
            {formatLatency(operation.latency)}
          </span>
        </div>
      </div>

      {/* Search Query and Results */}
      {isSearchOp && operation.query && (
        <div className="flex items-center gap-2 pl-8">
          <span className="text-xs text-gray-500">Query:</span>
          <span className="text-xs text-purple-300 font-mono truncate">"{operation.query}"</span>
          {operation.resultCount !== undefined && (
            <span className="text-xs text-gray-400">
              ({operation.resultCount} result{operation.resultCount !== 1 ? 's' : ''})
            </span>
          )}
        </div>
      )}

      {/* Value preview */}
      {showValue && operation.value !== undefined && (
        <div className="pl-8 pt-1">
          <pre className="text-xs text-gray-400 bg-gray-900/50 rounded p-2 overflow-x-auto">
            {truncateValue(operation.value)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default MemoryOperation;
