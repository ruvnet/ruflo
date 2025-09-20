/**
 * Topology Manager Implementation
 * Manages swarm network topologies and optimizations
 * Provides adaptive topology management based on workload patterns
 */

import { EventEmitter } from 'events';
import { RealMemoryManager } from '../memory/real-memory-manager.js';

/**
 * Topology patterns and their characteristics
 */
export const TopologyPatterns = {
  MESH: {
    name: 'mesh',
    description: 'Full interconnection between all agents',
    characteristics: {
      communication: 'high',
      resilience: 'very_high',
      scalability: 'low',
      overhead: 'high',
      bestFor: ['collaboration', 'consensus', 'small_teams']
    }
  },
  
  HIERARCHICAL: {
    name: 'hierarchical',
    description: 'Tree-like structure with clear delegation paths',
    characteristics: {
      communication: 'medium',
      resilience: 'medium',
      scalability: 'high',
      overhead: 'low',
      bestFor: ['delegation', 'management', 'large_teams']
    }
  },
  
  RING: {
    name: 'ring',
    description: 'Circular connection pattern for pipeline processing',
    characteristics: {
      communication: 'low',
      resilience: 'medium',
      scalability: 'medium',
      overhead: 'very_low',
      bestFor: ['pipeline', 'sequential_processing', 'data_flow']
    }
  },
  
  STAR: {
    name: 'star',
    description: 'Central coordinator with spoke connections',
    characteristics: {
      communication: 'medium',
      resilience: 'low',
      scalability: 'medium',
      overhead: 'low',
      bestFor: ['simple_coordination', 'centralized_control', 'broadcasts']
    }
  },
  
  HYBRID: {
    name: 'hybrid',
    description: 'Mixed topology combining multiple patterns',
    characteristics: {
      communication: 'variable',
      resilience: 'high',
      scalability: 'high',
      overhead: 'medium',
      bestFor: ['complex_workflows', 'adaptive_systems', 'multi_phase_tasks']
    }
  },
  
  DYNAMIC: {
    name: 'dynamic',
    description: 'Self-organizing topology based on ML optimization',
    characteristics: {
      communication: 'optimal',
      resilience: 'very_high',
      scalability: 'very_high',
      overhead: 'variable',
      bestFor: ['intelligent_systems', 'adaptive_workflows', 'optimization']
    }
  }
};

/**
 * Topology Manager Class
 * Manages network topologies for optimal agent coordination
 */
