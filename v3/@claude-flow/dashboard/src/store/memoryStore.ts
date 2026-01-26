/**
 * Memory Store - Memory operations state management
 * Tracks memory read/write operations for visualization
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';

/**
 * Maximum operations to store
 */
const MAX_OPERATIONS = 1000;

/**
 * Memory operation types
 */
export type MemoryOperationType = 'store' | 'retrieve' | 'update' | 'delete' | 'search' | 'clear' | 'prune';

/**
 * Memory entry types (aligned with core interfaces)
 */
export type MemoryType = 'session' | 'persistent' | 'vector' | 'cache' | 'pattern';

/**
 * Memory operation result status
 */
export type OperationStatus = 'pending' | 'success' | 'error' | 'timeout';

/**
 * Memory operation representation
 */
export interface MemoryOperation {
  id: string;
  timestamp: Date;
  operation: MemoryOperationType;
  status: OperationStatus;

  // Target
  namespace: string;
  key: string;
  type: MemoryType;

  // Value (optionally stored based on showValues setting)
  value?: unknown;
  previousValue?: unknown;

  // Metrics
  duration?: number;
  size?: number;

  // Search-specific
  searchQuery?: string;
  searchResults?: number;

  // Agent/session context
  agentId?: string;
  sessionId?: string;

  // Error info
  error?: string;

  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Memory operation filter configuration
 */
export interface MemoryFilter {
  namespaces: string[];
  operations: MemoryOperationType[];
  types: MemoryType[];
  statuses: OperationStatus[];
  search: string;
  agentId?: string;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalOperations: number;
  byOperation: Record<MemoryOperationType, number>;
  byStatus: Record<OperationStatus, number>;
  avgDuration: number;
  errorRate: number;
  lastOperationAt: Date | null;
}

/**
 * Namespace info for sidebar
 */
export interface NamespaceInfo {
  name: string;
  keyCount: number;
  lastAccess: Date;
}

/**
 * Memory store state shape
 */
export interface MemoryStoreState {
  // State
  operations: MemoryOperation[];
  filter: MemoryFilter;
  showValues: boolean;
  stats: MemoryStats;

  // Known namespaces (for filtering)
  namespaces: Map<string, NamespaceInfo>;

  // Actions
  addOperation: (operation: Omit<MemoryOperation, 'id' | 'timestamp'> & { id?: string; timestamp?: Date }) => void;
  updateOperation: (operationId: string, updates: Partial<MemoryOperation>) => void;
  setFilter: (filter: Partial<MemoryFilter>) => void;
  clearFilter: () => void;
  setShowValues: (show: boolean) => void;
  toggleShowValues: () => void;
  clearOperations: () => void;
  registerNamespace: (namespace: string) => void;

  // Selectors
  getFilteredOperations: () => MemoryOperation[];
  getOperationById: (operationId: string) => MemoryOperation | undefined;
  getOperationsByNamespace: (namespace: string) => MemoryOperation[];
  getOperationsByKey: (key: string) => MemoryOperation[];
  getRecentOperations: (count: number) => MemoryOperation[];
}

/**
 * Default filter configuration
 */
const defaultFilter: MemoryFilter = {
  namespaces: [],
  operations: [],
  types: [],
  statuses: [],
  search: '',
};

/**
 * Initial stats
 */
const initialStats: MemoryStats = {
  totalOperations: 0,
  byOperation: {
    store: 0,
    retrieve: 0,
    update: 0,
    delete: 0,
    search: 0,
    clear: 0,
    prune: 0,
  },
  byStatus: {
    pending: 0,
    success: 0,
    error: 0,
    timeout: 0,
  },
  avgDuration: 0,
  errorRate: 0,
  lastOperationAt: null,
};

/**
 * Generate unique operation ID
 */
const generateOperationId = (): string => {
  return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Apply filter to operations
 */
const applyFilter = (operations: MemoryOperation[], filter: MemoryFilter): MemoryOperation[] => {
  return operations.filter((op) => {
    // Filter by namespaces
    if (filter.namespaces.length > 0 && !filter.namespaces.includes(op.namespace)) {
      return false;
    }

    // Filter by operations
    if (filter.operations.length > 0 && !filter.operations.includes(op.operation)) {
      return false;
    }

    // Filter by types
    if (filter.types.length > 0 && !filter.types.includes(op.type)) {
      return false;
    }

    // Filter by statuses
    if (filter.statuses.length > 0 && !filter.statuses.includes(op.status)) {
      return false;
    }

    // Filter by agent
    if (filter.agentId && op.agentId !== filter.agentId) {
      return false;
    }

    // Filter by search text
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const keyMatch = op.key.toLowerCase().includes(searchLower);
      const namespaceMatch = op.namespace.toLowerCase().includes(searchLower);
      const valueMatch = op.value
        ? JSON.stringify(op.value).toLowerCase().includes(searchLower)
        : false;

      if (!keyMatch && !namespaceMatch && !valueMatch) {
        return false;
      }
    }

    return true;
  });
};

/**
 * Calculate updated stats
 */
const calculateStats = (operations: MemoryOperation[]): MemoryStats => {
  const stats: MemoryStats = {
    totalOperations: operations.length,
    byOperation: {
      store: 0,
      retrieve: 0,
      update: 0,
      delete: 0,
      search: 0,
      clear: 0,
      prune: 0,
    },
    byStatus: {
      pending: 0,
      success: 0,
      error: 0,
      timeout: 0,
    },
    avgDuration: 0,
    errorRate: 0,
    lastOperationAt: null,
  };

  let totalDuration = 0;
  let durationCount = 0;
  let errorCount = 0;

  for (const op of operations) {
    stats.byOperation[op.operation]++;
    stats.byStatus[op.status]++;

    if (op.duration !== undefined) {
      totalDuration += op.duration;
      durationCount++;
    }

    if (op.status === 'error') {
      errorCount++;
    }

    if (!stats.lastOperationAt || op.timestamp > stats.lastOperationAt) {
      stats.lastOperationAt = op.timestamp;
    }
  }

  stats.avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;
  stats.errorRate = operations.length > 0 ? errorCount / operations.length : 0;

  return stats;
};

/**
 * Memory Zustand store
 */
export const useMemoryStore = create<MemoryStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      operations: [],
      filter: { ...defaultFilter },
      showValues: false,
      stats: { ...initialStats },
      namespaces: new Map(),

