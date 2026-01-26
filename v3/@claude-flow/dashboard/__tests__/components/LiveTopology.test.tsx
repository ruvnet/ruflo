/**
 * LiveTopology Component Tests
 * Tests for topology visualization, animations, layout switching, and interactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React, { useState } from 'react';

// Types
type AgentStatus = 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'terminated';
type TopologyLayoutType = 'force' | 'hierarchical' | 'circular' | 'grid';
type EdgeHealth = 'healthy' | 'degraded' | 'unhealthy';

interface Position {
  x: number;
  y: number;
}

interface TopologyNode {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
}

interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  health: EdgeHealth;
  isActive: boolean;
}

interface MessageParticleData {
  id: string;
  sourceId: string;
  targetId: string;
  messageType: string;
}

// Mock nodes
const mockNodes: TopologyNode[] = [
  { id: 'node-1', name: 'Coordinator', type: 'coordinator', status: 'active' },
  { id: 'node-2', name: 'Coder', type: 'coder', status: 'busy' },
  { id: 'node-3', name: 'Tester', type: 'tester', status: 'idle' },
  { id: 'node-4', name: 'Reviewer', type: 'reviewer', status: 'error' },
];

// Mock edges
const mockEdges: TopologyEdge[] = [
  { id: 'edge-1', source: 'node-1', target: 'node-2', health: 'healthy', isActive: true },
  { id: 'edge-2', source: 'node-1', target: 'node-3', health: 'healthy', isActive: false },
  { id: 'edge-3', source: 'node-2', target: 'node-3', health: 'degraded', isActive: false },
  { id: 'edge-4', source: 'node-1', target: 'node-4', health: 'unhealthy', isActive: false },
];

// Mock messages for particles
const mockMessages: MessageParticleData[] = [
  { id: 'msg-1', sourceId: 'node-1', targetId: 'node-2', messageType: 'task' },
  { id: 'msg-2', sourceId: 'node-2', targetId: 'node-1', messageType: 'response' },
];

// Node positions for testing
const mockNodePositions: Map<string, Position> = new Map([
  ['node-1', { x: 100, y: 100 }],
  ['node-2', { x: 200, y: 150 }],
  ['node-3', { x: 150, y: 250 }],
  ['node-4', { x: 300, y: 100 }],
]);

// Status colors
const getStatusColor = (status: AgentStatus): string => {
  const colors: Record<AgentStatus, string> = {
    active: '#22c55e',
    busy: '#eab308',
    idle: '#6b7280',
    spawning: '#3b82f6',
    error: '#ef4444',
    terminated: '#374151',
  };
  return colors[status];
};

// Edge health colors
const getEdgeHealthColor = (health: EdgeHealth): string => {
  const colors: Record<EdgeHealth, string> = {
    healthy: '#22c55e',
    degraded: '#eab308',
    unhealthy: '#ef4444',
  };
  return colors[health];
};

// AnimatedEdge component
interface AnimatedEdgeProps {
  id: string;
  source: Position;
  target: Position;
  health: EdgeHealth;
  isActive: boolean;
}

const AnimatedEdge: React.FC<AnimatedEdgeProps> = ({
  id,
  source,
  target,
  health,
  isActive,
}) => {
  const color = getEdgeHealthColor(health);

  return (
    <g data-testid={`edge-${id}`}>
      <line
        x1={source.x}
        y1={source.y}
        x2={target.x}
        y2={target.y}
        stroke={color}
        strokeWidth={isActive ? 3 : 1}
        data-testid={`edge-line-${id}`}
        data-health={health}
        data-active={isActive}
      />
    </g>
  );
};

// MessageParticle component
interface MessageParticleProps {
  sourcePos: Position;
  targetPos: Position;
  messageType: string;
  onComplete: () => void;
}

const MessageParticle: React.FC<MessageParticleProps> = ({
  sourcePos,
  targetPos,
  messageType,
  onComplete,
}) => {
  const [progress, setProgress] = useState(0);
  const completedRef = React.useRef(false);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 1) {
          clearInterval(interval);
          return 1;
        }
        return p + 0.1;
      });
    }, 50);

    return () => clearInterval(interval);
  }, []);

  // Call onComplete outside of setState to avoid React warning
  React.useEffect(() => {
    if (progress >= 1 && !completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }, [progress, onComplete]);

  const x = sourcePos.x + (targetPos.x - sourcePos.x) * progress;
  const y = sourcePos.y + (targetPos.y - sourcePos.y) * progress;

  return (
    <circle
      data-testid="message-particle"
      data-message-type={messageType}
      cx={x}
      cy={y}
      r={4}
      fill="#3b82f6"
    />
  );
};

// TopologyNode component
interface TopologyNodeProps {
  node: TopologyNode;
  position: Position;
  isSelected: boolean;
  showLabels: boolean;
  showAnimations: boolean;
  onClick: (nodeId: string) => void;
  onDragStart: (nodeId: string, x: number, y: number) => void;
  onDrag: (nodeId: string, x: number, y: number) => void;
  onDragEnd: (nodeId: string) => void;
}

const TopologyNodeComponent: React.FC<TopologyNodeProps> = ({
  node,
  position,
  isSelected,
  showLabels,
  showAnimations,
  onClick,
}) => {
  const color = getStatusColor(node.status);
  const isActive = node.status === 'active' || node.status === 'busy';

  return (
    <g
      data-testid={`topology-node-${node.id}`}
      transform={`translate(${position.x}, ${position.y})`}
      onClick={() => onClick(node.id)}
      style={{ cursor: 'pointer' }}
    >
      {/* Selection ring */}
      {isSelected && (
        <circle
          data-testid={`selection-ring-${node.id}`}
          r={32}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={3}
        />
      )}

      {/* Pulsing animation for active nodes */}
      {isActive && showAnimations && (
        <circle
          data-testid={`pulse-animation-${node.id}`}
          r={24}
          fill="none"
          stroke={color}
          strokeWidth={2}
          opacity={0.5}
          className="pulse-animation"
        />
      )}

      {/* Node circle */}
      <circle
        data-testid={`node-circle-${node.id}`}
        r={24}
        fill={color}
        data-status={node.status}
      />

      {/* Node label */}
      {showLabels && (
        <text
          data-testid={`node-label-${node.id}`}
          y={40}
          textAnchor="middle"
          fill="#e2e8f0"
          fontSize={11}
        >
          {node.name}
        </text>
      )}
    </g>
  );
};

