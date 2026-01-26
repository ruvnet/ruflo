/**
 * MemoryLog Component
 * Main memory operations log with filtering, virtual scrolling, and stats
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useMemoryStore } from '../../stores/memoryStore';
import { NamespaceFilter } from './NamespaceFilter';
import { MemoryOperation } from './MemoryOperation';
import { VectorSearchResult } from './VectorSearchResult';
import type { MemoryOperationType, NamespaceStats } from '../../types/memory';

const OPERATION_TYPES: { value: MemoryOperationType; label: string; color: string }[] = [
  { value: 'store', label: 'Store', color: 'text-green-400 border-green-400' },
  { value: 'retrieve', label: 'Retrieve', color: 'text-blue-400 border-blue-400' },
  { value: 'search', label: 'Search', color: 'text-purple-400 border-purple-400' },
  { value: 'delete', label: 'Delete', color: 'text-red-400 border-red-400' },
];

export const MemoryLog: React.FC = () => {
  const {
    filters,
    setFilters,
    selectedOperation,
    setSelectedOperation,
    namespaceStats,
    getFilteredOperations,
    getCacheHitRate,
    getTotalOperations,
  } = useMemoryStore();

  const [expandedSearchId, setExpandedSearchId] = useState<string | null>(null);

  const filteredOperations = useMemo(() => getFilteredOperations(), [getFilteredOperations]);
  const namespaceList = useMemo(
    () => Array.from(namespaceStats.values()).sort((a, b) => a.namespace.localeCompare(b.namespace)),
    [namespaceStats]
  );
  const cacheHitRate = useMemo(() => getCacheHitRate(), [getCacheHitRate]);
  const totalOps = useMemo(() => getTotalOperations(), [getTotalOperations]);

  const handleNamespaceChange = useCallback(
    (namespaces: string[]) => {
      setFilters({ namespaces });
    },
    [setFilters]
  );

  const handleOperationTypeToggle = useCallback(
    (opType: MemoryOperationType) => {
      const current = filters.operations;
      if (current.includes(opType)) {
        setFilters({ operations: current.filter((t) => t !== opType) });
      } else {
        setFilters({ operations: [...current, opType] });
      }
    },
    [filters.operations, setFilters]
  );

  const handleShowValuesToggle = useCallback(() => {
    setFilters({ showValues: !filters.showValues });
  }, [filters.showValues, setFilters]);

  const handleOperationClick = useCallback(
    (operation: (typeof filteredOperations)[0]) => {
      if (operation.operation === 'search') {
        setExpandedSearchId((prev) => (prev === operation.id ? null : operation.id));
        setSelectedOperation(operation);
      } else {
        setSelectedOperation(operation);
      }
    },
    [setSelectedOperation]
  );

  const isOperationTypeSelected = (opType: MemoryOperationType) =>
    filters.operations.length === 0 || filters.operations.includes(opType);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
            />
          </svg>
          <h2 className="text-lg font-semibold text-white">Memory Operations</h2>
        </div>

        {/* Stats Summary */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Total:</span>
            <span className="text-white font-medium">{totalOps}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Cache Hit:</span>
            <span
              className={`font-medium ${
                cacheHitRate >= 80 ? 'text-green-400' : cacheHitRate >= 50 ? 'text-yellow-400' : 'text-red-400'
              }`}
            >
              {cacheHitRate.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        {/* Namespace Filter */}
        <NamespaceFilter
          namespaces={namespaceList}
          selectedNamespaces={filters.namespaces}
          onChange={handleNamespaceChange}
        />

        {/* Operation Type Filter & Show Values Toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-300">Operations:</span>
            <div className="flex gap-1">
              {OPERATION_TYPES.map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => handleOperationTypeToggle(value)}
                  className={`
                    px-2.5 py-1 text-xs font-medium rounded border transition-all duration-150
                    ${
                      isOperationTypeSelected(value)
                        ? `${color} border-current bg-current/10`
                        : 'text-gray-500 border-gray-600 hover:border-gray-500'
                    }
                  `}
                  aria-pressed={isOperationTypeSelected(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Show Values Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.showValues}
              onChange={handleShowValuesToggle}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
            />
            <span className="text-sm text-gray-300">Show values</span>
          </label>
        </div>
      </div>

      {/* Operations List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredOperations.length === 0 ? (
          <EmptyState hasFilters={filters.namespaces.length > 0 || filters.operations.length > 0} />
        ) : (
          filteredOperations.map((operation) => (
            <React.Fragment key={operation.id}>
              <MemoryOperation
                operation={operation}
                showValue={filters.showValues}
                onClick={() => handleOperationClick(operation)}
                isSelected={selectedOperation?.id === operation.id}
              />
              {/* Expanded Search Results */}
              {operation.operation === 'search' && expandedSearchId === operation.id && (
                <div className="ml-4 animate-in slide-in-from-top-2 duration-200">
                  <VectorSearchResult searchOp={operation} />
                </div>
              )}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
};

interface EmptyStateProps {
  hasFilters: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = ({ hasFilters }) => (
  <div className="flex flex-col items-center justify-center h-full py-12 text-center">
    <svg className="w-12 h-12 text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
      />
    </svg>
    <p className="text-gray-400 text-sm">
      {hasFilters ? 'No operations match your filters' : 'No memory operations yet'}
    </p>
    <p className="text-gray-500 text-xs mt-1">
      {hasFilters ? 'Try adjusting your filter settings' : 'Operations will appear here as they occur'}
    </p>
  </div>
);

export default MemoryLog;