export class TopologyManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = options.logger || console;
    this.memoryManager = options.memoryManager;
    this.swarmId = options.swarmId;
    
    // Current topology state
    this.currentTopology = options.initialTopology || 'hierarchical';
    this.topologyGraph = new Map(); // agentId -> Set<connectedAgentIds>
    this.topologyMetrics = new Map(); // topology -> performance metrics
    this.adaptationHistory = [];
    
    // Configuration
    this.enableAdaptiveTopology = options.enableAdaptiveTopology !== false;
    this.metricsWindow = options.metricsWindow || 300000; // 5 minutes
    this.adaptationThreshold = options.adaptationThreshold || 0.15; // 15% improvement needed
    this.maxAdaptationsPerHour = options.maxAdaptationsPerHour || 3;
    
    // Performance tracking
    this.performanceHistory = [];
    this.currentMetrics = {
      throughput: 0,
      latency: 0,
      reliability: 0,
      efficiency: 0,
      scalability: 0
    };
    
    // ML model for topology optimization (placeholder)
    this.optimizationModel = null;
    
    this.logger.info(`🕸️ TopologyManager initialized for swarm: ${this.swarmId}`);
  }
  
  /**
   * Initialize the topology manager
   */
  async initialize() {
    try {
      // Load historical topology data
      await this.loadTopologyHistory();
      
      // Initialize performance tracking
      this.startPerformanceTracking();
      
      // Load or train optimization model
      if (this.enableAdaptiveTopology) {
        await this.initializeOptimizationModel();
      }
      
      this.logger.info('✅ TopologyManager initialized successfully');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize TopologyManager:', error);
      throw error;
    }
  }
  
  /**
   * Add agent to the current topology
   */
  async addAgent(agentId, capabilities = [], preferences = {}) {
    if (this.topologyGraph.has(agentId)) {
      this.logger.warn(`Agent ${agentId} already exists in topology`);
      return;
    }
    
    // Add agent to topology based on current pattern
    const connections = await this.calculateOptimalConnections(agentId, capabilities, preferences);
    this.topologyGraph.set(agentId, connections);
    
    // Update existing connections
    for (const connectedAgentId of connections) {
      if (this.topologyGraph.has(connectedAgentId)) {
        this.topologyGraph.get(connectedAgentId).add(agentId);
      }
    }
    
    // Store topology change
    await this.recordTopologyChange('agent_added', {
      agentId,
      connections: Array.from(connections),
      topology: this.currentTopology
    });
    
    this.emit('agent:added', { agentId, connections, topology: this.currentTopology });
    this.logger.info(`➕ Agent ${agentId} added to ${this.currentTopology} topology`);
  }
  
  /**
   * Remove agent from topology
   */
  async removeAgent(agentId) {
    if (!this.topologyGraph.has(agentId)) {
      this.logger.warn(`Agent ${agentId} not found in topology`);
      return;
    }
    
    const connections = this.topologyGraph.get(agentId);
    
    // Remove connections from other agents
    for (const connectedAgentId of connections) {
      if (this.topologyGraph.has(connectedAgentId)) {
        this.topologyGraph.get(connectedAgentId).delete(agentId);
      }
    }
    
    // Remove agent from topology
    this.topologyGraph.delete(agentId);
    
    // Repair topology if needed
    await this.repairTopology(agentId, connections);
    
    // Store topology change
    await this.recordTopologyChange('agent_removed', {
      agentId,
      previousConnections: Array.from(connections),
      topology: this.currentTopology
    });
    
    this.emit('agent:removed', { agentId, topology: this.currentTopology });
    this.logger.info(`➖ Agent ${agentId} removed from topology`);
  }
  
  /**
   * Calculate optimal connections for a new agent
   */
  async calculateOptimalConnections(agentId, capabilities, preferences) {
    const existingAgents = Array.from(this.topologyGraph.keys());
    const connections = new Set();
    
    switch (this.currentTopology) {
      case 'mesh':
        // Connect to all existing agents
        existingAgents.forEach(id => connections.add(id));
        break;
        
      case 'hierarchical':
        connections.addAll(await this.calculateHierarchicalConnections(agentId, capabilities));
        break;
        
      case 'ring':
        connections.addAll(await this.calculateRingConnections(agentId));
        break;
        
      case 'star':
        connections.addAll(await this.calculateStarConnections(agentId));
        break;
        
      case 'hybrid':
        connections.addAll(await this.calculateHybridConnections(agentId, capabilities));
        break;
        
      case 'dynamic':
        connections.addAll(await this.calculateDynamicConnections(agentId, capabilities, preferences));
        break;
        
      default:
        // Default to hierarchical
        connections.addAll(await this.calculateHierarchicalConnections(agentId, capabilities));
    }
    
    return connections;
  }
  
  /**
   * Calculate hierarchical connections
   */
  async calculateHierarchicalConnections(agentId, capabilities) {
    const connections = new Set();
    const existingAgents = Array.from(this.topologyGraph.keys());
    
    if (existingAgents.length === 0) {
      // First agent becomes root
      return connections;
    }
    
    // Find best parent based on capabilities and load
    const parentCandidates = existingAgents.map(parentId => {
      const parentConnections = this.topologyGraph.get(parentId).size;
      const parentCapabilities = this.getAgentCapabilities(parentId);
      
      // Score based on capability matching and current load
      let score = 0;
      
      // Capability matching bonus
      const matchingCapabilities = capabilities.filter(cap => 
        parentCapabilities.includes(cap)
      ).length;
      score += matchingCapabilities * 10;
      
      // Load balancing penalty (prefer less connected agents)
      score -= parentConnections * 2;
      
      return { agentId: parentId, score, connections: parentConnections };
    });
    
    // Sort by score (higher is better)
    parentCandidates.sort((a, b) => b.score - a.score);
    
    // Connect to best parent
    if (parentCandidates.length > 0) {
      connections.add(parentCandidates[0].agentId);
    }
    
    return connections;
  }
  
  /**
   * Calculate ring connections
   */
  async calculateRingConnections(agentId) {
    const connections = new Set();
    const existingAgents = Array.from(this.topologyGraph.keys());
    
    if (existingAgents.length === 0) {
      return connections;
    } else if (existingAgents.length === 1) {
      connections.add(existingAgents[0]);
      return connections;
    }
    
    // Find the best insertion point in the ring
    let bestInsertionPoint = null;
    let minDisruption = Infinity;
    
    for (let i = 0; i < existingAgents.length; i++) {
      const currentAgent = existingAgents[i];
      const nextAgent = existingAgents[(i + 1) % existingAgents.length];
      
      // Calculate disruption score
      const disruption = this.calculateRingDisruption(currentAgent, nextAgent, agentId);
      
      if (disruption < minDisruption) {
        minDisruption = disruption;
        bestInsertionPoint = { current: currentAgent, next: nextAgent };
      }
    }
    
    if (bestInsertionPoint) {
      // Insert between current and next
      connections.add(bestInsertionPoint.current);
      connections.add(bestInsertionPoint.next);
      
      // Update existing connections
      this.topologyGraph.get(bestInsertionPoint.current).delete(bestInsertionPoint.next);
      this.topologyGraph.get(bestInsertionPoint.next).delete(bestInsertionPoint.current);
    }
    
    return connections;
  }
  
  /**
   * Calculate star connections
   */
  async calculateStarConnections(agentId) {
    const connections = new Set();
    const existingAgents = Array.from(this.topologyGraph.keys());
    
    if (existingAgents.length === 0) {
      // First agent becomes center
      return connections;
    }
    
    // Find the central node (most connected agent)
    let centralAgent = null;
    let maxConnections = 0;
    
    for (const existingAgentId of existingAgents) {
      const agentConnections = this.topologyGraph.get(existingAgentId).size;
      if (agentConnections > maxConnections) {
        maxConnections = agentConnections;
        centralAgent = existingAgentId;
      }
    }
    
    if (centralAgent) {
      connections.add(centralAgent);
    }
    
    return connections;
  }
  
  /**
   * Calculate hybrid connections
   */
  async calculateHybridConnections(agentId, capabilities) {
    const connections = new Set();
    const existingAgents = Array.from(this.topologyGraph.keys());
    
    if (existingAgents.length === 0) {
      return connections;
    }
    
    // Analyze agent role and determine optimal connection pattern
    const agentRole = this.determineAgentRole(capabilities);
    
    switch (agentRole) {
      case 'coordinator':
        // Coordinators use star pattern (connect to many)
        const topAgents = this.getTopPerformingAgents(3);
        topAgents.forEach(id => connections.add(id));
        break;
        
      case 'specialist':
        // Specialists use hierarchical pattern (connect to relevant coordinators)
        const relevantCoordinators = this.findRelevantCoordinators(capabilities);
        relevantCoordinators.forEach(id => connections.add(id));
        break;
        
      case 'worker':
        // Workers use simple connections to coordinators
        const coordinator = this.findBestCoordinator(capabilities);
        if (coordinator) connections.add(coordinator);
        break;
        
      default:
        // Default to hierarchical
        const hierarchicalConnections = await this.calculateHierarchicalConnections(agentId, capabilities);
        hierarchicalConnections.forEach(id => connections.add(id));
    }
    
    return connections;
  }
  
  /**
   * Calculate dynamic connections using ML optimization
   */
  async calculateDynamicConnections(agentId, capabilities, preferences) {
    const connections = new Set();
    
    if (!this.optimizationModel) {
      // Fallback to hierarchical if no model available
      return this.calculateHierarchicalConnections(agentId, capabilities);
    }
    
    try {
      // Prepare input features for ML model
      const features = await this.extractConnectionFeatures(agentId, capabilities, preferences);
      
      // Get connection predictions from model
      const predictions = await this.optimizationModel.predict(features);
      
      // Convert predictions to connections
      const existingAgents = Array.from(this.topologyGraph.keys());
      for (let i = 0; i < predictions.length && i < existingAgents.length; i++) {
        if (predictions[i] > 0.5) { // Threshold for connection
          connections.add(existingAgents[i]);
        }
      }
      
      // Ensure at least one connection if agents exist
      if (connections.size === 0 && existingAgents.length > 0) {
        const bestAgent = existingAgents[0]; // Simplified selection
        connections.add(bestAgent);
      }
      
    } catch (error) {
      this.logger.warn('Dynamic connection calculation failed, using hierarchical fallback:', error);
      return this.calculateHierarchicalConnections(agentId, capabilities);
    }
    
    return connections;
  }
  
  /**
   * Repair topology after agent removal
   */
  async repairTopology(removedAgentId, previousConnections) {
    const orphanedAgents = [];
    
    // Find agents that only connected through the removed agent
    for (const [agentId, connections] of this.topologyGraph) {
      if (connections.size === 0) {
        orphanedAgents.push(agentId);
      }
    }
    
    // Reconnect orphaned agents
    for (const orphanId of orphanedAgents) {
      const newConnections = await this.calculateOptimalConnections(
        orphanId, 
        this.getAgentCapabilities(orphanId),
        {}
      );
      
      this.topologyGraph.set(orphanId, newConnections);
      
      // Update reverse connections
      for (const connectedId of newConnections) {
        if (this.topologyGraph.has(connectedId)) {
          this.topologyGraph.get(connectedId).add(orphanId);
        }
      }
    }
    
    if (orphanedAgents.length > 0) {
      this.logger.info(`🔧 Repaired topology: reconnected ${orphanedAgents.length} orphaned agents`);
    }
  }
  
  /**
   * Change topology pattern
   */
  async changeTopology(newTopology, options = {}) {
    if (newTopology === this.currentTopology) {
      this.logger.info(`Already using ${newTopology} topology`);
      return;
    }
    
    this.logger.info(`🔄 Changing topology from ${this.currentTopology} to ${newTopology}`);
    
    const oldTopology = this.currentTopology;
    const agents = Array.from(this.topologyGraph.keys());
    
    // Store current metrics for comparison
    const preChangeMetrics = { ...this.currentMetrics };
    
    // Clear current topology
    this.topologyGraph.clear();
    this.currentTopology = newTopology;
    
    try {
      // Rebuild topology with new pattern
      for (const agentId of agents) {
        const capabilities = this.getAgentCapabilities(agentId);
        const connections = await this.calculateOptimalConnections(agentId, capabilities, {});
        
        this.topologyGraph.set(agentId, connections);
        
        // Update reverse connections
        for (const connectedId of connections) {
          if (this.topologyGraph.has(connectedId)) {
            this.topologyGraph.get(connectedId).add(agentId);
          }
        }
      }
      
      // Record topology change
      await this.recordTopologyChange('topology_changed', {
        fromTopology: oldTopology,
        toTopology: newTopology,
        agentCount: agents.length,
        reason: options.reason || 'manual',
        preChangeMetrics,
        timestamp: new Date()
      });
      
      this.emit('topology:changed', {
        oldTopology,
        newTopology,
        agentCount: agents.length
      });
      
      this.logger.info(`✅ Successfully changed to ${newTopology} topology`);
      
    } catch (error) {
      // Rollback on failure
      this.logger.error(`❌ Failed to change topology, rolling back:`, error);
      await this.changeTopology(oldTopology, { reason: 'rollback' });
      throw error;
    }
  }
  
  /**
   * Analyze current topology performance
   */
  async analyzeTopologyPerformance() {
    const analysis = {
      topology: this.currentTopology,
      agentCount: this.topologyGraph.size,
      connectionCount: this.calculateTotalConnections(),
      metrics: { ...this.currentMetrics },
      characteristics: TopologyPatterns[this.currentTopology.toUpperCase()]?.characteristics || {},
      recommendations: []
    };
    
    // Calculate topology-specific metrics
    analysis.density = this.calculateTopologyDensity();
    analysis.centralization = this.calculateCentralization();
    analysis.clustering = this.calculateClusteringCoefficient();
    analysis.pathLength = this.calculateAveragePathLength();
    
    // Generate recommendations
    analysis.recommendations = await this.generateTopologyRecommendations(analysis);
    
    return analysis;
  }
  
  /**
   * Calculate topology density
   */
  calculateTopologyDensity() {
    const agentCount = this.topologyGraph.size;
    if (agentCount <= 1) return 0;
    
    const actualConnections = this.calculateTotalConnections() / 2; // Undirected graph
    const maxConnections = (agentCount * (agentCount - 1)) / 2;
    
    return actualConnections / maxConnections;
  }
  
  /**
   * Calculate centralization
   */
  calculateCentralization() {
    const degrees = Array.from(this.topologyGraph.values()).map(connections => connections.size);
    if (degrees.length === 0) return 0;
    
    const maxDegree = Math.max(...degrees);
    const avgDegree = degrees.reduce((sum, deg) => sum + deg, 0) / degrees.length;
    
    return maxDegree - avgDegree;
  }
  
  /**
   * Calculate clustering coefficient
   */
  calculateClusteringCoefficient() {
    let totalClustering = 0;
    let nodeCount = 0;
    
    for (const [agentId, connections] of this.topologyGraph) {
      if (connections.size < 2) continue;
      
      // Count triangles involving this agent
      let triangles = 0;
      const connectionArray = Array.from(connections);
      
      for (let i = 0; i < connectionArray.length; i++) {
        for (let j = i + 1; j < connectionArray.length; j++) {
          const agent1 = connectionArray[i];
          const agent2 = connectionArray[j];
          
          if (this.topologyGraph.has(agent1) && 
              this.topologyGraph.get(agent1).has(agent2)) {
            triangles++;
          }
        }
      }
      
      const possibleTriangles = (connections.size * (connections.size - 1)) / 2;
      totalClustering += triangles / possibleTriangles;
      nodeCount++;
    }
    
    return nodeCount > 0 ? totalClustering / nodeCount : 0;
  }
  
  /**
   * Calculate average path length using BFS
   */
  calculateAveragePathLength() {
    const agents = Array.from(this.topologyGraph.keys());
    if (agents.length < 2) return 0;
    
    let totalDistance = 0;
    let pathCount = 0;
    
    for (const startAgent of agents) {
      const distances = this.breadthFirstSearch(startAgent);
      
      for (const [endAgent, distance] of distances) {
        if (endAgent !== startAgent && distance !== Infinity) {
          totalDistance += distance;
          pathCount++;
        }
      }
    }
    
    return pathCount > 0 ? totalDistance / pathCount : Infinity;
  }
  
  /**
   * Breadth-first search for shortest paths
   */
  breadthFirstSearch(startAgent) {
    const distances = new Map();
    const queue = [{ agent: startAgent, distance: 0 }];
    const visited = new Set();
    
    // Initialize distances
    for (const agent of this.topologyGraph.keys()) {
      distances.set(agent, Infinity);
    }
    distances.set(startAgent, 0);
    
    while (queue.length > 0) {
      const { agent, distance } = queue.shift();
      
      if (visited.has(agent)) continue;
      visited.add(agent);
      
      const connections = this.topologyGraph.get(agent) || new Set();
      for (const connectedAgent of connections) {
        if (!visited.has(connectedAgent)) {
          const newDistance = distance + 1;
          if (newDistance < distances.get(connectedAgent)) {
            distances.set(connectedAgent, newDistance);
            queue.push({ agent: connectedAgent, distance: newDistance });
          }
        }
      }
    }
    
    return distances;
  }
  
  /**
   * Generate topology recommendations
   */
  async generateTopologyRecommendations(analysis) {
    const recommendations = [];
    
    // Density recommendations
    if (analysis.density < 0.1) {
      recommendations.push({
        type: 'connectivity',
        priority: 'high',
        message: 'Topology is very sparse. Consider increasing connections for better resilience.',
        suggestedAction: 'Add strategic connections or consider mesh topology for small teams.'
      });
    } else if (analysis.density > 0.8) {
      recommendations.push({
        type: 'efficiency',
        priority: 'medium',
        message: 'Topology is very dense. Consider reducing connections to improve efficiency.',
        suggestedAction: 'Optimize connections or consider hierarchical topology for large teams.'
      });
    }
    
    // Performance recommendations
    if (analysis.metrics.throughput < 0.5) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Low throughput detected. Topology may be bottlenecking task distribution.',
        suggestedAction: 'Consider star topology for better centralized coordination.'
      });
    }
    
    // Scalability recommendations
    if (analysis.agentCount > 20 && analysis.topology === 'mesh') {
      recommendations.push({
        type: 'scalability',
        priority: 'high',
        message: 'Mesh topology with large agent count may cause performance issues.',
        suggestedAction: 'Consider hierarchical or hybrid topology for better scalability.'
      });
    }
    
    // Latency recommendations
    if (analysis.pathLength > 3) {
      recommendations.push({
        type: 'latency',
        priority: 'medium',
        message: 'High average path length may increase communication latency.',
        suggestedAction: 'Add shortcut connections or consider star topology.'
      });
    }
    
    return recommendations;
  }
  
  /**
   * Start performance tracking
   */
  startPerformanceTracking() {
    const trackingInterval = setInterval(() => {
      this.collectPerformanceMetrics();
    }, 30000); // Every 30 seconds
    
    this.performanceTrackingInterval = trackingInterval;
  }
  
  /**
   * Collect performance metrics
   */
  async collectPerformanceMetrics() {
    try {
      // Query recent performance data from memory
      const recentData = await this.memoryManager.query({
        namespace: 'swarm',
        category: 'performance',
        tags: ['task-completion'],
        limit: 100,
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });
      
      if (recentData.results.length === 0) return;
      
      // Calculate metrics
      const completedTasks = recentData.results.filter(r => r.value.success);
      const failedTasks = recentData.results.filter(r => !r.value.success);
      
      const throughput = completedTasks.length / (this.metricsWindow / 1000); // tasks per second
      const reliability = completedTasks.length / recentData.results.length;
      const averageLatency = completedTasks.length > 0 ? 
        completedTasks.reduce((sum, task) => sum + (task.value.duration || 0), 0) / completedTasks.length : 0;
      
      // Update current metrics
      this.currentMetrics = {
        throughput,
        latency: averageLatency,
        reliability,
        efficiency: this.calculateEfficiency(),
        scalability: this.calculateScalability()
      };
      
      // Store metrics history
      this.performanceHistory.push({
        timestamp: new Date(),
        topology: this.currentTopology,
        metrics: { ...this.currentMetrics },
        agentCount: this.topologyGraph.size
      });
      
      // Keep only recent history
      if (this.performanceHistory.length > 100) {
        this.performanceHistory = this.performanceHistory.slice(-100);
      }
      
      // Check for adaptation opportunities
      if (this.enableAdaptiveTopology) {
        await this.checkAdaptationOpportunity();
      }
      
    } catch (error) {
      this.logger.error('Error collecting performance metrics:', error);
    }
  }
  
  /**
   * Calculate efficiency metric
   */
  calculateEfficiency() {
    const connectionCount = this.calculateTotalConnections();
    const agentCount = this.topologyGraph.size;
    
    if (agentCount === 0) return 0;
    
    // Efficiency = throughput / (connection overhead)
    const connectionOverhead = connectionCount / agentCount;
    return this.currentMetrics.throughput / (1 + connectionOverhead);
  }
  
  /**
   * Calculate scalability metric
   */
  calculateScalability() {
    // Based on topology characteristics and current performance
    const topologyChar = TopologyPatterns[this.currentTopology.toUpperCase()]?.characteristics;
    const baseScalability = topologyChar?.scalability === 'very_high' ? 1.0 :
                           topologyChar?.scalability === 'high' ? 0.8 :
                           topologyChar?.scalability === 'medium' ? 0.6 :
                           topologyChar?.scalability === 'low' ? 0.4 : 0.2;
    
    // Adjust based on current performance
    const performanceAdjustment = (this.currentMetrics.throughput + this.currentMetrics.reliability) / 2;
    
    return baseScalability * performanceAdjustment;
  }
  
  /**
   * Calculate total connections in topology
   */
  calculateTotalConnections() {
    let total = 0;
    for (const connections of this.topologyGraph.values()) {
      total += connections.size;
    }
    return total;
  }
  
  /**
   * Record topology change in memory
   */
  async recordTopologyChange(changeType, data) {
    await this.memoryManager.store({
      key: `topology/change/${Date.now()}`,
      value: {
        changeType,
        ...data,
        timestamp: new Date()
      },
      namespace: 'swarm',
      category: 'coordination',
      tags: ['topology', 'change', changeType],
      metadata: {
        swarmId: this.swarmId,
        topology: this.currentTopology
      }
    });
  }
  
  /**
   * Load topology history from memory
   */
  async loadTopologyHistory() {
    try {
      const history = await this.memoryManager.query({
        namespace: 'swarm',
        category: 'coordination',
        tags: ['topology', 'change'],
        limit: 50,
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });
      
      this.adaptationHistory = history.results.map(r => r.value);
      this.logger.info(`📚 Loaded ${this.adaptationHistory.length} topology history records`);
      
    } catch (error) {
      this.logger.warn('Failed to load topology history:', error);
    }
  }
  
  /**
   * Get current topology status
   */
  getTopologyStatus() {
    return {
      swarmId: this.swarmId,
      currentTopology: this.currentTopology,
      agentCount: this.topologyGraph.size,
      connectionCount: this.calculateTotalConnections(),
      density: this.calculateTopologyDensity(),
      metrics: { ...this.currentMetrics },
      adaptiveMode: this.enableAdaptiveTopology,
      lastAdaptation: this.adaptationHistory[0]?.timestamp || null
    };
  }
  
  /**
   * Get topology graph for visualization
   */
  getTopologyGraph() {
    const graph = {
      nodes: [],
      edges: []
    };
    
    // Add nodes
    for (const agentId of this.topologyGraph.keys()) {
      graph.nodes.push({
        id: agentId,
        label: agentId,
        connections: this.topologyGraph.get(agentId).size
      });
    }
    
    // Add edges
    const addedEdges = new Set();
    for (const [agentId, connections] of this.topologyGraph) {
      for (const connectedId of connections) {
        const edgeKey = [agentId, connectedId].sort().join('-');
        if (!addedEdges.has(edgeKey)) {
          graph.edges.push({
            source: agentId,
            target: connectedId,
            id: edgeKey
          });
          addedEdges.add(edgeKey);
        }
      }
    }
    
    return graph;
  }
  
  // Helper methods (placeholder implementations)
  
  getAgentCapabilities(agentId) {
    // This would normally query agent registry
    return ['general'];
  }
  
  getTopPerformingAgents(count) {
    // This would return top performing agents based on metrics
    return Array.from(this.topologyGraph.keys()).slice(0, count);
  }
  
  determineAgentRole(capabilities) {
    if (capabilities.includes('coordination')) return 'coordinator';
    if (capabilities.includes('specialized')) return 'specialist';
    return 'worker';
  }
  
  findRelevantCoordinators(capabilities) {
    // Find coordinators with matching capabilities
    return Array.from(this.topologyGraph.keys()).filter(agentId => 
      this.getAgentCapabilities(agentId).includes('coordination')
    );
  }
  
  findBestCoordinator(capabilities) {
    const coordinators = this.findRelevantCoordinators(capabilities);
    return coordinators.length > 0 ? coordinators[0] : null;
  }
  
  calculateRingDisruption(current, next, newAgent) {
    // Simplified disruption calculation
    return Math.random(); // Placeholder
  }
  
  async initializeOptimizationModel() {
    // Placeholder for ML model initialization
    this.optimizationModel = {
      predict: async (features) => {
        // Simplified prediction
        return features.map(f => Math.random());
      }
    };
  }
  
  async extractConnectionFeatures(agentId, capabilities, preferences) {
    // Extract features for ML model
    return [0.5, 0.3, 0.8]; // Placeholder features
  }
  
  async checkAdaptationOpportunity() {
    // Check if topology should be adapted based on current performance
    // Implementation would analyze trends and trigger adaptations
  }
  
  /**
   * Shutdown topology manager
   */
  async shutdown() {
    if (this.performanceTrackingInterval) {
      clearInterval(this.performanceTrackingInterval);
    }
    
    // Save final state
    await this.recordTopologyChange('shutdown', {
      finalTopology: this.currentTopology,
      agentCount: this.topologyGraph.size,
      finalMetrics: this.currentMetrics
    });
    
    this.logger.info('🛑 TopologyManager shutdown complete');
  }
}

export default TopologyManager;