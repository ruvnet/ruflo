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
var advanced_scheduler_exports = {};
__export(advanced_scheduler_exports, {
  AdvancedTaskScheduler: () => AdvancedTaskScheduler,
  AffinitySchedulingStrategy: () => AffinitySchedulingStrategy,
  CapabilitySchedulingStrategy: () => CapabilitySchedulingStrategy,
  LeastLoadedSchedulingStrategy: () => LeastLoadedSchedulingStrategy,
  RoundRobinSchedulingStrategy: () => RoundRobinSchedulingStrategy
});
module.exports = __toCommonJS(advanced_scheduler_exports);
var import_types = require("../utils/types.js");
var import_scheduler = require("./scheduler.js");
var import_work_stealing = require("./work-stealing.js");
var import_dependency_graph = require("./dependency-graph.js");
var import_circuit_breaker = require("./circuit-breaker.js");
class CapabilitySchedulingStrategy {
  static {
    __name(this, "CapabilitySchedulingStrategy");
  }
  name = "capability";
  selectAgent(task, agents, context) {
    const capableAgents = agents.filter((agent) => {
      const capabilities = context.agentCapabilities.get(agent.id) || agent.capabilities;
      return task.type === "any" || capabilities.includes(task.type) || capabilities.includes("*");
    });
    if (capableAgents.length === 0) {
      return null;
    }
    capableAgents.sort((a, b) => {
      const loadA = context.taskLoads.get(a.id) || 0;
      const loadB = context.taskLoads.get(b.id) || 0;
      if (loadA !== loadB) {
        return loadA - loadB;
      }
      const priorityA = context.agentPriorities.get(a.id) || a.priority;
      const priorityB = context.agentPriorities.get(b.id) || b.priority;
      return priorityB - priorityA;
    });
    return capableAgents[0].id;
  }
}
class RoundRobinSchedulingStrategy {
  static {
    __name(this, "RoundRobinSchedulingStrategy");
  }
  name = "round-robin";
  lastIndex = 0;
  selectAgent(task, agents, context) {
    if (agents.length === 0) {
      return null;
    }
    this.lastIndex = (this.lastIndex + 1) % agents.length;
    return agents[this.lastIndex].id;
  }
}
class LeastLoadedSchedulingStrategy {
  static {
    __name(this, "LeastLoadedSchedulingStrategy");
  }
  name = "least-loaded";
  selectAgent(task, agents, context) {
    if (agents.length === 0) {
      return null;
    }
    let minLoad = Infinity;
    let selectedAgent = null;
    for (const agent of agents) {
      const load = context.taskLoads.get(agent.id) || 0;
      if (load < minLoad) {
        minLoad = load;
        selectedAgent = agent.id;
      }
    }
    return selectedAgent;
  }
}
class AffinitySchedulingStrategy {
  static {
    __name(this, "AffinitySchedulingStrategy");
  }
  name = "affinity";
  selectAgent(task, agents, context) {
    const taskStats = context.taskHistory.get(task.type);
    if (taskStats?.lastAgent) {
      const lastAgent = agents.find((a) => a.id === taskStats.lastAgent);
      if (lastAgent) {
        const load = context.taskLoads.get(lastAgent.id) || 0;
        if (load < lastAgent.maxConcurrentTasks * 0.8) {
          return lastAgent.id;
        }
      }
    }
    return new CapabilitySchedulingStrategy().selectAgent(task, agents, context);
  }
}
class AdvancedTaskScheduler extends import_scheduler.TaskScheduler {
  static {
    __name(this, "AdvancedTaskScheduler");
  }
  strategies = /* @__PURE__ */ new Map();
  activeAgents = /* @__PURE__ */ new Map();
  taskStats = /* @__PURE__ */ new Map();
  workStealing;
  dependencyGraph;
  circuitBreakers;
  defaultStrategy = "capability";
  constructor(config, eventBus, logger) {
    super(config, eventBus, logger);
    this.workStealing = new import_work_stealing.WorkStealingCoordinator(
      {
        enabled: true,
        stealThreshold: 3,
        maxStealBatch: 2,
        stealInterval: 5e3
      },
      eventBus,
      logger
    );
    this.dependencyGraph = new import_dependency_graph.DependencyGraph(logger);
    const cbConfig = {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 3e4,
      halfOpenLimit: 1
    };
    this.circuitBreakers = new import_circuit_breaker.CircuitBreakerManager(cbConfig, logger, eventBus);
    this.registerStrategy(new CapabilitySchedulingStrategy());
    this.registerStrategy(new RoundRobinSchedulingStrategy());
    this.registerStrategy(new LeastLoadedSchedulingStrategy());
    this.registerStrategy(new AffinitySchedulingStrategy());
    this.setupAdvancedEventHandlers();
  }
  async initialize() {
    await super.initialize();
    await this.workStealing.initialize();
    this.logger.info("Advanced task scheduler initialized");
  }
  async shutdown() {
    await this.workStealing.shutdown();
    await super.shutdown();
  }
  /**
   * Register a scheduling strategy
   */
  registerStrategy(strategy) {
    this.strategies.set(strategy.name, strategy);
    this.logger.info("Registered scheduling strategy", { name: strategy.name });
  }
  /**
   * Set the default scheduling strategy
   */
  setDefaultStrategy(name) {
    if (!this.strategies.has(name)) {
      throw new Error(`Strategy not found: ${name}`);
    }
    this.defaultStrategy = name;
  }
  /**
   * Register an agent
   */
  registerAgent(profile) {
    this.activeAgents.set(profile.id, profile);
    this.workStealing.updateAgentWorkload(profile.id, {
      agentId: profile.id,
      taskCount: 0,
      avgTaskDuration: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      priority: profile.priority,
      capabilities: profile.capabilities
    });
  }
  /**
   * Unregister an agent
   */
  unregisterAgent(agentId) {
    this.activeAgents.delete(agentId);
  }
  /**
   * Override assignTask to use advanced scheduling
   */
  async assignTask(task, agentId) {
    this.dependencyGraph.addTask(task);
    if (!agentId) {
      const selectedAgent = await this.selectAgentForTask(task);
      if (!selectedAgent) {
        throw new Error("No suitable agent found for task");
      }
      agentId = selectedAgent;
    }
    await this.circuitBreakers.execute(`assign-${agentId}`, async () => {
      await super.assignTask(task, agentId);
    });
    const taskCount = await this.getAgentTaskCount(agentId);
    this.workStealing.updateAgentWorkload(agentId, { taskCount });
  }
  /**
   * Select the best agent for a task
   */
  async selectAgentForTask(task) {
    const availableAgents = Array.from(this.activeAgents.values());
    if (availableAgents.length === 0) {
      return null;
    }
    const context = {
      taskLoads: /* @__PURE__ */ new Map(),
      agentCapabilities: /* @__PURE__ */ new Map(),
      agentPriorities: /* @__PURE__ */ new Map(),
      taskHistory: this.taskStats,
      currentTime: /* @__PURE__ */ new Date()
    };
    for (const agent of availableAgents) {
      const taskCount = await this.getAgentTaskCount(agent.id);
      context.taskLoads.set(agent.id, taskCount);
      context.agentCapabilities.set(agent.id, agent.capabilities);
      context.agentPriorities.set(agent.id, agent.priority);
    }
    const workStealingAgent = this.workStealing.findBestAgent(task, availableAgents);
    if (workStealingAgent) {
      return workStealingAgent;
    }
    const strategy = this.strategies.get(this.defaultStrategy);
    if (!strategy) {
      throw new Error(`Strategy not found: ${this.defaultStrategy}`);
    }
    return strategy.selectAgent(task, availableAgents, context);
  }
  /**
   * Override completeTask to update stats and dependency graph
   */
  async completeTask(taskId, result) {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const duration = task.startedAt ? (/* @__PURE__ */ new Date()).getTime() - task.startedAt.getTime() : 0;
    this.updateTaskStats(task.type, true, duration);
    if (task.assignedAgent) {
      this.workStealing.recordTaskDuration(task.assignedAgent, duration);
    }
    const readyTasks = this.dependencyGraph.markCompleted(taskId);
    await super.completeTask(taskId, result);
    for (const readyTaskId of readyTasks) {
      const readyTask = await this.getTask(readyTaskId);
      if (readyTask) {
        this.eventBus.emit(import_types.SystemEvents.TASK_CREATED, { task: readyTask });
      }
    }
  }
  /**
   * Override failTask to update stats and dependency graph
   */
  async failTask(taskId, error) {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    this.updateTaskStats(task.type, false, 0);
    const toCancelIds = this.dependencyGraph.markFailed(taskId);
    await super.failTask(taskId, error);
    for (const cancelId of toCancelIds) {
      await this.cancelTask(cancelId, "Parent task failed");
    }
  }
  /**
   * Get a task by ID (helper method)
   */
  async getTask(taskId) {
    return null;
  }
  /**
   * Update task statistics
   */
  updateTaskStats(taskType, success, duration) {
    const stats = this.taskStats.get(taskType) || {
      totalExecutions: 0,
      avgDuration: 0,
      successRate: 0
    };
    stats.totalExecutions++;
    if (success) {
      const successCount = Math.round(stats.successRate * (stats.totalExecutions - 1));
      stats.successRate = (successCount + 1) / stats.totalExecutions;
      if (duration > 0) {
        const totalDuration = stats.avgDuration * (stats.totalExecutions - 1);
        stats.avgDuration = (totalDuration + duration) / stats.totalExecutions;
      }
    } else {
      const successCount = Math.round(stats.successRate * (stats.totalExecutions - 1));
      stats.successRate = successCount / stats.totalExecutions;
    }
    this.taskStats.set(taskType, stats);
  }
  /**
   * Set up advanced event handlers
   */
  setupAdvancedEventHandlers() {
    this.eventBus.on("workstealing:request", async (data) => {
      const { sourceAgent, targetAgent, taskCount } = data;
      try {
        const tasks = await this.getAgentTasks(sourceAgent);
        const tasksToSteal = tasks.filter((t) => t.status === "queued" || t.status === "assigned").slice(0, taskCount);
        for (const task of tasksToSteal) {
          await this.reassignTask(task.id, targetAgent);
        }
        this.logger.info("Work stealing completed", {
          from: sourceAgent,
          to: targetAgent,
          stolenCount: tasksToSteal.length
        });
      } catch (error) {
        this.logger.error("Work stealing failed", { error });
      }
    });
    this.eventBus.on(import_types.SystemEvents.TASK_ASSIGNED, async (data) => {
      const { agentId } = data;
      const taskCount = await this.getAgentTaskCount(agentId);
      this.workStealing.updateAgentWorkload(agentId, { taskCount });
    });
    this.eventBus.on(import_types.SystemEvents.TASK_COMPLETED, async (data) => {
      const { taskId } = data;
    });
  }
  /**
   * Reassign a task to a different agent
   */
  async reassignTask(taskId, newAgentId) {
    await this.cancelTask(taskId, "Reassigning to different agent");
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    await this.assignTask(task, newAgentId);
  }
  /**
   * Get advanced scheduling metrics
   */
  async getSchedulingMetrics() {
    const baseMetrics = await this.getHealthStatus();
    const workloadStats = this.workStealing.getWorkloadStats();
    const depGraphStats = this.dependencyGraph.getStats();
    const cbMetrics = this.circuitBreakers.getAllMetrics();
    return {
      ...baseMetrics.metrics,
      workStealing: workloadStats,
      dependencies: depGraphStats,
      circuitBreakers: cbMetrics,
      taskStats: Object.fromEntries(this.taskStats),
      activeStrategies: Array.from(this.strategies.keys()),
      defaultStrategy: this.defaultStrategy
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AdvancedTaskScheduler,
  AffinitySchedulingStrategy,
  CapabilitySchedulingStrategy,
  LeastLoadedSchedulingStrategy,
  RoundRobinSchedulingStrategy
});
//# sourceMappingURL=advanced-scheduler.js.map
