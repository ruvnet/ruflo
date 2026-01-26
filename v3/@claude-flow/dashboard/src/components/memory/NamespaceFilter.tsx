/**
 * NamespaceFilter Component
 * Provides filter chips for memory namespaces with operation counts
 */

import React from 'react';
import type { NamespaceStats } from '../../types/memory';

interface NamespaceFilterProps {
  namespaces: NamespaceStats[];
  selectedNamespaces: string[];
  onChange: (namespaces: string[]) => void;
}

export const NamespaceFilter: React.FC<NamespaceFilterProps> = ({
  namespaces,
  selectedNamespaces,
  onChange,
}) => {
  const handleToggleNamespace = (namespace: string) => {
    if (selectedNamespaces.includes(namespace)) {
      onChange(selectedNamespaces.filter((ns) => ns !== namespace));
    } else {
      onChange([...selectedNamespaces, namespace]);
    }
  };

  const handleSelectAll = () => {
    onChange(namespaces.map((ns) => ns.namespace));
  };

  const handleSelectNone = () => {
    onChange([]);
  };

  const isSelected = (namespace: string) => selectedNamespaces.includes(namespace);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Namespaces</span>
        <div className="flex gap-1">
          <button
            onClick={handleSelectAll}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            aria-label="Select all namespaces"
          >
            All
          </button>
          <button
            onClick={handleSelectNone}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            aria-label="Clear namespace selection"
          >
            None
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {namespaces.length === 0 ? (
          <span className="text-sm text-gray-500 italic">No namespaces yet</span>
        ) : (
          namespaces.map((ns) => (
            <button
              key={ns.namespace}
              onClick={() => handleToggleNamespace(ns.namespace)}
              className={`
                inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                transition-all duration-150
                ${
                  isSelected(ns.namespace)
                    ? 'bg-purple-600 text-white ring-1 ring-purple-400'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }
              `}
              aria-pressed={isSelected(ns.namespace)}
            >
              <span className="truncate max-w-[120px]">{ns.namespace}</span>
              <span
                className={`
                  inline-flex items-center justify-center min-w-[20px] h-4 px-1 rounded-full text-[10px]
                  ${isSelected(ns.namespace) ? 'bg-purple-700 text-purple-100' : 'bg-gray-600 text-gray-400'}
                `}
              >
                {ns.operationCount}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default NamespaceFilter;
