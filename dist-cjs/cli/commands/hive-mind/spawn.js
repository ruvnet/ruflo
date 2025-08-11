#!/usr/bin/env node
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
var spawn_exports = {};
__export(spawn_exports, {
  spawnCommand: () => spawnCommand
});
module.exports = __toCommonJS(spawn_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_ora = __toESM(require("ora"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_HiveMind = require("../../../hive-mind/core/HiveMind.js");
var import_formatter = require("../../formatter.js");
const AGENT_TYPES = [
  "coordinator",
  "researcher",
  "coder",
  "analyst",
  "architect",
  "tester",
  "reviewer",
  "optimizer",
  "documenter",
  "monitor",
  "specialist",
  "requirements_analyst",
  "design_architect",
  "system-architect",
  "task_planner",
  "task-planner",
  "implementation_coder",
  "developer",
  "quality_reviewer",
  "steering_documenter"
];
const CAPABILITY_MAP = {
  coordinator: ["task_management", "resource_allocation", "consensus_building"],
  researcher: ["information_gathering", "pattern_recognition", "knowledge_synthesis"],
  coder: ["code_generation", "refactoring", "debugging"],
  analyst: ["data_analysis", "performance_metrics", "bottleneck_detection"],
  architect: ["system_design", "architecture_patterns", "integration_planning"],
  tester: ["test_generation", "quality_assurance", "edge_case_detection"],
  reviewer: ["code_review", "standards_enforcement", "best_practices"],
  optimizer: ["performance_optimization", "resource_optimization", "algorithm_improvement"],
  documenter: ["documentation_generation", "api_docs", "user_guides"],
  monitor: ["system_monitoring", "health_checks", "alerting"],
  specialist: ["domain_expertise", "custom_capabilities", "problem_solving"],
  requirements_analyst: ["requirements_analysis", "user_story_creation", "acceptance_criteria"],
  design_architect: ["system_design", "architecture", "specs_driven_design"],
  "system-architect": ["system_design", "architecture_patterns", "integration_planning"],
  task_planner: ["task_management", "workflow_orchestration"],
  "task-planner": ["task_management", "workflow_orchestration"],
  implementation_coder: ["code_generation", "implementation", "debugging"],
  developer: ["code_generation", "implementation", "debugging"],
  quality_reviewer: ["code_review", "quality_assurance", "testing"],
  steering_documenter: ["documentation_generation", "governance"]
};
const spawnCommand = new import_commander.Command("spawn").description("Spawn specialized agents into the Hive Mind").argument("[type]", "Agent type to spawn").option("-n, --name <string>", "Custom agent name").option("-c, --capabilities <items>", "Additional capabilities (comma-separated)").option("-s, --swarm-id <id>", "Target swarm ID").option("-i, --interactive", "Interactive spawn mode", false).option("-b, --batch <number>", "Spawn multiple agents of same type", "1").option("--auto-assign", "Automatically assign to available tasks", false).action(async (type, options) => {
  const spinner = (0, import_ora.default)("Spawning agent...").start();
  try {
    const swarmId = options.swarmId || await getActiveSwarmId();
    if (!swarmId) {
      throw new Error("No active swarm found. Initialize a Hive Mind first.");
    }
    if (options.interactive || !type) {
      const answers = await import_inquirer.default.prompt([
        {
          type: "list",
          name: "type",
          message: "Select agent type:",
          choices: AGENT_TYPES,
          when: !type
        },
        {
          type: "checkbox",
          name: "additionalCapabilities",
          message: "Select additional capabilities:",
          choices: getAllCapabilities(),
          when: (answers2) => {
            const agentType = type || answers2.type;
            return agentType === "specialist";
          }
        },
        {
          type: "input",
          name: "customName",
          message: "Enter custom agent name (optional):",
          when: !options.name
        }
      ]);
      type = type || answers.type;
      options.name = options.name || answers.customName;
      if (answers.additionalCapabilities) {
        options.capabilities = answers.additionalCapabilities.join(",");
      }
    }
    if (!AGENT_TYPES.includes(type)) {
      throw new Error(`Invalid agent type: ${type}`);
    }
    const hiveMind = await import_HiveMind.HiveMind.load(swarmId);
    const baseCapabilities = CAPABILITY_MAP[type] || [];
    const additionalCapabilities = options.capabilities ? options.capabilities.split(",").map((c) => c.trim()) : [];
    const capabilities = [...baseCapabilities, ...additionalCapabilities];
    const batchSize = parseInt(options.batch, 10);
    const spawnedAgents = [];
    for (let i = 0; i < batchSize; i++) {
      const agentName = options.name || `${type}-${Date.now()}-${i}`;
      const agent = await hiveMind.spawnAgent({
        type,
        name: agentName,
        capabilities,
        autoAssign: options.autoAssign
      });
      spawnedAgents.push(agent);
      if (batchSize > 1) {
        spinner.text = `Spawning agents... (${i + 1}/${batchSize})`;
      }
    }
    spinner.succeed((0, import_formatter.formatSuccess)(`Successfully spawned ${batchSize} ${type} agent(s)!`));
    console.log("\n" + import_chalk.default.bold("\u{1F916} Spawned Agents:"));
    spawnedAgents.forEach((agent) => {
      console.log((0, import_formatter.formatInfo)(`${agent.name} (${agent.id})`));
      console.log(import_chalk.default.gray(`  Capabilities: ${agent.capabilities.join(", ")}`));
      if (agent.currentTask) {
        console.log(import_chalk.default.yellow(`  Assigned to: ${agent.currentTask}`));
      }
    });
    const stats = await hiveMind.getStats();
    console.log("\n" + import_chalk.default.bold("\u{1F4CA} Swarm Statistics:"));
    console.log((0, import_formatter.formatInfo)(`Total Agents: ${stats.totalAgents}`));
    console.log((0, import_formatter.formatInfo)(`Active Agents: ${stats.activeAgents}`));
    console.log((0, import_formatter.formatInfo)(`Available Capacity: ${stats.availableCapacity}%`));
    if (options.autoAssign && stats.pendingTasks > 0) {
      console.log((0, import_formatter.formatWarning)(`Auto-assigned to ${stats.pendingTasks} pending task(s)`));
    }
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to spawn agent"));
    console.error((0, import_formatter.formatError)(error.message));
    process.exit(1);
  }
});
async function getActiveSwarmId() {
  const { DatabaseManager } = await import("../../../hive-mind/core/DatabaseManager.js");
  const db = await DatabaseManager.getInstance();
  return db.getActiveSwarmId();
}
__name(getActiveSwarmId, "getActiveSwarmId");
function getAllCapabilities() {
  const allCapabilities = /* @__PURE__ */ new Set();
  Object.values(CAPABILITY_MAP).forEach((caps) => {
    caps.forEach((cap) => allCapabilities.add(cap));
  });
  return Array.from(allCapabilities);
}
__name(getAllCapabilities, "getAllCapabilities");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  spawnCommand
});
//# sourceMappingURL=spawn.js.map
