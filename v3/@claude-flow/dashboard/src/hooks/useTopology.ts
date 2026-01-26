/**
 * useTopology Hook
 *
 * Manages D3.js force simulation for topology visualization.
 * Handles node positioning, layout transitions, and simulation lifecycle.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import * as d3 from 'd3';
import type {
  TopologyNodeData,
  TopologyEdgeData,
  TopologyLayoutType,
  SimulationNodeDatum,
  SimulationLinkDatum,
  Position,
  UseTopologyReturn,
} from '../types';

const SIMULATION_ALPHA = 0.3;
const SIMULATION_ALPHA_DECAY = 0.02;
const SIMULATION_VELOCITY_DECAY = 0.4;

// Force strengths
const LINK_DISTANCE = 120;
const LINK_STRENGTH = 0.5;
const CHARGE_STRENGTH = -300;
const CENTER_STRENGTH = 0.1;
const COLLISION_RADIUS = 40;

/**
 * Convert TopologyNodeData to SimulationNodeDatum
 */
function toSimulationNode(node: TopologyNodeData, existingPositions?: Map<string, Position>): SimulationNodeDatum {
  const existing = existingPositions?.get(node.id);
  return {
    ...node,
    x: existing?.x,
    y: existing?.y,
    fx: null,
    fy: null,
  };
}

/**
 * Convert TopologyEdgeData to SimulationLinkDatum
 */
function toSimulationLink(edge: TopologyEdgeData): SimulationLinkDatum {
  return {
    ...edge,
    source: edge.source,
    target: edge.target,
  };
}

/**
 * Calculate hierarchical positions for nodes
 */
function calculateHierarchicalPositions(
  nodes: SimulationNodeDatum[],
  width: number,
  height: number
): void {
  // Find coordinator/queen nodes (they go at top)
  const coordinators = nodes.filter(n =>
    n.role === 'queen' || n.role === 'coordinator' || n.type === 'coordinator'
  );
  const workers = nodes.filter(n =>
    n.role !== 'queen' && n.role !== 'coordinator' && n.type !== 'coordinator'
  );

  const centerX = width / 2;
  const topY = height * 0.2;
  const bottomY = height * 0.7;

  // Position coordinators at top
  coordinators.forEach((node, i) => {
    const spacing = width / (coordinators.length + 1);
    node.x = spacing * (i + 1);
    node.y = topY;
    node.fx = node.x;
    node.fy = node.y;
  });

  // Position workers at bottom in a semi-circle
  workers.forEach((node, i) => {
    const angle = (Math.PI / (workers.length + 1)) * (i + 1);
    const radius = Math.min(width, height) * 0.35;
    node.x = centerX + Math.cos(angle - Math.PI / 2) * radius * 1.5;
    node.y = bottomY + Math.sin(angle - Math.PI / 2) * radius * 0.5;
    node.fx = null;
    node.fy = null;
  });
}

/**
 * Calculate mesh positions for nodes
 */
function calculateMeshPositions(
  nodes: SimulationNodeDatum[],
  width: number,
  height: number
): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.35;

  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI / nodes.length) * i - Math.PI / 2;
    node.x = centerX + Math.cos(angle) * radius;
    node.y = centerY + Math.sin(angle) * radius;
    node.fx = null;
    node.fy = null;
  });
}

/**
 * Hook for managing D3 force simulation
 */
