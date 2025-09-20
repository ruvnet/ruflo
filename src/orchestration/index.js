/**
 * Orchestration Module Index
 * Exports all real swarm orchestration components
 * Provides unified interface for swarm orchestration system
 */

export { RealSwarmOrchestrator, SwarmTopology, AgentState, ExecutionStrategy } from './real-swarm-orchestrator.js';
export { AgentWorker } from './agent-worker.js';
export { TopologyManager, TopologyPatterns } from './topology-manager.js';
export { LoadBalancer, LoadBalancingStrategy, ResourceType } from './load-balancer.js';
export { FailureRecoveryManager, FailureType, RecoveryStrategy } from './failure-recovery.js';

/**
 * Orchestration Factory Class
 * Provides convenient factory methods for creating orchestration components
 */
export class OrchestrationFactory {
  /**
   * Create a complete swarm orchestration system
   */
  static async createSwarmSystem(options = {}) {
    const {
      swarmId = `swarm_${Date.now()}`,
      topology = SwarmTopology.HIERARCHICAL,
      maxAgents = 12,
      enableFailover = true,
      enableLoadBalancing = true,
      logger = console,
      memoryManager = null
    } = options;
    
    // Create main orchestrator
    const orchestrator = new RealSwarmOrchestrator({
      swarmId,
      topology,
      maxAgents,
      enableFailover,
      enableLoadBalancing,
      logger,
      memoryManager
    });
    
    // Create supporting components
    const topologyManager = new TopologyManager({
      swarmId,
      initialTopology: topology,
      logger,
      memoryManager
    });
    
    const loadBalancer = new LoadBalancer({
      swarmId,
      strategy: LoadBalancingStrategy.ADAPTIVE,
      logger,
      memoryManager
    });
    
    const failureRecovery = new FailureRecoveryManager({
      swarmId,
      swarmOrchestrator: orchestrator,
      loadBalancer,
      topologyManager,
      logger,
      memoryManager
    });
    
    // Wire components together
    orchestrator.topologyManager = topologyManager;
    orchestrator.loadBalancer = loadBalancer;
    orchestrator.failureRecovery = failureRecovery;
    
    return {
      orchestrator,
      topologyManager,
      loadBalancer,
      failureRecovery,
      
      async initialize() {
        await orchestrator.initialize();
        await topologyManager.initialize();
        await loadBalancer.initialize();
        await failureRecovery.initialize();
        
        logger.info('🚀 Complete swarm orchestration system initialized');
      },
      
      async shutdown() {
        await failureRecovery.shutdown();
        await loadBalancer.shutdown();
        await topologyManager.shutdown();  
        await orchestrator.shutdown();
        
        logger.info('🛑 Complete swarm orchestration system shutdown');
      }
    };
  }
  
  /**
   * Create a lightweight orchestration system for testing
   */
  static async createTestSystem(options = {}) {
    const {
      swarmId = `test_swarm_${Date.now()}`,
      maxAgents = 3,
      logger = console
    } = options;
    
    const orchestrator = new RealSwarmOrchestrator({
      swarmId,
      topology: SwarmTopology.MESH,
      maxAgents,
      enableFailover: false,
      enableLoadBalancing: true,
      logger
    });
    
    return {
      orchestrator,
      
      async initialize() {
        await orchestrator.initialize();
        logger.info('🧪 Test orchestration system initialized');
      },
      
      async shutdown() {
        await orchestrator.shutdown();
        logger.info('🧪 Test orchestration system shutdown');
      }
    };
  }
}

/**
 * Orchestration Utilities
 * Provides utility functions for orchestration operations
 */
