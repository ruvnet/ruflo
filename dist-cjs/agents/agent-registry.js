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
var agent_registry_exports = {};
__export(agent_registry_exports, {
  AgentRegistry: () => AgentRegistry
});
module.exports = __toCommonJS(agent_registry_exports);
var import_node_events = require("node:events");
class AgentRegistry extends import_node_events.EventEmitter {
  static {
    __name(this, "AgentRegistry");
  }
  memory;
  namespace;
  cache = /* @__PURE__ */ new Map();
  cacheExpiry = 6e4;
  // 1 minute
  lastCacheUpdate = 0;
  constructor(memory, namespace = "agents") {
    super();
    this.memory = memory;
    this.namespace = namespace;
  }
  async initialize() {
    await this.loadFromMemory();
    this.emit("registry:initialized");
  }
  /**
   * Register a new agent in the registry
   */
  async registerAgent(agent, tags = []) {
    const entry = {
      agent,
      createdAt: /* @__PURE__ */ new Date(),
      lastUpdated: /* @__PURE__ */ new Date(),
      tags: [...tags, agent.type, agent.status],
      metadata: {
        registeredBy: "agent-manager",
        version: "1.0.0"
      }
    };
    const key = this.getAgentKey(agent.id.id);
    await this.memory.store(key, entry, {
      type: "agent-registry",
      tags: entry.tags,
      partition: this.namespace
    });
    this.cache.set(agent.id.id, entry);
    this.emit("agent:registered", { agentId: agent.id.id, agent });
  }
  /**
   * Update agent information in registry
   */
  async updateAgent(agentId, updates) {
    const entry = await this.getAgentEntry(agentId);
    if (!entry) {
      throw new Error(`Agent ${agentId} not found in registry`);
    }
    entry.agent = { ...entry.agent, ...updates };
    entry.lastUpdated = /* @__PURE__ */ new Date();
    entry.tags = [
      entry.agent.type,
      entry.agent.status,
      ...entry.tags.filter((t) => t !== entry.agent.type && t !== entry.agent.status)
    ];
    const key = this.getAgentKey(agentId);
    await this.memory.store(key, entry, {
      type: "agent-registry",
      tags: entry.tags,
      partition: this.namespace
    });
    this.cache.set(agentId, entry);
    this.emit("agent:updated", { agentId, agent: entry.agent });
  }
  /**
   * Remove agent from registry
   */
  async unregisterAgent(agentId, preserveHistory = true) {
    const entry = await this.getAgentEntry(agentId);
    if (!entry) {
      return;
    }
    if (preserveHistory) {
      const archiveKey = this.getArchiveKey(agentId);
      await this.memory.store(
        archiveKey,
        {
          ...entry,
          archivedAt: /* @__PURE__ */ new Date(),
          reason: "agent_removed"
        },
        {
          type: "agent-archive",
          tags: [...entry.tags, "archived"],
          partition: "archived"
        }
      );
    }
    const key = this.getAgentKey(agentId);
    await this.memory.deleteEntry(key);
    this.cache.delete(agentId);
    this.emit("agent:unregistered", { agentId, preserved: preserveHistory });
  }
  /**
   * Get agent by ID
   */
  async getAgent(agentId) {
    const entry = await this.getAgentEntry(agentId);
    return entry?.agent || null;
  }
  /**
   * Get agent entry with metadata
   */
  async getAgentEntry(agentId) {
    if (this.cache.has(agentId) && this.isCacheValid()) {
      return this.cache.get(agentId) || null;
    }
    const key = this.getAgentKey(agentId);
    const memoryEntry = await this.memory.retrieve(key);
    if (memoryEntry && memoryEntry.value) {
      const registryEntry = memoryEntry.value;
      this.cache.set(agentId, registryEntry);
      return registryEntry;
    }
    return null;
  }
  /**
   * Query agents by criteria
   */
  async queryAgents(query = {}) {
    await this.refreshCacheIfNeeded();
    let agents = Array.from(this.cache.values()).map((entry) => entry.agent);
    if (query.type) {
      agents = agents.filter((agent) => agent.type === query.type);
    }
    if (query.status) {
      agents = agents.filter((agent) => agent.status === query.status);
    }
    if (query.healthThreshold !== void 0) {
      agents = agents.filter((agent) => agent.health >= query.healthThreshold);
    }
    if (query.namePattern) {
      const pattern = new RegExp(query.namePattern, "i");
      agents = agents.filter((agent) => pattern.test(agent.name));
    }
    if (query.tags && query.tags.length > 0) {
      const entries = Array.from(this.cache.values());
      const matchingEntries = entries.filter(
        (entry) => query.tags.some((tag) => entry.tags.includes(tag))
      );
      agents = matchingEntries.map((entry) => entry.agent);
    }
    if (query.createdAfter) {
      const entries = Array.from(this.cache.values());
      const matchingEntries = entries.filter((entry) => entry.createdAt >= query.createdAfter);
      agents = matchingEntries.map((entry) => entry.agent);
    }
    if (query.lastActiveAfter) {
      agents = agents.filter((agent) => agent.metrics.lastActivity >= query.lastActiveAfter);
    }
    return agents;
  }
  /**
   * Get all registered agents
   */
  async getAllAgents() {
    return this.queryAgents();
  }
  /**
   * Get agents by type
   */
  async getAgentsByType(type) {
    return this.queryAgents({ type });
  }
  /**
   * Get agents by status
   */
  async getAgentsByStatus(status) {
    return this.queryAgents({ status });
  }
  /**
   * Get healthy agents
   */
  async getHealthyAgents(threshold = 0.7) {
    return this.queryAgents({ healthThreshold: threshold });
  }
  /**
   * Get registry statistics
   */
  async getStatistics() {
    const agents = await this.getAllAgents();
    const stats = {
      totalAgents: agents.length,
      byType: {},
      byStatus: {},
      averageHealth: 0,
      activeAgents: 0,
      totalUptime: 0,
      tasksCompleted: 0,
      successRate: 0
    };
    if (agents.length === 0) {
      return stats;
    }
    for (const agent of agents) {
      stats.byType[agent.type] = (stats.byType[agent.type] || 0) + 1;
      stats.byStatus[agent.status] = (stats.byStatus[agent.status] || 0) + 1;
      if (agent.status === "idle" || agent.status === "busy") {
        stats.activeAgents++;
      }
      stats.totalUptime += agent.metrics.totalUptime;
      stats.tasksCompleted += agent.metrics.tasksCompleted;
    }
    stats.averageHealth = agents.reduce((sum, agent) => sum + agent.health, 0) / agents.length;
    const totalTasks = agents.reduce(
      (sum, agent) => sum + agent.metrics.tasksCompleted + agent.metrics.tasksFailed,
      0
    );
    if (totalTasks > 0) {
      stats.successRate = stats.tasksCompleted / totalTasks;
    }
    return stats;
  }
  /**
   * Search agents by capabilities
   */
  async searchByCapabilities(requiredCapabilities) {
    const agents = await this.getAllAgents();
    return agents.filter((agent) => {
      const capabilities = [
        ...agent.capabilities.languages,
        ...agent.capabilities.frameworks,
        ...agent.capabilities.domains,
        ...agent.capabilities.tools
      ];
      return requiredCapabilities.every(
        (required) => capabilities.some((cap) => cap.toLowerCase().includes(required.toLowerCase()))
      );
    });
  }
  /**
   * Find best agent for task
   */
  async findBestAgent(taskType, requiredCapabilities = [], preferredAgent) {
    let candidates = await this.getHealthyAgents(0.5);
    if (requiredCapabilities.length > 0) {
      candidates = await this.searchByCapabilities(requiredCapabilities);
    }
    if (preferredAgent) {
      const preferred = candidates.find(
        (agent) => agent.id.id === preferredAgent || agent.name === preferredAgent
      );
      if (preferred)
        return preferred;
    }
    candidates = candidates.filter(
      (agent) => agent.status === "idle" && agent.workload < 0.8 && agent.capabilities.maxConcurrentTasks > 0
    );
    if (candidates.length === 0)
      return null;
    const scored = candidates.map((agent) => ({
      agent,
      score: this.calculateAgentScore(agent, taskType, requiredCapabilities)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agent || null;
  }
  /**
   * Store agent coordination data
   */
  async storeCoordinationData(agentId, data) {
    const key = `coordination:${agentId}`;
    await this.memory.store(
      key,
      {
        agentId,
        data,
        timestamp: /* @__PURE__ */ new Date()
      },
      {
        type: "agent-coordination",
        tags: ["coordination", agentId],
        partition: this.namespace
      }
    );
  }
  /**
   * Retrieve agent coordination data
   */
  async getCoordinationData(agentId) {
    const key = `coordination:${agentId}`;
    const result = await this.memory.retrieve(key);
    return result?.value || null;
  }
  // === PRIVATE METHODS ===
  async loadFromMemory() {
    try {
      const entries = await this.memory.query({
        type: "state",
        namespace: this.namespace
      });
      this.cache.clear();
      for (const entry of entries) {
        if (entry.value && entry.value.agent) {
          this.cache.set(entry.value.agent.id.id, entry.value);
        }
      }
      this.lastCacheUpdate = Date.now();
    } catch (error) {
      console.warn("Failed to load agent registry from memory:", error);
    }
  }
  async refreshCacheIfNeeded() {
    if (!this.isCacheValid()) {
      await this.loadFromMemory();
    }
  }
  isCacheValid() {
    return Date.now() - this.lastCacheUpdate < this.cacheExpiry;
  }
  getAgentKey(agentId) {
    return `agent:${agentId}`;
  }
  getArchiveKey(agentId) {
    return `archived:${agentId}:${Date.now()}`;
  }
  calculateAgentScore(agent, taskType, requiredCapabilities) {
    let score = 0;
    score += agent.health * 40;
    score += agent.metrics.successRate * 30;
    const availability = 1 - agent.workload;
    score += availability * 20;
    if (requiredCapabilities.length > 0) {
      const agentCaps = [
        ...agent.capabilities.languages,
        ...agent.capabilities.frameworks,
        ...agent.capabilities.domains,
        ...agent.capabilities.tools
      ];
      const matches = requiredCapabilities.filter(
        (required) => agentCaps.some((cap) => cap.toLowerCase().includes(required.toLowerCase()))
      );
      score += matches.length / requiredCapabilities.length * 10;
    }
    return score;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentRegistry
});
//# sourceMappingURL=agent-registry.js.map