// TopologyControls component
interface TopologyControlsProps {
  layout: TopologyLayoutType;
  onLayoutChange: (layout: TopologyLayoutType) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  showAnimations: boolean;
  onToggleAnimations: () => void;
}

const TopologyControls: React.FC<TopologyControlsProps> = ({
  layout,
  onLayoutChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  showLabels,
  onToggleLabels,
  showAnimations,
  onToggleAnimations,
}) => {
  const layouts: TopologyLayoutType[] = ['force', 'hierarchical', 'circular', 'grid'];

  return (
    <div data-testid="topology-controls">
      <div data-testid="layout-buttons">
        {layouts.map((l) => (
          <button
            key={l}
            data-testid={`layout-button-${l}`}
            onClick={() => onLayoutChange(l)}
            aria-pressed={layout === l}
            className={layout === l ? 'active' : ''}
          >
            {l}
          </button>
        ))}
      </div>

      <div data-testid="zoom-controls">
        <button data-testid="zoom-in-button" onClick={onZoomIn}>
          +
        </button>
        <span data-testid="zoom-level">{(zoom * 100).toFixed(0)}%</span>
        <button data-testid="zoom-out-button" onClick={onZoomOut}>
          -
        </button>
        <button data-testid="fit-button" onClick={onFitToScreen}>
          Fit
        </button>
      </div>

      <div data-testid="toggle-controls">
        <label>
          <input
            type="checkbox"
            data-testid="toggle-labels"
            checked={showLabels}
            onChange={onToggleLabels}
          />
          Labels
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="toggle-animations"
            checked={showAnimations}
            onChange={onToggleAnimations}
          />
          Animations
        </label>
      </div>
    </div>
  );
};

// LiveTopology component
interface LiveTopologyProps {
  nodes?: TopologyNode[];
  edges?: TopologyEdge[];
  messages?: MessageParticleData[];
  nodePositions?: Map<string, Position>;
  initialLayout?: TopologyLayoutType;
  onNodeSelect?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  width?: number;
  height?: number;
  showLabels?: boolean;
  showAnimations?: boolean;
}

