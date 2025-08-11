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
var wizard_exports = {};
__export(wizard_exports, {
  wizardCommand: () => wizardCommand
});
module.exports = __toCommonJS(wizard_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_figlet = __toESM(require("figlet"), 1);
var import_gradient_string = __toESM(require("gradient-string"), 1);
var import_HiveMind = require("../../../hive-mind/core/HiveMind.js");
var import_DatabaseManager = require("../../../hive-mind/core/DatabaseManager.js");
var import_formatter = require("../../formatter.js");
const wizardCommand = new import_commander.Command("wizard").description("Interactive Hive Mind setup and management wizard").option("--skip-intro", "Skip the intro animation", false).action(async (options) => {
  try {
    if (!options.skipIntro) {
      await showIntro();
    }
    let exit = false;
    while (!exit) {
      const action = await selectAction();
      switch (action) {
        case "create_swarm":
          await createSwarmWizard();
          break;
        case "manage_agents":
          await manageAgentsWizard();
          break;
        case "submit_task":
          await submitTaskWizard();
          break;
        case "view_status":
          await viewStatusWizard();
          break;
        case "configure_memory":
          await configureMemoryWizard();
          break;
        case "run_simulation":
          await runSimulationWizard();
          break;
        case "export_data":
          await exportDataWizard();
          break;
        case "switch_swarm":
          await switchSwarmWizard();
          break;
        case "exit":
          exit = true;
          break;
      }
      if (!exit) {
        await import_inquirer.default.prompt([
          {
            type: "confirm",
            name: "continue",
            message: "Continue with another action?",
            default: true
          }
        ]).then((answers) => {
          exit = !answers.continue;
        });
      }
    }
    console.log("\n" + import_chalk.default.bold.yellow("\u{1F44B} Thank you for using Hive Mind!"));
  } catch (error) {
    console.error((0, import_formatter.formatError)("Wizard error: " + error.message));
    process.exit(1);
  }
});
async function showIntro() {
  console.clear();
  const title = import_figlet.default.textSync("Hive Mind", {
    font: "Big",
    horizontalLayout: "default",
    verticalLayout: "default"
  });
  console.log(import_gradient_string.default.rainbow(title));
  console.log(import_chalk.default.bold.yellow("\n\u{1F41D} Welcome to the Hive Mind Interactive Wizard! \u{1F41D}\n"));
  console.log(import_chalk.default.gray("Collective intelligence for autonomous task orchestration\n"));
  await new Promise((resolve) => setTimeout(resolve, 2e3));
}
__name(showIntro, "showIntro");
async function selectAction() {
  const db = await import_DatabaseManager.DatabaseManager.getInstance();
  const activeSwarm = await db.getActiveSwarmId();
  console.log("\n" + import_chalk.default.bold("\u{1F3AF} What would you like to do?"));
  if (activeSwarm) {
    console.log(import_chalk.default.gray(`Active swarm: ${activeSwarm}`));
  }
  const { action } = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "action",
      message: "Select an action:",
      choices: [
        { name: "\u{1F195} Create New Swarm", value: "create_swarm" },
        { name: "\u{1F916} Manage Agents", value: "manage_agents", disabled: !activeSwarm },
        { name: "\u{1F4CB} Submit Task", value: "submit_task", disabled: !activeSwarm },
        { name: "\u{1F4CA} View Status", value: "view_status", disabled: !activeSwarm },
        { name: "\u{1F4BE} Configure Memory", value: "configure_memory", disabled: !activeSwarm },
        { name: "\u{1F3AE} Run Simulation", value: "run_simulation", disabled: !activeSwarm },
        { name: "\u{1F4E4} Export Data", value: "export_data", disabled: !activeSwarm },
        { name: "\u{1F504} Switch Swarm", value: "switch_swarm" },
        new import_inquirer.default.Separator(),
        { name: "\u{1F6AA} Exit", value: "exit" }
      ]
    }
  ]);
  return action;
}
__name(selectAction, "selectAction");
async function createSwarmWizard() {
  console.log("\n" + import_chalk.default.bold("\u{1F195} Create New Hive Mind Swarm"));
  const answers = await import_inquirer.default.prompt([
    {
      type: "input",
      name: "name",
      message: "Swarm name:",
      default: `hive-mind-${Date.now()}`,
      validate: (input) => input.length > 0 || "Name is required"
    },
    {
      type: "list",
      name: "topology",
      message: "Select swarm topology:",
      choices: [
        { name: "\u{1F3DB}\uFE0F Hierarchical - Queen-led with clear command structure", value: "hierarchical" },
        { name: "\u{1F578}\uFE0F Mesh - Fully connected peer-to-peer network", value: "mesh" },
        { name: "\u{1F504} Ring - Circular communication pattern", value: "ring" },
        { name: "\u2B50 Star - Central hub with radiating connections", value: "star" }
      ]
    },
    {
      type: "list",
      name: "queenMode",
      message: "Queen coordination mode:",
      choices: [
        { name: "\u{1F451} Centralized - Single Queen controls all decisions", value: "centralized" },
        { name: "\u{1F91D} Distributed - Multiple Queens share leadership", value: "distributed" }
      ]
    },
    {
      type: "number",
      name: "maxAgents",
      message: "Maximum number of agents:",
      default: 8,
      validate: (input) => input > 0 && input <= 100 || "Must be between 1 and 100"
    },
    {
      type: "number",
      name: "consensusThreshold",
      message: "Consensus threshold (0.5 - 1.0):",
      default: 0.66,
      validate: (input) => input >= 0.5 && input <= 1 || "Must be between 0.5 and 1.0"
    },
    {
      type: "confirm",
      name: "autoSpawn",
      message: "Auto-spawn initial agents?",
      default: true
    }
  ]);
  const { showAdvanced } = await import_inquirer.default.prompt([
    {
      type: "confirm",
      name: "showAdvanced",
      message: "Configure advanced options?",
      default: false
    }
  ]);
  if (showAdvanced) {
    const advanced = await import_inquirer.default.prompt([
      {
        type: "number",
        name: "memoryTTL",
        message: "Default memory TTL (seconds):",
        default: 86400
      },
      {
        type: "checkbox",
        name: "enabledFeatures",
        message: "Enable features:",
        choices: [
          { name: "Neural Learning", value: "neural", checked: true },
          { name: "Performance Monitoring", value: "monitoring", checked: true },
          { name: "Auto-scaling", value: "autoscale", checked: false },
          { name: "Fault Tolerance", value: "faultTolerance", checked: true },
          { name: "Predictive Task Assignment", value: "predictive", checked: false }
        ]
      }
    ]);
    Object.assign(answers, advanced);
  }
  const spinner = ora("Creating Hive Mind swarm...").start();
  try {
    const hiveMind = new import_HiveMind.HiveMind({
      name: answers.name,
      topology: answers.topology,
      maxAgents: answers.maxAgents,
      queenMode: answers.queenMode,
      memoryTTL: answers.memoryTTL || 86400,
      consensusThreshold: answers.consensusThreshold,
      autoSpawn: answers.autoSpawn,
      enabledFeatures: answers.enabledFeatures || ["neural", "monitoring", "faultTolerance"],
      createdAt: /* @__PURE__ */ new Date()
    });
    const swarmId = await hiveMind.initialize();
    spinner.succeed((0, import_formatter.formatSuccess)("Hive Mind created successfully!"));
    console.log((0, import_formatter.formatInfo)(`Swarm ID: ${swarmId}`));
    if (answers.autoSpawn) {
      const agents = await hiveMind.autoSpawnAgents();
      console.log((0, import_formatter.formatSuccess)(`Spawned ${agents.length} initial agents`));
    }
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to create swarm"));
    throw error;
  }
}
__name(createSwarmWizard, "createSwarmWizard");
async function manageAgentsWizard() {
  console.log("\n" + import_chalk.default.bold("\u{1F916} Manage Agents"));
  const { action } = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "\u2795 Spawn New Agent", value: "spawn" },
        { name: "\u{1F4CA} View Agent List", value: "list" },
        { name: "\u{1F527} Modify Agent", value: "modify" },
        { name: "\u{1F5D1}\uFE0F Remove Agent", value: "remove" },
        { name: "\u{1F504} Rebalance Agents", value: "rebalance" }
      ]
    }
  ]);
  const db = await import_DatabaseManager.DatabaseManager.getInstance();
  const swarmId = await db.getActiveSwarmId();
  const hiveMind = await import_HiveMind.HiveMind.load(swarmId);
  switch (action) {
    case "spawn":
      await spawnAgentInteractive(hiveMind);
      break;
    case "list":
      await listAgentsInteractive(hiveMind);
      break;
    case "modify":
      await modifyAgentInteractive(hiveMind);
      break;
    case "remove":
      await removeAgentInteractive(hiveMind);
      break;
    case "rebalance":
      await rebalanceAgentsInteractive(hiveMind);
      break;
  }
}
__name(manageAgentsWizard, "manageAgentsWizard");
async function spawnAgentInteractive(hiveMind) {
  const agentTypes = [
    { name: "\u{1F3AF} Coordinator - Task management and delegation", value: "coordinator" },
    { name: "\u{1F52C} Researcher - Information gathering and analysis", value: "researcher" },
    { name: "\u{1F4BB} Coder - Code generation and implementation", value: "coder" },
    { name: "\u{1F4CA} Analyst - Data analysis and insights", value: "analyst" },
    { name: "\u{1F3D7}\uFE0F Architect - System design and planning", value: "architect" },
    { name: "\u{1F9EA} Tester - Quality assurance and testing", value: "tester" },
    { name: "\u{1F441}\uFE0F Reviewer - Code and design review", value: "reviewer" },
    { name: "\u26A1 Optimizer - Performance optimization", value: "optimizer" },
    { name: "\u{1F4DD} Documenter - Documentation generation", value: "documenter" },
    { name: "\u{1F4E1} Monitor - System monitoring and alerts", value: "monitor" },
    { name: "\u{1F3A8} Specialist - Custom specialized agent", value: "specialist" }
  ];
  const answers = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "type",
      message: "Select agent type:",
      choices: agentTypes
    },
    {
      type: "input",
      name: "name",
      message: "Agent name (optional):",
      default: (answers2) => `${answers2.type}-${Date.now()}`
    },
    {
      type: "number",
      name: "count",
      message: "How many agents to spawn?",
      default: 1,
      validate: (input) => input > 0 && input <= 10 || "Must be between 1 and 10"
    }
  ]);
  const spinner = ora(`Spawning ${answers.count} ${answers.type} agent(s)...`).start();
  try {
    const agents = [];
    for (let i = 0; i < answers.count; i++) {
      const agent = await hiveMind.spawnAgent({
        type: answers.type,
        name: answers.count > 1 ? `${answers.name}-${i}` : answers.name
      });
      agents.push(agent);
    }
    spinner.succeed((0, import_formatter.formatSuccess)(`Spawned ${agents.length} agent(s) successfully!`));
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to spawn agents"));
    throw error;
  }
}
__name(spawnAgentInteractive, "spawnAgentInteractive");
async function submitTaskWizard() {
  console.log("\n" + import_chalk.default.bold("\u{1F4CB} Submit Task to Hive Mind"));
  const db = await import_DatabaseManager.DatabaseManager.getInstance();
  const swarmId = await db.getActiveSwarmId();
  const hiveMind = await import_HiveMind.HiveMind.load(swarmId);
  const templates = [
    { name: "\u{1F50D} Research Task", value: "research" },
    { name: "\u{1F4BB} Development Task", value: "development" },
    { name: "\u{1F4CA} Analysis Task", value: "analysis" },
    { name: "\u{1F9EA} Testing Task", value: "testing" },
    { name: "\u{1F4DD} Documentation Task", value: "documentation" },
    { name: "\u270F\uFE0F Custom Task", value: "custom" }
  ];
  const { template } = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "template",
      message: "Select task template:",
      choices: templates
    }
  ]);
  let taskDescription = "";
  let taskConfig = {};
  if (template === "custom") {
    const answers = await import_inquirer.default.prompt([
      {
        type: "editor",
        name: "description",
        message: "Enter task description:"
      }
    ]);
    taskDescription = answers.description;
  } else {
    const templates2 = {
      research: {
        prompt: "What would you like to research?",
        prefix: "Research and analyze: "
      },
      development: {
        prompt: "What would you like to develop?",
        prefix: "Develop and implement: "
      },
      analysis: {
        prompt: "What would you like to analyze?",
        prefix: "Analyze and provide insights on: "
      },
      testing: {
        prompt: "What would you like to test?",
        prefix: "Test and validate: "
      },
      documentation: {
        prompt: "What would you like to document?",
        prefix: "Create documentation for: "
      }
    };
    const tmpl = templates2[template];
    const { detail } = await import_inquirer.default.prompt([
      {
        type: "input",
        name: "detail",
        message: tmpl.prompt
      }
    ]);
    taskDescription = tmpl.prefix + detail;
  }
  const config = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "priority",
      message: "Task priority:",
      choices: [
        { name: "\u{1F7E2} Low", value: "low" },
        { name: "\u{1F7E1} Medium", value: "medium" },
        { name: "\u{1F7E0} High", value: "high" },
        { name: "\u{1F534} Critical", value: "critical" }
      ],
      default: "medium"
    },
    {
      type: "list",
      name: "strategy",
      message: "Execution strategy:",
      choices: [
        { name: "\u{1F916} Adaptive (AI-optimized)", value: "adaptive" },
        { name: "\u26A1 Parallel (Multiple agents)", value: "parallel" },
        { name: "\u{1F4CD} Sequential (Step-by-step)", value: "sequential" },
        { name: "\u{1F91D} Consensus (Requires agreement)", value: "consensus" }
      ],
      default: "adaptive"
    },
    {
      type: "confirm",
      name: "monitor",
      message: "Monitor task progress?",
      default: true
    }
  ]);
  const spinner = ora("Submitting task...").start();
  try {
    const task = await hiveMind.submitTask({
      description: taskDescription,
      priority: config.priority,
      strategy: config.strategy
    });
    spinner.succeed((0, import_formatter.formatSuccess)("Task submitted successfully!"));
    console.log((0, import_formatter.formatInfo)(`Task ID: ${task.id}`));
    if (config.monitor) {
      console.log("\n" + import_chalk.default.bold("Monitoring task progress..."));
    }
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to submit task"));
    throw error;
  }
}
__name(submitTaskWizard, "submitTaskWizard");
async function viewStatusWizard() {
  const { view } = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "view",
      message: "What would you like to view?",
      choices: [
        { name: "\u{1F4CA} Overall Status", value: "overall" },
        { name: "\u{1F916} Agent Details", value: "agents" },
        { name: "\u{1F4CB} Task Queue", value: "tasks" },
        { name: "\u{1F4BE} Memory Usage", value: "memory" },
        { name: "\u{1F4C8} Performance Metrics", value: "performance" },
        { name: "\u{1F4E1} Communications", value: "communications" }
      ]
    }
  ]);
  const { statusCommand: statusCmd } = await import("./status.js");
  const args = ["status"];
  switch (view) {
    case "agents":
      args.push("--detailed");
      break;
    case "tasks":
      args.push("--tasks");
      break;
    case "memory":
      args.push("--memory");
      break;
    case "performance":
      args.push("--performance");
      break;
  }
  await statusCmd.parseAsync(args);
}
__name(viewStatusWizard, "viewStatusWizard");
async function listAgentsInteractive(hiveMind) {
  const agents = await hiveMind.getAgents();
  console.log("\n" + import_chalk.default.bold("\u{1F916} Agent List:"));
  agents.forEach((agent) => {
    const statusEmoji = agent.status === "busy" ? "\u{1F534}" : "\u{1F7E2}";
    console.log(`${statusEmoji} ${agent.name} (${agent.type}) - ${agent.status}`);
  });
}
__name(listAgentsInteractive, "listAgentsInteractive");
async function modifyAgentInteractive(hiveMind) {
  console.log((0, import_formatter.formatInfo)("Agent modification coming soon..."));
}
__name(modifyAgentInteractive, "modifyAgentInteractive");
async function removeAgentInteractive(hiveMind) {
  console.log((0, import_formatter.formatInfo)("Agent removal coming soon..."));
}
__name(removeAgentInteractive, "removeAgentInteractive");
async function rebalanceAgentsInteractive(hiveMind) {
  const spinner = ora("Rebalancing agents...").start();
  try {
    await hiveMind.rebalanceAgents();
    spinner.succeed((0, import_formatter.formatSuccess)("Agents rebalanced successfully!"));
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to rebalance agents"));
    throw error;
  }
}
__name(rebalanceAgentsInteractive, "rebalanceAgentsInteractive");
async function configureMemoryWizard() {
  console.log((0, import_formatter.formatInfo)("Memory configuration coming soon..."));
}
__name(configureMemoryWizard, "configureMemoryWizard");
async function runSimulationWizard() {
  console.log((0, import_formatter.formatInfo)("Simulation mode coming soon..."));
}
__name(runSimulationWizard, "runSimulationWizard");
async function exportDataWizard() {
  console.log((0, import_formatter.formatInfo)("Data export coming soon..."));
}
__name(exportDataWizard, "exportDataWizard");
async function switchSwarmWizard() {
  const db = await import_DatabaseManager.DatabaseManager.getInstance();
  const swarms = await db.getAllSwarms();
  if (swarms.length === 0) {
    console.log((0, import_formatter.formatWarning)("No swarms found. Create one first!"));
    return;
  }
  const { swarmId } = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "swarmId",
      message: "Select swarm:",
      choices: swarms.map((s) => ({
        name: `${s.name} (${s.topology}) - ${s.agentCount} agents`,
        value: s.id
      }))
    }
  ]);
  await db.setActiveSwarm(swarmId);
  console.log((0, import_formatter.formatSuccess)("Switched to swarm: " + swarmId));
}
__name(switchSwarmWizard, "switchSwarmWizard");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  wizardCommand
});
//# sourceMappingURL=wizard.js.map
