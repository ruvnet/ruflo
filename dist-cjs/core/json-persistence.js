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
var json_persistence_exports = {};
__export(json_persistence_exports, {
  JsonPersistenceManager: () => JsonPersistenceManager
});
module.exports = __toCommonJS(json_persistence_exports);
var import_path = require("path");
var import_promises = require("fs/promises");
class JsonPersistenceManager {
  static {
    __name(this, "JsonPersistenceManager");
  }
  dataPath;
  data;
  constructor(dataDir = "./memory") {
    this.dataPath = (0, import_path.join)(dataDir, "claude-flow-data.json");
    this.data = {
      agents: [],
      tasks: [],
      lastUpdated: Date.now()
    };
  }
  async initialize() {
    await (0, import_promises.mkdir)((0, import_path.join)(this.dataPath, ".."), { recursive: true });
    try {
      await (0, import_promises.access)(this.dataPath);
      const content = await (0, import_promises.readFile)(this.dataPath, "utf-8");
      this.data = JSON.parse(content);
    } catch (error) {
      console.error("Failed to load persistence data:", error);
    }
  }
  async save() {
    this.data.lastUpdated = Date.now();
    await (0, import_promises.writeFile)(this.dataPath, JSON.stringify(this.data, null, 2));
  }
  // Agent operations
  async saveAgent(agent) {
    this.data.agents = this.data.agents.filter((a) => a.id !== agent.id);
    this.data.agents.push(agent);
    await this.save();
  }
  async getAgent(id) {
    return this.data.agents.find((a) => a.id === id) || null;
  }
  async getActiveAgents() {
    return this.data.agents.filter((a) => a.status === "active" || a.status === "idle");
  }
  async getAllAgents() {
    return this.data.agents;
  }
  async updateAgentStatus(id, status) {
    const agent = this.data.agents.find((a) => a.id === id);
    if (agent) {
      agent.status = status;
      await this.save();
    }
  }
  // Task operations
  async saveTask(task) {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== task.id);
    this.data.tasks.push(task);
    await this.save();
  }
  async getTask(id) {
    return this.data.tasks.find((t) => t.id === id) || null;
  }
  async getActiveTasks() {
    return this.data.tasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress" || t.status === "assigned"
    );
  }
  async getAllTasks() {
    return this.data.tasks;
  }
  async updateTaskStatus(id, status, assignedAgent) {
    const task = this.data.tasks.find((t) => t.id === id);
    if (task) {
      task.status = status;
      if (assignedAgent !== void 0) {
        task.assignedAgent = assignedAgent;
      }
      if (status === "completed") {
        task.completedAt = Date.now();
      }
      await this.save();
    }
  }
  async updateTaskProgress(id, progress) {
    const task = this.data.tasks.find((t) => t.id === id);
    if (task) {
      task.progress = progress;
      await this.save();
    }
  }
  // Statistics
  async getStats() {
    const activeAgents = this.data.agents.filter(
      (a) => a.status === "active" || a.status === "idle"
    ).length;
    const pendingTasks = this.data.tasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress" || t.status === "assigned"
    ).length;
    const completedTasks = this.data.tasks.filter((t) => t.status === "completed").length;
    return {
      totalAgents: this.data.agents.length,
      activeAgents,
      totalTasks: this.data.tasks.length,
      pendingTasks,
      completedTasks
    };
  }
  close() {
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JsonPersistenceManager
});
//# sourceMappingURL=json-persistence.js.map