const LiveTopology: React.FC<LiveTopologyProps> = ({
  nodes = mockNodes,
  edges = mockEdges,
  messages = [],
  nodePositions = mockNodePositions,
  initialLayout = 'force',
  onNodeSelect,
  selectedNodeId = null,
  width = 800,
  height = 600,
  showLabels: initialShowLabels = true,
  showAnimations: initialShowAnimations = true,
}) => {
  const [layout, setLayout] = useState<TopologyLayoutType>(initialLayout);
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(initialShowLabels);
  const [showAnimations, setShowAnimations] = useState(initialShowAnimations);
  const [activeParticles, setActiveParticles] = useState<MessageParticleData[]>(messages);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleLayoutChange = (newLayout: TopologyLayoutType) => {
    setLayout(newLayout);
    setIsSimulating(true);
    // Simulate layout transition
    setTimeout(() => setIsSimulating(false), 500);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.3, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z * 0.7, 0.25));
  const handleFitToScreen = () => setZoom(1);

  const handleNodeClick = (nodeId: string) => {
    onNodeSelect?.(nodeId);
  };

  const handleParticleComplete = (particleId: string) => {
    setActiveParticles((prev) => prev.filter((p) => p.id !== particleId));
  };

  const getNodePosition = (nodeId: string): Position | null => {
    return nodePositions.get(nodeId) || null;
  };

  // Add new particles when messages change
  React.useEffect(() => {
    if (showAnimations && messages.length > 0) {
      const newParticles = messages.filter(
        (msg) => !activeParticles.some((p) => p.id === msg.id)
      );
      if (newParticles.length > 0) {
        setActiveParticles((prev) => [...prev, ...newParticles]);
      }
    }
  }, [messages, showAnimations, activeParticles]);

  return (
    <div data-testid="live-topology">
      <TopologyControls
        layout={layout}
        onLayoutChange={handleLayoutChange}
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToScreen={handleFitToScreen}
        showLabels={showLabels}
        onToggleLabels={() => setShowLabels(!showLabels)}
        showAnimations={showAnimations}
        onToggleAnimations={() => setShowAnimations(!showAnimations)}
      />

      {isSimulating && (
        <div data-testid="simulating-indicator">Simulating...</div>
      )}

      <svg data-testid="topology-svg" width={width} height={height}>
        <g data-testid="edges-layer">
          {edges.map((edge) => {
            const sourcePos = getNodePosition(edge.source);
            const targetPos = getNodePosition(edge.target);
            if (!sourcePos || !targetPos) return null;

            return (
              <AnimatedEdge
                key={edge.id}
                id={edge.id}
                source={sourcePos}
                target={targetPos}
                health={edge.health}
                isActive={edge.isActive}
              />
            );
          })}
        </g>

        <g data-testid="nodes-layer">
          {nodes.map((node) => {
            const position = getNodePosition(node.id);
            if (!position) return null;

            return (
              <TopologyNodeComponent
                key={node.id}
                node={node}
                position={position}
                isSelected={node.id === selectedNodeId}
                showLabels={showLabels}
                showAnimations={showAnimations}
                onClick={handleNodeClick}
                onDragStart={() => {}}
                onDrag={() => {}}
                onDragEnd={() => {}}
              />
            );
          })}
        </g>

        <g data-testid="particles-layer">
          {showAnimations &&
            activeParticles.map((particle) => {
              const sourcePos = getNodePosition(particle.sourceId);
              const targetPos = getNodePosition(particle.targetId);
              if (!sourcePos || !targetPos) return null;

              return (
                <MessageParticle
                  key={particle.id}
                  sourcePos={sourcePos}
                  targetPos={targetPos}
                  messageType={particle.messageType}
                  onComplete={() => handleParticleComplete(particle.id)}
                />
              );
            })}
        </g>
      </svg>
    </div>
  );
};

