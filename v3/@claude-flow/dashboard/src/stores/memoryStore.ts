/**
 * Memory Store for managing memory operation state
 * Uses Zustand for lightweight, reactive state management
 */

import { create } from 'zustand';
import type { MemoryOperation, MemoryOperationType, NamespaceStats, MemoryFilters } from '../types/memory';

const MAX_OPERATIONS = 1000;

interface MemoryState {
  operations: MemoryOperation[];
  filters: MemoryFilters;
  selectedOperation: MemoryOperation | null;
  namespaceStats: Map<string, NamespaceStats>;

  // Actions
  addOperation: (operation: MemoryOperation) => void;
  setFilters: (filters: Partial<MemoryFilters>) => void;
  setSelectedOperation: (operation: MemoryOperation | null) => void;
  clearOperations: () => void;

  // Computed
  getFilteredOperations: () => MemoryOperation[];
  getNamespaces: () => string[];
  getCacheHitRate: () => number;
  getTotalOperations: () => number;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  operations: [],
  filters: {
    namespaces: [],
    operations: [],
    showValues: false,
  },
  selectedOperation: null,
  namespaceStats: new Map(),

  addOperation: (operation: MemoryOperation) => {
    set((state) => {
      const newOperations = [operation, ...state.operations].slice(0, MAX_OPERATIONS);

      // Update namespace stats
      const stats = new Map(state.namespaceStats);
      const existing = stats.get(operation.namespace) || {
        namespace: operation.namespace,
        operationCount: 0,
        storeCount: 0,
        retrieveCount: 0,
        searchCount: 0,
        deleteCount: 0,
      };

      existing.operationCount++;
      switch (operation.operation) {
        case 'store':
          existing.storeCount++;
          break;
        case 'retrieve':
          existing.retrieveCount++;
          break;
        case 'search':
          existing.searchCount++;
          break;
        case 'delete':
          existing.deleteCount++;
          break;
      }
      stats.set(operation.namespace, existing);

      return { operations: newOperations, namespaceStats: stats };
    });
  },

  setFilters: (filters: Partial<MemoryFilters>) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
    }));
  },

  setSelectedOperation: (operation: MemoryOperation | null) => {
    set({ selectedOperation: operation });
  },

  clearOperations: () => {
    set({ operations: [], namespaceStats: new Map() });
  },

  getFilteredOperations: () => {
    const { operations, filters } = get();
    return operations.filter((op) => {
      // Filter by namespace
      if (filters.namespaces.length > 0 && !filters.namespaces.includes(op.namespace)) {
        return false;
      }
      // Filter by operation type
      if (filters.operations.length > 0 && !filters.operations.includes(op.operation)) {
        return false;
      }
      return true;
    });
  },

  getNamespaces: () => {
    const { namespaceStats } = get();
    return Array.from(namespaceStats.keys()).sort();
  },

  getCacheHitRate: () => {
    const { operations } = get();
    const retrieveOps = operations.filter((op) => op.operation === 'retrieve');
    if (retrieveOps.length === 0) return 0;
    const hits = retrieveOps.filter((op) => op.cacheHit === true).length;
    return (hits / retrieveOps.length) * 100;
  },

  getTotalOperations: () => {
    return get().operations.length;
  },
}));

export type { MemoryState };