export function useTopology(): UseTopologyReturn {
  const simulationRef = useRef<d3.Simulation<SimulationNodeDatum, SimulationLinkDatum> | null>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, Position>>(new Map());
  const [isSimulating, setIsSimulating] = useState(false);
  const layoutRef = useRef<TopologyLayoutType>('force');
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 800, height: 600 });

  /**
   * Update node positions from simulation
   */
  const updatePositions = useCallback(() => {
    if (!simulationRef.current) return;

    const nodes = simulationRef.current.nodes();
    const newPositions = new Map<string, Position>();

    nodes.forEach(node => {
      if (node.x !== undefined && node.y !== undefined) {
        newPositions.set(node.id, { x: node.x, y: node.y });
      }
    });

    setNodePositions(newPositions);
  }, []);

  /**
   * Initialize or reinitialize the simulation
   */
  const initializeSimulation = useCallback((
    nodes: TopologyNodeData[],
    edges: TopologyEdgeData[],
    width: number,
    height: number
  ) => {
    // Stop existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    dimensionsRef.current = { width, height };

    // Convert to simulation data
    const simNodes = nodes.map(n => toSimulationNode(n, nodePositions));
    const simLinks = edges.map(e => toSimulationLink(e));

    // Apply initial positions based on layout
    if (layoutRef.current === 'hierarchical') {
      calculateHierarchicalPositions(simNodes, width, height);
    } else if (layoutRef.current === 'mesh') {
      calculateMeshPositions(simNodes, width, height);
    }

    // Create force simulation
    const simulation = d3.forceSimulation<SimulationNodeDatum, SimulationLinkDatum>(simNodes)
      .alpha(SIMULATION_ALPHA)
      .alphaDecay(SIMULATION_ALPHA_DECAY)
      .velocityDecay(SIMULATION_VELOCITY_DECAY)
      .force('link', d3.forceLink<SimulationNodeDatum, SimulationLinkDatum>(simLinks)
        .id(d => d.id)
        .distance(LINK_DISTANCE)
        .strength(layoutRef.current === 'force' ? LINK_STRENGTH : 0.1)
      )
      .force('charge', d3.forceManyBody<SimulationNodeDatum>()
        .strength(layoutRef.current === 'force' ? CHARGE_STRENGTH : -50)
      )
      .force('center', d3.forceCenter(width / 2, height / 2)
        .strength(CENTER_STRENGTH)
      )
      .force('collision', d3.forceCollide<SimulationNodeDatum>()
        .radius(COLLISION_RADIUS)
      )
      .on('tick', () => {
        updatePositions();
      })
      .on('end', () => {
        setIsSimulating(false);
      });

    simulationRef.current = simulation;
    setIsSimulating(true);
    updatePositions();
  }, [nodePositions, updatePositions]);

  /**
   * Update the layout type and recalculate positions
   */
  const updateLayout = useCallback((layout: TopologyLayoutType) => {
    layoutRef.current = layout;

    if (!simulationRef.current) return;

    const nodes = simulationRef.current.nodes();
    const { width, height } = dimensionsRef.current;

    if (layout === 'hierarchical') {
      calculateHierarchicalPositions(nodes, width, height);
    } else if (layout === 'mesh') {
      calculateMeshPositions(nodes, width, height);
    } else {
      // Force layout - unfix all nodes
      nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
      });
    }

    // Update force strengths based on layout
    const linkForce = simulationRef.current.force('link') as d3.ForceLink<SimulationNodeDatum, SimulationLinkDatum>;
    const chargeForce = simulationRef.current.force('charge') as d3.ForceManyBody<SimulationNodeDatum>;

    if (linkForce) {
      linkForce.strength(layout === 'force' ? LINK_STRENGTH : 0.1);
    }
    if (chargeForce) {
      chargeForce.strength(layout === 'force' ? CHARGE_STRENGTH : -50);
    }

    // Restart simulation with new alpha
    simulationRef.current.alpha(SIMULATION_ALPHA).restart();
    setIsSimulating(true);
  }, []);

  /**
   * Update nodes in the simulation
   */
  const updateNodes = useCallback((nodes: TopologyNodeData[]) => {
    if (!simulationRef.current) return;

    const currentNodes = simulationRef.current.nodes();
    const currentNodeMap = new Map(currentNodes.map(n => [n.id, n]));

    // Update existing nodes and add new ones
    const updatedNodes = nodes.map(node => {
      const existing = currentNodeMap.get(node.id);
      if (existing) {
        // Update properties but keep position
        return {
          ...existing,
          ...node,
          x: existing.x,
          y: existing.y,
          fx: existing.fx,
          fy: existing.fy,
        };
      }
      return toSimulationNode(node, nodePositions);
    });

    simulationRef.current.nodes(updatedNodes);
    simulationRef.current.alpha(0.1).restart();
    setIsSimulating(true);
  }, [nodePositions]);

  /**
   * Update edges in the simulation
   */
  const updateEdges = useCallback((edges: TopologyEdgeData[]) => {
    if (!simulationRef.current) return;

    const simLinks = edges.map(e => toSimulationLink(e));
    const linkForce = simulationRef.current.force('link') as d3.ForceLink<SimulationNodeDatum, SimulationLinkDatum>;

    if (linkForce) {
      linkForce.links(simLinks);
    }

    simulationRef.current.alpha(0.1).restart();
    setIsSimulating(true);
  }, []);

  /**
   * Fix a node at a specific position (for dragging)
   */
  const fixNode = useCallback((nodeId: string, x: number, y: number) => {
    if (!simulationRef.current) return;

    const nodes = simulationRef.current.nodes();
    const node = nodes.find(n => n.id === nodeId);

    if (node) {
      node.fx = x;
      node.fy = y;
      simulationRef.current.alpha(0.1).restart();
    }
  }, []);

  /**
   * Unfix a node (release from dragging)
   */
  const unfixNode = useCallback((nodeId: string) => {
    if (!simulationRef.current) return;

    const nodes = simulationRef.current.nodes();
    const node = nodes.find(n => n.id === nodeId);

    if (node && layoutRef.current === 'force') {
      node.fx = null;
      node.fy = null;
    }
  }, []);

  /**
   * Stop the simulation
   */
  const stopSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
      setIsSimulating(false);
    }
  }, []);

  /**
   * Restart the simulation
   */
  const restartSimulation = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.alpha(SIMULATION_ALPHA).restart();
      setIsSimulating(true);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, []);

  return {
    simulationRef,
    nodePositions,
    isSimulating,
    initializeSimulation,
    updateLayout,
    updateNodes,
    updateEdges,
    fixNode,
    unfixNode,
    stopSimulation,
    restartSimulation,
  };
}

export default useTopology;
