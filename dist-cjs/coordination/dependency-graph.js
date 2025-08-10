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
var dependency_graph_exports = {};
__export(dependency_graph_exports, {
  DependencyGraph: () => DependencyGraph
});
module.exports = __toCommonJS(dependency_graph_exports);
var import_errors = require("../utils/errors.js");
class DependencyGraph {
  constructor(logger) {
    this.logger = logger;
  }
  static {
    __name(this, "DependencyGraph");
  }
  nodes = /* @__PURE__ */ new Map();
  completedTasks = /* @__PURE__ */ new Set();
  /**
   * Add a task to the dependency graph
   */
  addTask(task) {
    if (this.nodes.has(task.id)) {
      this.logger.warn("Task already exists in dependency graph", { taskId: task.id });
      return;
    }
    const node = {
      taskId: task.id,
      dependencies: new Set(task.dependencies),
      dependents: /* @__PURE__ */ new Set(),
      status: "pending"
    };
    for (const depId of task.dependencies) {
      if (!this.nodes.has(depId) && !this.completedTasks.has(depId)) {
        throw new import_errors.TaskDependencyError(task.id, [depId]);
      }
    }
    this.nodes.set(task.id, node);
    for (const depId of task.dependencies) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependents.add(task.id);
      }
    }
    if (this.isTaskReady(task.id)) {
      node.status = "ready";
    }
  }
  /**
   * Remove a task from the dependency graph
   */
  removeTask(taskId) {
    const node = this.nodes.get(taskId);
    if (!node) {
      return;
    }
    for (const depId of node.dependencies) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependents.delete(taskId);
      }
    }
    for (const depId of node.dependents) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.dependencies.delete(taskId);
        if (this.isTaskReady(depId)) {
          depNode.status = "ready";
        }
      }
    }
    this.nodes.delete(taskId);
  }
  /**
   * Mark a task as completed
   */
  markCompleted(taskId) {
    const node = this.nodes.get(taskId);
    if (!node) {
      this.logger.warn("Task not found in dependency graph", { taskId });
      return [];
    }
    node.status = "completed";
    this.completedTasks.add(taskId);
    const readyTasks = [];
    for (const dependentId of node.dependents) {
      const dependent = this.nodes.get(dependentId);
      if (dependent && dependent.status === "pending" && this.isTaskReady(dependentId)) {
        dependent.status = "ready";
        readyTasks.push(dependentId);
      }
    }
    this.removeTask(taskId);
    return readyTasks;
  }
  /**
   * Mark a task as failed
   */
  markFailed(taskId) {
    const node = this.nodes.get(taskId);
    if (!node) {
      return [];
    }
    node.status = "failed";
    const toCancelIds = this.getAllDependents(taskId);
    for (const depId of toCancelIds) {
      const depNode = this.nodes.get(depId);
      if (depNode) {
        depNode.status = "failed";
      }
    }
    return toCancelIds;
  }
  /**
   * Check if a task is ready to run
   */
  isTaskReady(taskId) {
    const node = this.nodes.get(taskId);
    if (!node) {
      return false;
    }
    for (const depId of node.dependencies) {
      if (!this.completedTasks.has(depId)) {
        return false;
      }
    }
    return true;
  }
  /**
   * Get all ready tasks
   */
  getReadyTasks() {
    const ready = [];
    for (const [taskId, node] of this.nodes) {
      if (node.status === "ready" || node.status === "pending" && this.isTaskReady(taskId)) {
        ready.push(taskId);
        node.status = "ready";
      }
    }
    return ready;
  }
  /**
   * Get all dependents of a task (recursive)
   */
  getAllDependents(taskId) {
    const visited = /* @__PURE__ */ new Set();
    const dependents = [];
    const visit = /* @__PURE__ */ __name((id) => {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);
      const node = this.nodes.get(id);
      if (!node) {
        return;
      }
      for (const depId of node.dependents) {
        if (!visited.has(depId)) {
          dependents.push(depId);
          visit(depId);
        }
      }
    }, "visit");
    visit(taskId);
    return dependents;
  }
  /**
   * Detect circular dependencies
   */
  detectCycles() {
    const cycles = [];
    const visited = /* @__PURE__ */ new Set();
    const recursionStack = /* @__PURE__ */ new Set();
    const currentPath = [];
    const hasCycle = /* @__PURE__ */ __name((taskId) => {
      visited.add(taskId);
      recursionStack.add(taskId);
      currentPath.push(taskId);
      const node = this.nodes.get(taskId);
      if (!node) {
        currentPath.pop();
        recursionStack.delete(taskId);
        return false;
      }
      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          if (hasCycle(depId)) {
            return true;
          }
        } else if (recursionStack.has(depId)) {
          const cycleStart = currentPath.indexOf(depId);
          const cycle = currentPath.slice(cycleStart);
          cycle.push(depId);
          cycles.push(cycle);
          return true;
        }
      }
      currentPath.pop();
      recursionStack.delete(taskId);
      return false;
    }, "hasCycle");
    for (const taskId of this.nodes.keys()) {
      if (!visited.has(taskId)) {
        hasCycle(taskId);
      }
    }
    return cycles;
  }
  /**
   * Get topological sort of tasks
   */
  topologicalSort() {
    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      this.logger.error("Cannot perform topological sort due to cycles", { cycles });
      return null;
    }
    const sorted = [];
    const visited = /* @__PURE__ */ new Set();
    const visit = /* @__PURE__ */ __name((taskId) => {
      if (visited.has(taskId)) {
        return;
      }
      visited.add(taskId);
      const node = this.nodes.get(taskId);
      if (!node) {
        return;
      }
      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          visit(depId);
        }
      }
      sorted.push(taskId);
    }, "visit");
    for (const taskId of this.nodes.keys()) {
      if (!visited.has(taskId)) {
        visit(taskId);
      }
    }
    return sorted;
  }
  /**
   * Find critical path (longest path through the graph)
   */
  findCriticalPath() {
    const paths = [];
    const sources = Array.from(this.nodes.entries()).filter(([_, node]) => node.dependencies.size === 0).map(([id]) => id);
    const sinks = Array.from(this.nodes.entries()).filter(([_, node]) => node.dependents.size === 0).map(([id]) => id);
    for (const source of sources) {
      for (const sink of sinks) {
        const path = this.findPath(source, sink);
        if (path) {
          paths.push({ from: source, to: sink, path });
        }
      }
    }
    if (paths.length === 0) {
      return null;
    }
    return paths.reduce(
      (longest, current) => current.path.length > longest.path.length ? current : longest
    );
  }
  /**
   * Find path between two tasks
   */
  findPath(from, to) {
    if (from === to) {
      return [from];
    }
    const visited = /* @__PURE__ */ new Set();
    const queue = [{ taskId: from, path: [from] }];
    while (queue.length > 0) {
      const { taskId, path } = queue.shift();
      if (visited.has(taskId)) {
        continue;
      }
      visited.add(taskId);
      const node = this.nodes.get(taskId);
      if (!node) {
        continue;
      }
      for (const depId of node.dependents) {
        if (depId === to) {
          return [...path, to];
        }
        if (!visited.has(depId)) {
          queue.push({ taskId: depId, path: [...path, depId] });
        }
      }
    }
    return null;
  }
  /**
   * Get graph statistics
   */
  getStats() {
    const stats = {
      totalTasks: this.nodes.size,
      completedTasks: this.completedTasks.size,
      readyTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      failedTasks: 0,
      avgDependencies: 0,
      maxDependencies: 0,
      cycles: this.detectCycles()
    };
    let totalDeps = 0;
    for (const node of this.nodes.values()) {
      totalDeps += node.dependencies.size;
      stats.maxDependencies = Math.max(stats.maxDependencies, node.dependencies.size);
      switch (node.status) {
        case "ready":
          stats.readyTasks++;
          break;
        case "pending":
          stats.pendingTasks++;
          break;
        case "running":
          stats.runningTasks++;
          break;
        case "failed":
          stats.failedTasks++;
          break;
      }
    }
    stats.avgDependencies = this.nodes.size > 0 ? totalDeps / this.nodes.size : 0;
    return stats;
  }
  /**
   * Export graph to DOT format for visualization
   */
  toDot() {
    let dot = "digraph TaskDependencies {\n";
    dot += "  rankdir=LR;\n";
    dot += "  node [shape=box];\n\n";
    for (const [taskId, node] of this.nodes) {
      let color = "white";
      switch (node.status) {
        case "ready":
          color = "lightgreen";
          break;
        case "running":
          color = "yellow";
          break;
        case "completed":
          color = "green";
          break;
        case "failed":
          color = "red";
          break;
      }
      dot += `  "${taskId}" [style=filled, fillcolor=${color}];
`;
    }
    dot += "\n";
    for (const [taskId, node] of this.nodes) {
      for (const depId of node.dependencies) {
        dot += `  "${depId}" -> "${taskId}";
`;
      }
    }
    dot += "}\n";
    return dot;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DependencyGraph
});
//# sourceMappingURL=dependency-graph.js.map
