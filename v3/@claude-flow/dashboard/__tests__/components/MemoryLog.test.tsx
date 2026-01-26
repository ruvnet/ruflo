/**
 * MemoryLog Component Tests
 * Tests for memory operations display, search, cache indicators, and namespace filtering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';

// Types
type MemoryOperationType = 'store' | 'retrieve' | 'search' | 'delete' | 'update';

interface VectorSearchResult {
  key: string;
  namespace: string;
  similarity: number;
  value?: unknown;
  highlight?: string;
}

interface MemoryOperation {
  id: string;
  operation: MemoryOperationType;
  namespace: string;
  key?: string;
  query?: string;
  value?: unknown;
  resultCount?: number;
  results?: VectorSearchResult[];
  cacheHit?: boolean;
  latency: number;
  success?: boolean;
  error?: string;
  agentId?: string;
  agentName?: string;
  timestamp: number;
}

interface NamespaceStats {
  namespace: string;
  operationCount: number;
  storeCount: number;
  retrieveCount: number;
  searchCount: number;
  deleteCount: number;
}

interface MemoryFilters {
  namespaces: string[];
  operations: MemoryOperationType[];
  showValues: boolean;
}

// Mock memory operations data
const mockOperations: MemoryOperation[] = [
  {
    id: 'op-1',
    operation: 'store',
    namespace: 'agent',
    key: 'agent:coordinator:state',
    value: { status: 'active', taskCount: 5 },
    cacheHit: false,
    latency: 12,
    success: true,
    agentId: 'agent-1',
    agentName: 'Coordinator',
    timestamp: Date.now() - 5000,
  },
  {
    id: 'op-2',
    operation: 'retrieve',
    namespace: 'agent',
    key: 'agent:coder:state',
    value: { status: 'busy', currentTask: 'implement-feature' },
    cacheHit: true,
    latency: 2,
    success: true,
    agentId: 'agent-2',
    agentName: 'Coder',
    timestamp: Date.now() - 4000,
  },
  {
    id: 'op-3',
    operation: 'search',
    namespace: 'vector',
    query: 'authentication patterns',
    resultCount: 5,
    results: [
      { key: 'pattern:auth:jwt', namespace: 'vector', similarity: 0.95 },
      { key: 'pattern:auth:oauth', namespace: 'vector', similarity: 0.88 },
      { key: 'pattern:auth:session', namespace: 'vector', similarity: 0.82 },
    ],
    cacheHit: false,
    latency: 45,
    success: true,
    agentId: 'agent-1',
    agentName: 'Coordinator',
    timestamp: Date.now() - 3000,
  },
  {
    id: 'op-4',
    operation: 'retrieve',
    namespace: 'cache',
    key: 'config:global',
    cacheHit: false,
    latency: 8,
    success: true,
    timestamp: Date.now() - 2000,
  },
  {
    id: 'op-5',
    operation: 'delete',
    namespace: 'session',
    key: 'session:expired:123',
    latency: 5,
    success: true,
    timestamp: Date.now() - 1000,
  },
  {
    id: 'op-6',
    operation: 'retrieve',
    namespace: 'agent',
    key: 'agent:tester:state',
    cacheHit: true,
    latency: 1,
    success: true,
    timestamp: Date.now() - 500,
  },
];

const mockNamespaceStats: NamespaceStats[] = [
  { namespace: 'agent', operationCount: 15, storeCount: 5, retrieveCount: 8, searchCount: 1, deleteCount: 1 },
  { namespace: 'vector', operationCount: 8, storeCount: 2, retrieveCount: 1, searchCount: 5, deleteCount: 0 },
  { namespace: 'cache', operationCount: 12, storeCount: 3, retrieveCount: 8, searchCount: 0, deleteCount: 1 },
  { namespace: 'session', operationCount: 5, storeCount: 2, retrieveCount: 1, searchCount: 0, deleteCount: 2 },
];

// MemoryOperation display component
interface MemoryOperationDisplayProps {
  operation: MemoryOperation;
  showValue?: boolean;
  onClick?: (operation: MemoryOperation) => void;
  isSelected?: boolean;
}

const MemoryOperationDisplay: React.FC<MemoryOperationDisplayProps> = ({
  operation,
  showValue = false,
  onClick,
  isSelected = false,
}) => {
  const operationColors: Record<MemoryOperationType, string> = {
    store: 'text-green-500',
    retrieve: 'text-blue-500',
    search: 'text-purple-500',
    delete: 'text-red-500',
    update: 'text-yellow-500',
  };

  return (
    <div
      data-testid={`memory-operation-${operation.id}`}
      className={`p-3 rounded border ${isSelected ? 'border-blue-500' : 'border-gray-700'}`}
      onClick={() => onClick?.(operation)}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-2">
        <span
          data-testid={`operation-type-${operation.id}`}
          className={operationColors[operation.operation]}
        >
          {operation.operation.toUpperCase()}
        </span>
        <span data-testid={`operation-namespace-${operation.id}`}>
          {operation.namespace}
        </span>
      </div>

      {operation.key && (
        <div data-testid={`operation-key-${operation.id}`}>{operation.key}</div>
      )}

      {operation.query && (
        <div data-testid={`operation-query-${operation.id}`}>
          Query: {operation.query}
        </div>
      )}

      {operation.resultCount !== undefined && (
        <div data-testid={`operation-results-${operation.id}`}>
          {operation.resultCount} results
        </div>
      )}

      {operation.cacheHit !== undefined && (
        <span
          data-testid={`cache-indicator-${operation.id}`}
          className={operation.cacheHit ? 'text-green-400' : 'text-yellow-400'}
        >
          {operation.cacheHit ? 'Cache HIT' : 'Cache MISS'}
        </span>
      )}

      <span data-testid={`operation-latency-${operation.id}`}>
        {operation.latency}ms
      </span>

      {showValue && operation.value && (
        <pre data-testid={`operation-value-${operation.id}`}>
          {JSON.stringify(operation.value, null, 2)}
        </pre>
      )}

      {operation.results && operation.results.length > 0 && (
        <div data-testid={`search-results-${operation.id}`}>
          {operation.results.map((result, idx) => (
            <div key={idx} data-testid={`search-result-${operation.id}-${idx}`}>
              <span>{result.key}</span>
              <span data-testid={`similarity-${operation.id}-${idx}`}>
                {(result.similarity * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Namespace filter component
interface NamespaceFilterProps {
  namespaces: NamespaceStats[];
  selectedNamespaces: string[];
  onChange: (namespaces: string[]) => void;
}

const NamespaceFilter: React.FC<NamespaceFilterProps> = ({
  namespaces,
  selectedNamespaces,
  onChange,
}) => {
  const toggleNamespace = (ns: string) => {
    if (selectedNamespaces.includes(ns)) {
      onChange(selectedNamespaces.filter((n) => n !== ns));
    } else {
      onChange([...selectedNamespaces, ns]);
    }
  };

  return (
    <div data-testid="namespace-filter">
      {namespaces.map((ns) => (
        <button
          key={ns.namespace}
          data-testid={`namespace-button-${ns.namespace}`}
          onClick={() => toggleNamespace(ns.namespace)}
          className={
            selectedNamespaces.includes(ns.namespace)
              ? 'bg-blue-500'
              : 'bg-gray-700'
          }
        >
          {ns.namespace} ({ns.operationCount})
        </button>
      ))}
    </div>
  );
};

// MemoryLog component
interface MemoryLogProps {
  operations?: MemoryOperation[];
  namespaceStats?: NamespaceStats[];
  initialFilters?: Partial<MemoryFilters>;
  onOperationSelect?: (operation: MemoryOperation) => void;
}

const MemoryLog: React.FC<MemoryLogProps> = ({
  operations = mockOperations,
  namespaceStats = mockNamespaceStats,
  initialFilters = {},
  onOperationSelect,
}) => {
  const [filters, setFilters] = useState<MemoryFilters>({
    namespaces: initialFilters.namespaces || [],
    operations: initialFilters.operations || [],
    showValues: initialFilters.showValues || false,
  });
  const [selectedOperation, setSelectedOperation] = useState<MemoryOperation | null>(null);

  // Apply filters
  let filteredOperations = operations;

  if (filters.namespaces.length > 0) {
    filteredOperations = filteredOperations.filter((op) =>
      filters.namespaces.includes(op.namespace)
    );
  }

  if (filters.operations.length > 0) {
    filteredOperations = filteredOperations.filter((op) =>
      filters.operations.includes(op.operation)
    );
  }

  // Calculate cache hit rate
  const retrieveOps = operations.filter((op) => op.operation === 'retrieve');
  const cacheHits = retrieveOps.filter((op) => op.cacheHit === true).length;
  const cacheHitRate = retrieveOps.length > 0 ? (cacheHits / retrieveOps.length) * 100 : 0;

  const handleOperationClick = (operation: MemoryOperation) => {
    setSelectedOperation(operation);
    onOperationSelect?.(operation);
  };

  const handleNamespaceChange = (namespaces: string[]) => {
    setFilters({ ...filters, namespaces });
  };

  const handleOperationTypeToggle = (opType: MemoryOperationType) => {
    const current = filters.operations;
    if (current.includes(opType)) {
      setFilters({ ...filters, operations: current.filter((t) => t !== opType) });
    } else {
      setFilters({ ...filters, operations: [...current, opType] });
    }
  };

  const handleShowValuesToggle = () => {
    setFilters({ ...filters, showValues: !filters.showValues });
  };

  return (
    <div data-testid="memory-log">
      <div data-testid="memory-stats">
        <span data-testid="total-operations">{operations.length} operations</span>
        <span data-testid="cache-hit-rate">{cacheHitRate.toFixed(1)}% cache hit rate</span>
      </div>

      <NamespaceFilter
        namespaces={namespaceStats}
        selectedNamespaces={filters.namespaces}
        onChange={handleNamespaceChange}
      />

      <div data-testid="operation-type-filter">
        {(['store', 'retrieve', 'search', 'delete'] as MemoryOperationType[]).map((opType) => (
          <button
            key={opType}
            data-testid={`operation-type-button-${opType}`}
            onClick={() => handleOperationTypeToggle(opType)}
            className={filters.operations.includes(opType) ? 'active' : ''}
            aria-pressed={filters.operations.includes(opType)}
          >
            {opType}
          </button>
        ))}
      </div>

      <label data-testid="show-values-toggle">
        <input
          type="checkbox"
          checked={filters.showValues}
          onChange={handleShowValuesToggle}
          data-testid="show-values-checkbox"
        />
        Show values
      </label>

      <div data-testid="operations-list">
        {filteredOperations.length === 0 ? (
          <p data-testid="empty-state">No operations match your filters</p>
        ) : (
          filteredOperations.map((op) => (
            <MemoryOperationDisplay
              key={op.id}
              operation={op}
              showValue={filters.showValues}
              onClick={handleOperationClick}
              isSelected={selectedOperation?.id === op.id}
            />
          ))
        )}
      </div>
    </div>
  );
};

describe('MemoryLog', () => {
  describe('Store operations display', () => {
    it('should render all memory operations', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('memory-operation-op-1')).toBeInTheDocument();
      expect(screen.getByTestId('memory-operation-op-2')).toBeInTheDocument();
      expect(screen.getByTestId('memory-operation-op-3')).toBeInTheDocument();
    });

    it('should display operation type correctly', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-type-op-1')).toHaveTextContent('STORE');
      expect(screen.getByTestId('operation-type-op-2')).toHaveTextContent('RETRIEVE');
      expect(screen.getByTestId('operation-type-op-3')).toHaveTextContent('SEARCH');
      expect(screen.getByTestId('operation-type-op-5')).toHaveTextContent('DELETE');
    });

    it('should display namespace for each operation', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-namespace-op-1')).toHaveTextContent('agent');
      expect(screen.getByTestId('operation-namespace-op-3')).toHaveTextContent('vector');
      expect(screen.getByTestId('operation-namespace-op-4')).toHaveTextContent('cache');
    });

    it('should display operation key when available', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-key-op-1')).toHaveTextContent('agent:coordinator:state');
      expect(screen.getByTestId('operation-key-op-2')).toHaveTextContent('agent:coder:state');
    });

    it('should display operation latency', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-latency-op-1')).toHaveTextContent('12ms');
      expect(screen.getByTestId('operation-latency-op-2')).toHaveTextContent('2ms');
    });

    it('should show total operations count', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('total-operations')).toHaveTextContent('6 operations');
    });
  });

  describe('Search operations with query/results', () => {
    it('should display search query', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-query-op-3')).toHaveTextContent('Query: authentication patterns');
    });

    it('should display result count', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-results-op-3')).toHaveTextContent('5 results');
    });

    it('should display search results with similarity scores', () => {
      render(<MemoryLog operations={mockOperations} />);

      const searchResults = screen.getByTestId('search-results-op-3');
      expect(searchResults).toBeInTheDocument();

      expect(screen.getByTestId('search-result-op-3-0')).toBeInTheDocument();
      expect(screen.getByTestId('similarity-op-3-0')).toHaveTextContent('95.0%');
      expect(screen.getByTestId('similarity-op-3-1')).toHaveTextContent('88.0%');
      expect(screen.getByTestId('similarity-op-3-2')).toHaveTextContent('82.0%');
    });
  });

  describe('Cache hit/miss indicators', () => {
    it('should display cache hit indicator', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('cache-indicator-op-2')).toHaveTextContent('Cache HIT');
      expect(screen.getByTestId('cache-indicator-op-2')).toHaveClass('text-green-400');
    });

    it('should display cache miss indicator', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('cache-indicator-op-1')).toHaveTextContent('Cache MISS');
      expect(screen.getByTestId('cache-indicator-op-1')).toHaveClass('text-yellow-400');
    });

    it('should calculate and display cache hit rate', () => {
      render(<MemoryLog operations={mockOperations} />);

      // 2 cache hits out of 3 retrieve operations = 66.7%
      expect(screen.getByTestId('cache-hit-rate')).toHaveTextContent('66.7% cache hit rate');
    });

    it('should handle 0% cache hit rate', () => {
      const noCacheHits: MemoryOperation[] = [
        { ...mockOperations[0], cacheHit: false },
        {
          id: 'op-nocache',
          operation: 'retrieve',
          namespace: 'test',
          key: 'test:key',
          cacheHit: false,
          latency: 10,
          timestamp: Date.now(),
        },
      ];

      render(<MemoryLog operations={noCacheHits} />);

      expect(screen.getByTestId('cache-hit-rate')).toHaveTextContent('0.0% cache hit rate');
    });

    it('should handle 100% cache hit rate', () => {
      const allCacheHits: MemoryOperation[] = [
        { ...mockOperations[1], cacheHit: true },
        { ...mockOperations[5], cacheHit: true },
      ];

      render(<MemoryLog operations={allCacheHits} />);

      expect(screen.getByTestId('cache-hit-rate')).toHaveTextContent('100.0% cache hit rate');
    });
  });

  describe('Namespace filtering', () => {
    it('should render namespace filter buttons', () => {
      render(<MemoryLog namespaceStats={mockNamespaceStats} />);

      expect(screen.getByTestId('namespace-button-agent')).toBeInTheDocument();
      expect(screen.getByTestId('namespace-button-vector')).toBeInTheDocument();
      expect(screen.getByTestId('namespace-button-cache')).toBeInTheDocument();
      expect(screen.getByTestId('namespace-button-session')).toBeInTheDocument();
    });

    it('should display operation count for each namespace', () => {
      render(<MemoryLog namespaceStats={mockNamespaceStats} />);

      expect(screen.getByTestId('namespace-button-agent')).toHaveTextContent('agent (15)');
      expect(screen.getByTestId('namespace-button-vector')).toHaveTextContent('vector (8)');
    });

    it('should filter operations by selected namespace', () => {
      render(<MemoryLog operations={mockOperations} namespaceStats={mockNamespaceStats} />);

      // Click to filter by 'agent' namespace
      fireEvent.click(screen.getByTestId('namespace-button-agent'));

      // Should show only agent namespace operations
      expect(screen.getByTestId('memory-operation-op-1')).toBeInTheDocument();
      expect(screen.getByTestId('memory-operation-op-2')).toBeInTheDocument();
      expect(screen.getByTestId('memory-operation-op-6')).toBeInTheDocument();

      // Should not show operations from other namespaces
      expect(screen.queryByTestId('memory-operation-op-3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('memory-operation-op-4')).not.toBeInTheDocument();
    });

    it('should allow multiple namespace selection', () => {
      render(<MemoryLog operations={mockOperations} namespaceStats={mockNamespaceStats} />);

      fireEvent.click(screen.getByTestId('namespace-button-agent'));
      fireEvent.click(screen.getByTestId('namespace-button-vector'));

      // Should show agent and vector namespace operations
      expect(screen.getByTestId('memory-operation-op-1')).toBeInTheDocument();
      expect(screen.getByTestId('memory-operation-op-3')).toBeInTheDocument();
    });

    it('should toggle namespace selection off', () => {
      render(<MemoryLog operations={mockOperations} namespaceStats={mockNamespaceStats} />);

      // Select agent namespace
      fireEvent.click(screen.getByTestId('namespace-button-agent'));
      expect(screen.queryByTestId('memory-operation-op-3')).not.toBeInTheDocument();

      // Deselect agent namespace
      fireEvent.click(screen.getByTestId('namespace-button-agent'));
      expect(screen.getByTestId('memory-operation-op-3')).toBeInTheDocument();
    });

    it('should show empty state when no operations match filter', () => {
      render(
        <MemoryLog
          operations={mockOperations}
          namespaceStats={[...mockNamespaceStats, { namespace: 'empty', operationCount: 0, storeCount: 0, retrieveCount: 0, searchCount: 0, deleteCount: 0 }]}
          initialFilters={{ namespaces: ['empty'], operations: [], showValues: false }}
        />
      );

      expect(screen.getByTestId('empty-state')).toHaveTextContent('No operations match your filters');
    });
  });

  describe('Operation type filtering', () => {
    it('should render operation type filter buttons', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('operation-type-button-store')).toBeInTheDocument();
      expect(screen.getByTestId('operation-type-button-retrieve')).toBeInTheDocument();
      expect(screen.getByTestId('operation-type-button-search')).toBeInTheDocument();
      expect(screen.getByTestId('operation-type-button-delete')).toBeInTheDocument();
    });

    it('should filter operations by type', () => {
      render(<MemoryLog operations={mockOperations} />);

      fireEvent.click(screen.getByTestId('operation-type-button-store'));

      expect(screen.getByTestId('memory-operation-op-1')).toBeInTheDocument();
      expect(screen.queryByTestId('memory-operation-op-2')).not.toBeInTheDocument();
    });

    it('should allow multiple operation type selection', () => {
      render(<MemoryLog operations={mockOperations} />);

      fireEvent.click(screen.getByTestId('operation-type-button-store'));
      fireEvent.click(screen.getByTestId('operation-type-button-search'));

      expect(screen.getByTestId('memory-operation-op-1')).toBeInTheDocument();
      expect(screen.getByTestId('memory-operation-op-3')).toBeInTheDocument();
      expect(screen.queryByTestId('memory-operation-op-2')).not.toBeInTheDocument();
    });
  });

  describe('Show values toggle', () => {
    it('should have show values checkbox', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.getByTestId('show-values-checkbox')).toBeInTheDocument();
    });

    it('should hide values by default', () => {
      render(<MemoryLog operations={mockOperations} />);

      expect(screen.queryByTestId('operation-value-op-1')).not.toBeInTheDocument();
    });

    it('should show values when checkbox is checked', () => {
      render(<MemoryLog operations={mockOperations} />);

      fireEvent.click(screen.getByTestId('show-values-checkbox'));

      expect(screen.getByTestId('operation-value-op-1')).toBeInTheDocument();
    });

    it('should toggle values visibility', () => {
      render(<MemoryLog operations={mockOperations} />);

      // Enable show values
      fireEvent.click(screen.getByTestId('show-values-checkbox'));
      expect(screen.getByTestId('operation-value-op-1')).toBeInTheDocument();

      // Disable show values
      fireEvent.click(screen.getByTestId('show-values-checkbox'));
      expect(screen.queryByTestId('operation-value-op-1')).not.toBeInTheDocument();
    });
  });

  describe('Operation selection', () => {
    it('should call onOperationSelect when operation is clicked', () => {
      const onOperationSelect = vi.fn();
      render(<MemoryLog operations={mockOperations} onOperationSelect={onOperationSelect} />);

      fireEvent.click(screen.getByTestId('memory-operation-op-1'));

      expect(onOperationSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'op-1', operation: 'store' })
      );
    });

    it('should highlight selected operation', () => {
      render(<MemoryLog operations={mockOperations} />);

      fireEvent.click(screen.getByTestId('memory-operation-op-1'));

      expect(screen.getByTestId('memory-operation-op-1')).toHaveClass('border-blue-500');
    });
  });
});
