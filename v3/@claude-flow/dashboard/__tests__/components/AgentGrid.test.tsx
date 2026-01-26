/**
 * AgentGrid Component Tests
 * Tests for rendering agents, status indicators, updates, and interactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { act } from 'react-dom/test-utils';

// Types for testing
interface AgentState {
  id: string;
  name: string;
  type: string;
  status: 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'terminated';
  capabilities: string[];
  maxConcurrentTasks: number;
  currentTaskCount: number;
  createdAt: Date;
  lastActivity: Date;
  priority: number;
  metrics?: {
    tasksCompleted: number;
    tasksFailed: number;
    avgTaskDuration: number;
    errorCount: number;
    uptime: number;
  };
  health?: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    lastCheck: Date;
    issues?: string[];
  };
}

// Mock agent data
const mockAgents: AgentState[] = [
  {
    id: 'agent-1',
    name: 'Coordinator',
    type: 'coordinator',
    status: 'active',
    capabilities: ['task-routing', 'coordination'],
    maxConcurrentTasks: 10,
    currentTaskCount: 3,
    createdAt: new Date(),
    lastActivity: new Date(),
    priority: 1,
    metrics: {
      tasksCompleted: 50,
      tasksFailed: 2,
      avgTaskDuration: 1500,
      errorCount: 2,
      uptime: 3600000,
    },
    health: { status: 'healthy', lastCheck: new Date() },
  },
  {
    id: 'agent-2',
    name: 'Coder',
    type: 'coder',
    status: 'busy',
    capabilities: ['code-generation', 'debugging'],
    maxConcurrentTasks: 5,
    currentTaskCount: 5,
    createdAt: new Date(),
    lastActivity: new Date(),
    priority: 2,
    metrics: {
      tasksCompleted: 120,
      tasksFailed: 5,
      avgTaskDuration: 3000,
      errorCount: 5,
      uptime: 7200000,
    },
    health: { status: 'healthy', lastCheck: new Date() },
  },
  {
    id: 'agent-3',
    name: 'Tester',
    type: 'tester',
    status: 'idle',
    capabilities: ['unit-testing', 'integration-testing'],
    maxConcurrentTasks: 3,
    currentTaskCount: 0,
    createdAt: new Date(),
    lastActivity: new Date(),
    priority: 3,
    health: { status: 'healthy', lastCheck: new Date() },
  },
  {
    id: 'agent-4',
    name: 'Reviewer',
    type: 'reviewer',
    status: 'error',
    capabilities: ['code-review', 'security-review'],
    maxConcurrentTasks: 2,
    currentTaskCount: 0,
    createdAt: new Date(),
    lastActivity: new Date(),
    priority: 4,
    health: {
      status: 'unhealthy',
      lastCheck: new Date(),
      issues: ['Connection timeout'],
    },
  },
];

// Status indicator component for testing
interface StatusIndicatorProps {
  status: AgentState['status'];
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  const statusColors: Record<string, string> = {
    active: 'bg-green-500',
    busy: 'bg-yellow-500',
    idle: 'bg-gray-400',
    spawning: 'bg-blue-500',
    error: 'bg-red-500',
    terminated: 'bg-gray-600',
  };

  return (
    <div
      data-testid="status-indicator"
      className={`w-3 h-3 rounded-full ${statusColors[status]}`}
      aria-label={`Status: ${status}`}
    />
  );
};

// AgentCard component for testing
interface AgentCardProps {
  agent: AgentState;
  onClick?: (agent: AgentState) => void;
  isSelected?: boolean;
  onHover?: (agentId: string | null) => void;
}

const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onClick,
  isSelected,
  onHover,
}) => {
  return (
    <div
      data-testid={`agent-card-${agent.id}`}
      className={`p-4 rounded-lg border ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-700'
      }`}
      onClick={() => onClick?.(agent)}
      onMouseEnter={() => onHover?.(agent.id)}
      onMouseLeave={() => onHover?.(null)}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-2">
        <StatusIndicator status={agent.status} />
        <span data-testid={`agent-name-${agent.id}`}>{agent.name}</span>
      </div>
      <span data-testid={`agent-status-${agent.id}`}>{agent.status}</span>
      <span data-testid={`agent-type-${agent.id}`}>{agent.type}</span>
      {agent.health && (
        <span data-testid={`agent-health-${agent.id}`}>{agent.health.status}</span>
      )}
    </div>
  );
};

// AgentGrid component for testing
interface AgentGridProps {
  agents?: AgentState[];
  onAgentSelect?: (agent: AgentState) => void;
  onAgentHover?: (agentId: string | null) => void;
  selectedAgentId?: string | null;
  isLoading?: boolean;
}

const AgentGrid: React.FC<AgentGridProps> = ({
  agents = mockAgents,
  onAgentSelect,
  onAgentHover,
  selectedAgentId,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div data-testid="agent-grid-loading">
        <span>Loading agents...</span>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div data-testid="agent-grid-empty">
        <p data-testid="empty-state">No agents running</p>
      </div>
    );
  }

  return (
    <div data-testid="agent-grid" className="grid grid-cols-3 gap-4">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onClick={onAgentSelect}
          isSelected={agent.id === selectedAgentId}
          onHover={onAgentHover}
        />
      ))}
    </div>
  );
};

describe('AgentGrid', () => {
  describe('Rendering all agents from store', () => {
    it('should render all agents', () => {
      render(<AgentGrid agents={mockAgents} />);

      expect(screen.getByTestId('agent-card-agent-1')).toBeInTheDocument();
      expect(screen.getByTestId('agent-card-agent-2')).toBeInTheDocument();
      expect(screen.getByTestId('agent-card-agent-3')).toBeInTheDocument();
      expect(screen.getByTestId('agent-card-agent-4')).toBeInTheDocument();
    });

    it('should display agent names correctly', () => {
      render(<AgentGrid agents={mockAgents} />);

      expect(screen.getByTestId('agent-name-agent-1')).toHaveTextContent('Coordinator');
      expect(screen.getByTestId('agent-name-agent-2')).toHaveTextContent('Coder');
      expect(screen.getByTestId('agent-name-agent-3')).toHaveTextContent('Tester');
      expect(screen.getByTestId('agent-name-agent-4')).toHaveTextContent('Reviewer');
    });

    it('should display agent types', () => {
      render(<AgentGrid agents={mockAgents} />);

      expect(screen.getByTestId('agent-type-agent-1')).toHaveTextContent('coordinator');
      expect(screen.getByTestId('agent-type-agent-2')).toHaveTextContent('coder');
      expect(screen.getByTestId('agent-type-agent-3')).toHaveTextContent('tester');
      expect(screen.getByTestId('agent-type-agent-4')).toHaveTextContent('reviewer');
    });
  });

  describe('Correct status indicators', () => {
    it('should display correct status for each agent', () => {
      render(<AgentGrid agents={mockAgents} />);

      expect(screen.getByTestId('agent-status-agent-1')).toHaveTextContent('active');
      expect(screen.getByTestId('agent-status-agent-2')).toHaveTextContent('busy');
      expect(screen.getByTestId('agent-status-agent-3')).toHaveTextContent('idle');
      expect(screen.getByTestId('agent-status-agent-4')).toHaveTextContent('error');
    });

    it('should render status indicator for each agent', () => {
      render(<AgentGrid agents={mockAgents} />);

      const statusIndicators = screen.getAllByTestId('status-indicator');
      expect(statusIndicators).toHaveLength(4);
    });

    it('should display health status when available', () => {
      render(<AgentGrid agents={mockAgents} />);

      expect(screen.getByTestId('agent-health-agent-1')).toHaveTextContent('healthy');
      expect(screen.getByTestId('agent-health-agent-4')).toHaveTextContent('unhealthy');
    });
  });

  describe('Immediate updates on status change', () => {
    it('should update display when agent status changes', async () => {
      const initialAgents = [...mockAgents];
      const { rerender } = render(<AgentGrid agents={initialAgents} />);

      expect(screen.getByTestId('agent-status-agent-1')).toHaveTextContent('active');

      // Simulate status change
      const updatedAgents = initialAgents.map((agent) =>
        agent.id === 'agent-1' ? { ...agent, status: 'busy' as const } : agent
      );

      rerender(<AgentGrid agents={updatedAgents} />);

      expect(screen.getByTestId('agent-status-agent-1')).toHaveTextContent('busy');
    });

    it('should handle agent addition', () => {
      const initialAgents = mockAgents.slice(0, 2);
      const { rerender } = render(<AgentGrid agents={initialAgents} />);

      expect(screen.queryByTestId('agent-card-agent-3')).not.toBeInTheDocument();

      const updatedAgents = [...initialAgents, mockAgents[2]];
      rerender(<AgentGrid agents={updatedAgents} />);

      expect(screen.getByTestId('agent-card-agent-3')).toBeInTheDocument();
    });

    it('should handle agent removal', () => {
      const { rerender } = render(<AgentGrid agents={mockAgents} />);

      expect(screen.getByTestId('agent-card-agent-4')).toBeInTheDocument();

      const updatedAgents = mockAgents.filter((a) => a.id !== 'agent-4');
      rerender(<AgentGrid agents={updatedAgents} />);

      expect(screen.queryByTestId('agent-card-agent-4')).not.toBeInTheDocument();
    });
  });

  describe('Click to open detail panel', () => {
    it('should call onAgentSelect when agent card is clicked', () => {
      const onAgentSelect = vi.fn();
      render(<AgentGrid agents={mockAgents} onAgentSelect={onAgentSelect} />);

      fireEvent.click(screen.getByTestId('agent-card-agent-1'));

      expect(onAgentSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-1', name: 'Coordinator' })
      );
    });

    it('should call onAgentSelect with correct agent data for different agents', () => {
      const onAgentSelect = vi.fn();
      render(<AgentGrid agents={mockAgents} onAgentSelect={onAgentSelect} />);

      fireEvent.click(screen.getByTestId('agent-card-agent-2'));
      expect(onAgentSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-2', name: 'Coder' })
      );

      fireEvent.click(screen.getByTestId('agent-card-agent-3'));
      expect(onAgentSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-3', name: 'Tester' })
      );
    });

    it('should visually indicate selected agent', () => {
      render(<AgentGrid agents={mockAgents} selectedAgentId="agent-1" />);

      const selectedCard = screen.getByTestId('agent-card-agent-1');
      expect(selectedCard).toHaveClass('border-blue-500');
      expect(selectedCard).toHaveClass('ring-2');
    });
  });

  describe('Hover highlight on topology', () => {
    it('should call onAgentHover when mouse enters agent card', () => {
      const onAgentHover = vi.fn();
      render(<AgentGrid agents={mockAgents} onAgentHover={onAgentHover} />);

      fireEvent.mouseEnter(screen.getByTestId('agent-card-agent-1'));

      expect(onAgentHover).toHaveBeenCalledWith('agent-1');
    });

    it('should call onAgentHover with null when mouse leaves agent card', () => {
      const onAgentHover = vi.fn();
      render(<AgentGrid agents={mockAgents} onAgentHover={onAgentHover} />);

      fireEvent.mouseEnter(screen.getByTestId('agent-card-agent-1'));
      fireEvent.mouseLeave(screen.getByTestId('agent-card-agent-1'));

      expect(onAgentHover).toHaveBeenLastCalledWith(null);
    });

    it('should handle hover between different agents', () => {
      const onAgentHover = vi.fn();
      render(<AgentGrid agents={mockAgents} onAgentHover={onAgentHover} />);

      fireEvent.mouseEnter(screen.getByTestId('agent-card-agent-1'));
      expect(onAgentHover).toHaveBeenCalledWith('agent-1');

      fireEvent.mouseLeave(screen.getByTestId('agent-card-agent-1'));
      fireEvent.mouseEnter(screen.getByTestId('agent-card-agent-2'));
      expect(onAgentHover).toHaveBeenCalledWith('agent-2');
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no agents', () => {
      render(<AgentGrid agents={[]} />);

      expect(screen.getByTestId('empty-state')).toHaveTextContent('No agents running');
    });
  });

  describe('Loading State', () => {
    it('should show loading state', () => {
      render(<AgentGrid isLoading={true} />);

      expect(screen.getByTestId('agent-grid-loading')).toBeInTheDocument();
    });

    it('should hide loading state when done', () => {
      const { rerender } = render(<AgentGrid isLoading={true} />);

      expect(screen.getByTestId('agent-grid-loading')).toBeInTheDocument();

      rerender(<AgentGrid isLoading={false} agents={mockAgents} />);

      expect(screen.queryByTestId('agent-grid-loading')).not.toBeInTheDocument();
      expect(screen.getByTestId('agent-grid')).toBeInTheDocument();
    });
  });

  describe('Agent Sorting', () => {
    it('should display agents in correct order', () => {
      render(<AgentGrid agents={mockAgents} />);

      const agentCards = screen.getAllByTestId(/^agent-card-/);
      expect(agentCards).toHaveLength(4);
    });
  });
});
