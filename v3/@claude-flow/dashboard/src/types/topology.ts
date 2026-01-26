/**
 * Topology types for the Live Operations Dashboard
 *
 * Includes D3.js force simulation types for node positioning,
 * edge rendering, and message particle animations.
 */

import type * as d3 from 'd3';
import type { AgentNode, AgentStatus, AgentType } from './agents';

// ===== TOPOLOGY TYPES =====

export type TopologyType = 'hierarchical' | 'mesh' | 'adaptive' | 'hierarchical-mesh';

export type TopologyLayoutType = 'hierarchical' | 'mesh' | 'force';

export type ConnectionHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export type EdgeHealth = 'healthy' | 'warning' | 'error' | 'unknown';

export type NodeStatus = AgentStatus;

// ===== CONNECTION/EDGE TYPES =====

export interface Connection {
  id: string;
  source: string;
  target: string;
  health: ConnectionHealth;
  latency?: number;
  messageCount: number;
  lastMessage?: number;
}

export interface TopologyEdgeData {
  id: string;
  source: string;
  target: string;
  health: EdgeHealth;
  isActive: boolean;
  latencyMs?: number;
  messageCount?: number;
}

// ===== NODE TYPES =====

export interface TopologyNodeData {
  id: string;
  name: string;
  type: AgentType | string;
  status: NodeStatus;
  role?: 'queen' | 'worker' | 'coordinator' | 'peer';
  connections: string[];
  taskCount?: number;
  messageCount?: number;
}

export interface SimulationNodeDatum extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  status: NodeStatus;
  role?: 'queen' | 'worker' | 'coordinator' | 'peer';
  connections: string[];
  taskCount?: number;
  messageCount?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

export interface SimulationLinkDatum extends d3.SimulationLinkDatum<SimulationNodeDatum> {
  id: string;
  source: SimulationNodeDatum | string;
  target: SimulationNodeDatum | string;
  health: EdgeHealth;
  isActive: boolean;
  latencyMs?: number;
  messageCount?: number;
}

// ===== MESSAGE PARTICLE TYPES =====

export interface MessageParticleData {
  id: string;
  sourceId: string;
  targetId: string;
  messageType?: 'task' | 'result' | 'query' | 'response' | 'broadcast';
  startTime: number;
  duration: number;
}

export interface Position {
  x: number;
  y: number;
}

// ===== STATE TYPES =====

export interface TopologyState {
  type: TopologyType;
  nodes: AgentNode[];
  edges: Connection[];
  lastUpdated: number;
}

export interface LiveTopologyState {
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
  layout: TopologyLayoutType;
  showLabels: boolean;
  showAnimations: boolean;
  selectedNodeId: string | null;
  zoom: number;
}

// ===== EVENT TYPES =====

export interface TopologyChangeEvent {
  type: 'topology:change';
  topology: TopologyType;
  nodes: AgentNode[];
  edges: Connection[];
  timestamp: number;
}

// ===== LAYOUT TYPES =====

export type LayoutType = 'hierarchical' | 'mesh' | 'force' | 'radial';

export interface TopologyLayout {
  type: LayoutType;
  nodePositions: Map<string, { x: number; y: number }>;
}

// ===== HOOK RETURN TYPES =====

export interface UseTopologyReturn {
  simulationRef: React.MutableRefObject<d3.Simulation<SimulationNodeDatum, SimulationLinkDatum> | null>;
  nodePositions: Map<string, Position>;
  isSimulating: boolean;
  initializeSimulation: (
    nodes: TopologyNodeData[],
    edges: TopologyEdgeData[],
    width: number,
    height: number
  ) => void;
  updateLayout: (layout: TopologyLayoutType) => void;
  updateNodes: (nodes: TopologyNodeData[]) => void;
  updateEdges: (edges: TopologyEdgeData[]) => void;
  fixNode: (nodeId: string, x: number, y: number) => void;
  unfixNode: (nodeId: string) => void;
  stopSimulation: () => void;
  restartSimulation: () => void;
}

// ===== COMPONENT PROPS =====

export interface TopologyControlsProps {
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

export interface AnimatedEdgeProps {
  source: Position;
  target: Position;
  health: EdgeHealth;
  isActive: boolean;
  id: string;
}

export interface MessageParticleProps {
  sourcePos: Position;
  targetPos: Position;
  onComplete: () => void;
  messageType?: 'task' | 'result' | 'query' | 'response' | 'broadcast';
}

export interface LiveTopologyProps {
  nodes: TopologyNodeData[];
  edges: TopologyEdgeData[];
  layout?: TopologyLayoutType;
  onNodeSelect?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  messages?: MessageParticleData[];
  width?: number;
  height?: number;
  showLabels?: boolean;
  showAnimations?: boolean;
}

// ===== COLOR UTILITIES =====

export const HEALTH_COLORS: Record<ConnectionHealth, string> = {
  healthy: 'stroke-green-500',
  degraded: 'stroke-amber-500',
  unhealthy: 'stroke-red-500',
  unknown: 'stroke-gray-500',
};

export const EDGE_HEALTH_HEX: Record<EdgeHealth, string> = {
  healthy: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  unknown: '#64748b',
};

export const NODE_STATUS_HEX: Record<NodeStatus, string> = {
  active: '#22c55e',
  idle: '#64748b',
  busy: '#f59e0b',
  error: '#ef4444',
  spawning: '#3b82f6',
  stopped: '#6b7280',
};

export const MESSAGE_TYPE_HEX: Record<string, string> = {
  task: '#3b82f6',
  result: '#22c55e',
  query: '#f59e0b',
  response: '#8b5cf6',
  broadcast: '#ec4899',
};

export const TOPOLOGY_DESCRIPTIONS: Record<TopologyType, string> = {
  hierarchical: 'Tree structure with coordinator at root',
  mesh: 'Fully connected peer-to-peer network',
  adaptive: 'Dynamic topology based on workload',
  'hierarchical-mesh': 'Hybrid with layers and peer connections',
};

// ===== UTILITY FUNCTIONS =====

export const getStatusColor = (status: NodeStatus): string => {
  return NODE_STATUS_HEX[status] || NODE_STATUS_HEX.idle;
};

export const getHealthColor = (health: EdgeHealth): string => {
  return EDGE_HEALTH_HEX[health] || EDGE_HEALTH_HEX.unknown;
};

export const getMessageTypeColor = (type?: string): string => {
  return MESSAGE_TYPE_HEX[type || 'task'] || MESSAGE_TYPE_HEX.task;
};
