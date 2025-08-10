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
var hive_orchestrator_exports = {};
__export(hive_orchestrator_exports, {
  HiveOrchestrator: () => HiveOrchestrator
});
module.exports = __toCommonJS(hive_orchestrator_exports);
var import_events = require("events");
var import_helpers = require("../utils/helpers.js");
class HiveOrchestrator extends import_events.EventEmitter {
  static {
    __name(this, "HiveOrchestrator");
  }
  tasks = /* @__PURE__ */ new Map();
  decisions = /* @__PURE__ */ new Map();
  agentCapabilities = /* @__PURE__ */ new Map();
  consensusThreshold;
  topology;
  constructor(options = {}) {
    super();
    this.consensusThreshold = options.consensusThreshold || 0.6;
    this.topology = options.topology || "hierarchical";
  }
  /**
   * Register agent capabilities for task matching
   */
  registerAgentCapabilities(agentId, capabilities) {
    this.agentCapabilities.set(agentId, new Set(capabilities));
    this.emit("agent:registered", { agentId, capabilities });
  }
  /**
   * Decompose objective into coordinated tasks
   */
  async decomposeObjective(objective) {
    const tasks = [];
    const needsResearch = objective.toLowerCase().includes("research") || objective.toLowerCase().includes("analyze");
    const needsDesign = objective.toLowerCase().includes("build") || objective.toLowerCase().includes("create") || objective.toLowerCase().includes("develop");
    const needsImplementation = needsDesign || objective.toLowerCase().includes("implement");
    if (needsResearch) {
      tasks.push(
        this.createTask(
          "research",
          `Research background and requirements for: ${objective}`,
          "high"
        )
      );
    }
    const analysisTask = this.createTask(
      "analysis",
      `Analyze requirements and constraints for: ${objective}`,
      "critical"
    );
    tasks.push(analysisTask);
    if (needsDesign) {
      const designTask = this.createTask(
        "design",
        "Design system architecture and components",
        "high",
        [analysisTask.id]
      );
      tasks.push(designTask);
      if (needsImplementation) {
        const implTask = this.createTask("implementation", "Implement core functionality", "high", [
          designTask.id
        ]);
        tasks.push(implTask);
        const testTask = this.createTask("testing", "Test and validate implementation", "high", [
          implTask.id
        ]);
        tasks.push(testTask);
      }
    }
    const docTask = this.createTask(
      "documentation",
      "Document solution and decisions",
      "medium",
      tasks.filter((t) => t.type !== "documentation").map((t) => t.id)
    );
    tasks.push(docTask);
    return this.applyTopologyOrdering(tasks);
  }
  /**
   * Create a new task
   */
  createTask(type, description, priority, dependencies = []) {
    const task = {
      id: (0, import_helpers.generateId)("task"),
      type,
      description,
      priority,
      dependencies,
      status: "pending",
      votes: /* @__PURE__ */ new Map(),
      metrics: {
        startTime: Date.now(),
        attempts: 0
      }
    };
    this.tasks.set(task.id, task);
    this.emit("task:created", task);
    return task;
  }
  /**
   * Apply topology-specific task ordering
   */
  applyTopologyOrdering(tasks) {
    switch (this.topology) {
      case "hierarchical":
        return tasks.sort((a, b) => {
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
      case "ring":
        for (let i = 1; i < tasks.length; i++) {
          if (tasks[i].dependencies.length === 0) {
            tasks[i].dependencies.push(tasks[i - 1].id);
          }
        }
        return tasks;
      case "mesh":
        return tasks.sort((a, b) => a.dependencies.length - b.dependencies.length);
      case "star":
        const analysisTask = tasks.find((t) => t.type === "analysis");
        if (analysisTask) {
          tasks.forEach((t) => {
            if (t.id !== analysisTask.id && t.dependencies.length === 0) {
              t.dependencies.push(analysisTask.id);
            }
          });
        }
        return tasks;
      default:
        return tasks;
    }
  }
  /**
   * Propose task assignment with voting
   */
  async proposeTaskAssignment(taskId, agentId) {
    const task = this.tasks.get(taskId);
    if (!task)
      throw new Error(`Task ${taskId} not found`);
    const decision = {
      id: (0, import_helpers.generateId)("decision"),
      type: "task_assignment",
      proposal: { taskId, agentId },
      votes: /* @__PURE__ */ new Map(),
      result: "pending",
      timestamp: Date.now()
    };
    this.decisions.set(decision.id, decision);
    task.status = "voting";
    this.emit("decision:proposed", decision);
    return decision;
  }
  /**
   * Submit vote for a decision
   */
  submitVote(decisionId, agentId, vote) {
    const decision = this.decisions.get(decisionId);
    if (!decision)
      throw new Error(`Decision ${decisionId} not found`);
    decision.votes.set(agentId, vote);
    const totalAgents = this.agentCapabilities.size;
    const votesReceived = decision.votes.size;
    if (votesReceived >= totalAgents * 0.8) {
      this.evaluateDecision(decision);
    }
  }
  /**
   * Evaluate decision based on votes
   */
  evaluateDecision(decision) {
    const approvals = Array.from(decision.votes.values()).filter((v) => v).length;
    const totalVotes = decision.votes.size;
    const approvalRate = approvals / totalVotes;
    decision.result = approvalRate >= this.consensusThreshold ? "approved" : "rejected";
    if (decision.result === "approved" && decision.type === "task_assignment") {
      const { taskId, agentId } = decision.proposal;
      const task = this.tasks.get(taskId);
      if (task) {
        task.assignedTo = agentId;
        task.status = "assigned";
        this.emit("task:assigned", { task, agentId });
      }
    }
    this.emit("decision:resolved", decision);
  }
  /**
   * Get optimal agent for task based on capabilities
   */
  getOptimalAgent(taskId) {
    const task = this.tasks.get(taskId);
    if (!task)
      return null;
    let bestAgent = null;
    let bestScore = 0;
    for (const [agentId, capabilities] of this.agentCapabilities) {
      const score = this.calculateAgentTaskScore(task, capabilities);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agentId;
      }
    }
    return bestAgent;
  }
  /**
   * Calculate how well agent capabilities match task
   */
  calculateAgentTaskScore(task, capabilities) {
    let score = 0;
    switch (task.type) {
      case "research":
        if (capabilities.has("research"))
          score += 5;
        if (capabilities.has("analysis"))
          score += 3;
        if (capabilities.has("exploration"))
          score += 2;
        break;
      case "design":
        if (capabilities.has("architecture"))
          score += 5;
        if (capabilities.has("design"))
          score += 4;
        if (capabilities.has("planning"))
          score += 3;
        break;
      case "implementation":
        if (capabilities.has("coding"))
          score += 5;
        if (capabilities.has("implementation"))
          score += 4;
        if (capabilities.has("building"))
          score += 3;
        break;
      case "testing":
        if (capabilities.has("testing"))
          score += 5;
        if (capabilities.has("validation"))
          score += 4;
        if (capabilities.has("quality"))
          score += 3;
        break;
      case "documentation":
        if (capabilities.has("documentation"))
          score += 5;
        if (capabilities.has("writing"))
          score += 3;
        break;
    }
    if (capabilities.has("analysis"))
      score += 1;
    if (capabilities.has("optimization"))
      score += 1;
    return score;
  }
  /**
   * Update task status
   */
  updateTaskStatus(taskId, status, result) {
    const task = this.tasks.get(taskId);
    if (!task)
      throw new Error(`Task ${taskId} not found`);
    task.status = status;
    if (result)
      task.result = result;
    if (status === "completed" && task.metrics) {
      task.metrics.endTime = Date.now();
    }
    this.emit("task:updated", task);
    if (status === "completed") {
      this.checkDependentTasks(taskId);
    }
  }
  /**
   * Check and update dependent tasks
   */
  checkDependentTasks(completedTaskId) {
    for (const task of this.tasks.values()) {
      if (task.status === "pending" && task.dependencies.includes(completedTaskId)) {
        const allDepsCompleted = task.dependencies.every((depId) => {
          const depTask = this.tasks.get(depId);
          return depTask && depTask.status === "completed";
        });
        if (allDepsCompleted) {
          this.emit("task:ready", task);
        }
      }
    }
  }
  /**
   * Calculate swarm performance metrics
   */
  getPerformanceMetrics() {
    const tasks = Array.from(this.tasks.values());
    const completed = tasks.filter((t) => t.status === "completed");
    const failed = tasks.filter((t) => t.status === "failed");
    const avgExecutionTime = completed.length > 0 ? completed.reduce(
      (sum, t) => sum + (t.metrics?.endTime || 0) - (t.metrics?.startTime || 0),
      0
    ) / completed.length : 0;
    const decisions = Array.from(this.decisions.values());
    const approvedDecisions = decisions.filter((d) => d.result === "approved");
    return {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      pendingTasks: tasks.filter((t) => t.status === "pending").length,
      executingTasks: tasks.filter((t) => t.status === "executing").length,
      avgExecutionTime,
      totalDecisions: decisions.length,
      approvedDecisions: approvedDecisions.length,
      consensusRate: decisions.length > 0 ? approvedDecisions.length / decisions.length : 0,
      topology: this.topology
    };
  }
  /**
   * Get task dependency graph
   */
  getTaskGraph() {
    const nodes = Array.from(this.tasks.values()).map((task) => ({
      id: task.id,
      type: task.type,
      status: task.status,
      assignedTo: task.assignedTo
    }));
    const edges = [];
    for (const task of this.tasks.values()) {
      for (const dep of task.dependencies) {
        edges.push({ from: dep, to: task.id });
      }
    }
    return { nodes, edges };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HiveOrchestrator
});
//# sourceMappingURL=hive-orchestrator.js.map