describe('LiveTopology', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Message particle animation', () => {
    it('should render message particles when messages are provided', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          edges={mockEdges}
          messages={mockMessages}
          nodePositions={mockNodePositions}
          showAnimations={true}
        />
      );

      const particles = screen.getAllByTestId('message-particle');
      expect(particles.length).toBeGreaterThan(0);
    });

    it('should display correct message type on particles', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          edges={mockEdges}
          messages={mockMessages}
          nodePositions={mockNodePositions}
          showAnimations={true}
        />
      );

      const particles = screen.getAllByTestId('message-particle');
      const taskParticle = particles.find(
        (p) => p.getAttribute('data-message-type') === 'task'
      );
      expect(taskParticle).toBeInTheDocument();
    });

    it('should not render particles when animations are disabled', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          edges={mockEdges}
          messages={mockMessages}
          nodePositions={mockNodePositions}
          showAnimations={false}
        />
      );

      expect(screen.queryByTestId('message-particle')).not.toBeInTheDocument();
    });

    it('should animate particles along edge', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          edges={mockEdges}
          messages={[mockMessages[0]]}
          nodePositions={mockNodePositions}
          showAnimations={true}
        />
      );

      const particle = screen.getByTestId('message-particle');
      expect(particle).toBeInTheDocument();

      // Particle should be positioned between source and target
      const cx = parseFloat(particle.getAttribute('cx') || '0');
      const cy = parseFloat(particle.getAttribute('cy') || '0');

      // Source is node-1 (100, 100), target is node-2 (200, 150)
      // Initial position should be at or near source
      expect(cx).toBeGreaterThanOrEqual(100);
      expect(cx).toBeLessThanOrEqual(200);
      expect(cy).toBeGreaterThanOrEqual(100);
      expect(cy).toBeLessThanOrEqual(150);
    });
  });

  describe('Active agent pulsing', () => {
    it('should show pulsing animation for active agents', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showAnimations={true}
        />
      );

      // node-1 is active
      expect(screen.getByTestId('pulse-animation-node-1')).toBeInTheDocument();
      // node-2 is busy (also shows pulse)
      expect(screen.getByTestId('pulse-animation-node-2')).toBeInTheDocument();
    });

    it('should not show pulsing animation for idle agents', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showAnimations={true}
        />
      );

      // node-3 is idle
      expect(screen.queryByTestId('pulse-animation-node-3')).not.toBeInTheDocument();
    });

    it('should not show pulsing when animations are disabled', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showAnimations={false}
        />
      );

      expect(screen.queryByTestId('pulse-animation-node-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pulse-animation-node-2')).not.toBeInTheDocument();
    });

    it('should toggle pulsing animation', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showAnimations={true}
        />
      );

      expect(screen.getByTestId('pulse-animation-node-1')).toBeInTheDocument();

      // Toggle animations off
      fireEvent.click(screen.getByTestId('toggle-animations'));

      expect(screen.queryByTestId('pulse-animation-node-1')).not.toBeInTheDocument();
    });
  });

  describe('Edge styles based on health', () => {
    it('should render edges with correct health colors', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          edges={mockEdges}
          nodePositions={mockNodePositions}
        />
      );

      const healthyEdge = screen.getByTestId('edge-line-edge-1');
      expect(healthyEdge.getAttribute('data-health')).toBe('healthy');

      const degradedEdge = screen.getByTestId('edge-line-edge-3');
      expect(degradedEdge.getAttribute('data-health')).toBe('degraded');

      const unhealthyEdge = screen.getByTestId('edge-line-edge-4');
      expect(unhealthyEdge.getAttribute('data-health')).toBe('unhealthy');
    });

    it('should show thicker lines for active edges', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          edges={mockEdges}
          nodePositions={mockNodePositions}
        />
      );

      const activeEdge = screen.getByTestId('edge-line-edge-1');
      expect(activeEdge.getAttribute('data-active')).toBe('true');
      expect(activeEdge.getAttribute('stroke-width')).toBe('3');

      const inactiveEdge = screen.getByTestId('edge-line-edge-2');
      expect(inactiveEdge.getAttribute('data-active')).toBe('false');
      expect(inactiveEdge.getAttribute('stroke-width')).toBe('1');
    });
  });

  describe('Layout switching', () => {
    it('should render layout control buttons', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      expect(screen.getByTestId('layout-button-force')).toBeInTheDocument();
      expect(screen.getByTestId('layout-button-hierarchical')).toBeInTheDocument();
      expect(screen.getByTestId('layout-button-circular')).toBeInTheDocument();
      expect(screen.getByTestId('layout-button-grid')).toBeInTheDocument();
    });

    it('should highlight current layout', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          initialLayout="force"
        />
      );

      expect(screen.getByTestId('layout-button-force')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByTestId('layout-button-hierarchical')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('should change layout when button is clicked', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          initialLayout="force"
        />
      );

      fireEvent.click(screen.getByTestId('layout-button-hierarchical'));

      expect(screen.getByTestId('layout-button-hierarchical')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByTestId('layout-button-force')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('should show simulating indicator during layout transition', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      fireEvent.click(screen.getByTestId('layout-button-hierarchical'));

      expect(screen.getByTestId('simulating-indicator')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(screen.queryByTestId('simulating-indicator')).not.toBeInTheDocument();
    });
  });

  describe('Node rendering', () => {
    it('should render all nodes', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      expect(screen.getByTestId('topology-node-node-1')).toBeInTheDocument();
      expect(screen.getByTestId('topology-node-node-2')).toBeInTheDocument();
      expect(screen.getByTestId('topology-node-node-3')).toBeInTheDocument();
      expect(screen.getByTestId('topology-node-node-4')).toBeInTheDocument();
    });

    it('should display node status colors correctly', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      expect(screen.getByTestId('node-circle-node-1').getAttribute('data-status')).toBe('active');
      expect(screen.getByTestId('node-circle-node-2').getAttribute('data-status')).toBe('busy');
      expect(screen.getByTestId('node-circle-node-3').getAttribute('data-status')).toBe('idle');
      expect(screen.getByTestId('node-circle-node-4').getAttribute('data-status')).toBe('error');
    });

    it('should show labels when enabled', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showLabels={true}
        />
      );

      expect(screen.getByTestId('node-label-node-1')).toHaveTextContent('Coordinator');
      expect(screen.getByTestId('node-label-node-2')).toHaveTextContent('Coder');
    });

    it('should hide labels when disabled', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showLabels={false}
        />
      );

      expect(screen.queryByTestId('node-label-node-1')).not.toBeInTheDocument();
    });

    it('should toggle labels visibility', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          showLabels={true}
        />
      );

      expect(screen.getByTestId('node-label-node-1')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('toggle-labels'));

      expect(screen.queryByTestId('node-label-node-1')).not.toBeInTheDocument();
    });
  });

  describe('Node selection', () => {
    it('should call onNodeSelect when node is clicked', () => {
      const onNodeSelect = vi.fn();
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          onNodeSelect={onNodeSelect}
        />
      );

      fireEvent.click(screen.getByTestId('topology-node-node-1'));

      expect(onNodeSelect).toHaveBeenCalledWith('node-1');
    });

    it('should show selection ring on selected node', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          selectedNodeId="node-1"
        />
      );

      expect(screen.getByTestId('selection-ring-node-1')).toBeInTheDocument();
      expect(screen.queryByTestId('selection-ring-node-2')).not.toBeInTheDocument();
    });
  });

  describe('Zoom controls', () => {
    it('should render zoom controls', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      expect(screen.getByTestId('zoom-in-button')).toBeInTheDocument();
      expect(screen.getByTestId('zoom-out-button')).toBeInTheDocument();
      expect(screen.getByTestId('fit-button')).toBeInTheDocument();
      expect(screen.getByTestId('zoom-level')).toBeInTheDocument();
    });

    it('should display current zoom level', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      expect(screen.getByTestId('zoom-level')).toHaveTextContent('100%');
    });

    it('should increase zoom when zoom in is clicked', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      fireEvent.click(screen.getByTestId('zoom-in-button'));

      expect(screen.getByTestId('zoom-level')).toHaveTextContent('130%');
    });

    it('should decrease zoom when zoom out is clicked', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      fireEvent.click(screen.getByTestId('zoom-out-button'));

      expect(screen.getByTestId('zoom-level')).toHaveTextContent('70%');
    });

    it('should reset zoom when fit is clicked', () => {
      render(<LiveTopology nodes={mockNodes} nodePositions={mockNodePositions} />);

      // Zoom in first
      fireEvent.click(screen.getByTestId('zoom-in-button'));
      expect(screen.getByTestId('zoom-level')).toHaveTextContent('130%');

      // Click fit
      fireEvent.click(screen.getByTestId('fit-button'));
      expect(screen.getByTestId('zoom-level')).toHaveTextContent('100%');
    });
  });

  describe('SVG structure', () => {
    it('should render SVG with correct dimensions', () => {
      render(
        <LiveTopology
          nodes={mockNodes}
          nodePositions={mockNodePositions}
          width={800}
          height={600}
        />
      );

      const svg = screen.getByTestId('topology-svg');
      expect(svg).toHaveAttribute('width', '800');
      expect(svg).toHaveAttribute('height', '600');
    });

    it('should have correct layer structure', () => {
      render(<LiveTopology nodes={mockNodes} edges={mockEdges} nodePositions={mockNodePositions} />);

      expect(screen.getByTestId('edges-layer')).toBeInTheDocument();
      expect(screen.getByTestId('nodes-layer')).toBeInTheDocument();
      expect(screen.getByTestId('particles-layer')).toBeInTheDocument();
    });
  });
});