export class OrchestrationUtils {
  /**
   * Validate orchestration configuration
   */
  static validateConfig(config) {
    const errors = [];
    
    if (!config.swarmId) {
      errors.push('swarmId is required');
    }
    
    if (config.maxAgents && (config.maxAgents < 1 || config.maxAgents > 100)) {
      errors.push('maxAgents must be between 1 and 100');
    }
    
    if (config.topology && !Object.values(SwarmTopology).includes(config.topology)) {
      errors.push(`Invalid topology: ${config.topology}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Calculate optimal swarm configuration based on workload
   */
  static calculateOptimalConfig(workload) {
    const {
      expectedTasks = 10,
      taskComplexity = 'medium',
      concurrencyRequirements = 'medium',
      reliabilityRequirements = 'medium'
    } = workload;
    
    let maxAgents = Math.ceil(expectedTasks / 3); // Base calculation
    let topology = SwarmTopology.HIERARCHICAL; // Default
    let strategy = LoadBalancingStrategy.ADAPTIVE;
    
    // Adjust based on complexity
    if (taskComplexity === 'high') {
      maxAgents = Math.min(maxAgents * 1.5, 20);
      topology = SwarmTopology.MESH; // Better collaboration
    }
    
    // Adjust based on concurrency
    if (concurrencyRequirements === 'high') {
      maxAgents = Math.min(maxAgents * 2, 25);
      strategy = LoadBalancingStrategy.LEAST_LOADED;
    }
    
    // Adjust based on reliability
    if (reliabilityRequirements === 'high') {
      topology = SwarmTopology.HYBRID; // Better fault tolerance
    }
    
    return {
      maxAgents: Math.max(1, Math.ceil(maxAgents)),
      topology,
      loadBalancingStrategy: strategy,
      enableFailover: reliabilityRequirements !== 'low',
      enableLoadBalancing: true
    };
  }
  
  /**
   * Generate orchestration metrics report
   */
  static generateMetricsReport(components) {
    const {
      orchestrator,
      topologyManager,
      loadBalancer,
      failureRecovery
    } = components;
    
    const report = {
      timestamp: new Date(),
      swarmStatus: orchestrator?.getSwarmStatus() || {},
      topologyStatus: topologyManager?.getTopologyStatus() || {},
      loadBalancingStats: loadBalancer?.getLoadBalancingStats() || {},
      failureStats: failureRecovery?.getFailureStats() || {}
    };
    
    // Calculate aggregate metrics
    report.summary = {
      totalAgents: report.swarmStatus.agents?.total || 0,
      activeAgents: report.swarmStatus.agents?.byState?.idle + report.swarmStatus.agents?.byState?.busy || 0,
      totalTasks: report.swarmStatus.tasks?.total || 0,
      systemHealth: this.calculateSystemHealth(report),
      performance: this.calculatePerformanceScore(report)
    };
    
    return report;
  }
  
  /**
   * Calculate system health score (0-1)
   */
  static calculateSystemHealth(report) {
    let healthScore = 1.0;
    
    // Deduct for active failures
    const activeFailures = report.failureStats.active || 0;
    healthScore -= activeFailures * 0.1;
    
    // Deduct for poor utilization
    const utilization = report.loadBalancingStats.utilization || 0;
    if (utilization > 0.9) {
      healthScore -= 0.2; // Overloaded
    } else if (utilization < 0.3) {
      healthScore -= 0.1; // Underutilized
    }
    
    // Ensure valid range
    return Math.max(0, Math.min(1, healthScore));
  }
  
  /**
   * Calculate performance score (0-1)
   */
  static calculatePerformanceScore(report) {
    let performanceScore = 0.5; // Base score
    
    // Factor in task completion rate
    const tasks = report.swarmStatus.tasks || {};
    const completionRate = tasks.total > 0 ? 
      (tasks.byStatus?.completed || 0) / tasks.total : 1;
    performanceScore += completionRate * 0.3;
    
    // Factor in load balancing efficiency
    const efficiency = 1 - Math.abs(0.7 - (report.loadBalancingStats.utilization || 0.7));
    performanceScore += efficiency * 0.2;
    
    // Ensure valid range
    return Math.max(0, Math.min(1, performanceScore));
  }
  
  /**
   * Create orchestration configuration from environment
   */
  static configFromEnvironment() {
    return {
      swarmId: process.env.SWARM_ID || `swarm_${Date.now()}`,
      maxAgents: parseInt(process.env.MAX_AGENTS) || 12,
      topology: process.env.TOPOLOGY || SwarmTopology.HIERARCHICAL,
      enableFailover: process.env.ENABLE_FAILOVER !== 'false',
      enableLoadBalancing: process.env.ENABLE_LOAD_BALANCING !== 'false',
      coordinationPort: parseInt(process.env.COORDINATION_PORT) || 0,
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 5000,
      taskTimeout: parseInt(process.env.TASK_TIMEOUT) || 300000
    };
  }
}

/**
 * Orchestration Constants
 */
export const OrchestrationConstants = {
  DEFAULT_MAX_AGENTS: 12,
  DEFAULT_TOPOLOGY: SwarmTopology.HIERARCHICAL,
  DEFAULT_LOAD_BALANCING_STRATEGY: LoadBalancingStrategy.ADAPTIVE,
  DEFAULT_HEARTBEAT_INTERVAL: 5000,
  DEFAULT_TASK_TIMEOUT: 300000,
  DEFAULT_RECOVERY_TIMEOUT: 60000,
  
  HEALTH_CHECK_INTERVAL: 10000,
  METRICS_UPDATE_INTERVAL: 30000,
  PATTERN_ANALYSIS_INTERVAL: 60000,
  
  MIN_AGENTS: 1,
  MAX_AGENTS: 100,
  MAX_CONCURRENT_TASKS: 50,
  
  FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_TIMEOUT: 60000,
  CASCADE_DETECTION_WINDOW: 30000
};

/**
 * Default export - main orchestration factory
 */
export default OrchestrationFactory;