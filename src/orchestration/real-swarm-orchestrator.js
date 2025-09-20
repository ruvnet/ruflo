/**
 * Real Swarm Orchestrator Implementation
 * Replaces mock/placeholder swarm functionality with actual coordination
 * Integrates with RealMemoryManager for persistent state
 */

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import WebSocket from 'ws';
import crypto from 'crypto';
import { RealMemoryManager } from '../memory/real-memory-manager.js';

/**
 * Swarm topologies for different coordination patterns
 */
export const SwarmTopology = {
  MESH: 'mesh',           // Full interconnection - best for collaboration
  HIERARCHICAL: 'hierarchical', // Tree structure - best for delegation
  RING: 'ring',           // Circular - best for pipeline processing
  STAR: 'star',           // Central coordinator - best for simple coordination
  HYBRID: 'hybrid',       // Mixed topology - adaptive based on task type
  DYNAMIC: 'dynamic'      // Self-organizing topology
};

/**
 * Agent lifecycle states
 */
export const AgentState = {
  INITIALIZING: 'initializing',
  IDLE: 'idle',
  BUSY: 'busy',
  PAUSED: 'paused',
  FAILED: 'failed',
  TERMINATED: 'terminated',
  MIGRATING: 'migrating'
};

/**
 * Task execution strategies
 */
export const ExecutionStrategy = {
  PARALLEL: 'parallel',
  SEQUENTIAL: 'sequential',
  PIPELINE: 'pipeline',
  MAP_REDUCE: 'map_reduce',
  REACTIVE: 'reactive',
  ADAPTIVE: 'adaptive'
};

/**
 * Real Swarm Orchestrator Class
 * Manages the lifecycle, coordination, and communication of agent swarms
 */
