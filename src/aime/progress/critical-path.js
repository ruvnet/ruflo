/**
 * Critical Path Analyzer
 * 
 * Implements Critical Path Method (CPM) for project scheduling.
 * Calculates critical paths, slack times, and optimal execution sequences.
 * 
 * @module CriticalPathAnalyzer
 */

export class CriticalPathAnalyzer {
  constructor() {
    this.analysisCache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }
  
  /**
   * Calculate critical path using CPM algorithm
   */
  async calculate(graph, options = {}) {
    const {
      startNode = null,
      endNode = null,
      includeSlack = true,
      includeFloat = true,
      considerResources = false
    } = options;
    
    // Check cache
    const cacheKey = this.getCacheKey(graph, options);
    const cached = this.analysisCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.result;
    }
    
    // Prepare graph data
    const nodes = new Map();
    const edges = new Map();
    
    // Initialize nodes
    for (const node of graph.nodes) {
      nodes.set(node.id, {
        id: node.id,
        type: node.type,
        data: node.data,
        duration: this.getNodeDuration(node),
        earliestStart: 0,
        earliestFinish: 0,
        latestStart: Infinity,
        latestFinish: Infinity,
        totalFloat: 0,
        freeFloat: 0,
        isCritical: false,
        dependencies: [],
        dependents: []
      });
    }
    
    // Build edge relationships
    for (const edge of graph.edges) {
      const sourceNode = nodes.get(edge.source);
      const targetNode = nodes.get(edge.target);
      
      if (sourceNode && targetNode) {
        targetNode.dependencies.push(edge.source);
        sourceNode.dependents.push(edge.target);
      }
    }
    
    // Forward pass - calculate earliest times
    await this.forwardPass(nodes, startNode);
    
    // Backward pass - calculate latest times
    const projectDuration = await this.backwardPass(nodes, endNode);
    
    // Calculate floats and identify critical path
    const criticalPath = this.calculateFloats(nodes, includeSlack, includeFloat);
    
    // Build result
    const result = {
      nodes: criticalPath.nodes,
      edges: criticalPath.edges,
      duration: projectDuration,
      criticalNodes: criticalPath.criticalNodes,
      slack: includeSlack ? criticalPath.slack : {},
      float: includeFloat ? criticalPath.float : {},
      parallelPaths: this.findParallelPaths(nodes),
      metadata: {
        calculatedAt: Date.now(),
        nodeCount: nodes.size,
        criticalNodeCount: criticalPath.criticalNodes.length
      }
    };
    
    // Cache result
    this.analysisCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
    
