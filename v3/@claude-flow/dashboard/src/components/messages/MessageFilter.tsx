/**
 * MessageFilter Component
 * Provides filtering controls for the message stream including:
 * - Source agent multi-select dropdown
 * - Target agent multi-select dropdown
 * - Message type filter chips
 * - Search input with debounce
 * - Clear filters button
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMessageStore } from '../../store/messageStore';
import type { MessageFilter as MessageFilterType, MessageType } from '../../store/messageStore';
import {
  ALL_MESSAGE_TYPES,
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_COLORS,
} from '../../types/messages';

/**
 * Props for MessageFilter component
 */
interface MessageFilterProps {
  filter: MessageFilterType;
  onFilterChange: (filter: Partial<MessageFilterType>) => void;
}

/**
 * Multi-select dropdown component for agent selection
 */
interface AgentDropdownProps {
  label: string;
  selectedAgents: string[];
  availableAgents: string[];
  onChange: (agents: string[]) => void;
  placeholder: string;
}

const AgentDropdown: React.FC<AgentDropdownProps> = ({
  label,
  selectedAgents,
  availableAgents,
  onChange,
  placeholder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleAgent = (agent: string) => {
    if (selectedAgents.includes(agent)) {
      onChange(selectedAgents.filter((a) => a !== agent));
    } else {
      onChange([...selectedAgents, agent]);
    }
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-xs font-medium text-slate-400 mb-1">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
      >
        <span className="truncate">
          {selectedAgents.length > 0
            ? `${selectedAgents.length} selected`
            : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {selectedAgents.length > 0 && (
            <button
              onClick={clearSelection}
              className="p-1 hover:bg-slate-700 rounded"
              aria-label="Clear selection"
            >
              <svg
                className="w-3 h-3 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
          >
            {availableAgents.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">
                No agents available
              </div>
            ) : (
              availableAgents.map((agent) => (
                <button
                  key={agent}
                  type="button"
                  onClick={() => toggleAgent(agent)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  <div
                    className={`w-4 h-4 rounded border ${
                      selectedAgents.includes(agent)
                        ? 'bg-blue-500 border-blue-500'
                        : 'border-slate-600'
                    } flex items-center justify-center`}
                  >
                    {selectedAgents.includes(agent) && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="truncate">{agent}</span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * Message type filter chip
 */
interface TypeChipProps {
  type: MessageType;
  isSelected: boolean;
  onClick: () => void;
}

const TypeChip: React.FC<TypeChipProps> = ({ type, isSelected, onClick }) => {
  const color = MESSAGE_TYPE_COLORS[type];
  const label = MESSAGE_TYPE_LABELS[type];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
        isSelected
          ? 'text-white shadow-lg'
          : 'text-slate-400 bg-slate-800 hover:bg-slate-700'
      }`}
      style={
        isSelected
          ? {
              backgroundColor: color,
              boxShadow: `0 0 12px ${color}40`,
            }
          : undefined
      }
    >
      {label}
    </motion.button>
  );
};

/**
 * Debounce hook for search input
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * MessageFilter component
 */
export const MessageFilter: React.FC<MessageFilterProps> = ({
  filter,
  onFilterChange,
}) => {
  // Extract unique agents from messages
  const messages = useMessageStore((state) => state.messages);
  const availableAgents = useMemo(() => {
    const agents = new Set<string>();
    messages.forEach((msg) => {
      agents.add(msg.source);
      if (msg.target) {
        agents.add(msg.target);
      }
    });
    return Array.from(agents).sort();
  }, [messages]);

  const [searchInput, setSearchInput] = useState(filter.search);

  // Debounce search input
  const debouncedSearch = useDebounce(searchInput, 150);

  // Update filter when debounced search changes
  useEffect(() => {
    if (debouncedSearch !== filter.search) {
      onFilterChange({ search: debouncedSearch });
    }
  }, [debouncedSearch, filter.search, onFilterChange]);

  // Handle source agents change
  const handleSourceAgentsChange = useCallback(
    (agents: string[]) => {
      onFilterChange({ source: agents });
    },
    [onFilterChange]
  );

  // Handle target agents change
  const handleTargetAgentsChange = useCallback(
    (agents: string[]) => {
      onFilterChange({ target: agents });
    },
    [onFilterChange]
  );

  // Toggle message type
  const toggleMessageType = useCallback(
    (type: MessageType) => {
      const currentTypes = filter.types;
      if (currentTypes.includes(type)) {
        onFilterChange({
          types: currentTypes.filter((t) => t !== type),
        });
      } else {
        onFilterChange({
          types: [...currentTypes, type],
        });
      }
    },
    [filter.types, onFilterChange]
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    onFilterChange({
      source: [],
      target: [],
      types: [],
      search: '',
    });
  }, [onFilterChange]);

  // Check if any filters are active
  const hasActiveFilters =
    filter.source.length > 0 ||
    filter.target.length > 0 ||
    filter.types.length > 0 ||
    filter.search.length > 0;

  return (
    <div className="p-4 bg-slate-900/50 border-b border-slate-800">
      {/* Search input */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-400 mb-1">
          Search Messages
        </label>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search in content, agents..."
            className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded"
              aria-label="Clear search"
            >
              <svg
                className="w-3 h-3 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Agent dropdowns */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <AgentDropdown
          label="Source Agent"
          selectedAgents={filter.source}
          availableAgents={availableAgents}
          onChange={handleSourceAgentsChange}
          placeholder="All sources"
        />
        <AgentDropdown
          label="Target Agent"
          selectedAgents={filter.target}
          availableAgents={availableAgents}
          onChange={handleTargetAgentsChange}
          placeholder="All targets"
        />
      </div>

      {/* Message type chips */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-400 mb-2">
          Message Type
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_MESSAGE_TYPES.map((type) => (
            <TypeChip
              key={type}
              type={type}
              isSelected={filter.types.includes(type)}
              onClick={() => toggleMessageType(type)}
            />
          ))}
        </div>
      </div>

      {/* Clear filters button */}
      <AnimatePresence>
        {hasActiveFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <button
              onClick={clearAllFilters}
              className="w-full py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Clear all filters
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MessageFilter;
