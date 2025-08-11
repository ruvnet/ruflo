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
var swarm_coordinator_exports = {};
__export(swarm_coordinator_exports, {
  SwarmCoordinator: () => SwarmCoordinator
});
module.exports = __toCommonJS(swarm_coordinator_exports);
var import_node_events = require("node:events");
var import_logger = require("../core/logger.js");
var import_event_bus = require("../core/event-bus.js");
var import_helpers = require("../utils/helpers.js");
var import_swarm_monitor = require("./swarm-monitor.js");
var import_manager = require("../memory/manager.js");
class SwarmCoordinator extends import_node_events.EventEmitter {
  static {
    __name(this, "SwarmCoordinator");
  }
  logger;
  config;
  agents;
  objectives;
  tasks;
  monitor;
  scheduler;
  memoryManager;
  backgroundWorkers;
  isRunning = false;
  workStealer;
  circuitBreaker;
  constructor(config = {}) {
    super();
    this.logger = new import_logger.Logger("SwarmCoordinator");
    this.config = {
      maxAgents: 10,
      maxConcurrentTasks: 5,
      taskTimeout: 3e5,
      // 5 minutes
      enableMonitoring: true,
      enableWorkStealing: true,
      enableCircuitBreaker: true,
      memoryNamespace: "swarm",
      coordinationStrategy: "hybrid",
      backgroundTaskInterval: 5e3,
      // 5 seconds
      healthCheckInterval: 1e4,
      // 10 seconds
      maxRetries: 3,
      backoffMultiplier: 2,
      ...config
    };
    this.agents = /* @__PURE__ */ new Map();
    this.objectives = /* @__PURE__ */ new Map();
    this.tasks = /* @__PURE__ */ new Map();
    this.backgroundWorkers = /* @__PURE__ */ new Map();
    const eventBus = import_event_bus.EventBus.getInstance();
    this.memoryManager = new import_manager.MemoryManager(
      {
        backend: "sqlite",
        namespace: this.config.memoryNamespace,
        cacheSizeMB: 50,
        syncOnExit: true,
        maxEntries: 1e4,
        ttlMinutes: 60
      },
      eventBus,
      this.logger
    );
    if (this.config.enableMonitoring) {
      this.monitor = new import_swarm_monitor.SwarmMonitor({
        updateInterval: 1e3,
        enableAlerts: true,
        enableHistory: true
      });
    }
    this.setupEventHandlers();
  }
  setupEventHandlers() {
    if (this.monitor) {
      this.monitor.on("alert", (alert) => {
        this.handleMonitorAlert(alert);
      });
    }
    this.on("task:completed", (data) => {
      this.handleTaskCompleted(data.taskId, data.result);
    });
    this.on("task:failed", (data) => {
      this.handleTaskFailed(data.taskId, data.error);
    });
  }
  async start() {
    if (this.isRunning) {
      this.logger.warn("Swarm coordinator already running");
      return;
    }
    this.logger.info("Starting swarm coordinator...");
    this.isRunning = true;
    await this.memoryManager.initialize();
    if (this.monitor) {
      await this.monitor.start();
    }
    this.startBackgroundWorkers();
    this.emit("coordinator:started");
  }
  async stop() {
    if (!this.isRunning) {
      return;
    }
    this.logger.info("Stopping swarm coordinator...");
    this.isRunning = false;
    this.stopBackgroundWorkers();
    await this.scheduler.shutdown();
    if (this.monitor) {
      this.monitor.stop();
    }
    this.emit("coordinator:stopped");
  }
  startBackgroundWorkers() {
    const taskProcessor = setInterval(() => {
      this.processBackgroundTasks();
    }, this.config.backgroundTaskInterval);
    this.backgroundWorkers.set("taskProcessor", taskProcessor);
    const healthChecker = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    this.backgroundWorkers.set("healthChecker", healthChecker);
    if (this.workStealer) {
      const workStealerWorker = setInterval(() => {
        this.performWorkStealing();
      }, this.config.backgroundTaskInterval);
      this.backgroundWorkers.set("workStealer", workStealerWorker);
    }
    const memorySync = setInterval(() => {
      this.syncMemoryState();
    }, this.config.backgroundTaskInterval * 2);
    this.backgroundWorkers.set("memorySync", memorySync);
  }
  stopBackgroundWorkers() {
    for (const [name, worker] of this.backgroundWorkers) {
      clearInterval(worker);
      this.logger.debug(`Stopped background worker: ${name}`);
    }
    this.backgroundWorkers.clear();
  }
  async createObjective(description, strategy = "auto") {
    const objectiveId = (0, import_helpers.generateId)("objective");
    const objective = {
      id: objectiveId,
      description,
      strategy,
      tasks: [],
      status: "planning",
      createdAt: /* @__PURE__ */ new Date()
    };
    this.objectives.set(objectiveId, objective);
    this.logger.info(`Created objective: ${objectiveId} - ${description}`);
    const tasks = await this.decomposeObjective(objective);
    objective.tasks = tasks;
    await this.memoryManager.store({
      id: `objective:${objectiveId}`,
      agentId: "swarm-coordinator",
      type: "objective",
      content: JSON.stringify(objective),
      namespace: this.config.memoryNamespace,
      timestamp: /* @__PURE__ */ new Date(),
      metadata: {
        type: "objective",
        strategy,
        taskCount: tasks.length
      }
    });
    this.emit("objective:created", objective);
    return objectiveId;
  }
  async decomposeObjective(objective) {
    const tasks = [];
    switch (objective.strategy) {
      case "research":
        tasks.push(
          this.createTask("research", "Gather information and research materials", 1),
          this.createTask("analysis", "Analyze research findings", 2, ["research"]),
          this.createTask("synthesis", "Synthesize insights and create report", 3, ["analysis"])
        );
        break;
      case "development":
        tasks.push(
          this.createTask("planning", "Plan architecture and design", 1),
          this.createTask("implementation", "Implement core functionality", 2, ["planning"]),
          this.createTask("testing", "Test and validate implementation", 3, ["implementation"]),
          this.createTask("documentation", "Create documentation", 3, ["implementation"]),
          this.createTask("review", "Peer review and refinement", 4, ["testing", "documentation"])
        );
        break;
      case "analysis":
        tasks.push(
          this.createTask("data-collection", "Collect and prepare data", 1),
          this.createTask("analysis", "Perform detailed analysis", 2, ["data-collection"]),
          this.createTask("visualization", "Create visualizations", 3, ["analysis"]),
          this.createTask("reporting", "Generate final report", 4, ["analysis", "visualization"])
        );
        break;
      default:
        tasks.push(
          this.createTask("exploration", "Explore and understand requirements", 1),
          this.createTask("planning", "Create execution plan", 2, ["exploration"]),
          this.createTask("execution", "Execute main tasks", 3, ["planning"]),
          this.createTask("validation", "Validate and test results", 4, ["execution"]),
          this.createTask("completion", "Finalize and document", 5, ["validation"])
        );
    }
    tasks.forEach((task) => {
      this.tasks.set(task.id, task);
    });
    return tasks;
  }
  createTask(type, description, priority, dependencies = []) {
    return {
      id: (0, import_helpers.generateId)("task"),
      type,
      description,
      priority,
      dependencies,
      status: "pending",
      createdAt: /* @__PURE__ */ new Date(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      timeout: this.config.taskTimeout
    };
  }
  async registerAgent(name, type, capabilities = []) {
    const agentId = (0, import_helpers.generateId)("agent");
    const agent = {
      id: agentId,
      name,
      type,
      status: "idle",
      capabilities,
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalDuration: 0,
        lastActivity: /* @__PURE__ */ new Date()
      }
    };
    this.agents.set(agentId, agent);
    if (this.monitor) {
      this.monitor.registerAgent(agentId, name);
    }
    if (this.workStealer) {
      this.workStealer.registerWorker(agentId, 1);
    }
    this.logger.info(`Registered agent: ${name} (${agentId}) - Type: ${type}`);
    this.emit("agent:registered", agent);
    return agentId;
  }
  async assignTask(taskId, agentId) {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);
    if (!task || !agent) {
      throw new Error("Task or agent not found");
    }
    if (agent.status !== "idle") {
      throw new Error("Agent is not available");
    }
    if (this.circuitBreaker && !this.circuitBreaker.canExecute(agentId)) {
      throw new Error("Agent circuit breaker is open");
    }
    task.assignedTo = agentId;
    task.status = "running";
    task.startedAt = /* @__PURE__ */ new Date();
    agent.status = "busy";
    agent.currentTask = task;
    if (this.monitor) {
      this.monitor.taskStarted(agentId, taskId, task.description);
    }
    this.logger.info(`Assigned task ${taskId} to agent ${agentId}`);
    this.emit("task:assigned", { task, agent });
    this.executeTask(task, agent);
  }
  async executeTask(task, agent) {
    try {
      const result = await this.simulateTaskExecution(task, agent);
      await this.handleTaskCompleted(task.id, result);
    } catch (error) {
      await this.handleTaskFailed(task.id, error);
    }
  }
  async simulateTaskExecution(task, agent) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Task timeout"));
      }, task.timeout || this.config.taskTimeout);
      setTimeout(
        () => {
          clearTimeout(timeout);
          resolve({
            taskId: task.id,
            agentId: agent.id,
            result: `Completed ${task.type} task`,
            timestamp: /* @__PURE__ */ new Date()
          });
        },
        Math.random() * 5e3 + 2e3
      );
    });
  }
  async handleTaskCompleted(taskId, result) {
    const task = this.tasks.get(taskId);
    if (!task)
      return;
    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;
    task.status = "completed";
    task.completedAt = /* @__PURE__ */ new Date();
    task.result = result;
    if (agent) {
      agent.status = "idle";
      agent.currentTask = void 0;
      agent.metrics.tasksCompleted++;
      agent.metrics.totalDuration += task.completedAt.getTime() - (task.startedAt?.getTime() || 0);
      agent.metrics.lastActivity = /* @__PURE__ */ new Date();
      if (this.monitor) {
        this.monitor.taskCompleted(agent.id, taskId);
      }
      if (this.circuitBreaker) {
        this.circuitBreaker.recordSuccess(agent.id);
      }
    }
    await this.memoryManager.store({
      id: `task:${taskId}:result`,
      agentId: agent?.id || "unknown",
      type: "task-result",
      content: JSON.stringify(result),
      namespace: this.config.memoryNamespace,
      timestamp: /* @__PURE__ */ new Date(),
      metadata: {
        type: "task-result",
        taskType: task.type,
        agentId: agent?.id
      }
    });
    this.logger.info(`Task ${taskId} completed successfully`);
    this.emit("task:completed", { task, result });
    this.checkObjectiveCompletion(task);
  }
  async handleTaskFailed(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task)
      return;
    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;
    task.error = (error instanceof Error ? error.message : String(error)) || String(error);
    task.retryCount++;
    if (agent) {
      agent.status = "idle";
      agent.currentTask = void 0;
      agent.metrics.tasksFailed++;
      agent.metrics.lastActivity = /* @__PURE__ */ new Date();
      if (this.monitor) {
        this.monitor.taskFailed(agent.id, taskId, task.error);
      }
      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure(agent.id);
      }
    }
    if (task.retryCount < task.maxRetries) {
      task.status = "pending";
      task.assignedTo = void 0;
      this.logger.warn(`Task ${taskId} failed, will retry (${task.retryCount}/${task.maxRetries})`);
      this.emit("task:retry", { task, error });
    } else {
      task.status = "failed";
      task.completedAt = /* @__PURE__ */ new Date();
      this.logger.error(`Task ${taskId} failed after ${task.retryCount} retries`);
      this.emit("task:failed", { task, error });
    }
  }
  checkObjectiveCompletion(completedTask) {
    for (const [objectiveId, objective] of this.objectives) {
      if (objective.status !== "executing")
        continue;
      const allTasksComplete = objective.tasks.every((task) => {
        const t = this.tasks.get(task.id);
        return t && (t.status === "completed" || t.status === "failed");
      });
      if (allTasksComplete) {
        objective.status = "completed";
        objective.completedAt = /* @__PURE__ */ new Date();
        this.logger.info(`Objective ${objectiveId} completed`);
        this.emit("objective:completed", objective);
      }
    }
  }
  async processBackgroundTasks() {
    if (!this.isRunning)
      return;
    try {
      const pendingTasks = Array.from(this.tasks.values()).filter(
        (t) => t.status === "pending" && this.areDependenciesMet(t)
      );
      const availableAgents = Array.from(this.agents.values()).filter((a) => a.status === "idle");
      for (const task of pendingTasks) {
        if (availableAgents.length === 0)
          break;
        const agent = this.selectBestAgent(task, availableAgents);
        if (agent) {
          try {
            await this.assignTask(task.id, agent.id);
            availableAgents.splice(availableAgents.indexOf(agent), 1);
          } catch (error) {
            this.logger.error(`Failed to assign task ${task.id}:`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error("Error processing background tasks:", error);
    }
  }
  areDependenciesMet(task) {
    return task.dependencies.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep && dep.status === "completed";
    });
  }
  selectBestAgent(task, availableAgents) {
    const compatibleAgents = availableAgents.filter((agent) => {
      if (task.type.includes("research") && agent.type === "researcher")
        return true;
      if (task.type.includes("implement") && agent.type === "coder")
        return true;
      if (task.type.includes("analysis") && agent.type === "analyst")
        return true;
      if (task.type.includes("review") && agent.type === "reviewer")
        return true;
      return agent.type === "coordinator";
    });
    if (compatibleAgents.length === 0) {
      return availableAgents[0];
    }
    return compatibleAgents.reduce((best, agent) => {
      const bestRatio = best.metrics.tasksCompleted / (best.metrics.tasksFailed + 1);
      const agentRatio = agent.metrics.tasksCompleted / (agent.metrics.tasksFailed + 1);
      return agentRatio > bestRatio ? agent : best;
    });
  }
  async performHealthChecks() {
    if (!this.isRunning)
      return;
    try {
      const now = /* @__PURE__ */ new Date();
      for (const [agentId, agent] of this.agents) {
        if (agent.status === "busy" && agent.currentTask) {
          const taskDuration = now.getTime() - (agent.currentTask.startedAt?.getTime() || 0);
          if (taskDuration > this.config.taskTimeout) {
            this.logger.warn(`Agent ${agentId} appears stalled on task ${agent.currentTask.id}`);
            await this.handleTaskFailed(agent.currentTask.id, new Error("Task timeout"));
          }
        }
        const inactivityTime = now.getTime() - agent.metrics.lastActivity.getTime();
        if (inactivityTime > this.config.healthCheckInterval * 3) {
          this.logger.warn(
            `Agent ${agentId} has been inactive for ${Math.round(inactivityTime / 1e3)}s`
          );
        }
      }
    } catch (error) {
      this.logger.error("Error performing health checks:", error);
    }
  }
  async performWorkStealing() {
    if (!this.isRunning || !this.workStealer)
      return;
    try {
      const workloads = /* @__PURE__ */ new Map();
      for (const [agentId, agent] of this.agents) {
        workloads.set(agentId, agent.status === "busy" ? 1 : 0);
      }
      this.workStealer.updateLoads(workloads);
      const stealingSuggestions = this.workStealer.suggestWorkStealing();
      for (const suggestion of stealingSuggestions) {
        this.logger.debug(`Work stealing suggestion: ${suggestion.from} -> ${suggestion.to}`);
      }
    } catch (error) {
      this.logger.error("Error performing work stealing:", error);
    }
  }
  async syncMemoryState() {
    if (!this.isRunning)
      return;
    try {
      const state = {
        objectives: Array.from(this.objectives.values()),
        tasks: Array.from(this.tasks.values()),
        agents: Array.from(this.agents.values()).map((a) => ({
          ...a,
          currentTask: void 0
          // Don't store transient state
        })),
        timestamp: /* @__PURE__ */ new Date()
      };
      await this.memoryManager.store({
        id: "swarm:state",
        agentId: "swarm-coordinator",
        type: "swarm-state",
        content: JSON.stringify(state),
        namespace: this.config.memoryNamespace,
        timestamp: /* @__PURE__ */ new Date(),
        metadata: {
          type: "swarm-state",
          objectiveCount: state.objectives.length,
          taskCount: state.tasks.length,
          agentCount: state.agents.length
        }
      });
    } catch (error) {
      this.logger.error("Error syncing memory state:", error);
    }
  }
  handleMonitorAlert(alert) {
    this.logger.warn(`Monitor alert: ${alert.message}`);
    this.emit("monitor:alert", alert);
  }
  handleAgentMessage(message) {
    this.logger.debug(`Agent message: ${message.type} from ${message.from}`);
    this.emit("agent:message", message);
  }
  // Public API methods
  async executeObjective(objectiveId) {
    const objective = this.objectives.get(objectiveId);
    if (!objective) {
      throw new Error("Objective not found");
    }
    objective.status = "executing";
    this.logger.info(`Executing objective: ${objectiveId}`);
    this.emit("objective:started", objective);
  }
  getObjectiveStatus(objectiveId) {
    return this.objectives.get(objectiveId);
  }
  getAgentStatus(agentId) {
    return this.agents.get(agentId);
  }
  getSwarmStatus() {
    const tasks = Array.from(this.tasks.values());
    const agents = Array.from(this.agents.values());
    return {
      objectives: this.objectives.size,
      tasks: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending").length,
        running: tasks.filter((t) => t.status === "running").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        failed: tasks.filter((t) => t.status === "failed").length
      },
      agents: {
        total: agents.length,
        idle: agents.filter((a) => a.status === "idle").length,
        busy: agents.filter((a) => a.status === "busy").length,
        failed: agents.filter((a) => a.status === "failed").length
      },
      uptime: this.monitor ? this.monitor.getSummary().uptime : 0
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SwarmCoordinator
});
//# sourceMappingURL=swarm-coordinator.js.map
