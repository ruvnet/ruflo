"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var persistence_exports = {};
__export(persistence_exports, {
  PersistenceManager: () => PersistenceManager
});
module.exports = __toCommonJS(persistence_exports);
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
var import_path = require("path");
var import_promises = require("fs/promises");
class PersistenceManager {
  static {
    __name(this, "PersistenceManager");
  }
  db;
  dbPath;
  constructor(dataDir = "./memory") {
    this.dbPath = (0, import_path.join)(dataDir, "claude-flow.db");
  }
  async initialize() {
    await (0, import_promises.mkdir)((0, import_path.join)(this.dbPath, ".."), { recursive: true });
    this.db = new import_better_sqlite3.default(this.dbPath);
    this.createTables();
  }
  createTables() {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        max_concurrent_tasks INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        dependencies TEXT NOT NULL,
        metadata TEXT NOT NULL,
        assigned_agent TEXT,
        progress INTEGER DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);
  }
  // Agent operations
  async saveAgent(agent) {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO agents 
       (id, type, name, status, capabilities, system_prompt, max_concurrent_tasks, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      agent.id,
      agent.type,
      agent.name,
      agent.status,
      agent.capabilities,
      agent.systemPrompt,
      agent.maxConcurrentTasks,
      agent.priority,
      agent.createdAt
    );
  }
  async getAgent(id) {
    const stmt = this.db.prepare("SELECT * FROM agents WHERE id = ?");
    const row = stmt.get(id);
    if (!row)
      return null;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      capabilities: row.capabilities,
      systemPrompt: row.system_prompt,
      maxConcurrentTasks: row.max_concurrent_tasks,
      priority: row.priority,
      createdAt: row.created_at
    };
  }
  async getActiveAgents() {
    const stmt = this.db.prepare(
      "SELECT * FROM agents WHERE status IN ('active', 'idle') ORDER BY created_at DESC"
    );
    const rows = stmt.all();
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      capabilities: row.capabilities,
      systemPrompt: row.system_prompt,
      maxConcurrentTasks: row.max_concurrent_tasks,
      priority: row.priority,
      createdAt: row.created_at
    }));
  }
  async updateAgentStatus(id, status) {
    const stmt = this.db.prepare("UPDATE agents SET status = ? WHERE id = ?");
    stmt.run(status, id);
  }
  // Task operations
  async saveTask(task) {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO tasks 
       (id, type, description, status, priority, dependencies, metadata, assigned_agent, progress, error, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      task.id,
      task.type,
      task.description,
      task.status,
      task.priority,
      task.dependencies,
      task.metadata,
      task.assignedAgent || null,
      task.progress,
      task.error || null,
      task.createdAt,
      task.completedAt || null
    );
  }
  async getTask(id) {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    const row = stmt.get(id);
    if (!row)
      return null;
    return {
      id: row.id,
      type: row.type,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dependencies: row.dependencies,
      metadata: row.metadata,
      assignedAgent: row.assigned_agent || void 0,
      progress: row.progress,
      error: row.error || void 0,
      createdAt: row.created_at,
      completedAt: row.completed_at || void 0
    };
  }
  async getActiveTasks() {
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE status IN ('pending', 'in_progress', 'assigned') ORDER BY priority DESC, created_at ASC"
    );
    const rows = stmt.all();
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dependencies: row.dependencies,
      metadata: row.metadata,
      assignedAgent: row.assigned_agent || void 0,
      progress: row.progress,
      error: row.error || void 0,
      createdAt: row.created_at,
      completedAt: row.completed_at || void 0
    }));
  }
  async updateTaskStatus(id, status, assignedAgent) {
    if (assignedAgent) {
      const stmt = this.db.prepare("UPDATE tasks SET status = ?, assigned_agent = ? WHERE id = ?");
      stmt.run(status, assignedAgent, id);
    } else {
      const stmt = this.db.prepare("UPDATE tasks SET status = ? WHERE id = ?");
      stmt.run(status, id);
    }
  }
  async updateTaskProgress(id, progress) {
    const stmt = this.db.prepare("UPDATE tasks SET progress = ? WHERE id = ?");
    stmt.run(progress, id);
  }
  // Statistics
  async getStats() {
    const totalAgents = this.db.prepare("SELECT COUNT(*) as count FROM agents").get();
    const activeAgents = this.db.prepare("SELECT COUNT(*) as count FROM agents WHERE status IN ('active', 'idle')").get();
    const totalTasks = this.db.prepare("SELECT COUNT(*) as count FROM tasks").get();
    const pendingTasks = this.db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status IN ('pending', 'in_progress', 'assigned')"
    ).get();
    const completedTasks = this.db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'").get();
    return {
      totalAgents: totalAgents.count,
      activeAgents: activeAgents.count,
      totalTasks: totalTasks.count,
      pendingTasks: pendingTasks.count,
      completedTasks: completedTasks.count
    };
  }
  close() {
    this.db.close();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PersistenceManager
});
//# sourceMappingURL=persistence.js.map
