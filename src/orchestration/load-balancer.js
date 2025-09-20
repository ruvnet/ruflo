/**
 * Load Balancer Implementation
 * Provides intelligent load balancing and resource allocation for swarm agents
 * Integrates with RealMemoryManager for performance history and optimization
 */

import { EventEmitter } from 'events';

/**
 * Load balancing strategies
 */
export const LoadBalancingStrategy = {
  ROUND_ROBIN: 'round_robin',
  LEAST_LOADED: 'least_loaded',
  WEIGHTED_ROUND_ROBIN: 'weighted_round_robin',
  RESOURCE_AWARE: 'resource_aware',
  PERFORMANCE_BASED: 'performance_based',
  PREDICTIVE: 'predictive',
  ADAPTIVE: 'adaptive'
};

/**
 * Resource types for allocation
 */
export const ResourceType = {
  CPU: 'cpu',
  MEMORY: 'memory',
  NETWORK: 'network',
  STORAGE: 'storage',
  CONCURRENT_TASKS: 'concurrent_tasks',
  SPECIALIZED_CAPABILITY: 'specialized_capability'
};

/**
 * Load Balancer Class
 * Manages intelligent task distribution and resource allocation
 */
export class LoadBalancer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = options.logger || console;
    this.memoryManager = options.memoryManager;
    this.swarmId = options.swarmId;
    
    // Configuration
    this.strategy = options.strategy || LoadBalancingStrategy.ADAPTIVE;
    this.maxConcurrentTasks = options.maxConcurrentTasks || 10;
    this.resourceThresholds = {
      cpu: options.cpuThreshold || 0.8,
      memory: options.memoryThreshold || 0.8,
      network: options.networkThreshold || 0.8,
      concurrent_tasks: options.taskThreshold || 0.9
    };
    
    // Load balancing state
    this.agents = new Map(); // agentId -> AgentState
    this.taskQueue = [];
    this.roundRobinIndex = 0;
    this.weights = new Map(); // agentId -> weight (0-1)
    this.performanceHistory = new Map(); // agentId -> PerformanceMetrics[]
    
    // Resource allocation tracking
    this.resourceAllocations = new Map(); // resourceId -> { agentId, allocated, reserved }
    this.pendingAllocations = new Map(); // allocationId -> AllocationRequest
    
    // Performance prediction model
    this.predictionModel = null;
    this.modelTrainingData = [];
    
    // Monitoring intervals
    this.metricsUpdateInterval = null;
    this.weightUpdateInterval = null;
    this.predictionUpdateInterval = null;
    
    this.logger.info(`⚖️ LoadBalancer initialized for swarm: ${this.swarmId} with strategy: ${this.strategy}`);
  }
  
  /**
   * Initialize the load balancer
   */
  async initialize() {
    try {
      // Load historical data
      await this.loadHistoricalData();
      
      // Initialize prediction model
      await this.initializePredictionModel();
      
      // Start monitoring
      this.startMonitoring();
      
      this.logger.info('✅ LoadBalancer initialized successfully');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize LoadBalancer:', error);
      throw error;
    }
  }
  
  /**
   * Register an agent with the load balancer
   */
  async registerAgent(agentId, capabilities = [], resources = {}) {
    const agentState = {
      id: agentId,
      capabilities,
      resources: {
        cpu: { total: resources.cpu || 1.0, available: resources.cpu || 1.0 },
        memory: { total: resources.memory || 1024, available: resources.memory || 1024 },
        network: { total: resources.network || 100, available: resources.network || 100 },
        concurrent_tasks: { 
          total: resources.maxTasks || this.maxConcurrentTasks, 
          available: resources.maxTasks || this.maxConcurrentTasks 
        }
      },
      currentLoad: 0,
      taskCount: 0,
      queuedTasks: [],
      status: 'idle',
      healthScore: 1.0,
      lastUpdate: new Date(),
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageExecutionTime: 0,
        successRate: 1.0,
        throughput: 0,
        errorRate: 0
      }
    };
    
    this.agents.set(agentId, agentState);
    this.performanceHistory.set(agentId, []);
    
    // Initialize weight
    await this.updateAgentWeight(agentId);
    
    this.logger.info(`📝 Agent registered with LoadBalancer: ${agentId}`);
    this.emit('agent:registered', { agentId, capabilities, resources });
  }
  
  /**
   * Unregister an agent from the load balancer
   */
  async unregisterAgent(agentId) {
    if (!this.agents.has(agentId)) {
      this.logger.warn(`Agent not found for unregistration: ${agentId}`);
      return;
    }
    
    const agent = this.agents.get(agentId);
    
    // Redistribute queued tasks
    if (agent.queuedTasks.length > 0) {
      this.taskQueue.push(...agent.queuedTasks);
      this.logger.info(`Redistributing ${agent.queuedTasks.length} tasks from agent ${agentId}`);
    }
    
    // Release allocated resources
    await this.releaseAllResources(agentId);
    
    // Remove from tracking
    this.agents.delete(agentId);
    this.weights.delete(agentId);
    this.performanceHistory.delete(agentId);
    
    this.logger.info(`📤 Agent unregistered from LoadBalancer: ${agentId}`);
    this.emit('agent:unregistered', { agentId });
  }
  
  /**
   * Select the best agent for a task using the configured strategy
   */
  async selectAgent(task, options = {}) {
    const availableAgents = this.getAvailableAgents(task, options);
    
    if (availableAgents.length === 0) {
      return null;
    }
    
    let selectedAgent;
    
    switch (this.strategy) {
      case LoadBalancingStrategy.ROUND_ROBIN:
        selectedAgent = this.selectRoundRobin(availableAgents);
        break;
        
      case LoadBalancingStrategy.LEAST_LOADED:
        selectedAgent = this.selectLeastLoaded(availableAgents);
        break;
        
      case LoadBalancingStrategy.WEIGHTED_ROUND_ROBIN:
        selectedAgent = this.selectWeightedRoundRobin(availableAgents);
        break;
        
      case LoadBalancingStrategy.RESOURCE_AWARE:
        selectedAgent = this.selectResourceAware(availableAgents, task);
        break;
        
      case LoadBalancingStrategy.PERFORMANCE_BASED:
        selectedAgent = this.selectPerformanceBased(availableAgents, task);
        break;
        
      case LoadBalancingStrategy.PREDICTIVE:
        selectedAgent = await this.selectPredictive(availableAgents, task);
        break;
        
      case LoadBalancingStrategy.ADAPTIVE:
        selectedAgent = await this.selectAdaptive(availableAgents, task);
        break;
        
      default:
        selectedAgent = this.selectLeastLoaded(availableAgents);
    }
    
    if (selectedAgent) {
      await this.allocateTask(selectedAgent.id, task);
    }
    
    return selectedAgent;
  }
  
  /**
   * Get available agents that can handle a task
   */
  getAvailableAgents(task, options = {}) {
    const requiredCapabilities = task.requiredCapabilities || [];
    const requiredResources = task.requiredResources || {};
    
    return Array.from(this.agents.values()).filter(agent => {
      // Check if agent is healthy and available
      if (agent.status !== 'idle' && agent.status !== 'busy') {
        return false;
      }
      
      // Check health score
      if (agent.healthScore < 0.5) {
        return false;
      }
      
      // Check capability requirements
      if (requiredCapabilities.length > 0) {
        const hasCapabilities = requiredCapabilities.every(cap => 
          agent.capabilities.includes(cap)
        );
        if (!hasCapabilities) {
          return false;
        }
      }
      
      // Check resource requirements
      for (const [resourceType, required] of Object.entries(requiredResources)) {
        const available = agent.resources[resourceType]?.available || 0;
        if (available < required) {
          return false;
        }
      }
      
      // Check concurrent task limit
      if (agent.taskCount >= agent.resources.concurrent_tasks.total) {
        return false;
      }
      
      // Check load threshold (optional)
      if (options.maxLoad && agent.currentLoad > options.maxLoad) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Round-robin selection
   */
  selectRoundRobin(agents) {
    if (agents.length === 0) return null;
    
    const selected = agents[this.roundRobinIndex % agents.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % agents.length;
    
    return selected;
  }
  
  /**
   * Least loaded selection
   */
  selectLeastLoaded(agents) {
    if (agents.length === 0) return null;
    
    return agents.reduce((least, current) => {
      if (current.currentLoad < least.currentLoad) {
        return current;
      } else if (current.currentLoad === least.currentLoad) {
        // Secondary sort by task count
        return current.taskCount < least.taskCount ? current : least;
      }
      return least;
    });
  }
  
  /**
   * Weighted round-robin selection
   */
  selectWeightedRoundRobin(agents) {
    if (agents.length === 0) return null;
    
    // Calculate total weight
    const totalWeight = agents.reduce((sum, agent) => {
      const weight = this.weights.get(agent.id) || 0.5;
      return sum + weight;
    }, 0);
    
    if (totalWeight === 0) {
      return this.selectRoundRobin(agents);
    }
    
    // Select based on weighted probability
    let random = Math.random() * totalWeight;
    
    for (const agent of agents) {
      const weight = this.weights.get(agent.id) || 0.5;
      random -= weight;
      if (random <= 0) {
        return agent;
      }
    }
    
    // Fallback to last agent
    return agents[agents.length - 1];
  }
  
  /**
   * Resource-aware selection
   */
  selectResourceAware(agents, task) {
    if (agents.length === 0) return null;
    
    const requiredResources = task.requiredResources || {};
    
    // Score agents based on resource availability
    const scoredAgents = agents.map(agent => {
      let score = 0;
      let resourceCount = 0;
      
      for (const [resourceType, required] of Object.entries(requiredResources)) {
        const resource = agent.resources[resourceType];
        if (resource) {
          const utilization = 1 - (resource.available / resource.total);
          score += 1 - utilization; // Higher score for more available resources
          resourceCount++;
        }
      }
      
      // Average resource availability score
      const resourceScore = resourceCount > 0 ? score / resourceCount : 0.5;
      
      // Combine with current load (lower load = higher score)
      const loadScore = 1 - agent.currentLoad;
      
      const finalScore = (resourceScore * 0.7) + (loadScore * 0.3);
      
      return { agent, score: finalScore };
    });
    
    // Sort by score (highest first)
    scoredAgents.sort((a, b) => b.score - a.score);
    
    return scoredAgents[0].agent;
  }
  
  /**
   * Performance-based selection
   */
  selectPerformanceBased(agents, task) {
    if (agents.length === 0) return null;
    
    const scoredAgents = agents.map(agent => {
      const metrics = agent.metrics;
      
      // Calculate performance score
      let score = 0;
      
      // Success rate component (40%)
      score += metrics.successRate * 0.4;
      
      // Throughput component (30%)
      const normalizedThroughput = Math.min(metrics.throughput / 10, 1); // Normalize to 0-1
      score += normalizedThroughput * 0.3;
      
      // Speed component (20%) - inverse of execution time
      const speedScore = metrics.averageExecutionTime > 0 ? 
        Math.min(10000 / metrics.averageExecutionTime, 1) : 0.5;
      score += speedScore * 0.2;
      
      // Health component (10%)
      score += agent.healthScore * 0.1;
      
      return { agent, score };
    });
    
    // Sort by score (highest first)
    scoredAgents.sort((a, b) => b.score - a.score);
    
    return scoredAgents[0].agent;
  }
  
  /**
   * Predictive selection using ML model
   */
  async selectPredictive(agents, task) {
    if (!this.predictionModel || agents.length === 0) {
      return this.selectPerformanceBased(agents, task);
    }
    
    try {
      const predictions = await Promise.all(
        agents.map(async agent => {
          const features = this.extractFeatures(agent, task);
          const prediction = await this.predictionModel.predict(features);
          return { agent, prediction };
        })
      );
      
      // Select agent with best predicted performance
      predictions.sort((a, b) => b.prediction - a.prediction);
      return predictions[0].agent;
      
    } catch (error) {
      this.logger.warn('Predictive selection failed, using performance-based fallback:', error);
      return this.selectPerformanceBased(agents, task);
    }
  }
  
  /**
   * Adaptive selection that combines multiple strategies
   */
  async selectAdaptive(agents, task) {
    if (agents.length === 0) return null;
    
    // Get selections from different strategies
    const strategies = [
      { name: 'least_loaded', agent: this.selectLeastLoaded(agents), weight: 0.3 },
      { name: 'resource_aware', agent: this.selectResourceAware(agents, task), weight: 0.3 },
      { name: 'performance_based', agent: this.selectPerformanceBased(agents, task), weight: 0.4 }
    ];
    
    // Count votes for each agent
    const votes = new Map();
    
    for (const strategy of strategies) {
      if (strategy.agent) {
        const agentId = strategy.agent.id;
        const currentVotes = votes.get(agentId) || 0;
        votes.set(agentId, currentVotes + strategy.weight);
      }
    }
    
    if (votes.size === 0) {
      return null;
    }
    
    // Select agent with most weighted votes
    let bestAgent = null;
    let maxVotes = 0;
    
    for (const [agentId, voteCount] of votes) {
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        bestAgent = agents.find(a => a.id === agentId);
      }
    }
    
    return bestAgent;
  }
  
  /**
   * Allocate a task to an agent
   */
  async allocateTask(agentId, task) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    // Update agent state
    agent.taskCount++;
    agent.queuedTasks.push(task);
    agent.status = agent.taskCount >= agent.resources.concurrent_tasks.total ? 'busy' : 'idle';
    
    // Allocate required resources
    const requiredResources = task.requiredResources || {};
    for (const [resourceType, required] of Object.entries(requiredResources)) {
      if (agent.resources[resourceType]) {
        agent.resources[resourceType].available -= required;
      }
    }
    
    // Update load calculation
    await this.updateAgentLoad(agentId);
    
    // Store allocation in memory
    await this.memoryManager.store({
      key: `allocation/${task.id}`,
      value: {
        taskId: task.id,
        agentId,
        allocatedAt: new Date(),
        resources: requiredResources,
        strategy: this.strategy
      },
      namespace: 'swarm',
      category: 'coordination',
      tags: ['allocation', 'load-balancing'],
      metadata: {
        agentId,
        taskType: task.type,
        strategy: this.strategy
      }
    });
    
    this.emit('task:allocated', { task, agentId, agent });
    this.logger.debug(`📋 Task ${task.id} allocated to agent ${agentId}`);
  }
  
  /**
   * Deallocate a task from an agent
   */
  async deallocateTask(agentId, taskId, result = null) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(`Agent not found for deallocation: ${agentId}`);
      return;
    }
    
    // Find and remove task
    const taskIndex = agent.queuedTasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      this.logger.warn(`Task not found for deallocation: ${taskId} from agent ${agentId}`);
      return;
    }
    
    const task = agent.queuedTasks.splice(taskIndex, 1)[0];
    
    // Update agent state
    agent.taskCount = Math.max(0, agent.taskCount - 1);
    agent.status = agent.taskCount > 0 ? 'busy' : 'idle';
    
    // Release allocated resources
    const requiredResources = task.requiredResources || {};
    for (const [resourceType, required] of Object.entries(requiredResources)) {
      if (agent.resources[resourceType]) {
        agent.resources[resourceType].available = Math.min(
          agent.resources[resourceType].available + required,
          agent.resources[resourceType].total
        );
      }
    }
    
    // Update metrics
    await this.updateAgentMetrics(agentId, task, result);
    
    // Update load calculation
    await this.updateAgentLoad(agentId);
    
    this.emit('task:deallocated', { task, agentId, result });
    this.logger.debug(`📤 Task ${taskId} deallocated from agent ${agentId}`);
  }
  
  /**
   * Update agent load calculation
   */
  async updateAgentLoad(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    // Calculate load based on resource utilization
    let totalLoad = 0;
    let resourceCount = 0;
    
    for (const [resourceType, resource] of Object.entries(agent.resources)) {
      if (resource.total > 0) {
        const utilization = 1 - (resource.available / resource.total);
        totalLoad += utilization;
        resourceCount++;
      }
    }
    
    agent.currentLoad = resourceCount > 0 ? totalLoad / resourceCount : 0;
    agent.lastUpdate = new Date();
  }
  
  /**
   * Update agent performance metrics
   */
  async updateAgentMetrics(agentId, task, result) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    const metrics = agent.metrics;
    const isSuccess = result && result.success !== false;
    const executionTime = result?.executionTime || 0;
    
    // Update counters
    metrics.totalTasks++;
    if (isSuccess) {
      metrics.completedTasks++;
    } else {
      metrics.failedTasks++;
    }
    
    // Update rates
    metrics.successRate = metrics.completedTasks / metrics.totalTasks;
    metrics.errorRate = metrics.failedTasks / metrics.totalTasks;
    
    // Update execution time
    if (executionTime > 0) {
      const totalTime = metrics.averageExecutionTime * (metrics.totalTasks - 1) + executionTime;
      metrics.averageExecutionTime = totalTime / metrics.totalTasks;
    }
    
    // Update throughput (tasks per minute)
    const timeWindow = 60000; // 1 minute
    const history = this.performanceHistory.get(agentId) || [];
    const now = new Date();
    
    // Add current task to history
    history.push({
      timestamp: now,
      success: isSuccess,
      executionTime
    });
    
    // Remove old entries
    const cutoff = new Date(now.getTime() - timeWindow);
    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
    }
    
    metrics.throughput = history.length; // Tasks in last minute
    this.performanceHistory.set(agentId, history);
    
    // Update weight based on new metrics
    await this.updateAgentWeight(agentId);
    
    // Store metrics in memory
    await this.memoryManager.store({
      key: `agent/${agentId}/metrics`,
      value: {
        agentId,
        metrics: { ...metrics },
        timestamp: now
      },
      namespace: 'swarm',
      category: 'performance',
      tags: ['agent-metrics', 'load-balancing'],
      metadata: {
        agentId,
        successRate: metrics.successRate,
        throughput: metrics.throughput
      }
    });
  }
  
  /**
   * Update agent weight for weighted algorithms
   */
  async updateAgentWeight(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    const metrics = agent.metrics;
    
    // Calculate weight based on performance factors
    let weight = 0.5; // Base weight
    
    // Success rate component (40%)
    weight += metrics.successRate * 0.4;
    
    // Health score component (20%)
    weight += agent.healthScore * 0.2;
    
    // Load component (20%) - lower load gets higher weight
    weight += (1 - agent.currentLoad) * 0.2;
    
    // Throughput component (20%)
    const normalizedThroughput = Math.min(metrics.throughput / 10, 1);
    weight += normalizedThroughput * 0.2;
    
    // Ensure weight is in valid range
    weight = Math.max(0.1, Math.min(1.0, weight));
    
    this.weights.set(agentId, weight);
  }
  
  /**
   * Get load balancing statistics
   */
  getLoadBalancingStats() {
    const agents = Array.from(this.agents.values());
    const totalTasks = agents.reduce((sum, agent) => sum + agent.taskCount, 0);
    const totalCapacity = agents.reduce((sum, agent) => sum + agent.resources.concurrent_tasks.total, 0);
    
    return {
      strategy: this.strategy,
      agentCount: agents.length,
      totalTasks,
      totalCapacity,
      utilization: totalCapacity > 0 ? totalTasks / totalCapacity : 0,
      agents: agents.map(agent => ({
        id: agent.id,
        status: agent.status,
        load: agent.currentLoad,
        taskCount: agent.taskCount,
        weight: this.weights.get(agent.id) || 0.5,
        metrics: { ...agent.metrics }
      })),
      queuedTasks: this.taskQueue.length
    };
  }
  
  /**
   * Start monitoring and maintenance
   */
  startMonitoring() {
    // Update metrics every 30 seconds
    this.metricsUpdateInterval = setInterval(() => {
      this.updateAllAgentMetrics();
    }, 30000);
    
    // Update weights every minute
    this.weightUpdateInterval = setInterval(() => {
      this.updateAllWeights();
    }, 60000);
    
    // Update prediction model every 5 minutes
    this.predictionUpdateInterval = setInterval(() => {
      this.updatePredictionModel();
    }, 300000);
    
    this.logger.info('📊 LoadBalancer monitoring started');
  }
  
  /**
   * Update metrics for all agents
   */
  async updateAllAgentMetrics() {
    for (const agentId of this.agents.keys()) {
      await this.updateAgentLoad(agentId);
    }
  }
  
  /**
   * Update weights for all agents
   */
  async updateAllWeights() {
    for (const agentId of this.agents.keys()) {
      await this.updateAgentWeight(agentId);
    }
  }
  
  /**
   * Initialize prediction model
   */
  async initializePredictionModel() {
    // Placeholder for ML model initialization
    // In a real implementation, this would load/train a machine learning model
    this.predictionModel = {
      predict: async (features) => {
        // Simple heuristic-based prediction
        const [successRate, throughput, load, healthScore] = features;
        return (successRate * 0.4) + (throughput * 0.3) + ((1 - load) * 0.2) + (healthScore * 0.1);
      }
    };
  }
  
  /**
   * Extract features for prediction model
   */
  extractFeatures(agent, task) {
    return [
      agent.metrics.successRate,
      Math.min(agent.metrics.throughput / 10, 1), // Normalized throughput
      agent.currentLoad,
      agent.healthScore
    ];
  }
  
  /**
   * Update prediction model with new data
   */
  async updatePredictionModel() {
    // Collect training data from recent performance
    const trainingData = [];
    
    for (const [agentId, agent] of this.agents) {
      const history = this.performanceHistory.get(agentId) || [];
      
      // Create training samples from recent history
      for (const entry of history.slice(-10)) { // Last 10 tasks
        const features = [
          agent.metrics.successRate,
          Math.min(agent.metrics.throughput / 10, 1),
          agent.currentLoad,
          agent.healthScore
        ];
        
        const target = entry.success ? 1.0 : 0.0;
        trainingData.push({ features, target });
      }
    }
    
    // Store training data for model updates
    this.modelTrainingData = trainingData.slice(-1000); // Keep last 1000 samples
    
    // In a real implementation, retrain the model here
    if (this.modelTrainingData.length > 100) {
      this.logger.debug(`📈 Model training data updated: ${this.modelTrainingData.length} samples`);
    }
  }
  
  /**
   * Load historical data from memory
   */
  async loadHistoricalData() {
    try {
      const historicalData = await this.memoryManager.query({
        namespace: 'swarm',
        category: 'performance',
        tags: ['agent-metrics', 'load-balancing'],
        limit: 500,
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });
      
      // Process historical data to rebuild performance history
      for (const record of historicalData.results) {
        const data = record.value;
        if (data.agentId && data.metrics) {
          // Initialize agent if not exists
          if (!this.performanceHistory.has(data.agentId)) {
            this.performanceHistory.set(data.agentId, []);
          }
          
          // Add to training data
          this.modelTrainingData.push({
            features: [
              data.metrics.successRate,
              Math.min(data.metrics.throughput / 10, 1),
              0.5, // Default load (historical)
              1.0  // Default health (historical)
            ],
            target: data.metrics.successRate
          });
        }
      }
      
      this.logger.info(`📚 Loaded ${historicalData.results.length} historical performance records`);
      
    } catch (error) {
      this.logger.warn('Failed to load historical data:', error);
    }
  }
  
  /**
   * Release all resources allocated to an agent
   */
  async releaseAllResources(agentId) {
    const allocations = [];
    
    for (const [resourceId, allocation] of this.resourceAllocations) {
      if (allocation.agentId === agentId) {
        allocations.push(resourceId);
      }
    }
    
    for (const resourceId of allocations) {
      this.resourceAllocations.delete(resourceId);
    }
    
    if (allocations.length > 0) {
      this.logger.info(`🔓 Released ${allocations.length} resources from agent ${agentId}`);
    }
  }
  
  /**
   * Shutdown the load balancer
   */
  async shutdown() {
    // Stop monitoring intervals
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
    }
    if (this.weightUpdateInterval) {
      clearInterval(this.weightUpdateInterval);
    }
    if (this.predictionUpdateInterval) {
      clearInterval(this.predictionUpdateInterval);
    }
    
    // Save final state
    const finalStats = this.getLoadBalancingStats();
    await this.memoryManager.store({
      key: 'load-balancer/final-state',
      value: {
        ...finalStats,
        shutdownTime: new Date()
      },
      namespace: 'swarm',
      category: 'coordination',
      tags: ['load-balancer', 'shutdown'],
      metadata: {
        swarmId: this.swarmId,
        strategy: this.strategy
      }
    });
    
    this.logger.info('🛑 LoadBalancer shutdown complete');
  }
}

export default LoadBalancer;