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
var task_exports = {};
__export(task_exports, {
  taskCommand: () => taskCommand
});
module.exports = __toCommonJS(task_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_ora = __toESM(require("ora"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var import_cli_progress = __toESM(require("cli-progress"), 1);
var import_HiveMind = require("../../../hive-mind/core/HiveMind.js");
var import_formatter = require("../../formatter.js");
var import_DatabaseManager = require("../../../hive-mind/core/DatabaseManager.js");
const taskCommand = new import_commander.Command("task").description("Submit and manage tasks in the Hive Mind").argument("[description]", "Task description").option("-s, --swarm-id <id>", "Target swarm ID").option("-p, --priority <level>", "Task priority (low, medium, high, critical)", "medium").option(
  "-t, --strategy <type>",
  "Execution strategy (parallel, sequential, adaptive, consensus)",
  "adaptive"
).option("-d, --dependencies <ids>", "Comma-separated list of dependent task IDs").option("-a, --assign-to <agent>", "Assign to specific agent").option("-r, --require-consensus", "Require consensus for this task", false).option("-m, --max-agents <number>", "Maximum agents to assign", "3").option("-i, --interactive", "Interactive task creation", false).option("-w, --watch", "Watch task progress", false).option("-l, --list", "List all tasks", false).option("--cancel <id>", "Cancel a specific task").option("--retry <id>", "Retry a failed task").action(async (description, options) => {
  try {
    const swarmId = options.swarmId || await getActiveSwarmId();
    if (!swarmId) {
      throw new Error("No active swarm found. Initialize a Hive Mind first.");
    }
    const hiveMind = await import_HiveMind.HiveMind.load(swarmId);
    if (options.list) {
      await listTasks(hiveMind);
      return;
    }
    if (options.cancel) {
      await cancelTask(hiveMind, options.cancel);
      return;
    }
    if (options.retry) {
      await retryTask(hiveMind, options.retry);
      return;
    }
    if (options.interactive || !description) {
      const answers = await import_inquirer.default.prompt([
        {
          type: "input",
          name: "description",
          message: "Enter task description:",
          when: !description,
          validate: (input) => input.length > 0 || "Task description is required"
        },
        {
          type: "list",
          name: "priority",
          message: "Select task priority:",
          choices: ["low", "medium", "high", "critical"],
          default: options.priority
        },
        {
          type: "list",
          name: "strategy",
          message: "Select execution strategy:",
          choices: [
            { name: "Adaptive (AI-optimized)", value: "adaptive" },
            { name: "Parallel (Fast, multiple agents)", value: "parallel" },
            { name: "Sequential (Step-by-step)", value: "sequential" },
            { name: "Consensus (Requires agreement)", value: "consensus" }
          ],
          default: options.strategy
        },
        {
          type: "confirm",
          name: "requireConsensus",
          message: "Require consensus for critical decisions?",
          default: options.requireConsensus,
          when: (answers2) => answers2.strategy !== "consensus"
        },
        {
          type: "number",
          name: "maxAgents",
          message: "Maximum agents to assign:",
          default: parseInt(options.maxAgents, 10),
          validate: (input) => input > 0 && input <= 10 || "Must be between 1 and 10"
        },
        {
          type: "checkbox",
          name: "capabilities",
          message: "Required agent capabilities:",
          choices: [
            "code_generation",
            "research",
            "analysis",
            "testing",
            "optimization",
            "documentation",
            "architecture",
            "review"
          ]
        }
      ]);
      description = description || answers.description;
      options.priority = answers.priority || options.priority;
      options.strategy = answers.strategy || options.strategy;
      options.requireConsensus = answers.requireConsensus || options.requireConsensus;
      options.maxAgents = answers.maxAgents || options.maxAgents;
      options.requiredCapabilities = answers.capabilities;
    }
    const spinner = (0, import_ora.default)("Submitting task to Hive Mind...").start();
    const dependencies = options.dependencies ? options.dependencies.split(",").map((id) => id.trim()) : [];
    const task = await hiveMind.submitTask({
      description,
      priority: options.priority,
      strategy: options.strategy,
      dependencies,
      assignTo: options.assignTo,
      requireConsensus: options.requireConsensus,
      maxAgents: parseInt(options.maxAgents, 10),
      requiredCapabilities: options.requiredCapabilities || [],
      metadata: {
        submittedBy: "cli",
        submittedAt: /* @__PURE__ */ new Date()
      }
    });
    spinner.succeed((0, import_formatter.formatSuccess)("Task submitted successfully!"));
    console.log("\n" + import_chalk.default.bold("\u{1F4CB} Task Details:"));
    console.log((0, import_formatter.formatInfo)(`Task ID: ${task.id}`));
    console.log((0, import_formatter.formatInfo)(`Description: ${task.description}`));
    console.log((0, import_formatter.formatInfo)(`Priority: ${getPriorityBadge(task.priority)} ${task.priority}`));
    console.log((0, import_formatter.formatInfo)(`Strategy: ${task.strategy}`));
    console.log((0, import_formatter.formatInfo)(`Status: ${task.status}`));
    if (task.assignedAgents.length > 0) {
      console.log((0, import_formatter.formatInfo)(`Assigned to: ${task.assignedAgents.join(", ")}`));
    }
    if (options.watch) {
      console.log("\n" + import_chalk.default.bold("\u{1F440} Watching task progress..."));
      await watchTaskProgress(hiveMind, task.id);
    } else {
      console.log(
        "\n" + import_chalk.default.gray(`Track progress: ruv-swarm hive-mind task --watch ${task.id}`)
      );
    }
  } catch (error) {
    console.error((0, import_formatter.formatError)("Failed to submit task"));
    console.error((0, import_formatter.formatError)(error.message));
    process.exit(1);
  }
});
async function getActiveSwarmId() {
  const db = await import_DatabaseManager.DatabaseManager.getInstance();
  return db.getActiveSwarmId();
}
__name(getActiveSwarmId, "getActiveSwarmId");
async function listTasks(hiveMind) {
  const tasks = await hiveMind.getTasks();
  if (tasks.length === 0) {
    console.log((0, import_formatter.formatInfo)("No tasks found."));
    return;
  }
  console.log("\n" + import_chalk.default.bold("\u{1F4CB} Task List:"));
  const table = new import_cli_table3.default({
    head: ["ID", "Description", "Priority", "Status", "Progress", "Agents"],
    style: { head: ["cyan"] }
  });
  tasks.forEach((task) => {
    table.push([
      task.id.substring(0, 8),
      task.description.substring(0, 40) + (task.description.length > 40 ? "..." : ""),
      getPriorityBadge(task.priority),
      getTaskStatusBadge(task.status),
      `${task.progress}%`,
      task.assignedAgents.length
    ]);
  });
  console.log(table.toString());
}
__name(listTasks, "listTasks");
async function cancelTask(hiveMind, taskId) {
  const spinner = (0, import_ora.default)("Cancelling task...").start();
  try {
    await hiveMind.cancelTask(taskId);
    spinner.succeed((0, import_formatter.formatSuccess)("Task cancelled successfully!"));
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to cancel task"));
    throw error;
  }
}
__name(cancelTask, "cancelTask");
async function retryTask(hiveMind, taskId) {
  const spinner = (0, import_ora.default)("Retrying task...").start();
  try {
    const newTask = await hiveMind.retryTask(taskId);
    spinner.succeed((0, import_formatter.formatSuccess)("Task retry submitted!"));
    console.log((0, import_formatter.formatInfo)(`New Task ID: ${newTask.id}`));
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to retry task"));
    throw error;
  }
}
__name(retryTask, "retryTask");
async function watchTaskProgress(hiveMind, taskId) {
  let lastProgress = -1;
  let completed = false;
  const bar = new import_cli_progress.default.SingleBar({
    format: "Progress |" + import_chalk.default.cyan("{bar}") + "| {percentage}% | {status}",
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true
  });
  bar.start(100, 0, { status: "Initializing..." });
  const interval = setInterval(async () => {
    try {
      const task = await hiveMind.getTask(taskId);
      if (task.progress !== lastProgress) {
        lastProgress = task.progress;
        bar.update(task.progress, { status: task.status });
      }
      if (task.status === "completed" || task.status === "failed") {
        completed = true;
        bar.stop();
        clearInterval(interval);
        console.log("\n" + import_chalk.default.bold("\u{1F4CA} Task Result:"));
        console.log((0, import_formatter.formatInfo)(`Status: ${task.status}`));
        console.log((0, import_formatter.formatInfo)(`Duration: ${formatDuration(task.completedAt - task.createdAt)}`));
        if (task.result) {
          console.log((0, import_formatter.formatInfo)("Result:"));
          console.log(import_chalk.default.gray(JSON.stringify(task.result, null, 2)));
        }
        if (task.error) {
          console.log((0, import_formatter.formatError)(`Error: ${task.error}`));
        }
      }
    } catch (error) {
      clearInterval(interval);
      bar.stop();
      console.error((0, import_formatter.formatError)("Error watching task: " + error.message));
    }
  }, 1e3);
  process.on("SIGINT", () => {
    if (!completed) {
      clearInterval(interval);
      bar.stop();
      console.log("\n" + (0, import_formatter.formatWarning)("Task watch cancelled. Task continues in background."));
      process.exit(0);
    }
  });
}
__name(watchTaskProgress, "watchTaskProgress");
function getPriorityBadge(priority) {
  const badges = {
    low: "\u{1F7E2}",
    medium: "\u{1F7E1}",
    high: "\u{1F7E0}",
    critical: "\u{1F534}"
  };
  return badges[priority] || "\u26AA";
}
__name(getPriorityBadge, "getPriorityBadge");
function getTaskStatusBadge(status) {
  const badges = {
    pending: import_chalk.default.gray("\u23F3"),
    assigned: import_chalk.default.yellow("\u{1F504}"),
    in_progress: import_chalk.default.blue("\u25B6\uFE0F"),
    completed: import_chalk.default.green("\u2705"),
    failed: import_chalk.default.red("\u274C")
  };
  return badges[status] || import_chalk.default.gray("\u2753");
}
__name(getTaskStatusBadge, "getTaskStatusBadge");
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0)
    return `${hours}h ${minutes % 60}m`;
  if (minutes > 0)
    return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
__name(formatDuration, "formatDuration");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  taskCommand
});
//# sourceMappingURL=task.js.map
