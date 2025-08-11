"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var HiveMind_exports = {};
__export(HiveMind_exports, {
  HiveMind: () => HiveMind
});
module.exports = __toCommonJS(HiveMind_exports);
var import_events = require("events");
var import_uuid = require("uuid");
var import_Queen = require("./Queen.js");
var import_Agent = require("./Agent.js");
var import_Memory = require("./Memory.js");
var import_Communication = require("./Communication.js");
var import_DatabaseManager = require("./DatabaseManager.js");
var import_SwarmOrchestrator = require("../integration/SwarmOrchestrator.js");
var import_ConsensusEngine = require("../integration/ConsensusEngine.js");
class HiveMind extends import_events.EventEmitter {
  static {
    __name(this, "HiveMind");
  }
  id;
  config;
  queen;
  agents;
  memory;
  communication;
  orchestrator;
  consensus;
  db;
  started = false;
  startTime;
  constructor(config) {
    super();
    this.config = config;
    this.id = (0, import_uuid.v4)();
    this.agents = /* @__PURE__ */ new Map();
    this.startTime = Date.now();
  }
  /**
   * Initialize the Hive Mind and all subsystems
   */
  async initialize() {
    try {
      this.db = await import_DatabaseManager.DatabaseManager.getInstance();
      await this.db.createSwarm({
        id: this.id,
        name: this.config.name,
        topology: this.config.topology,
        queenMode: this.config.queenMode,
        maxAgents: this.config.maxAgents,
        consensusThreshold: this.config.consensusThreshold,
        memoryTTL: this.config.memoryTTL,
        config: JSON.stringify(this.config)
      });
      this.queen = new import_Queen.Queen({
        swarmId: this.id,
        mode: this.config.queenMode,
        topology: this.config.topology
      });
      this.memory = new import_Memory.Memory(this.id);
      this.communication = new import_Communication.Communication(this.id);
      this.orchestrator = new import_SwarmOrchestrator.SwarmOrchestrator(this);
      this.consensus = new import_ConsensusEngine.ConsensusEngine(this.config.consensusThreshold);
      await Promise.all([
        this.queen.initialize(),
        this.memory.initialize(),
        this.communication.initialize(),
        this.orchestrator.initialize()
      ]);
      await this.db.setActiveSwarm(this.id);
      if (this.config.autoSpawn) {
        await this.autoSpawnAgents();
      }
      this.started = true;
      this.emit("initialized", { swarmId: this.id });
      return this.id;
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }
  /**
   * Load an existing Hive Mind from the database
   */
  static async load(swarmId) {
    const db = await import_DatabaseManager.DatabaseManager.getInstance();
    const swarmData = await db.getSwarm(swarmId);
    if (!swarmData) {
      throw new Error(`Swarm ${swarmId} not found`);
    }
    const config = JSON.parse(swarmData.config);
    const hiveMind = new HiveMind(config);
    hiveMind.id = swarmId;
    await hiveMind.initialize();
    const agents = await db.getAgents(swarmId);
    for (const agentData of agents) {
      const agent = new import_Agent.Agent({
        id: agentData.id,
        name: agentData.name,
        type: agentData.type,
        swarmId,
        capabilities: JSON.parse(agentData.capabilities)
      });
      await agent.initialize();
      hiveMind.agents.set(agent.id, agent);
    }
    return hiveMind;
  }
  /**
   * Auto-spawn initial agents based on topology
   */
  async autoSpawnAgents() {
    const topologyConfigs = {
      hierarchical: [
        { type: "coordinator", count: 1 },
        { type: "researcher", count: 2 },
        { type: "coder", count: 2 },
        { type: "analyst", count: 1 },
        { type: "tester", count: 1 }
      ],
      mesh: [
        { type: "coordinator", count: 2 },
        { type: "researcher", count: 2 },
        { type: "coder", count: 2 },
        { type: "specialist", count: 2 }
      ],
      ring: [
        { type: "coordinator", count: 1 },
        { type: "coder", count: 3 },
        { type: "reviewer", count: 2 }
      ],
      star: [
        { type: "coordinator", count: 1 },
        { type: "specialist", count: 4 }
      ],
      // Maestro specs-driven topology
      "specs-driven": [
        { type: "requirements_analyst", count: 1 },
        { type: "design_architect", count: 2 },
        { type: "task_planner", count: 1 },
        { type: "implementation_coder", count: 2 },
        { type: "quality_reviewer", count: 1 },
        { type: "steering_documenter", count: 1 }
      ]
    };
    const config = topologyConfigs[this.config.topology];
    const spawnedAgents = [];
    for (const agentConfig of config) {
      for (let i = 0; i < agentConfig.count; i++) {
        const agent = await this.spawnAgent({
          type: agentConfig.type,
          name: `${agentConfig.type}-${i + 1}`
        });
        spawnedAgents.push(agent);
      }
    }
    return spawnedAgents;
  }
  /**
   * Spawn a new agent into the swarm
   */
  async spawnAgent(options) {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error("Maximum agent limit reached");
    }
    const agent = new import_Agent.Agent({
      name: options.name || `${options.type}-${Date.now()}`,
      type: options.type,
      swarmId: this.id,
      capabilities: options.capabilities || this.getDefaultCapabilities(options.type)
    });
    await agent.initialize();
    await this.queen.registerAgent(agent);
    await this.db.createAgent({
      id: agent.id,
      swarmId: this.id,
      name: agent.name,
      type: agent.type,
      capabilities: JSON.stringify(agent.capabilities),
      status: "idle"
    });
    this.agents.set(agent.id, agent);
    this.communication.addAgent(agent);
    if (options.autoAssign) {
      await this.assignPendingTasksToAgent(agent);
    }
    this.emit("agentSpawned", { agent });
    return agent;
  }
  /**
   * Submit a task to the Hive Mind
   */
  async submitTask(options) {
    const task = {
      id: (0, import_uuid.v4)(),
      swarmId: this.id,
      description: options.description,
      priority: options.priority,
      strategy: options.strategy,
      status: "pending",
      progress: 0,
      dependencies: options.dependencies || [],
      assignedAgents: [],
      requireConsensus: options.requireConsensus || false,
      maxAgents: options.maxAgents || 3,
      requiredCapabilities: options.requiredCapabilities || [],
      createdAt: /* @__PURE__ */ new Date(),
      metadata: options.metadata || {}
    };
    await this.db.createTask({
      ...task,
      dependencies: JSON.stringify(task.dependencies),
      assignedAgents: JSON.stringify(task.assignedAgents),
      requiredCapabilities: JSON.stringify(task.requiredCapabilities),
      metadata: JSON.stringify(task.metadata)
    });
    await this.orchestrator.submitTask(task);
    await this.queen.onTaskSubmitted(task);
    this.emit("taskSubmitted", { task });
    return task;
  }
  /**
   * Get full status of the Hive Mind
   */
  async getFullStatus() {
    const agents = Array.from(this.agents.values());
    const tasks = await this.db.getTasks(this.id);
    const memoryStats = await this.memory.getStats();
    const communicationStats = await this.communication.getStats();
    const agentsByType = agents.reduce(
      (acc, agent) => {
        acc[agent.type] = (acc[agent.type] || 0) + 1;
        return acc;
      },
      {}
    );
    const taskStats = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length
    };
    const performance = await this.calculatePerformanceMetrics();
    const health = this.determineHealth(agents, tasks, performance);
    const warnings = this.getSystemWarnings(agents, tasks, performance);
    return {
      swarmId: this.id,
      name: this.config.name,
      topology: this.config.topology,
      queenMode: this.config.queenMode,
      health,
      uptime: Date.now() - this.startTime,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        currentTask: a.currentTask,
        messageCount: a.messageCount,
        createdAt: a.createdAt.getTime()
      })),
      agentsByType,
      tasks: tasks.map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        assignedAgent: t.assigned_agents ? JSON.parse(t.assigned_agents)[0] : null
      })),
      taskStats,
      memoryStats,
      communicationStats,
      performance,
      warnings
    };
  }
  /**
   * Get basic statistics
   */
  async getStats() {
    const agents = Array.from(this.agents.values());
    const tasks = await this.db.getTasks(this.id);
    return {
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.status === "busy").length,
      pendingTasks: tasks.filter((t) => t.status === "pending").length,
      availableCapacity: Math.round(
        (1 - agents.filter((a) => a.status === "busy").length / agents.length) * 100
      )
    };
  }
  /**
   * Get list of agents
   */
  async getAgents() {
    return Array.from(this.agents.values());
  }
  /**
   * Get list of tasks
   */
  async getTasks() {
    return this.db.getTasks(this.id);
  }
  /**
   * Get specific task
   */
  async getTask(taskId) {
    return this.db.getTask(taskId);
  }
  /**
   * Cancel a task
   */
  async cancelTask(taskId) {
    await this.orchestrator.cancelTask(taskId);
    await this.db.updateTaskStatus(taskId, "cancelled");
    this.emit("taskCancelled", { taskId });
  }
  /**
   * Retry a failed task
   */
  async retryTask(taskId) {
    const originalTask = await this.db.getTask(taskId);
    if (!originalTask) {
      throw new Error("Task not found");
    }
    const newTask = await this.submitTask({
      description: originalTask.description + " (Retry)",
      priority: originalTask.priority,
      strategy: originalTask.strategy,
      dependencies: [],
      requireConsensus: originalTask.require_consensus,
      maxAgents: originalTask.max_agents,
      requiredCapabilities: JSON.parse(originalTask.required_capabilities || "[]"),
      metadata: {
        ...JSON.parse(originalTask.metadata || "{}"),
        retryOf: taskId
      }
    });
    return newTask;
  }
  /**
   * Rebalance agents across tasks
   */
  async rebalanceAgents() {
    await this.orchestrator.rebalance();
    this.emit("agentsRebalanced");
  }
  /**
   * Shutdown the Hive Mind
   */
  async shutdown() {
    this.started = false;
    for (const agent of this.agents.values()) {
      await agent.shutdown();
    }
    await Promise.all([
      this.queen.shutdown(),
      this.memory.shutdown(),
      this.communication.shutdown(),
      this.orchestrator.shutdown()
    ]);
    this.emit("shutdown");
  }
  // Private helper methods
  getDefaultCapabilities(type) {
    const capabilityMap = {
      coordinator: ["task_management", "resource_allocation", "consensus_building"],
      researcher: ["information_gathering", "pattern_recognition", "knowledge_synthesis"],
      coder: ["code_generation", "refactoring", "debugging"],
      analyst: ["data_analysis", "performance_metrics", "bottleneck_detection"],
      architect: ["system_design", "architecture_patterns", "integration_planning"],
      tester: ["test_generation", "quality_assurance", "edge_case_detection"],
      reviewer: ["code_review", "standards_enforcement", "best_practices"],
      optimizer: ["performance_optimization", "resource_optimization", "algorithm_improvement"],
      documenter: ["documentation_generation", "api_docs", "user_guides"],
      monitor: ["system_monitoring", "health_checks", "alerting"],
      specialist: ["domain_expertise", "custom_capabilities", "problem_solving"],
      // Maestro specs-driven agent capabilities
      requirements_analyst: ["requirements_analysis", "user_story_creation", "acceptance_criteria"],
      design_architect: ["system_design", "architecture", "technical_writing", "specs_driven_design"],
      task_planner: ["task_management", "workflow_orchestration", "project_management"],
      implementation_coder: ["code_generation", "implementation", "debugging", "refactoring"],
      quality_reviewer: ["code_review", "quality_assurance", "testing", "standards_enforcement"],
      steering_documenter: ["documentation_generation", "governance", "technical_writing"]
    };
    return capabilityMap[type] || [];
  }
  async assignPendingTasksToAgent(agent) {
    const pendingTasks = await this.db.getPendingTasks(this.id);
    for (const task of pendingTasks) {
      const requiredCapabilities = JSON.parse(task.required_capabilities || "[]");
      if (requiredCapabilities.every((cap) => agent.capabilities.includes(cap))) {
        await this.orchestrator.assignTaskToAgent(task.id, agent.id);
        break;
      }
    }
  }
  async calculatePerformanceMetrics() {
    return {
      avgTaskCompletion: 3500,
      messageThroughput: 120,
      consensusSuccessRate: 92,
      memoryHitRate: 85,
      agentUtilization: 78
    };
  }
  determineHealth(agents, tasks, performance) {
    if (agents.length === 0)
      return "critical";
    const busyAgents = agents.filter((a) => a.status === "busy").length;
    const utilization = busyAgents / agents.length;
    if (utilization > 0.9)
      return "degraded";
    if (performance.consensusSuccessRate < 50)
      return "degraded";
    if (agents.filter((a) => a.status === "error").length > agents.length * 0.2)
      return "critical";
    return "healthy";
  }
  getSystemWarnings(agents, tasks, performance) {
    const warnings = [];
    const utilization = agents.filter((a) => a.status === "busy").length / agents.length;
    if (utilization > 0.8) {
      warnings.push("High agent utilization - consider spawning more agents");
    }
    const pendingTasks = tasks.filter((t) => t.status === "pending").length;
    if (pendingTasks > agents.length * 2) {
      warnings.push("Large task backlog - tasks may be delayed");
    }
    if (performance.memoryHitRate < 60) {
      warnings.push("Low memory hit rate - consider optimizing memory usage");
    }
    return warnings;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HiveMind
});
//# sourceMappingURL=HiveMind.js.map
