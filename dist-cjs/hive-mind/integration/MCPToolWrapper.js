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
var MCPToolWrapper_exports = {};
__export(MCPToolWrapper_exports, {
  MCPToolWrapper: () => MCPToolWrapper
});
module.exports = __toCommonJS(MCPToolWrapper_exports);
var import_events = require("events");
var import_child_process = require("child_process");
var import_util = require("util");
var import_type_guards = require("../../utils/type-guards.js");
const execAsync = (0, import_util.promisify)(import_child_process.exec);
class MCPToolWrapper extends import_events.EventEmitter {
  static {
    __name(this, "MCPToolWrapper");
  }
  toolPrefix = "mcp__ruv-swarm__";
  isInitialized = false;
  constructor() {
    super();
  }
  /**
   * Initialize MCP tools
   */
  async initialize() {
    try {
      await this.checkToolAvailability();
      this.isInitialized = true;
      this.emit("initialized");
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }
  /**
   * Check if MCP tools are available
   */
  async checkToolAvailability() {
    try {
      const { stdout } = await execAsync("npx ruv-swarm --version");
      if (!stdout) {
        throw new Error("ruv-swarm MCP tools not found");
      }
    } catch (error) {
      throw new Error("MCP tools not available. Please ensure ruv-swarm is installed.");
    }
  }
  /**
   * Execute MCP tool via CLI
   */
  async executeTool(toolName, params) {
    try {
      const command = `npx ruv-swarm mcp-execute ${toolName} '${JSON.stringify(params)}'`;
      const { stdout, stderr } = await execAsync(command);
      if (stderr) {
        return { success: false, error: stderr };
      }
      const result = JSON.parse(stdout);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (0, import_type_guards.getErrorMessage)(error) };
    }
  }
  // Swarm coordination tools
  async initSwarm(params) {
    return this.executeTool("swarm_init", params);
  }
  async spawnAgent(params) {
    return this.executeTool("agent_spawn", params);
  }
  async orchestrateTask(params) {
    return this.executeTool("task_orchestrate", params);
  }
  async getSwarmStatus(swarmId) {
    return this.executeTool("swarm_status", { swarmId });
  }
  async monitorSwarm(params) {
    return this.executeTool("swarm_monitor", params);
  }
  // Neural and pattern tools
  async analyzePattern(params) {
    return this.executeTool("neural_patterns", params);
  }
  async trainNeural(params) {
    return this.executeTool("neural_train", params);
  }
  async predict(params) {
    return this.executeTool("neural_predict", params);
  }
  async getNeuralStatus(modelId) {
    return this.executeTool("neural_status", { modelId });
  }
  // Memory management tools
  async storeMemory(params) {
    return this.executeTool("memory_usage", params);
  }
  async retrieveMemory(params) {
    const result = await this.executeTool("memory_usage", params);
    return result.success ? result.data : null;
  }
  async searchMemory(params) {
    return this.executeTool("memory_search", params);
  }
  async deleteMemory(params) {
    return this.executeTool("memory_usage", params);
  }
  async listMemory(params) {
    return this.executeTool("memory_usage", params);
  }
  // Performance and monitoring tools
  async getPerformanceReport(params) {
    return this.executeTool("performance_report", params || {});
  }
  async analyzeBottlenecks(params) {
    return this.executeTool("bottleneck_analyze", params || {});
  }
  async getTokenUsage(params) {
    return this.executeTool("token_usage", params || {});
  }
  // Agent management tools
  async listAgents(swarmId) {
    return this.executeTool("agent_list", { swarmId });
  }
  async getAgentMetrics(agentId) {
    return this.executeTool("agent_metrics", { agentId });
  }
  // Task management tools
  async getTaskStatus(taskId) {
    return this.executeTool("task_status", { taskId });
  }
  async getTaskResults(taskId) {
    return this.executeTool("task_results", { taskId });
  }
  // Advanced coordination tools
  async optimizeTopology(swarmId) {
    return this.executeTool("topology_optimize", { swarmId });
  }
  async loadBalance(params) {
    return this.executeTool("load_balance", params);
  }
  async syncCoordination(swarmId) {
    return this.executeTool("coordination_sync", { swarmId });
  }
  async scaleSwarm(params) {
    return this.executeTool("swarm_scale", params);
  }
  // SPARC mode integration
  async runSparcMode(params) {
    return this.executeTool("sparc_mode", params);
  }
  // Workflow tools
  async createWorkflow(params) {
    return this.executeTool("workflow_create", params);
  }
  async executeWorkflow(params) {
    return this.executeTool("workflow_execute", params);
  }
  // GitHub integration tools
  async analyzeRepository(params) {
    return this.executeTool("github_repo_analyze", params);
  }
  async manageGitHubPR(params) {
    return this.executeTool("github_pr_manage", params);
  }
  // Dynamic Agent Architecture tools
  async createDynamicAgent(params) {
    return this.executeTool("daa_agent_create", params);
  }
  async matchCapabilities(params) {
    return this.executeTool("daa_capability_match", params);
  }
  // System tools
  async runBenchmark(suite) {
    return this.executeTool("benchmark_run", { suite });
  }
  async collectMetrics(components) {
    return this.executeTool("metrics_collect", { components });
  }
  async analyzeTrends(params) {
    return this.executeTool("trend_analysis", params);
  }
  async analyzeCost(timeframe) {
    return this.executeTool("cost_analysis", { timeframe });
  }
  async assessQuality(params) {
    return this.executeTool("quality_assess", params);
  }
  async healthCheck(components) {
    return this.executeTool("health_check", { components });
  }
  // Batch operations
  async batchProcess(params) {
    return this.executeTool("batch_process", params);
  }
  async parallelExecute(tasks) {
    return this.executeTool("parallel_execute", { tasks });
  }
  /**
   * Generic tool execution for custom tools
   */
  async executeMCPTool(toolName, params) {
    return this.executeTool(toolName, params);
  }
  /**
   * Helper to format tool responses
   */
  formatResponse(response) {
    if (response.success) {
      return response.data;
    } else {
      throw new Error(`MCP Tool Error: ${response.error}`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MCPToolWrapper
});
//# sourceMappingURL=MCPToolWrapper.js.map
