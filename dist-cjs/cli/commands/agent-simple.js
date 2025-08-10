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
var agent_simple_exports = {};
__export(agent_simple_exports, {
  agentCommands: () => agentCommands,
  agentHealth: () => agentHealth,
  agentInfo: () => agentInfo,
  listAgents: () => listAgents,
  restartAgent: () => restartAgent,
  spawnAgent: () => spawnAgent,
  startAgent: () => startAgent,
  terminateAgent: () => terminateAgent
});
module.exports = __toCommonJS(agent_simple_exports);
var import_agent_manager = require("../../agents/agent-manager.js");
var import_agent_registry = require("../../agents/agent-registry.js");
var import_distributed_memory = require("../../memory/distributed-memory.js");
var import_event_bus = require("../../core/event-bus.js");
var import_logger = require("../../core/logger.js");
let agentManager = null;
let agentRegistry = null;
async function initializeAgentSystem() {
  if (agentManager && agentRegistry) {
    return { manager: agentManager, registry: agentRegistry };
  }
  try {
    const logger = new import_logger.Logger({
      level: "info",
      format: "text",
      destination: "console"
    });
    const eventBus = import_event_bus.EventBus.getInstance();
    const memorySystem = new import_distributed_memory.DistributedMemorySystem(
      {
        namespace: "agents",
        distributed: false,
        consistency: "eventual",
        replicationFactor: 1,
        syncInterval: 6e4,
        maxMemorySize: 100,
        compressionEnabled: false,
        encryptionEnabled: false,
        backupEnabled: true,
        persistenceEnabled: true,
        shardingEnabled: false,
        cacheSize: 50,
        cacheTtl: 3e5
      },
      logger,
      eventBus
    );
    await memorySystem.initialize();
    agentRegistry = new import_agent_registry.AgentRegistry(memorySystem, "agents");
    await agentRegistry.initialize();
    agentManager = new import_agent_manager.AgentManager(
      {
        maxAgents: 50,
        defaultTimeout: 6e4,
        heartbeatInterval: 15e3,
        healthCheckInterval: 3e4,
        autoRestart: true,
        resourceLimits: {
          memory: 1024 * 1024 * 1024,
          // 1GB
          cpu: 2,
          disk: 2 * 1024 * 1024 * 1024
          // 2GB
        }
      },
      logger,
      eventBus,
      memorySystem
    );
    await agentManager.initialize();
    return { manager: agentManager, registry: agentRegistry };
  } catch (error) {
    throw new Error(
      `Failed to initialize agent system: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
__name(initializeAgentSystem, "initializeAgentSystem");
const agentCommands = {
  async spawn(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      const templateName = args[0] || "researcher";
      const name = options.name || `${templateName}-${Date.now().toString(36)}`;
      console.log(`\u{1F680} Creating agent with template: ${templateName}`);
      const agentId = await manager.createAgent(templateName, {
        name,
        config: {
          autonomyLevel: options.autonomy || 0.7,
          maxConcurrentTasks: options.maxTasks || 5,
          timeoutThreshold: options.timeout || 3e5
        }
      });
      if (options.start !== false) {
        console.log("\u26A1 Starting agent...");
        await manager.startAgent(agentId);
      }
      console.log("\u2705 Agent created successfully!");
      console.log(`   ID: ${agentId}`);
      console.log(`   Name: ${name}`);
      console.log(`   Template: ${templateName}`);
    } catch (error) {
      console.error(
        "\u274C Error creating agent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async list(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      let agents = manager.getAllAgents();
      if (options.type) {
        agents = agents.filter((agent) => agent.type === options.type);
      }
      if (options.status) {
        agents = agents.filter((agent) => agent.status === options.status);
      }
      if (options.unhealthy) {
        agents = agents.filter((agent) => agent.health < 0.7);
      }
      if (agents.length === 0) {
        console.log("\u{1F4CB} No agents found matching the criteria");
        return;
      }
      console.log(`\u{1F916} Agent List (${agents.length} agents)`);
      console.log("=".repeat(60));
      for (const agent of agents) {
        const healthEmoji = agent.health > 0.8 ? "\u{1F7E2}" : agent.health > 0.5 ? "\u{1F7E1}" : "\u{1F534}";
        const statusEmoji = agent.status === "idle" ? "\u2B55" : agent.status === "busy" ? "\u{1F535}" : agent.status === "error" ? "\u{1F534}" : "\u26AA";
        console.log(`${healthEmoji} ${agent.name}`);
        console.log(`   ID: ${agent.id.id.slice(-8)}`);
        console.log(`   Type: ${agent.type}`);
        console.log(`   Status: ${statusEmoji} ${agent.status.toUpperCase()}`);
        console.log(`   Health: ${Math.round(agent.health * 100)}%`);
        console.log(`   Workload: ${agent.workload} tasks`);
        if (options.detailed) {
          console.log(`   Tasks Completed: ${agent.metrics.tasksCompleted}`);
          console.log(`   Success Rate: ${Math.round(agent.metrics.successRate * 100)}%`);
          console.log(`   Memory: ${Math.round(agent.metrics.memoryUsage / 1024 / 1024)}MB`);
        }
        console.log("");
      }
      const stats = manager.getSystemStats();
      console.log("\u{1F4CA} System Overview:");
      console.log(
        `   Total: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`
      );
      console.log(`   Average Health: ${Math.round(stats.averageHealth * 100)}%`);
    } catch (error) {
      console.error(
        "\u274C Error listing agents:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async info(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      const agentId = args[0];
      if (!agentId) {
        console.error("\u274C Agent ID is required");
        console.log("Usage: agent info <agent-id>");
        return;
      }
      const agent = manager.getAgent(agentId);
      if (!agent) {
        console.error(`\u274C Agent '${agentId}' not found`);
        const allAgents = manager.getAllAgents();
        const similar = allAgents.filter(
          (a) => a.id.id.includes(agentId) || a.name.toLowerCase().includes(agentId.toLowerCase())
        );
        if (similar.length > 0) {
          console.log("\\nDid you mean one of these agents?");
          similar.forEach((a) => console.log(`  ${a.id.id} - ${a.name}`));
        }
        return;
      }
      console.log(`\u{1F916} Agent Information: ${agent.name}`);
      console.log("=".repeat(50));
      console.log(`ID: ${agent.id.id}`);
      console.log(`Name: ${agent.name}`);
      console.log(`Type: ${agent.type}`);
      console.log(`Status: ${agent.status.toUpperCase()}`);
      console.log(`Health: ${Math.round(agent.health * 100)}%`);
      console.log(`Workload: ${agent.workload} active tasks`);
      console.log("\\n\u2699\uFE0F Configuration:");
      console.log(`  Autonomy Level: ${agent.config.autonomyLevel}`);
      console.log(`  Max Concurrent Tasks: ${agent.config.maxConcurrentTasks}`);
      console.log(`  Timeout Threshold: ${agent.config.timeoutThreshold}ms`);
      console.log(`  Runtime: ${agent.environment.runtime}`);
      console.log("\\n\u{1F4CA} Performance Metrics:");
      console.log(`  Tasks Completed: ${agent.metrics.tasksCompleted}`);
      console.log(`  Tasks Failed: ${agent.metrics.tasksFailed}`);
      console.log(`  Success Rate: ${Math.round(agent.metrics.successRate * 100)}%`);
      console.log(`  Average Execution Time: ${agent.metrics.averageExecutionTime}ms`);
      console.log(`  Memory Usage: ${Math.round(agent.metrics.memoryUsage / 1024 / 1024)}MB`);
      console.log(`  CPU Usage: ${Math.round(agent.metrics.cpuUsage * 100)}%`);
      const health = manager.getAgentHealth(agentId);
      if (health) {
        console.log("\\n\u{1F3E5} Health Details:");
        console.log(`  Responsiveness: ${Math.round(health.components.responsiveness * 100)}%`);
        console.log(`  Performance: ${Math.round(health.components.performance * 100)}%`);
        console.log(`  Reliability: ${Math.round(health.components.reliability * 100)}%`);
        console.log(`  Resource Usage: ${Math.round(health.components.resourceUsage * 100)}%`);
        if (health.issues.length > 0) {
          console.log("\\n\u26A0\uFE0F Active Issues:");
          health.issues.forEach((issue, index) => {
            console.log(`  ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
          });
        }
      }
      console.log("\\n\u{1F6E0}\uFE0F Capabilities:");
      console.log(`  Code Generation: ${agent.capabilities.codeGeneration ? "\u2705" : "\u274C"}`);
      console.log(`  Code Review: ${agent.capabilities.codeReview ? "\u2705" : "\u274C"}`);
      console.log(`  Testing: ${agent.capabilities.testing ? "\u2705" : "\u274C"}`);
      console.log(`  Research: ${agent.capabilities.research ? "\u2705" : "\u274C"}`);
      console.log(`  Web Search: ${agent.capabilities.webSearch ? "\u2705" : "\u274C"}`);
      if (agent.capabilities.languages.length > 0) {
        console.log(`  Languages: ${agent.capabilities.languages.join(", ")}`);
      }
      if (agent.capabilities.frameworks.length > 0) {
        console.log(`  Frameworks: ${agent.capabilities.frameworks.join(", ")}`);
      }
    } catch (error) {
      console.error(
        "\u274C Error getting agent info:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async terminate(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      const agentId = args[0];
      if (!agentId) {
        console.error("\u274C Agent ID is required");
        console.log("Usage: agent terminate <agent-id>");
        return;
      }
      const agent = manager.getAgent(agentId);
      if (!agent) {
        console.error(`\u274C Agent '${agentId}' not found`);
        return;
      }
      console.log(`\u{1F6D1} Terminating agent: ${agent.name} (${agentId})`);
      const reason = options.reason || "user_request";
      if (options.force) {
        console.log("\u26A1 Force terminating agent...");
      } else {
        console.log("\u{1F504} Gracefully shutting down agent...");
      }
      await manager.stopAgent(agentId, reason);
      if (options.cleanup) {
        console.log("\u{1F9F9} Cleaning up agent data...");
        await manager.removeAgent(agentId);
      }
      console.log("\u2705 Agent terminated successfully");
      if (agent.metrics) {
        console.log("\\n\u{1F4C8} Final Statistics:");
        console.log(`  Tasks Completed: ${agent.metrics.tasksCompleted}`);
        console.log(`  Success Rate: ${Math.round(agent.metrics.successRate * 100)}%`);
        console.log(`  Total Uptime: ${Math.round(agent.metrics.totalUptime / 1e3)}s`);
      }
    } catch (error) {
      console.error(
        "\u274C Error terminating agent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async start(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      const agentId = args[0];
      if (!agentId) {
        console.error("\u274C Agent ID is required");
        console.log("Usage: agent start <agent-id>");
        return;
      }
      console.log(`\u{1F680} Starting agent ${agentId}...`);
      await manager.startAgent(agentId);
      console.log("\u2705 Agent started successfully");
    } catch (error) {
      console.error(
        "\u274C Error starting agent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async restart(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      const agentId = args[0];
      if (!agentId) {
        console.error("\u274C Agent ID is required");
        console.log("Usage: agent restart <agent-id>");
        return;
      }
      console.log(`\u{1F504} Restarting agent ${agentId}...`);
      const reason = options.reason || "manual_restart";
      await manager.restartAgent(agentId, reason);
      console.log("\u2705 Agent restarted successfully");
    } catch (error) {
      console.error(
        "\u274C Error restarting agent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async health(args, options = {}) {
    try {
      const { manager } = await initializeAgentSystem();
      const agents = manager.getAllAgents();
      const stats = manager.getSystemStats();
      const threshold = options.threshold || 0.7;
      console.log("\u{1F3E5} Agent Health Dashboard");
      console.log("=".repeat(50));
      console.log(`Time: ${(/* @__PURE__ */ new Date()).toLocaleString()}`);
      console.log(
        `Total Agents: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`
      );
      console.log(`Average Health: ${Math.round(stats.averageHealth * 100)}%`);
      const unhealthyAgents = agents.filter((a) => a.health < threshold);
      if (unhealthyAgents.length > 0) {
        console.log(
          `\\n\u26A0\uFE0F ${unhealthyAgents.length} agents below health threshold (${Math.round(threshold * 100)}%):`
        );
        unhealthyAgents.forEach((agent) => {
          const healthPercent = Math.round(agent.health * 100);
          console.log(`  \u{1F534} ${agent.name}: ${healthPercent}% (${agent.status})`);
        });
      } else {
        console.log("\\n\u2705 All agents are healthy!");
      }
      console.log("\\n\u{1F4BB} Resource Utilization:");
      console.log(`  CPU: ${Math.round(stats.resourceUtilization.cpu * 100)}%`);
      console.log(`  Memory: ${Math.round(stats.resourceUtilization.memory / 1024 / 1024)}MB`);
      console.log(`  Disk: ${Math.round(stats.resourceUtilization.disk / 1024 / 1024)}MB`);
    } catch (error) {
      console.error(
        "\u274C Error getting health status:",
        error instanceof Error ? error.message : String(error)
      );
    }
  },
  async help() {
    console.log("\u{1F916} Agent Management Commands:");
    console.log("");
    console.log("Available commands:");
    console.log("  spawn <template>     - Create and start new agents");
    console.log("  list                 - Display all agents with status");
    console.log("  info <agent-id>      - Get detailed agent information");
    console.log("  terminate <agent-id> - Safely terminate agents");
    console.log("  start <agent-id>     - Start a created agent");
    console.log("  restart <agent-id>   - Restart an agent");
    console.log("  health               - Monitor agent health");
    console.log("");
    console.log("Common options:");
    console.log("  --type <type>        - Filter by agent type");
    console.log("  --status <status>    - Filter by agent status");
    console.log("  --detailed           - Show detailed information");
    console.log("  --force              - Force operation");
    console.log("  --cleanup            - Clean up data after operation");
    console.log("");
    console.log("Examples:");
    console.log('  agent spawn researcher --name "research-bot"');
    console.log("  agent list --type researcher --detailed");
    console.log("  agent info agent-123");
    console.log("  agent terminate agent-123 --cleanup");
    console.log("  agent health --threshold 0.8");
  }
};
const {
  spawn: spawnAgent,
  list: listAgents,
  info: agentInfo,
  terminate: terminateAgent,
  start: startAgent,
  restart: restartAgent,
  health: agentHealth
} = agentCommands;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  agentCommands,
  agentHealth,
  agentInfo,
  listAgents,
  restartAgent,
  spawnAgent,
  startAgent,
  terminateAgent
});
//# sourceMappingURL=agent-simple.js.map