    return result;
  }
  
  /**
   * Forward pass - calculate earliest start and finish times
   */
  async forwardPass(nodes, startNode) {
    const processed = new Set();
    const queue = [];
    
    // Find starting nodes
    if (startNode) {
      queue.push(startNode);
    } else {
      // Find all nodes with no dependencies
      for (const [nodeId, node] of nodes) {
        if (node.dependencies.length === 0) {
          queue.push(nodeId);
        }
      }
    }
    
    // Process nodes in topological order
    while (queue.length > 0) {
      const nodeId = queue.shift();
      const node = nodes.get(nodeId);
      
      if (!node || processed.has(nodeId)) continue;
      
      // Calculate earliest start
      if (node.dependencies.length === 0) {
        node.earliestStart = 0;
      } else {
        let maxFinish = 0;
        for (const depId of node.dependencies) {
          const dep = nodes.get(depId);
          if (dep && processed.has(depId)) {
            maxFinish = Math.max(maxFinish, dep.earliestFinish);
          } else {
            // Dependency not processed yet, skip this node
            continue;
          }
        }
        node.earliestStart = maxFinish;
      }
      
      // Calculate earliest finish
      node.earliestFinish = node.earliestStart + node.duration;
      processed.add(nodeId);
      
      // Add dependents to queue
      for (const depId of node.dependents) {
        const dependent = nodes.get(depId);
        if (dependent) {
          // Check if all dependencies are processed
          const allDepsProcessed = dependent.dependencies.every(d => processed.has(d));
          if (allDepsProcessed && !processed.has(depId)) {
            queue.push(depId);
          }
        }
      }
    }
  }
  
  /**
   * Backward pass - calculate latest start and finish times
   */
  async backwardPass(nodes, endNode) {
    const processed = new Set();
    const queue = [];
    let projectDuration = 0;
    
    // Find project duration and ending nodes
    if (endNode) {
      const node = nodes.get(endNode);
      if (node) {
        projectDuration = node.earliestFinish;
        queue.push(endNode);
      }
    } else {
      // Find all nodes with no dependents and max finish time
      for (const [nodeId, node] of nodes) {
        projectDuration = Math.max(projectDuration, node.earliestFinish);
        if (node.dependents.length === 0) {
          queue.push(nodeId);
        }
      }
    }
    
    // Set latest finish for ending nodes
    for (const nodeId of queue) {
      const node = nodes.get(nodeId);
      if (node) {
        node.latestFinish = projectDuration;
        node.latestStart = node.latestFinish - node.duration;
      }
    }
    
    // Process nodes in reverse topological order
    while (queue.length > 0) {
      const nodeId = queue.shift();
      const node = nodes.get(nodeId);
      
      if (!node || processed.has(nodeId)) continue;
      processed.add(nodeId);
      
      // Update dependencies
      for (const depId of node.dependencies) {
        const dep = nodes.get(depId);
        if (!dep) continue;
        
        // Update latest finish
        dep.latestFinish = Math.min(dep.latestFinish, node.latestStart);
        dep.latestStart = dep.latestFinish - dep.duration;
        
        // Check if all dependents are processed
        const allDepsProcessed = dep.dependents.every(d => processed.has(d));
        if (allDepsProcessed && !processed.has(depId)) {
          queue.push(depId);
        }
      }
    }
    
    return projectDuration;
  }
  
  /**
   * Calculate floats and identify critical path
   */
  calculateFloats(nodes, includeSlack, includeFloat) {
    const criticalNodes = [];
    const criticalEdges = [];
    const slack = {};
    const float = {};
    
    for (const [nodeId, node] of nodes) {
      // Calculate total float (slack)
      node.totalFloat = node.latestStart - node.earliestStart;
      
      // Calculate free float
      let minSuccessorES = Infinity;
      for (const depId of node.dependents) {
        const dep = nodes.get(depId);
        if (dep) {
          minSuccessorES = Math.min(minSuccessorES, dep.earliestStart);
        }
      }
      
      if (node.dependents.length > 0) {
        node.freeFloat = minSuccessorES - node.earliestFinish;
      } else {
        node.freeFloat = node.totalFloat;
      }
      
      // Identify critical nodes (zero total float)
      if (node.totalFloat === 0) {
        node.isCritical = true;
        criticalNodes.push(nodeId);
        
        // Add critical edges
        for (const depId of node.dependents) {
          const dep = nodes.get(depId);
          if (dep && dep.totalFloat === 0) {
            criticalEdges.push({
              source: nodeId,
              target: depId,
              type: 'critical'
            });
          }
        }
      }
      
      // Store slack and float values
      if (includeSlack) {
        slack[nodeId] = node.totalFloat;
      }
      if (includeFloat) {
        float[nodeId] = {
          total: node.totalFloat,
          free: node.freeFloat
        };
      }
    }
    
    return {
      nodes: Array.from(nodes.keys()),
      edges: criticalEdges,
      criticalNodes,
      slack,
      float
    };
  }
  
  /**
   * Find parallel critical paths
   */
  findParallelPaths(nodes) {
    const criticalNodes = new Set();
    const paths = [];
    
    // Identify all critical nodes
    for (const [nodeId, node] of nodes) {
      if (node.isCritical) {
        criticalNodes.add(nodeId);
      }
    }
    
    // Find starting nodes
    const startNodes = [];
    for (const nodeId of criticalNodes) {
      const node = nodes.get(nodeId);
      const hasCriticalDep = node.dependencies.some(d => criticalNodes.has(d));
      if (!hasCriticalDep) {
        startNodes.push(nodeId);
      }
    }
    
    // Trace paths from each start node
    for (const startId of startNodes) {
      const path = this.traceCriticalPath(startId, nodes, criticalNodes);
      if (path.length > 0) {
        paths.push(path);
      }
    }
    
    return paths;
  }
  
  /**
   * Trace a critical path from a starting node
   */
  traceCriticalPath(startId, nodes, criticalNodes, visited = new Set()) {
    const path = [startId];
    visited.add(startId);
    
    let currentId = startId;
    while (currentId) {
      const node = nodes.get(currentId);
      if (!node) break;
      
      // Find next critical node
      let nextId = null;
      for (const depId of node.dependents) {
        if (criticalNodes.has(depId) && !visited.has(depId)) {
          nextId = depId;
          break;
        }
      }
      
      if (nextId) {
        path.push(nextId);
        visited.add(nextId);
        currentId = nextId;
      } else {
        break;
      }
    }
    
    return path;
  }
  
  /**
   * Get node duration
   */
  getNodeDuration(node) {
    // Try different duration fields
    if (node.data?.estimatedDuration) {
      return node.data.estimatedDuration;
    }
    if (node.data?.metadata?.estimatedDuration) {
      return node.data.metadata.estimatedDuration;
    }
    if (node.data?.duration) {
      return node.data.duration;
    }
    
    // Default durations by type
    const defaultDurations = {
      mission: 86400000,  // 1 day
      phase: 28800000,    // 8 hours
      task: 3600000,      // 1 hour
      subtask: 900000     // 15 minutes
    };
    
    return defaultDurations[node.type] || 3600000;
  }
  
  /**
   * Generate cache key
   */
  getCacheKey(graph, options) {
    const graphHash = this.hashGraph(graph);
    const optionsHash = JSON.stringify(options);
    return `${graphHash}_${optionsHash}`;
  }
  
  /**
   * Simple graph hash for caching
   */
  hashGraph(graph) {
    const nodeIds = graph.nodes.map(n => n.id).sort().join(',');
    const edgeIds = graph.edges.map(e => `${e.source}-${e.target}`).sort().join(',');
    return `${nodeIds}_${edgeIds}`;
  }
  
  /**
   * Calculate resource-constrained critical path
   */
  async calculateResourceConstrained(graph, resources, options = {}) {
    // This would implement resource-leveling algorithms
    // For now, return standard critical path
    return this.calculate(graph, { ...options, considerResources: true });
  }
  
  /**
   * Optimize critical path by suggesting parallelization
   */
  async optimizePath(graph, constraints = {}) {
    const analysis = await this.calculate(graph);
    const suggestions = [];
    
    // Find nodes that could be parallelized
    for (const node of graph.nodes) {
      const nodeData = analysis.float[node.id];
      if (nodeData && nodeData.total > 0) {
        suggestions.push({
          nodeId: node.id,
          type: 'parallelization',
          description: `Node ${node.id} has ${nodeData.total}ms float and could be started earlier`,
          potentialSaving: nodeData.total
        });
      }
    }
    
    // Find resource bottlenecks
    const resourceUsage = this.analyzeResourceUsage(graph, analysis);
    for (const [resource, usage] of Object.entries(resourceUsage)) {
      if (usage.peak > usage.average * 1.5) {
        suggestions.push({
          type: 'resource_bottleneck',
          resource,
          description: `Resource ${resource} has peak usage ${usage.peak} vs average ${usage.average}`,
          affectedNodes: usage.peakNodes
        });
      }
    }
    
    return {
      currentDuration: analysis.duration,
      suggestions,
      potentialSaving: suggestions.reduce((sum, s) => sum + (s.potentialSaving || 0), 0)
    };
  }
  
  /**
   * Analyze resource usage patterns
   */
  analyzeResourceUsage(graph, analysis) {
    const usage = {};
    
    // Simplified resource analysis
    // In real implementation, this would track actual resource requirements
    for (const node of graph.nodes) {
      const resources = node.data?.requirements || {};
      for (const [resource, amount] of Object.entries(resources)) {
        if (!usage[resource]) {
          usage[resource] = {
            total: 0,
            peak: 0,
            average: 0,
            peakNodes: []
          };
        }
        usage[resource].total += amount;
        if (amount > usage[resource].peak) {
          usage[resource].peak = amount;
          usage[resource].peakNodes = [node.id];
        }
      }
    }
    
    // Calculate averages
    for (const resource of Object.values(usage)) {
      resource.average = resource.total / graph.nodes.length;
    }
    
    return usage;
  }
  
  /**
   * Clear analysis cache
   */
  clearCache() {
    this.analysisCache.clear();
  }
}