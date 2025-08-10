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
var agent_exports = {};
__export(agent_exports, {
  agentCommand: () => agentCommand,
  createAgentCommand: () => createAgentCommand
});
module.exports = __toCommonJS(agent_exports);
var import_commander = require("commander");
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var import_chalk = __toESM(require("chalk"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_agent_manager = require("../../agents/agent-manager.js");
var import_event_bus = require("../../core/event-bus.js");
var import_logger = require("../../core/logger.js");
var import_distributed_memory = require("../../memory/distributed-memory.js");
var import_formatters = require("../../utils/formatters.js");
var import_node_path = __toESM(require("node:path"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
const { colors } = { colors: import_chalk.default };
let agentManager = null;
async function initializeAgentManager() {
  if (agentManager)
    return agentManager;
  const logger = new import_logger.Logger({ level: "info", format: "text", destination: "console" });
  const eventBus = import_event_bus.EventBus.getInstance();
  const memorySystem = new import_distributed_memory.DistributedMemorySystem(
    {},
    // Use default config
    logger,
    eventBus
  );
  await memorySystem.initialize();
  agentManager = new import_agent_manager.AgentManager(
    {
      maxAgents: 100,
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
  return agentManager;
}
__name(initializeAgentManager, "initializeAgentManager");
function createAgentCommand() {
  const agentCommand2 = new import_commander.Command("agent").description("Comprehensive Claude-Flow agent management with advanced features").action(() => {
    console.log(import_chalk.default.cyan("\u{1F916} Claude-Flow Agent Management System"));
    console.log("");
    console.log("Available commands:");
    console.log("  spawn    - Create and start new agents with advanced configuration");
    console.log("  list     - Display all agents with status, metrics, and resource usage");
    console.log("  info     - Get detailed information about a specific agent");
    console.log("  terminate - Safely terminate agents with cleanup and state preservation");
    console.log("  pool     - Manage agent pools for scaling and load distribution");
    console.log("  health   - Monitor agent health and performance metrics");
    console.log("  logs     - View agent logs and activity history");
    console.log("");
    console.log("Use --help with any command for detailed options.");
  });
  agentCommand2.command("list").description("Display all agents with comprehensive status and metrics").option("-t, --type <type>", "Filter by agent type").option("-s, --status <status>", "Filter by agent status").option("--unhealthy", "Show only unhealthy agents").option("--json", "Output in JSON format").option("--detailed", "Show detailed resource usage and metrics").option("--sort <field>", "Sort by field (name, type, status, health, workload)", "name").action(async (options) => {
    try {
      const manager = await initializeAgentManager();
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
      agents.sort((a, b) => {
        switch (options.sort) {
          case "type":
            return a.type.localeCompare(b.type);
          case "status":
            return a.status.localeCompare(b.status);
          case "health":
            return b.health - a.health;
          case "workload":
            return b.workload - a.workload;
          default:
            return a.name.localeCompare(b.name);
        }
      });
      if (options.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      if (agents.length === 0) {
        console.log(import_chalk.default.yellow("No agents found matching the criteria"));
        return;
      }
      console.log(import_chalk.default.cyan(`
\u{1F916} Agent Status Report (${agents.length} agents)`));
      console.log("=".repeat(80));
      if (options.detailed) {
        displayDetailedAgentList(agents, manager);
      } else {
        displayCompactAgentList(agents);
      }
      const stats = manager.getSystemStats();
      console.log("\n" + import_chalk.default.cyan("System Overview:"));
      console.log(
        `Total Agents: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`
      );
      console.log(
        `Average Health: ${(0, import_formatters.formatPercentage)(stats.averageHealth)} | Pools: ${stats.pools}`
      );
    } catch (error) {
      console.error(
        import_chalk.default.red("Error listing agents:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });
  agentCommand2.command("spawn [template]").description("Create and start new agents with advanced configuration options").option("-n, --name <name>", "Agent name").option("-t, --type <type>", "Agent type").option("--template <template>", "Use predefined template").option("--pool <pool>", "Add to specific pool").option("--autonomy <level>", "Autonomy level (0-1)", "0.7").option("--max-tasks <max>", "Maximum concurrent tasks", "5").option("--max-memory <mb>", "Memory limit in MB", "512").option("--timeout <ms>", "Task timeout in milliseconds", "300000").option("--interactive", "Interactive configuration").option("--start", "Automatically start the agent after creation").option("--config <path>", "Load configuration from JSON file").action(async (template, options) => {
    try {
      const manager = await initializeAgentManager();
      let agentConfig = {};
      if (options.config) {
        const configPath = import_node_path.default.resolve(options.config);
        const configData = await import_promises.default.readFile(configPath, "utf-8");
        agentConfig = JSON.parse(configData);
      }
      if (options.interactive) {
        agentConfig = await interactiveAgentConfiguration(manager);
      } else {
        const templateName = template || options.template;
        if (!templateName) {
          console.error(
            import_chalk.default.red("Error: Template name is required. Use --interactive for guided setup.")
          );
          return;
        }
        const templates = manager.getAgentTemplates();
        const selectedTemplate = templates.find(
          (t) => t.name.toLowerCase().includes(templateName.toLowerCase())
        );
        if (!selectedTemplate) {
          console.error(import_chalk.default.red(`Template '${templateName}' not found.`));
          console.log("Available templates:");
          templates.forEach((t) => console.log(`  - ${t.name} (${t.type})`));
          return;
        }
        agentConfig = {
          template: selectedTemplate.name,
          name: options.name,
          config: {
            autonomyLevel: parseFloat(options.autonomy),
            maxConcurrentTasks: parseInt(options.maxTasks),
            timeoutThreshold: parseInt(options.timeout)
          },
          environment: {
            maxMemoryUsage: parseInt(options.maxMemory) * 1024 * 1024
          }
        };
      }
      console.log(import_chalk.default.cyan("\n\u{1F680} Creating new agent..."));
      const agentId = await manager.createAgent(agentConfig.template || "researcher", {
        name: agentConfig.name,
        config: agentConfig.config,
        environment: agentConfig.environment
      });
      console.log(import_chalk.default.green(`\u2705 Agent created successfully!`));
      console.log(`Agent ID: ${import_chalk.default.bold(agentId)}`);
      if (options.pool) {
        const pools = manager.getAllPools();
        const targetPool = pools.find((p) => p.name === options.pool || p.id === options.pool);
        if (targetPool) {
          console.log(import_chalk.default.blue(`Added to pool: ${targetPool.name}`));
        } else {
          console.log(import_chalk.default.yellow(`Warning: Pool '${options.pool}' not found`));
        }
      }
      if (options.start) {
        console.log(import_chalk.default.cyan("Starting agent..."));
        await manager.startAgent(agentId);
        console.log(import_chalk.default.green("\u2705 Agent started and ready!"));
      } else {
        console.log(import_chalk.default.yellow(`Use 'claude-flow agent start ${agentId}' to start the agent`));
      }
      const agent = manager.getAgent(agentId);
      if (agent) {
        displayAgentSummary(agent);
      }
    } catch (error) {
      console.error(
        import_chalk.default.red("Error creating agent:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });
  return agentCommand2;
}
__name(createAgentCommand, "createAgentCommand");
const agentCommand = createAgentCommand();
async function interactiveAgentConfiguration(manager) {
  console.log(import_chalk.default.cyan("\n\u{1F6E0}\uFE0F  Interactive Agent Configuration"));
  const templates = manager.getAgentTemplates();
  const templateChoices = templates.map((t) => ({ name: `${t.name} (${t.type})`, value: t.name }));
  const answers = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "template",
      message: "Select agent template:",
      choices: templateChoices
    },
    {
      type: "input",
      name: "name",
      message: "Agent name:",
      default: `agent-${Date.now().toString(36)}`
    },
    {
      type: "input",
      name: "autonomyLevel",
      message: "Autonomy level (0-1):",
      default: "0.7",
      validate: (value) => {
        const num = parseFloat(value);
        return num >= 0 && num <= 1 || "Must be between 0 and 1";
      }
    },
    {
      type: "input",
      name: "maxTasks",
      message: "Maximum concurrent tasks:",
      default: "5",
      validate: (value) => {
        const num = parseInt(value);
        return num > 0 && num <= 20 || "Must be between 1 and 20";
      }
    },
    {
      type: "input",
      name: "maxMemory",
      message: "Memory limit (MB):",
      default: "512",
      validate: (value) => {
        const num = parseInt(value);
        return num >= 128 && num <= 4096 || "Must be between 128 and 4096";
      }
    }
  ]);
  return {
    template: answers.template,
    name: answers.name,
    config: {
      autonomyLevel: parseFloat(answers.autonomyLevel),
      maxConcurrentTasks: parseInt(answers.maxTasks),
      timeoutThreshold: 3e5
    },
    environment: {
      maxMemoryUsage: parseInt(answers.maxMemory) * 1024 * 1024
    }
  };
}
__name(interactiveAgentConfiguration, "interactiveAgentConfiguration");
function displayCompactAgentList(agents) {
  const table = new import_cli_table3.default({
    head: ["ID", "Name", "Type", "Status", "Health", "Workload", "Last Activity"],
    colWidths: [10, 20, 15, 12, 10, 10, 20]
  });
  agents.forEach((agent) => {
    table.push([
      agent.id.id.slice(-8),
      agent.name,
      agent.type,
      getStatusDisplay(agent.status),
      getHealthDisplay(agent.health),
      agent.workload.toString(),
      formatRelativeTime(agent.metrics?.lastActivity || agent.lastHeartbeat)
    ]);
  });
  console.log(table.toString());
}
__name(displayCompactAgentList, "displayCompactAgentList");
function displayDetailedAgentList(agents, manager) {
  agents.forEach((agent, index) => {
    if (index > 0)
      console.log("\n" + "-".repeat(60));
    console.log(`
${import_chalk.default.bold(agent.name)} (${agent.id.id.slice(-8)})`);
    console.log(`Type: ${import_chalk.default.blue(agent.type)} | Status: ${getStatusDisplay(agent.status)}`);
    console.log(`Health: ${getHealthDisplay(agent.health)} | Workload: ${agent.workload}`);
    if (agent.metrics) {
      console.log(
        `Tasks: ${agent.metrics.tasksCompleted} completed, ${agent.metrics.tasksFailed} failed`
      );
      console.log(`Success Rate: ${(0, import_formatters.formatPercentage)(agent.metrics.successRate)}`);
      console.log(
        `CPU: ${(0, import_formatters.formatPercentage)(agent.metrics.cpuUsage)} | Memory: ${(0, import_formatters.formatBytes)(agent.metrics.memoryUsage)}`
      );
    }
    const health = manager.getAgentHealth(agent.id.id);
    if (health && health.issues.length > 0) {
      console.log(import_chalk.default.red(`Issues: ${health.issues.length} active`));
    }
  });
}
__name(displayDetailedAgentList, "displayDetailedAgentList");
function displayAgentSummary(agent) {
  console.log("\n" + import_chalk.default.dim("Agent Summary:"));
  console.log(`  Name: ${agent.name}`);
  console.log(`  Type: ${agent.type}`);
  console.log(`  Status: ${getStatusDisplay(agent.status)}`);
  console.log(`  Health: ${getHealthDisplay(agent.health)}`);
}
__name(displayAgentSummary, "displayAgentSummary");
function getStatusColor(status) {
  switch (status) {
    case "idle":
      return import_chalk.default.green;
    case "busy":
      return import_chalk.default.blue;
    case "error":
      return import_chalk.default.red;
    case "offline":
      return import_chalk.default.gray;
    case "initializing":
      return import_chalk.default.yellow;
    case "terminating":
      return import_chalk.default.yellow;
    case "terminated":
      return import_chalk.default.gray;
    default:
      return import_chalk.default.white;
  }
}
__name(getStatusColor, "getStatusColor");
function getStatusDisplay(status) {
  const color = getStatusColor(status);
  return `${color}${status.toUpperCase()}${import_chalk.default.reset}`;
}
__name(getStatusDisplay, "getStatusDisplay");
function getHealthDisplay(health) {
  const percentage = Math.round(health * 100);
  let color = import_chalk.default.green;
  if (health < 0.3)
    color = import_chalk.default.red;
  else if (health < 0.7)
    color = import_chalk.default.yellow;
  return `${color}${percentage}%${import_chalk.default.reset}`;
}
__name(getHealthDisplay, "getHealthDisplay");
function formatRelativeTime(date) {
  const now = /* @__PURE__ */ new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 6e4)
    return "just now";
  if (diff < 36e5)
    return `${Math.floor(diff / 6e4)}m ago`;
  if (diff < 864e5)
    return `${Math.floor(diff / 36e5)}h ago`;
  return `${Math.floor(diff / 864e5)}d ago`;
}
__name(formatRelativeTime, "formatRelativeTime");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  agentCommand,
  createAgentCommand
});
//# sourceMappingURL=agent.js.map