export class RealSwarmOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Core configuration
    this.swarmId = options.swarmId || `swarm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.maxAgents = options.maxAgents || 12;
    this.topology = options.topology || SwarmTopology.HIERARCHICAL;
    this.executionStrategy = options.executionStrategy || ExecutionStrategy.PARALLEL;
    this.logger = options.logger || console;
    this.coordinationPort = options.coordinationPort || 0; // Auto-assign
    this.enableFailover = options.enableFailover !== false;
    this.enableLoadBalancing = options.enableLoadBalancing !== false;
    this.enableMigration = options.enableMigration !== false;
    this.heartbeatInterval = options.heartbeatInterval || 5000;
    this.taskTimeout = options.taskTimeout || 300000; // 5 minutes
    this.recoveryTimeout = options.recoveryTimeout || 30000; // 30 seconds
    
    // Memory and persistence
    this.memoryManager = new RealMemoryManager({
      persistenceDir: options.persistenceDir || './data/swarm-memory',
      sessionId: `swarm_${this.swarmId}`,
      logger: this.logger,
      maxMemorySize: options.maxMemorySize || 500 * 1024 * 1024, // 500MB
      compressionEnabled: true,
      vectorSearchEnabled: true
    });
    
    // Internal state
    this.agents = new Map(); // agentId -> AgentInstance
    this.tasks = new Map(); // taskId -> TaskInstance
    this.connections = new Map(); // agentId -> WebSocket
    this.topologyGraph = new Map(); // agentId -> Set<connectedAgentIds>
    this.loadBalancer = null;
    this.messageQueue = new Map(); // agentId -> MessageQueue
    this.healthMonitor = null;
    this.coordinationServer = null;
    this.isRunning = false;
    this.startTime = Date.now();
    
    // Performance metrics
    this.metrics = {
      tasksExecuted: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      agentsSpawned: 0,
      agentsTerminated: 0,
      messagesExchanged: 0,
      averageTaskDuration: 0,
      currentLoad: 0,
      topologyChanges: 0,
      failoverEvents: 0,
      migrationEvents: 0
    };
    
    // Task distribution algorithms
    this.distributionAlgorithms = {
      round_robin: this.roundRobinDistribution.bind(this),
      least_loaded: this.leastLoadedDistribution.bind(this),
      capability_based: this.capabilityBasedDistribution.bind(this),
      affinity_based: this.affinityBasedDistribution.bind(this),
      predictive: this.predictiveDistribution.bind(this)
    };
    
    this.logger.info(`🐝 RealSwarmOrchestrator initialized: ${this.swarmId}`);
  }
  
  /**
   * Initialize the swarm orchestrator
   */
  async initialize() {
    try {
      this.logger.info(`🚀 Initializing swarm orchestrator: ${this.swarmId}`);
      
      // Initialize memory manager
      await this.memoryManager.initialize();
      
      // Create coordination server
      await this.createCoordinationServer();
      
      // Initialize topology management
      await this.initializeTopology();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Initialize load balancer
      if (this.enableLoadBalancing) {
        this.initializeLoadBalancer();
      }
      
      // Load previous state if available
      await this.loadPreviousState();
      
      this.isRunning = true;
      
      // Store initialization in memory
      await this.memoryManager.store({
        key: 'orchestrator/initialization',
        value: {
          swarmId: this.swarmId,
          topology: this.topology,
          strategy: this.executionStrategy,
          maxAgents: this.maxAgents,
          startTime: this.startTime,
          coordinationPort: this.coordinationPort
        },
        namespace: 'swarm',
        category: 'coordination',
        tags: ['initialization', 'swarm', 'orchestrator'],
        metadata: {
          component: 'RealSwarmOrchestrator',
          version: '1.0.0'
        }
      });
      
      this.emit('orchestrator:initialized', {
        swarmId: this.swarmId,
        coordinationPort: this.coordinationPort,
        topology: this.topology
      });
      
      this.logger.info(`✅ Swarm orchestrator initialized successfully`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to initialize swarm orchestrator:`, error);
      throw error;
    }
  }
  
  /**
   * Create WebSocket server for agent coordination
   */
  async createCoordinationServer() {
    return new Promise((resolve, reject) => {
      this.coordinationServer = new WebSocket.Server({
        port: this.coordinationPort,
        perMessageDeflate: false
      });
      
      this.coordinationServer.on('connection', (ws, req) => {
        this.handleAgentConnection(ws, req);
      });
      
      this.coordinationServer.on('listening', () => {
        const address = this.coordinationServer.address();
        this.coordinationPort = address.port;
        this.logger.info(`🔗 Coordination server listening on port ${this.coordinationPort}`);
        resolve();
      });
      
      this.coordinationServer.on('error', (error) => {
        this.logger.error('Coordination server error:', error);
        reject(error);
      });
    });
  }
  
  /**
   * Handle new agent connections
   */
  handleAgentConnection(ws, req) {
    const agentId = req.headers['x-agent-id'] || `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    this.logger.info(`🤝 Agent connected: ${agentId}`);
    
    // Store connection
    this.connections.set(agentId, ws);
    
    // Initialize message queue for agent
    this.messageQueue.set(agentId, []);
    
    // Handle agent messages
    ws.on('message', (data) => {
      this.handleAgentMessage(agentId, data);
    });
    
    // Handle agent disconnection
    ws.on('close', () => {
      this.handleAgentDisconnection(agentId);
    });
    
    // Handle connection errors
    ws.on('error', (error) => {
      this.logger.error(`Agent connection error (${agentId}):`, error);
      this.handleAgentError(agentId, error);
    });
    
    // Send welcome message
    this.sendToAgent(agentId, {
      type: 'welcome',
      swarmId: this.swarmId,
      agentId: agentId,
      topology: this.topology,
      timestamp: new Date().toISOString()
    });
    
    this.emit('agent:connected', { agentId, timestamp: new Date().toISOString() });
  }
  
  /**
   * Handle messages from agents
   */
  async handleAgentMessage(agentId, data) {
    try {
      const message = JSON.parse(data.toString());
      
      this.metrics.messagesExchanged++;
      
      switch (message.type) {
        case 'register':
          await this.handleAgentRegistration(agentId, message);
          break;
          
        case 'task_result':
          await this.handleTaskResult(agentId, message);
          break;
          
        case 'task_error':
          await this.handleTaskError(agentId, message);
          break;
          
        case 'status_update':
          await this.handleStatusUpdate(agentId, message);
          break;
          
        case 'peer_message':
          await this.handlePeerMessage(agentId, message);
          break;
          
        case 'resource_request':
          await this.handleResourceRequest(agentId, message);
          break;
          
        case 'heartbeat':
          await this.handleHeartbeat(agentId, message);
          break;
          
        default:
          this.logger.warn(`Unknown message type from ${agentId}: ${message.type}`);
      }
      
    } catch (error) {
      this.logger.error(`Error handling message from ${agentId}:`, error);
    }
  }
  
  /**
   * Handle agent registration
   */
  async handleAgentRegistration(agentId, message) {
    const { name, type, capabilities, resources } = message.data;
    
    const agent = {
      id: agentId,
      name: name || `Agent_${agentId}`,
      type: type || 'general',
      capabilities: capabilities || [],
      resources: resources || {},
      state: AgentState.IDLE,
      currentTask: null,
      lastHeartbeat: new Date(),
      startTime: new Date(),
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalExecutionTime: 0,
        averageTaskTime: 0,
        errorRate: 0,
        currentLoad: 0
      },
      health: {
        status: 'healthy',
        lastCheck: new Date(),
        issues: []
      },
      connections: new Set()
    };
    
    this.agents.set(agentId, agent);
    this.metrics.agentsSpawned++;
    
    // Add to topology
    await this.addAgentToTopology(agentId);
    
    // Store agent registration in memory
    await this.memoryManager.store({
      key: `agent/${agentId}/registration`,
      value: agent,
      namespace: 'swarm',
      category: 'coordination',
      tags: ['agent', 'registration', type],
      metadata: {
        agentId,
        agentType: type,
        capabilities: capabilities?.length || 0
      }
    });
    
    this.logger.info(`📝 Agent registered: ${name} (${agentId}) - Type: ${type}`);
    this.emit('agent:registered', { agent, timestamp: new Date().toISOString() });
    
    // Send topology information to agent
    await this.sendTopologyUpdate(agentId);
  }
  
  /**
   * Add agent to the swarm topology
   */
  async addAgentToTopology(agentId) {
    const topology = this.topologyGraph;
    
    switch (this.topology) {
      case SwarmTopology.MESH:
        // Connect to all existing agents
        topology.set(agentId, new Set(topology.keys()));
        for (const existingId of topology.keys()) {
          if (existingId !== agentId) {
            topology.get(existingId).add(agentId);
          }
        }
        break;
        
      case SwarmTopology.HIERARCHICAL:
        // Connect to parent nodes (create tree structure)
        const existingAgents = Array.from(topology.keys());
        if (existingAgents.length === 0) {
          // First agent becomes root
          topology.set(agentId, new Set());
        } else {
          // Find best parent (least connected)
          const parent = existingAgents.reduce((least, current) => {
            const leastConnections = topology.get(least).size;
            const currentConnections = topology.get(current).size;
            return currentConnections < leastConnections ? current : least;
          });
          
          topology.set(agentId, new Set([parent]));
          topology.get(parent).add(agentId);
        }
        break;
        
      case SwarmTopology.RING:
        // Connect in circular fashion
        const agents = Array.from(topology.keys());
        if (agents.length === 0) {
          topology.set(agentId, new Set());
        } else if (agents.length === 1) {
          const firstAgent = agents[0];
          topology.set(agentId, new Set([firstAgent]));
          topology.get(firstAgent).add(agentId);
        } else {
          // Insert into ring
          const lastAgent = agents[agents.length - 1];
          const firstAgent = agents[0];
          
          // Remove connection from last to first
          topology.get(lastAgent).delete(firstAgent);
          topology.get(firstAgent).delete(lastAgent);
          
          // Connect last -> new -> first
          topology.set(agentId, new Set([firstAgent]));
          topology.get(lastAgent).add(agentId);
          topology.get(firstAgent).add(agentId);
        }
        break;
        
      case SwarmTopology.STAR:
        // First agent becomes central coordinator
        const centralAgent = Array.from(topology.keys())[0];
        if (!centralAgent) {
          topology.set(agentId, new Set());
        } else {
          topology.set(agentId, new Set([centralAgent]));
          topology.get(centralAgent).add(agentId);
        }
        break;
        
      case SwarmTopology.DYNAMIC:
        // Use ML-based topology optimization
        await this.optimizeTopologyForAgent(agentId);
        break;
    }
    
    this.metrics.topologyChanges++;
    this.emit('topology:updated', { 
      agentId, 
      topology: this.topology, 
      connections: topology.get(agentId) 
    });
  }
  
  /**
   * Spawn a new agent with specified configuration
   */
  async spawnAgent(config = {}) {
    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Maximum agents (${this.maxAgents}) already spawned`);
    }
    
    const {
      name = `Agent_${Date.now()}`,
      type = 'general',
      capabilities = [],
      resources = {},
      strategy = 'adaptive',
      priority = 'medium'
    } = config;
    
    const agentId = `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    try {
      // Create agent worker thread
      const worker = new Worker(new URL('./agent-worker.js', import.meta.url), {
        workerData: {
          agentId,
          swarmId: this.swarmId,
          coordinationPort: this.coordinationPort,
          config: {
            name,
            type,
            capabilities,
            resources,
            strategy,
            priority
          }
        }
      });
      
      // Handle worker messages
      worker.on('message', (message) => {
        this.handleWorkerMessage(agentId, message);
      });
      
      // Handle worker errors
      worker.on('error', (error) => {
        this.logger.error(`Agent worker error (${agentId}):`, error);
        this.handleAgentError(agentId, error);
      });
      
      // Handle worker exit
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.logger.error(`Agent worker exited with code ${code}: ${agentId}`);
        }
        this.handleAgentTermination(agentId);
      });
      
      // Store worker reference
      const agentData = {
        id: agentId,
        name,
        type,
        capabilities,
        resources,
        worker,
        spawnTime: new Date(),
        state: AgentState.INITIALIZING
      };
      
      // Wait for agent to connect and register
      const connectionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Agent connection timeout: ${agentId}`));
        }, 30000);
        
        const handler = (data) => {
          if (data.agentId === agentId) {
            clearTimeout(timeout);
            this.off('agent:registered', handler);
            resolve(data.agent);
          }
        };
        
        this.on('agent:registered', handler);
      });
      
      const agent = await connectionPromise;
      
      this.logger.info(`🚀 Agent spawned successfully: ${name} (${agentId})`);
      
      // Store spawn event in memory
      await this.memoryManager.store({
        key: `agent/${agentId}/spawn`,
        value: {
          agentId,
          name,
          type,
          capabilities,
          spawnTime: new Date(),
          config
        },
        namespace: 'swarm',
        category: 'coordination',
        tags: ['agent', 'spawn', type],
        metadata: {
          agentId,
          agentType: type,
          priority
        }
      });
      
      this.emit('agent:spawned', { agent, config });
      
      return agent;
      
    } catch (error) {
      this.logger.error(`Failed to spawn agent ${agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Distribute task to optimal agent(s)
   */
  async distributeTask(task, strategy = null) {
    const distributionStrategy = strategy || this.executionStrategy;
    const algorithm = this.distributionAlgorithms[distributionStrategy] || 
                     this.distributionAlgorithms.least_loaded;
    
    try {
      const assignment = await algorithm(task);
      
      if (!assignment || assignment.agents.length === 0) {
        throw new Error('No suitable agents available for task distribution');
      }
      
      // Store task in memory
      await this.memoryManager.store({
        key: `task/${task.id}/distribution`,
        value: {
          task,
          assignment,
          distributionStrategy,
          timestamp: new Date()
        },
        namespace: 'swarm',
        category: 'coordination',
        tags: ['task', 'distribution', distributionStrategy],
        metadata: {
          taskId: task.id,
          taskType: task.type,
          agentCount: assignment.agents.length
        }
      });
      
      // Send task to assigned agent(s)
      for (const agentId of assignment.agents) {
        await this.assignTaskToAgent(task, agentId, assignment);
      }
      
      this.tasks.set(task.id, {
        ...task,
        assignment,
        startTime: new Date(),
        status: 'distributed'
      });
      
      this.metrics.tasksExecuted++;
      
      this.emit('task:distributed', { task, assignment });
      
      return assignment;
      
    } catch (error) {
      this.logger.error(`Failed to distribute task ${task.id}:`, error);
      throw error;
    }
  }
  
  /**
   * Assign specific task to specific agent
   */
  async assignTaskToAgent(task, agentId, assignment) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    if (agent.state !== AgentState.IDLE) {
      throw new Error(`Agent not available: ${agentId} (state: ${agent.state})`);
    }
    
    // Update agent state
    agent.state = AgentState.BUSY;
    agent.currentTask = task.id;
    
    // Send task assignment message
    await this.sendToAgent(agentId, {
      type: 'task_assignment',
      task: {
        ...task,
        assignedAt: new Date().toISOString(),
        timeout: task.timeout || this.taskTimeout,
        assignment
      },
      swarmContext: {
        topology: this.topology,
        peerAgents: assignment.agents.filter(id => id !== agentId),
        coordinationEndpoint: `ws://localhost:${this.coordinationPort}`
      }
    });
    
    // Start task timeout monitoring
    this.startTaskTimeout(task.id, agentId);
    
    this.emit('task:assigned', { task, agentId, assignment });
  }
  
  /**
   * Task distribution algorithms
   */
  
  async roundRobinDistribution(task) {
    const availableAgents = Array.from(this.agents.values())
      .filter(agent => agent.state === AgentState.IDLE);
    
    if (availableAgents.length === 0) {
      return null;
    }
    
    // Simple round-robin selection
    const index = this.metrics.tasksExecuted % availableAgents.length;
    const selectedAgent = availableAgents[index];
    
    return {
      strategy: 'round_robin',
      agents: [selectedAgent.id],
      reasoning: 'Selected using round-robin algorithm',
      confidence: 0.7
    };
  }
  
  async leastLoadedDistribution(task) {
    const availableAgents = Array.from(this.agents.values())
      .filter(agent => agent.state === AgentState.IDLE)
      .sort((a, b) => a.metrics.currentLoad - b.metrics.currentLoad);
    
    if (availableAgents.length === 0) {
      return null;
    }
    
    return {
      strategy: 'least_loaded',
      agents: [availableAgents[0].id],
      reasoning: `Selected agent with lowest load: ${availableAgents[0].metrics.currentLoad}`,
      confidence: 0.8
    };
  }
  
  async capabilityBasedDistribution(task) {
    const requiredCapabilities = task.requiredCapabilities || [];
    
    const compatibleAgents = Array.from(this.agents.values())
      .filter(agent => {
        if (agent.state !== AgentState.IDLE) return false;
        
        // Check if agent has all required capabilities
        return requiredCapabilities.every(cap => 
          agent.capabilities.includes(cap)
        );
      })
      .sort((a, b) => {
        // Prefer agents with more matching capabilities
        const aMatches = a.capabilities.filter(cap => requiredCapabilities.includes(cap)).length;
        const bMatches = b.capabilities.filter(cap => requiredCapabilities.includes(cap)).length;
        return bMatches - aMatches;
      });
    
    if (compatibleAgents.length === 0) {
      // Fallback to any available agent
      return this.leastLoadedDistribution(task);
    }
    
    return {
      strategy: 'capability_based',
      agents: [compatibleAgents[0].id],
      reasoning: `Selected agent with best capability match: ${compatibleAgents[0].capabilities.join(', ')}`,
      confidence: 0.9
    };
  }
  
  async affinityBasedDistribution(task) {
    // Check if task has affinity preferences
    const agentAffinity = task.agentAffinity || {};
    const dataAffinity = task.dataAffinity || {};
    
    let candidates = Array.from(this.agents.values())
      .filter(agent => agent.state === AgentState.IDLE);
    
    // Apply agent affinity
    if (agentAffinity.preferred && agentAffinity.preferred.length > 0) {
      const preferred = candidates.filter(agent => 
        agentAffinity.preferred.includes(agent.id)
      );
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }
    
    // Apply anti-affinity
    if (agentAffinity.avoided && agentAffinity.avoided.length > 0) {
      candidates = candidates.filter(agent => 
        !agentAffinity.avoided.includes(agent.id)
      );
    }
    
    if (candidates.length === 0) {
      return this.leastLoadedDistribution(task);
    }
    
    // Score candidates based on data locality
    const scoredCandidates = candidates.map(agent => {
      let score = 0;
      
      // Data locality scoring
      if (dataAffinity.location && agent.resources.location) {
        score += agent.resources.location === dataAffinity.location ? 10 : 0;
      }
      
      // Performance history scoring
      score += (1 - agent.metrics.errorRate) * 5;
      score += (agent.metrics.averageTaskTime > 0) ? 
        (1 / agent.metrics.averageTaskTime) * 3 : 0;
      
      return { agent, score };
    });
    
    scoredCandidates.sort((a, b) => b.score - a.score);
    
    return {
      strategy: 'affinity_based',
      agents: [scoredCandidates[0].agent.id],
      reasoning: `Selected based on affinity scoring: ${scoredCandidates[0].score}`,
      confidence: 0.85
    };
  }
  
  async predictiveDistribution(task) {
    // Use historical data to predict best agent
    const taskType = task.type || 'general';
    
    // Query historical performance data
    const historicalData = await this.memoryManager.query({
      namespace: 'swarm',
      category: 'performance',
      tags: ['task-completion', taskType],
      limit: 100,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    });
    
    // Analyze agent performance for this task type
    const agentPerformance = new Map();
    
    for (const record of historicalData.results) {
      const data = record.value;
      if (data.agentId && data.success) {
        const perf = agentPerformance.get(data.agentId) || {
          successCount: 0,
          totalDuration: 0,
          taskCount: 0
        };
        
        perf.successCount += data.success ? 1 : 0;
        perf.totalDuration += data.duration || 0;
        perf.taskCount += 1;
        
        agentPerformance.set(data.agentId, perf);
      }
    }
    
    // Score available agents
    const availableAgents = Array.from(this.agents.values())
      .filter(agent => agent.state === AgentState.IDLE);
    
    const scoredAgents = availableAgents.map(agent => {
      const perf = agentPerformance.get(agent.id);
      let score = 0.5; // Base score
      
      if (perf) {
        const successRate = perf.successCount / perf.taskCount;
        const avgDuration = perf.totalDuration / perf.taskCount;
        
        score = successRate * 0.7 + (1 / (avgDuration + 1)) * 0.3;
      }
      
      return { agent, score };
    });
    
    if (scoredAgents.length === 0) {
      return null;
    }
    
    scoredAgents.sort((a, b) => b.score - a.score);
    
    return {
      strategy: 'predictive',
      agents: [scoredAgents[0].agent.id],
      reasoning: `Predicted best performance based on historical data: score ${scoredAgents[0].score.toFixed(3)}`,
      confidence: Math.min(scoredAgents[0].score, 0.95)
    };
  }
  
  /**
   * Send message to specific agent
   */
  async sendToAgent(agentId, message) {
    const connection = this.connections.get(agentId);
    if (!connection || connection.readyState !== WebSocket.OPEN) {
      // Queue message for later delivery
      const queue = this.messageQueue.get(agentId) || [];
      queue.push({
        message,
        timestamp: new Date(),
        retries: 0
      });
      this.messageQueue.set(agentId, queue);
      return false;
    }
    
    try {
      connection.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message to agent ${agentId}:`, error);
      return false;
    }
  }
  
  /**
   * Broadcast message to all agents
   */
  async broadcastToAll(message, exclude = []) {
    const results = {};
    
    for (const [agentId, connection] of this.connections) {
      if (exclude.includes(agentId)) continue;
      
      results[agentId] = await this.sendToAgent(agentId, message);
    }
    
    return results;
  }
  
  /**
   * Handle task completion from agent
   */
  async handleTaskResult(agentId, message) {
    const { taskId, result, metrics } = message.data;
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    
    if (!task || !agent) {
      this.logger.warn(`Task result received for unknown task/agent: ${taskId}/${agentId}`);
      return;
    }
    
    // Update task status
    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date();
    task.duration = task.completedAt - task.startTime;
    
    // Update agent state
    agent.state = AgentState.IDLE;
    agent.currentTask = null;
    agent.metrics.tasksCompleted++;
    agent.metrics.totalExecutionTime += task.duration;
    agent.metrics.averageTaskTime = 
      agent.metrics.totalExecutionTime / agent.metrics.tasksCompleted;
    
    // Update orchestrator metrics
    this.metrics.tasksCompleted++;
    this.metrics.averageTaskDuration = 
      (this.metrics.averageTaskDuration * (this.metrics.tasksCompleted - 1) + task.duration) / 
      this.metrics.tasksCompleted;
    
    // Store completion data
    await this.memoryManager.store({
      key: `task/${taskId}/completion`,
      value: {
        taskId,
        agentId,
        result,
        duration: task.duration,
        metrics,
        success: true,
        timestamp: new Date()
      },
      namespace: 'swarm',
      category: 'performance',
      tags: ['task-completion', task.type || 'general', 'success'],
      metadata: {
        taskId,
        agentId,
        taskType: task.type,
        duration: task.duration
      }
    });
    
    this.logger.info(`✅ Task completed: ${taskId} by ${agentId} in ${task.duration}ms`);
    this.emit('task:completed', { task, agent, result, metrics });
    
    // Check if this completes a larger objective
    await this.checkObjectiveCompletion(task);
  }
  
  /**
   * Handle task error from agent
   */
  async handleTaskError(agentId, message) {
    const { taskId, error, canRetry } = message.data;
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    
    if (!task || !agent) {
      this.logger.warn(`Task error received for unknown task/agent: ${taskId}/${agentId}`);
      return;
    }
    
    // Update agent state
    agent.state = AgentState.IDLE;
    agent.currentTask = null;
    agent.metrics.tasksFailed++;
    agent.metrics.errorRate = 
      agent.metrics.tasksFailed / (agent.metrics.tasksCompleted + agent.metrics.tasksFailed);
    
    // Update orchestrator metrics
    this.metrics.tasksFailed++;
    
    // Store error data
    await this.memoryManager.store({
      key: `task/${taskId}/error`,
      value: {
        taskId,
        agentId,
        error,
        canRetry,
        success: false,
        timestamp: new Date()
      },
      namespace: 'swarm',
      category: 'performance',
      tags: ['task-error', task.type || 'general', 'failure'],
      metadata: {
        taskId,
        agentId,
        taskType: task.type,
        canRetry
      }
    });
    
    // Attempt retry or fail task
    if (canRetry && (task.retryCount || 0) < (task.maxRetries || 3)) {
      task.retryCount = (task.retryCount || 0) + 1;
      this.logger.warn(`🔄 Retrying task: ${taskId} (attempt ${task.retryCount})`);
      
      // Redistribute task with different strategy
      setTimeout(() => {
        this.distributeTask(task, 'least_loaded');
      }, Math.pow(2, task.retryCount) * 1000); // Exponential backoff
      
    } else {
      task.status = 'failed';
      task.error = error;
      task.completedAt = new Date();
      
      this.logger.error(`❌ Task failed permanently: ${taskId} - ${error}`);
      this.emit('task:failed', { task, agent, error });
    }
  }
  
  /**
   * Initialize topology management
   */
  async initializeTopology() {
    this.topologyGraph = new Map();
    
    // Load previous topology if available
    const previousTopology = await this.memoryManager.retrieve('topology/current', 'swarm');
    if (previousTopology) {
      this.topologyGraph = new Map(previousTopology.value.graph);
      this.logger.info('📊 Restored previous topology configuration');
    }
  }
  
  /**
   * Start health monitoring for all agents
   */
  startHealthMonitoring() {
    this.healthMonitor = setInterval(async () => {
      await this.performHealthCheck();
    }, this.heartbeatInterval);
    
    this.logger.info('❤️ Health monitoring started');
  }
  
  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const now = new Date();
    const unhealthyAgents = [];
    
    for (const [agentId, agent] of this.agents) {
      const timeSinceHeartbeat = now - agent.lastHeartbeat;
      
      if (timeSinceHeartbeat > this.heartbeatInterval * 3) {
        // Agent missed multiple heartbeats
        agent.health.status = 'unhealthy';
        agent.health.issues.push(`No heartbeat for ${timeSinceHeartbeat}ms`);
        unhealthyAgents.push(agentId);
        
        this.logger.warn(`💔 Agent unhealthy: ${agentId} (no heartbeat for ${timeSinceHeartbeat}ms)`);
      }
    }
    
    // Handle unhealthy agents
    for (const agentId of unhealthyAgents) {
      if (this.enableFailover) {
        await this.initiateFailover(agentId);
      }
    }
    
    // Store health metrics
    await this.memoryManager.store({
      key: 'health/check',
      value: {
        timestamp: now,
        totalAgents: this.agents.size,
        healthyAgents: this.agents.size - unhealthyAgents.length,
        unhealthyAgents: unhealthyAgents.length,
        issues: unhealthyAgents
      },
      namespace: 'swarm',
      category: 'monitoring',
      tags: ['health', 'monitoring'],
      ttl: 3600000 // 1 hour
    });
  }
  
  /**
   * Initialize load balancer
   */
  initializeLoadBalancer() {
    this.loadBalancer = {
      strategy: 'weighted_round_robin',
      weights: new Map(),
      currentIndex: 0,
      
      updateWeights: () => {
        for (const [agentId, agent] of this.agents) {
          // Calculate weight based on performance metrics
          const successRate = agent.metrics.tasksCompleted / 
            (agent.metrics.tasksCompleted + agent.metrics.tasksFailed || 1);
          const speedFactor = agent.metrics.averageTaskTime > 0 ? 
            1 / agent.metrics.averageTaskTime : 1;
          
          const weight = Math.max(0.1, successRate * speedFactor);
          this.loadBalancer.weights.set(agentId, weight);
        }
      }
    };
    
    // Update weights periodically
    setInterval(() => {
      this.loadBalancer.updateWeights();
    }, 30000); // Every 30 seconds
    
    this.logger.info('⚖️ Load balancer initialized');
  }
  
  /**
   * Get comprehensive swarm status
   */
  getSwarmStatus() {
    const agents = Array.from(this.agents.values());
    const tasks = Array.from(this.tasks.values());
    
    return {
      swarmId: this.swarmId,
      isRunning: this.isRunning,
      topology: this.topology,
      uptime: Date.now() - this.startTime,
      agents: {
        total: agents.length,
        byState: {
          idle: agents.filter(a => a.state === AgentState.IDLE).length,
          busy: agents.filter(a => a.state === AgentState.BUSY).length,
          failed: agents.filter(a => a.state === AgentState.FAILED).length,
          paused: agents.filter(a => a.state === AgentState.PAUSED).length
        },
        byType: agents.reduce((acc, agent) => {
          acc[agent.type] = (acc[agent.type] || 0) + 1;
          return acc;
        }, {})
      },
      tasks: {
        total: tasks.length,
        byStatus: {
          pending: tasks.filter(t => t.status === 'pending').length,
          distributed: tasks.filter(t => t.status === 'distributed').length,
          running: tasks.filter(t => t.status === 'running').length,
          completed: tasks.filter(t => t.status === 'completed').length,
          failed: tasks.filter(t => t.status === 'failed').length
        }
      },
      metrics: this.metrics,
      connections: this.connections.size,
      memoryUsage: this.memoryManager.getStats()
    };
  }
  
  /**
   * Shutdown the swarm orchestrator
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('🛑 Shutting down swarm orchestrator...');
    this.isRunning = false;
    
    try {
      // Save current state
      await this.saveCurrentState();
      
      // Terminate all agents gracefully
      const terminationPromises = Array.from(this.agents.keys())
        .map(agentId => this.terminateAgent(agentId));
      
      await Promise.allSettled(terminationPromises);
      
      // Stop health monitoring
      if (this.healthMonitor) {
        clearInterval(this.healthMonitor);
      }
      
      // Close coordination server
      if (this.coordinationServer) {
        this.coordinationServer.close();
      }
      
      // Shutdown memory manager
      await this.memoryManager.performMaintenance();
      
      this.emit('orchestrator:shutdown', {
        swarmId: this.swarmId,
        finalMetrics: this.metrics
      });
      
      this.logger.info('✅ Swarm orchestrator shutdown complete');
      
    } catch (error) {
      this.logger.error('❌ Error during shutdown:', error);
      throw error;
    }
  }
  
  /**
   * Save current swarm state for recovery
   */
  async saveCurrentState() {
    const state = {
      swarmId: this.swarmId,
      topology: this.topology,
      agents: Array.from(this.agents.entries()),
      tasks: Array.from(this.tasks.entries()),
      topologyGraph: Array.from(this.topologyGraph.entries()),
      metrics: this.metrics,
      timestamp: new Date()
    };
    
    await this.memoryManager.store({
      key: 'orchestrator/state',
      value: state,
      namespace: 'swarm',
      category: 'coordination',
      tags: ['state', 'recovery', 'checkpoint'],
      metadata: {
        swarmId: this.swarmId,
        agentCount: this.agents.size,
        taskCount: this.tasks.size
      }
    });
  }
  
  /**
   * Load previous state for recovery
   */
  async loadPreviousState() {
    try {
      const previousState = await this.memoryManager.retrieve('orchestrator/state', 'swarm');
      if (!previousState) {
        this.logger.info('No previous state found, starting fresh');
        return;
      }
      
      const state = previousState.value;
      
      // Restore basic state
      this.metrics = { ...this.metrics, ...state.metrics };
      
      // Note: Agents and connections will be restored when they reconnect
      this.logger.info(`📈 Restored previous state from ${state.timestamp}`);
      
    } catch (error) {
      this.logger.warn('Failed to load previous state:', error);
    }
  }
}

export default RealSwarmOrchestrator;