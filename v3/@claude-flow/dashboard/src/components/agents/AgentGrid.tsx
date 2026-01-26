/**
 * AgentGrid Component
 * Renders a responsive grid of AgentCard components
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentCard } from './AgentCard';
import { useAgentStore, useAgentsArray, type AgentState } from '../../store';

interface AgentGridProps {
  onAgentSelect?: (agent: AgentState) => void;
  filter?: {
    status?: string[];
    type?: string[];
  };
  className?: string;
}

const EmptyState: React.FC = () => (
  <motion.div
    className="col-span-full flex flex-col items-center justify-center py-16 px-4"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.3 }}
  >
    <div className="w-16 h-16 mb-4 text-slate-600">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
        />
      </svg>
    </div>
    <h3 className="text-lg font-medium text-slate-400 mb-2">No Agents Active</h3>
    <p className="text-sm text-slate-500 text-center max-w-sm">
      No agents are currently running. Spawn a new swarm or agent to see them appear here.
    </p>
  </motion.div>
);

const LoadingState: React.FC = () => (
  <div className="col-span-full flex flex-col items-center justify-center py-16 px-4">
    <motion.div
      className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
    />
    <p className="mt-4 text-sm text-slate-400">Loading agents...</p>
  </div>
);

const ErrorState: React.FC<{ error: string }> = ({ error }) => (
  <motion.div
    className="col-span-full flex flex-col items-center justify-center py-16 px-4"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
  >
    <div className="w-16 h-16 mb-4 text-red-500">
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    </div>
    <h3 className="text-lg font-medium text-red-400 mb-2">Error Loading Agents</h3>
    <p className="text-sm text-slate-500 text-center max-w-sm">{error}</p>
  </motion.div>
);

export const AgentGrid: React.FC<AgentGridProps> = ({ onAgentSelect, filter, className = '' }) => {
  const agents = useAgentsArray();
  const isLoading = useAgentStore((state) => state.isLoading);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);

  // Apply filters
  const filteredAgents = React.useMemo(() => {
    let result = agents;

    if (filter?.status && filter.status.length > 0) {
      result = result.filter((agent) => filter.status!.includes(agent.status));
    }

    if (filter?.type && filter.type.length > 0) {
      result = result.filter((agent) => filter.type!.includes(agent.type));
    }

    // Sort by status priority (active > busy > spawning > idle > error > terminated)
    const statusPriority: Record<string, number> = {
      active: 0,
      busy: 1,
      spawning: 2,
      idle: 3,
      error: 4,
      terminated: 5,
    };

    return [...result].sort(
      (a, b) => (statusPriority[a.status] ?? 6) - (statusPriority[b.status] ?? 6)
    );
  }, [agents, filter]);

  const handleAgentClick = (agent: AgentState) => {
    setSelectedAgentId(agent.id);
    onAgentSelect?.(agent);
  };

  if (isLoading) {
    return (
      <div className={`grid ${className}`}>
        <LoadingState />
      </div>
    );
  }

  return (
    <div
      className={`
        grid gap-4
        grid-cols-1
        sm:grid-cols-2
        lg:grid-cols-3
        xl:grid-cols-4
        ${className}
      `}
    >
      <AnimatePresence mode="popLayout">
        {filteredAgents.length === 0 ? (
          <EmptyState />
        ) : (
          filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onClick={handleAgentClick}
              isSelected={agent.id === selectedAgentId}
            />
          ))
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentGrid;