      // Actions
      addOperation: (operation) =>
        set(
          (state) => {
            const newOperation: MemoryOperation = {
              ...operation,
              id: operation.id ?? generateOperationId(),
              timestamp: operation.timestamp ?? new Date(),
            };

            // Circular buffer: remove oldest if at capacity
            const newOperations = state.operations.length >= MAX_OPERATIONS
              ? [...state.operations.slice(1), newOperation]
              : [...state.operations, newOperation];

            // Update namespaces
            const newNamespaces = new Map(state.namespaces);
            const existingNs = newNamespaces.get(newOperation.namespace);
            newNamespaces.set(newOperation.namespace, {
              name: newOperation.namespace,
              keyCount: existingNs ? existingNs.keyCount + 1 : 1,
              lastAccess: newOperation.timestamp,
            });

            return {
              operations: newOperations,
              stats: calculateStats(newOperations),
              namespaces: newNamespaces,
            };
          },
          false,
          'addOperation'
        ),

      updateOperation: (operationId, updates) =>
        set(
          (state) => {
            const newOperations = state.operations.map((op) =>
              op.id === operationId ? { ...op, ...updates } : op
            );
            return {
              operations: newOperations,
              stats: calculateStats(newOperations),
            };
          },
          false,
          'updateOperation'
        ),

      setFilter: (filterUpdates) =>
        set(
          (state) => ({
            filter: { ...state.filter, ...filterUpdates },
          }),
          false,
          'setFilter'
        ),

      clearFilter: () =>
        set({ filter: { ...defaultFilter } }, false, 'clearFilter'),

      setShowValues: (show) =>
        set({ showValues: show }, false, 'setShowValues'),

      toggleShowValues: () =>
        set((state) => ({ showValues: !state.showValues }), false, 'toggleShowValues'),

      clearOperations: () =>
        set(
          {
            operations: [],
            stats: { ...initialStats },
          },
          false,
          'clearOperations'
        ),

      registerNamespace: (namespace) =>
        set(
          (state) => {
            if (state.namespaces.has(namespace)) return state;
            const newNamespaces = new Map(state.namespaces);
            newNamespaces.set(namespace, {
              name: namespace,
              keyCount: 0,
              lastAccess: new Date(),
            });
            return { namespaces: newNamespaces };
          },
          false,
          'registerNamespace'
        ),

      // Selectors
      getFilteredOperations: () => applyFilter(get().operations, get().filter),

      getOperationById: (operationId) => get().operations.find((op) => op.id === operationId),

      getOperationsByNamespace: (namespace) =>
        get().operations.filter((op) => op.namespace === namespace),

      getOperationsByKey: (key) =>
        get().operations.filter((op) => op.key === key),

      getRecentOperations: (count) => get().operations.slice(-count),
    })),
    { name: 'MemoryStore' }
  )
);

/**
 * Selector hooks for optimized re-renders
 */
export const useMemoryOperations = () => useMemoryStore((state) => state.operations);
export const useMemoryFilter = () => useMemoryStore((state) => state.filter);
export const useShowValues = () => useMemoryStore((state) => state.showValues);
export const useMemoryStats = () => useMemoryStore((state) => state.stats);
export const useMemoryNamespaces = () => useMemoryStore((state) => state.namespaces);

/**
 * Get filtered operations with reactive updates
 */
export const useFilteredOperations = (): MemoryOperation[] => {
  const operations = useMemoryStore((state) => state.operations);
  const filter = useMemoryStore((state) => state.filter);
  return applyFilter(operations, filter);
};

/**
 * Get recent operations (last N)
 */
export const useRecentOperations = (count: number = 50): MemoryOperation[] => {
  const operations = useMemoryStore((state) => state.operations);
  return operations.slice(-count);
};

/**
 * Get operations for a specific namespace
 */
export const useNamespaceOperations = (namespace: string): MemoryOperation[] => {
  const operations = useMemoryStore((state) => state.operations);
  return operations.filter((op) => op.namespace === namespace);
};
