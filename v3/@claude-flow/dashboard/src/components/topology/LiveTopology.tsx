/**
 * LiveTopology Component
 *
 * D3.js force simulation visualization for agent topology:
 * - Renders agent nodes as circles with status colors
 * - Pulsing animation for active agents
 * - Agent name labels below nodes
 * - Connection edges between agents
 * - Message particles animated on message events
 * - Click node to select agent
 * - Drag nodes to reposition
 * - Zoom and pan support
 * - Layout switch with animated transitions
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { useTopology } from '../../hooks/useTopology';
import { TopologyControls } from './TopologyControls';
import { AnimatedEdge } from './AnimatedEdge';
import { MessageParticle } from './MessageParticle';
import type {
  LiveTopologyProps,
  TopologyLayoutType,
  MessageParticleData,
  Position,
} from '../../types';
import { getStatusColor } from '../../types';

const NODE_RADIUS = 24;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;

export const LiveTopology: React.FC<LiveTopologyProps> = ({
  nodes,
  edges,
  layout: initialLayout = 'force',
  onNodeSelect,
  selectedNodeId,
  messages = [],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  showLabels: initialShowLabels = true,
  showAnimations: initialShowAnimations = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>();

  const [layout, setLayout] = useState<TopologyLayoutType>(initialLayout);
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(initialShowLabels);
  const [showAnimations, setShowAnimations] = useState(initialShowAnimations);
  const [activeParticles, setActiveParticles] = useState<MessageParticleData[]>([]);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);

  const {
    nodePositions,
    isSimulating,
    initializeSimulation,
    updateLayout,
    updateNodes,
    fixNode,
    unfixNode,
  } = useTopology();

  // Initialize simulation on mount or when nodes/edges change significantly
  useEffect(() => {
    initializeSimulation(nodes, edges, width, height);
  }, [nodes.length, edges.length, width, height, initializeSimulation]);

  // Update nodes when their properties change
  useEffect(() => {
    updateNodes(nodes);
  }, [nodes, updateNodes]);

  // Initialize zoom behavior
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = svg.select<SVGGElement>('g.topology-container');

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setZoom(event.transform.k);
      });

    svg.call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    return () => {
      svg.on('.zoom', null);
    };
  }, []);

  // Handle layout change
  const handleLayoutChange = useCallback((newLayout: TopologyLayoutType) => {
    setLayout(newLayout);
    updateLayout(newLayout);
  }, [updateLayout]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(300)
      .call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const handleFitToScreen = useCallback(() => {
    if (!svgRef.current || !zoomRef.current || nodePositions.size === 0) return;

    // Calculate bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    nodePositions.forEach(pos => {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    });

    const padding = 60;
    const boundsWidth = maxX - minX + padding * 2;
    const boundsHeight = maxY - minY + padding * 2;

    const scale = Math.min(
      width / boundsWidth,
      height / boundsHeight,
      1
    ) * 0.9;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-centerX, -centerY)
      );
  }, [nodePositions, width, height]);

  // Handle node drag
  const handleNodeDragStart = useCallback((nodeId: string, x: number, y: number) => {
    setDraggedNode(nodeId);
    fixNode(nodeId, x, y);
  }, [fixNode]);

  const handleNodeDrag = useCallback((nodeId: string, x: number, y: number) => {
    fixNode(nodeId, x, y);
  }, [fixNode]);

  const handleNodeDragEnd = useCallback((nodeId: string) => {
    setDraggedNode(null);
    unfixNode(nodeId);
  }, [unfixNode]);

  // Handle node click
  const handleNodeClick = useCallback((nodeId: string) => {
    if (onNodeSelect) {
      onNodeSelect(nodeId);
    }
  }, [onNodeSelect]);

  // Handle new messages for particle animation
  useEffect(() => {
    if (!showAnimations) return;

    const newMessages = messages.filter(
      msg => !activeParticles.some(p => p.id === msg.id)
    );

    if (newMessages.length > 0) {
      setActiveParticles(prev => [...prev, ...newMessages]);
    }
  }, [messages, showAnimations, activeParticles]);

  // Remove completed particles
  const handleParticleComplete = useCallback((particleId: string) => {
    setActiveParticles(prev => prev.filter(p => p.id !== particleId));
  }, []);

  // Get position for a node
  const getNodePosition = useCallback((nodeId: string): Position | null => {
    return nodePositions.get(nodeId) || null;
  }, [nodePositions]);

  // Render edges
  const renderedEdges = useMemo(() => {
    return edges.map(edge => {
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
    }).filter(Boolean);
  }, [edges, getNodePosition]);

  // Render nodes
  const renderedNodes = useMemo(() => {
    return nodes.map(node => {
      const pos = getNodePosition(node.id);
      if (!pos) return null;

      const color = getStatusColor(node.status);
      const isSelected = node.id === selectedNodeId;
      const isActive = node.status === 'active' || node.status === 'busy';
      const isDragging = node.id === draggedNode;

      return (
        <g
          key={node.id}
          className="topology-node"
          transform={`translate(${pos.x}, ${pos.y})`}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            handleNodeDragStart(node.id, pos.x, pos.y);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (!isDragging) {
              handleNodeClick(node.id);
            }
          }}
        >
          {/* Selection ring */}
          {isSelected && (
            <circle
              r={NODE_RADIUS + 8}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={3}
              strokeDasharray="4,2"
              opacity={0.8}
              style={{
                animation: 'selectionPulse 1.5s ease-in-out infinite',
              }}
            />
          )}

          {/* Pulsing animation for active nodes */}
          {isActive && showAnimations && (
            <circle
              r={NODE_RADIUS}
              fill="none"
              stroke={color}
              strokeWidth={2}
              opacity={0}
              style={{
                animation: 'nodePulse 2s ease-out infinite',
              }}
            />
          )}

          {/* Node shadow */}
          <circle
            r={NODE_RADIUS}
            fill="rgba(0, 0, 0, 0.3)"
            transform="translate(2, 2)"
          />

          {/* Node background */}
          <circle
            r={NODE_RADIUS}
            fill={`${color}20`}
            stroke={color}
            strokeWidth={2}
            style={{
              transition: 'fill 0.3s ease, stroke 0.3s ease',
            }}
          />

          {/* Node inner circle */}
          <circle
            r={NODE_RADIUS - 6}
            fill={color}
            opacity={0.8}
          />

          {/* Node type icon/letter */}
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="12"
            fontWeight="bold"
            style={{ pointerEvents: 'none' }}
          >
            {node.type.charAt(0).toUpperCase()}
          </text>

          {/* Node label */}
          {showLabels && (
            <text
              y={NODE_RADIUS + 16}
              textAnchor="middle"
              fill="#e2e8f0"
              fontSize="11"
              fontWeight="500"
              style={{ pointerEvents: 'none' }}
            >
              {node.name}
            </text>
          )}
        </g>
      );
    }).filter(Boolean);
  }, [nodes, getNodePosition, selectedNodeId, draggedNode, showLabels, showAnimations, handleNodeDragStart, handleNodeClick]);

  // Render message particles
  const renderedParticles = useMemo(() => {
    if (!showAnimations) return null;

    return activeParticles.map(particle => {
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
    }).filter(Boolean);
  }, [activeParticles, getNodePosition, showAnimations, handleParticleComplete]);

  // Handle mouse move for dragging
  useEffect(() => {
    if (!draggedNode || !svgRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const transform = d3.zoomTransform(svg);

      // Convert screen coordinates to SVG coordinates
      const x = (e.clientX - rect.left - transform.x) / transform.k;
      const y = (e.clientY - rect.top - transform.y) / transform.k;

      handleNodeDrag(draggedNode, x, y);
    };

    const handleMouseUp = () => {
      if (draggedNode) {
        handleNodeDragEnd(draggedNode);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggedNode, handleNodeDrag, handleNodeDragEnd]);

  return (
    <div
      ref={containerRef}
      className="live-topology"
      style={styles.container}
    >
      {/* Controls */}
      <div style={styles.controlsWrapper}>
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
      </div>

      {/* Status indicator */}
      {isSimulating && (
        <div style={styles.simulatingIndicator}>
          Simulating...
        </div>
      )}

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={styles.svg}
      >
        {/* Background */}
        <rect
          width={width}
          height={height}
          fill="#0f172a"
          rx={8}
        />

        {/* Grid pattern */}
        <defs>
          <pattern
            id="topology-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(71, 85, 105, 0.2)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect
          width={width}
          height={height}
          fill="url(#topology-grid)"
        />

        {/* Main container for zoom/pan */}
        <g className="topology-container">
          {/* Edges layer */}
          <g className="edges-layer">
            {renderedEdges}
          </g>

          {/* Nodes layer */}
          <g className="nodes-layer">
            {renderedNodes}
          </g>

          {/* Particles layer */}
          <g className="particles-layer">
            {renderedParticles}
          </g>
        </g>
      </svg>

      {/* Inline styles for animations */}
      <style>
        {`
          @keyframes nodePulse {
            0% {
              r: ${NODE_RADIUS}px;
              opacity: 0.8;
            }
            100% {
              r: ${NODE_RADIUS + 20}px;
              opacity: 0;
            }
          }

          @keyframes selectionPulse {
            0%, 100% {
              opacity: 0.8;
              stroke-dashoffset: 0;
            }
            50% {
              opacity: 0.4;
              stroke-dashoffset: 6;
            }
          }
        `}
      </style>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: '#0f172a',
    borderRadius: '12px',
    padding: '16px',
  },
  controlsWrapper: {
    position: 'absolute',
    top: '24px',
    left: '24px',
    zIndex: 10,
  },
  simulatingIndicator: {
    position: 'absolute',
    top: '24px',
    right: '24px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#94a3b8',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: '6px',
    border: '1px solid rgba(71, 85, 105, 0.5)',
    zIndex: 10,
  },
  svg: {
    display: 'block',
    borderRadius: '8px',
    overflow: 'hidden',
  },
};

export default LiveTopology;
