"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var claude_exports = {};
__export(claude_exports, {
  claudeCommand: () => claudeCommand
});
module.exports = __toCommonJS(claude_exports);
var import_node_fs = require("node:fs");
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_node_child_process = require("node:child_process");
var import_helpers = require("../../utils/helpers.js");
const claudeCommand = new import_commander.Command().name("claude").description("Manage Claude instances").action(() => {
  claudeCommand.help();
});
claudeCommand.command("spawn").description("Spawn a new Claude instance with specific configuration").arguments("<task>").option(
  "-t, --tools <tools>",
  "Allowed tools (comma-separated)",
  "View,Edit,Replace,GlobTool,GrepTool,LS,Bash"
).option("--no-permissions", "Use --dangerously-skip-permissions flag").option("-c, --config <config>", "MCP config file path").option(
  "-m, --mode <mode>",
  "Development mode (full, backend-only, frontend-only, api-only)",
  "full"
).option("--parallel", "Enable parallel execution with BatchTool").option("--research", "Enable web research with WebFetchTool").option("--coverage <coverage>", "Test coverage target", "80").option("--commit <frequency>", "Commit frequency (phase, feature, manual)", "phase").option("-v, --verbose", "Enable verbose output").option("--dry-run", "Show what would be executed without running").action(async (task, options) => {
  try {
    const instanceId = (0, import_helpers.generateId)("claude");
    let tools = options.tools;
    if (options.parallel && !tools.includes("BatchTool")) {
      tools += ",BatchTool,dispatch_agent";
    }
    if (options.research && !tools.includes("WebFetchTool")) {
      tools += ",WebFetchTool";
    }
    const claudeArgs = [task];
    claudeArgs.push("--allowedTools", tools);
    if (options.noPermissions) {
      claudeArgs.push("--dangerously-skip-permissions");
    }
    if (options.config) {
      claudeArgs.push("--mcp-config", options.config);
    }
    if (options.verbose) {
      claudeArgs.push("--verbose");
    }
    if (options.dryRun) {
      console.log(import_chalk.default.yellow("DRY RUN - Would execute:"));
      console.log(import_chalk.default.gray(`claude ${claudeArgs.join(" ")}`));
      console.log("\nConfiguration:");
      console.log(`  Instance ID: ${instanceId}`);
      console.log(`  Task: ${task}`);
      console.log(`  Tools: ${tools}`);
      console.log(`  Mode: ${options.mode}`);
      console.log(`  Coverage: ${parseInt(options.coverage)}%`);
      console.log(`  Commit: ${options.commit}`);
      return;
    }
    console.log(import_chalk.default.green(`Spawning Claude instance: ${instanceId}`));
    console.log(import_chalk.default.gray(`Task: ${task}`));
    console.log(import_chalk.default.gray(`Tools: ${tools}`));
    const claude = (0, import_node_child_process.spawn)("claude", claudeArgs, {
      stdio: "inherit",
      env: {
        ...process.env,
        CLAUDE_INSTANCE_ID: instanceId,
        CLAUDE_FLOW_MODE: options.mode,
        CLAUDE_FLOW_COVERAGE: parseInt(options.coverage).toString(),
        CLAUDE_FLOW_COMMIT: options.commit
      }
    });
    claude.on("error", (err) => {
      console.error(import_chalk.default.red("Failed to spawn Claude:"), err.message);
    });
    claude.on("exit", (code) => {
      if (code === 0) {
        console.log(import_chalk.default.green(`Claude instance ${instanceId} completed successfully`));
      } else {
        console.log(import_chalk.default.red(`Claude instance ${instanceId} exited with code ${code}`));
      }
    });
  } catch (error) {
    console.error(import_chalk.default.red("Failed to spawn Claude:"), error.message);
  }
});
claudeCommand.command("batch").description("Spawn multiple Claude instances from workflow").arguments("<workflow-file>").option("--dry-run", "Show what would be executed without running").action(async (workflowFile, options) => {
  try {
    const content = await import_node_fs.promises.readFile(workflowFile, "utf-8");
    const workflow = JSON.parse(content);
    console.log(import_chalk.default.green("Loading workflow:"), workflow.name || "Unnamed");
    console.log(import_chalk.default.gray(`Tasks: ${workflow.tasks?.length || 0}`));
    if (!workflow.tasks || workflow.tasks.length === 0) {
      console.log(import_chalk.default.yellow("No tasks found in workflow"));
      return;
    }
    for (const task of workflow.tasks) {
      const claudeArgs = [task.description || task.name];
      if (task.tools) {
        claudeArgs.push(
          "--allowedTools",
          Array.isArray(task.tools) ? task.tools.join(",") : task.tools
        );
      }
      if (task.skipPermissions) {
        claudeArgs.push("--dangerously-skip-permissions");
      }
      if (task.config) {
        claudeArgs.push("--mcp-config", task.config);
      }
      if (options.dryRun) {
        console.log(import_chalk.default.yellow(`
DRY RUN - Task: ${task.name || task.id}`));
        console.log(import_chalk.default.gray(`claude ${claudeArgs.join(" ")}`));
      } else {
        console.log(import_chalk.default.blue(`
Spawning Claude for task: ${task.name || task.id}`));
        const claude = (0, import_node_child_process.spawn)("claude", claudeArgs, {
          stdio: "inherit",
          env: {
            ...process.env,
            CLAUDE_TASK_ID: task.id || (0, import_helpers.generateId)("task"),
            CLAUDE_TASK_TYPE: task.type || "general"
          }
        });
        if (!workflow.parallel) {
          await new Promise((resolve) => {
            claude.on("exit", resolve);
          });
        }
      }
    }
    if (!options.dryRun && workflow.parallel) {
      console.log(import_chalk.default.green("\nAll Claude instances spawned in parallel mode"));
    }
  } catch (error) {
    console.error(import_chalk.default.red("Failed to process workflow:"), error.message);
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  claudeCommand
});
//# sourceMappingURL=claude.js.map
