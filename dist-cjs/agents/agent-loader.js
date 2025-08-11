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
var agent_loader_exports = {};
__export(agent_loader_exports, {
  LEGACY_AGENT_MAPPING: () => LEGACY_AGENT_MAPPING,
  agentLoader: () => agentLoader,
  getAgent: () => getAgent,
  getAgentCategories: () => getAgentCategories,
  getAgentsByCategory: () => getAgentsByCategory,
  getAllAgents: () => getAllAgents,
  getAvailableAgentTypes: () => getAvailableAgentTypes,
  isValidAgentType: () => isValidAgentType,
  refreshAgents: () => refreshAgents,
  resolveLegacyAgentType: () => resolveLegacyAgentType,
  searchAgents: () => searchAgents
});
module.exports = __toCommonJS(agent_loader_exports);
var import_node_fs = require("node:fs");
var import_glob = require("glob");
var import_node_path = require("node:path");
var import_yaml = require("yaml");
const LEGACY_AGENT_MAPPING = {
  analyst: "code-analyzer",
  coordinator: "task-orchestrator",
  optimizer: "perf-analyzer",
  documenter: "api-docs",
  monitor: "performance-benchmarker",
  specialist: "system-architect",
  architect: "system-architect"
};
function resolveLegacyAgentType(legacyType) {
  return LEGACY_AGENT_MAPPING[legacyType] || legacyType;
}
__name(resolveLegacyAgentType, "resolveLegacyAgentType");
class AgentLoader {
  static {
    __name(this, "AgentLoader");
  }
  agentCache = /* @__PURE__ */ new Map();
  categoriesCache = [];
  lastLoadTime = 0;
  cacheExpiry = 6e4;
  // 1 minute cache
  /**
   * Get the .claude/agents directory path
   */
  getAgentsDirectory() {
    let currentDir = process.cwd();
    while (currentDir !== "/") {
      const claudeAgentsPath = (0, import_node_path.resolve)(currentDir, ".claude", "agents");
      if ((0, import_node_fs.existsSync)(claudeAgentsPath)) {
        return claudeAgentsPath;
      }
      currentDir = (0, import_node_path.dirname)(currentDir);
    }
    return (0, import_node_path.resolve)(process.cwd(), ".claude", "agents");
  }
  /**
   * Parse agent definition from markdown file
   */
  parseAgentFile(filePath) {
    try {
      const content = (0, import_node_fs.readFileSync)(filePath, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!frontmatterMatch) {
        console.warn(`No frontmatter found in ${filePath}`);
        return null;
      }
      const [, yamlContent, markdownContent] = frontmatterMatch;
      const frontmatter = (0, import_yaml.parse)(yamlContent);
      if (!frontmatter.name || !frontmatter.metadata?.description) {
        console.warn(`Missing required fields (name, metadata.description) in ${filePath}`);
        return null;
      }
      return {
        name: frontmatter.name,
        type: frontmatter.type,
        color: frontmatter.color,
        description: frontmatter.metadata.description,
        capabilities: frontmatter.metadata.capabilities || frontmatter.capabilities || [],
        priority: frontmatter.priority || "medium",
        hooks: frontmatter.hooks,
        content: markdownContent.trim()
      };
    } catch (error) {
      console.error(`Error parsing agent file ${filePath}:`, error);
      return null;
    }
  }
  /**
   * Load all agent definitions from .claude/agents directory
   */
  async loadAgents() {
    const agentsDir = this.getAgentsDirectory();
    if (!(0, import_node_fs.existsSync)(agentsDir)) {
      console.warn(`Agents directory not found: ${agentsDir}`);
      return;
    }
    const agentFiles = await (0, import_glob.glob)("**/*.md", {
      cwd: agentsDir,
      ignore: ["**/README.md", "**/MIGRATION_SUMMARY.md"],
      absolute: true
    });
    this.agentCache.clear();
    this.categoriesCache = [];
    const categoryMap = /* @__PURE__ */ new Map();
    for (const filePath of agentFiles) {
      const agent = this.parseAgentFile(filePath);
      if (agent) {
        this.agentCache.set(agent.name, agent);
        const relativePath = filePath.replace(agentsDir, "");
        const pathParts = relativePath.split("/");
        const category = pathParts[1] || "uncategorized";
        if (!categoryMap.has(category)) {
          categoryMap.set(category, []);
        }
        categoryMap.get(category).push(agent);
      }
    }
    this.categoriesCache = Array.from(categoryMap.entries()).map(([name, agents]) => ({
      name,
      agents: agents.sort((a, b) => a.name.localeCompare(b.name))
    }));
    this.lastLoadTime = Date.now();
  }
  /**
   * Check if cache needs refresh
   */
  needsRefresh() {
    return Date.now() - this.lastLoadTime > this.cacheExpiry;
  }
  /**
   * Ensure agents are loaded and cache is fresh
   */
  async ensureLoaded() {
    if (this.agentCache.size === 0 || this.needsRefresh()) {
      await this.loadAgents();
    }
  }
  /**
   * Get all available agent types
   */
  async getAvailableAgentTypes() {
    await this.ensureLoaded();
    const currentTypes = Array.from(this.agentCache.keys());
    const legacyTypes = Object.keys(LEGACY_AGENT_MAPPING);
    const combined = [...currentTypes, ...legacyTypes];
    const uniqueTypes = Array.from(new Set(combined));
    return uniqueTypes.sort();
  }
  /**
   * Get agent definition by name
   */
  async getAgent(name) {
    await this.ensureLoaded();
    return this.agentCache.get(name) || this.agentCache.get(resolveLegacyAgentType(name)) || null;
  }
  /**
   * Get all agent definitions
   */
  async getAllAgents() {
    await this.ensureLoaded();
    return Array.from(this.agentCache.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * Get agents organized by category
   */
  async getAgentCategories() {
    await this.ensureLoaded();
    return this.categoriesCache;
  }
  /**
   * Search agents by capabilities, description, or name
   */
  async searchAgents(query) {
    await this.ensureLoaded();
    const lowerQuery = query.toLowerCase();
    return Array.from(this.agentCache.values()).filter((agent) => {
      return agent.name.toLowerCase().includes(lowerQuery) || agent.description.toLowerCase().includes(lowerQuery) || agent.capabilities?.some((cap) => cap.toLowerCase().includes(lowerQuery)) || false;
    });
  }
  /**
   * Check if an agent type is valid
   */
  async isValidAgentType(name) {
    await this.ensureLoaded();
    return this.agentCache.has(name) || this.agentCache.has(resolveLegacyAgentType(name));
  }
  /**
   * Get agents by category name
   */
  async getAgentsByCategory(category) {
    const categories = await this.getAgentCategories();
    const found = categories.find((cat) => cat.name === category);
    return found?.agents || [];
  }
  /**
   * Force refresh the agent cache
   */
  async refresh() {
    this.lastLoadTime = 0;
    await this.loadAgents();
  }
}
const agentLoader = new AgentLoader();
const getAvailableAgentTypes = /* @__PURE__ */ __name(() => agentLoader.getAvailableAgentTypes(), "getAvailableAgentTypes");
const getAgent = /* @__PURE__ */ __name((name) => agentLoader.getAgent(name), "getAgent");
const getAllAgents = /* @__PURE__ */ __name(() => agentLoader.getAllAgents(), "getAllAgents");
const getAgentCategories = /* @__PURE__ */ __name(() => agentLoader.getAgentCategories(), "getAgentCategories");
const searchAgents = /* @__PURE__ */ __name((query) => agentLoader.searchAgents(query), "searchAgents");
const isValidAgentType = /* @__PURE__ */ __name((name) => agentLoader.isValidAgentType(name), "isValidAgentType");
const getAgentsByCategory = /* @__PURE__ */ __name((category) => agentLoader.getAgentsByCategory(category), "getAgentsByCategory");
const refreshAgents = /* @__PURE__ */ __name(() => agentLoader.refresh(), "refreshAgents");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LEGACY_AGENT_MAPPING,
  agentLoader,
  getAgent,
  getAgentCategories,
  getAgentsByCategory,
  getAllAgents,
  getAvailableAgentTypes,
  isValidAgentType,
  refreshAgents,
  resolveLegacyAgentType,
  searchAgents
});
//# sourceMappingURL=agent-loader.js.map
