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
var task_exports = {};
__export(task_exports, {
  taskCommand: () => taskCommand
});
module.exports = __toCommonJS(task_exports);
var import_error_handler = require("../../utils/error-handler.js");
var import_commander = require("commander");
var import_node_fs = require("node:fs");
var import_chalk = __toESM(require("chalk"), 1);
var import_helpers = require("../../utils/helpers.js");
const taskCommand = new import_commander.Command().name("task").description("Manage tasks").action(() => {
  taskCommand.outputHelp();
}).command("create").description("Create a new task").argument("<type>", "Task type").argument("<description>", "Task description").option("-p, --priority <priority>", "Task priority", "0").option("-d, --dependencies <deps>", "Comma-separated list of dependency task IDs").option("-i, --input <input>", "Task input as JSON").option("-a, --assign <agent>", "Assign to specific agent").action(async (type, description, options) => {
  const task = {
    id: (0, import_helpers.generateId)("task"),
    type,
    description,
    priority: parseInt(options.priority, 10),
    dependencies: options.dependencies ? options.dependencies.split(",") : [],
    assignedAgent: options.assign,
    status: "pending",
    input: options.input ? JSON.parse(options.input) : {},
    createdAt: /* @__PURE__ */ new Date()
  };
  console.log(import_chalk.default.green("Task created:"));
  console.log(JSON.stringify(task, null, 2));
  console.log(import_chalk.default.yellow("\nTo submit this task, ensure Claude-Flow is running"));
}).command("list").description("List all tasks").option("-s, --status <status:string>", "Filter by status").option("-a, --agent <agent:string>", "Filter by assigned agent").action(async (options) => {
  console.log(import_chalk.default.yellow("Task listing requires a running Claude-Flow instance"));
}).command("status").description("Get task status").argument("<task-id>", "Task ID").action(async (taskId, options) => {
  console.log(import_chalk.default.yellow(`Task status requires a running Claude-Flow instance`));
}).command("cancel").description("Cancel a task").argument("<task-id>", "Task ID").option("-r, --reason <reason>", "Cancellation reason").action(async (taskId, options) => {
  console.log(import_chalk.default.yellow(`Cancelling task ${taskId} requires a running Claude-Flow instance`));
}).command("workflow").description("Execute a workflow from file").argument("<workflow-file>", "Workflow file path").action(async (workflowFile, options) => {
  try {
    const content = await import_node_fs.promises.readFile(workflowFile, "utf-8");
    const workflow = JSON.parse(content);
    console.log(import_chalk.default.green("Workflow loaded:"));
    console.log(`- Name: ${workflow.name || "Unnamed"}`);
    console.log(`- Tasks: ${workflow.tasks?.length || 0}`);
    console.log(import_chalk.default.yellow("\nTo execute this workflow, ensure Claude-Flow is running"));
  } catch (error) {
    console.error(import_chalk.default.red("Failed to load workflow:"), (0, import_error_handler.getErrorMessage)(error));
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  taskCommand
});
//# sourceMappingURL=task.js.map
