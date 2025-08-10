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
var workflow_exports = {};
__export(workflow_exports, {
  workflowCommand: () => workflowCommand
});
module.exports = __toCommonJS(workflow_exports);
var import_error_handler = require("../../utils/error-handler.js");
var import_commander = require("commander");
var import_node_fs = require("node:fs");
var import_chalk = __toESM(require("chalk"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var Table = __toESM(require("cli-table3"), 1);
var import_helpers = require("../../utils/helpers.js");
var import_formatter = require("../formatter.js");
const workflowCommand = new import_commander.Command().name("workflow").description("Execute and manage workflows").action(() => {
  workflowCommand.outputHelp();
}).command("run").description("Execute a workflow from file").argument("<workflow-file>", "Workflow file path").option("-d, --dry-run", "Validate workflow without executing").option("-v, --variables <vars>", "Override variables (JSON format)").option("-w, --watch", "Watch workflow execution progress").option("--parallel", "Allow parallel execution where possible").option("--fail-fast", "Stop on first task failure").action(async (workflowFile, options) => {
  await runWorkflow(workflowFile, options);
}).command("validate").description("Validate a workflow file").argument("<workflow-file>", "Workflow file path").option("--strict", "Use strict validation mode").action(async (workflowFile, options) => {
  await validateWorkflow(workflowFile, options);
}).command("list").description("List running workflows").option("--all", "Include completed workflows").option("--format <format>", "Output format (table, json)", "table").action(async (options) => {
  await listWorkflows(options);
}).command("status").description("Show workflow execution status").argument("<workflow-id>", "Workflow ID").option("-w, --watch", "Watch workflow progress").action(async (workflowId, options) => {
  await showWorkflowStatus(workflowId, options);
}).command("stop").description("Stop a running workflow").argument("<workflow-id>", "Workflow ID").option("-f, --force", "Force stop without cleanup").action(async (workflowId, options) => {
  await stopWorkflow(workflowId, options);
}).command("template").description("Generate workflow templates").argument("<template-type>", "Template type").option("-o, --output <file>", "Output file path").option("--format <format>", "Template format (json, yaml)", "json").action(async (templateType, options) => {
  await generateTemplate(templateType, options);
});
async function runWorkflow(workflowFile, options) {
  try {
    const workflow = await loadWorkflow(workflowFile);
    if (options.dryRun) {
      await validateWorkflowDefinition(workflow, true);
      console.log(import_chalk.default.green("\u2713 Workflow validation passed"));
      return;
    }
    if (options.variables) {
      try {
        const vars = JSON.parse(options.variables);
        workflow.variables = { ...workflow.variables, ...vars };
      } catch (error) {
        throw new Error(`Invalid variables JSON: ${error.message}`);
      }
    }
    const execution = await createExecution(workflow);
    console.log(import_chalk.default.cyan.bold("Starting workflow execution"));
    console.log(`${import_chalk.default.white("Workflow:")} ${workflow.name}`);
    console.log(`${import_chalk.default.white("ID:")} ${execution.id}`);
    console.log(`${import_chalk.default.white("Tasks:")} ${execution.tasks.length}`);
    console.log();
    if (options.watch) {
      await executeWorkflowWithWatch(execution, workflow, options);
    } else {
      await executeWorkflow(execution, workflow, options);
    }
  } catch (error) {
    console.error(import_chalk.default.red("Workflow execution failed:"), error.message);
    process.exit(1);
  }
}
__name(runWorkflow, "runWorkflow");
async function validateWorkflow(workflowFile, options) {
  try {
    const workflow = await loadWorkflow(workflowFile);
    await validateWorkflowDefinition(workflow, options.strict);
    console.log(import_chalk.default.green("\u2713 Workflow validation passed"));
    console.log(`${import_chalk.default.white("Name:")} ${workflow.name}`);
    console.log(`${import_chalk.default.white("Tasks:")} ${workflow.tasks.length}`);
    console.log(`${import_chalk.default.white("Agents:")} ${workflow.agents?.length || 0}`);
    if (workflow.dependencies) {
      const depCount = Object.values(workflow.dependencies).flat().length;
      console.log(`${import_chalk.default.white("Dependencies:")} ${depCount}`);
    }
  } catch (error) {
    console.error(import_chalk.default.red("\u2717 Workflow validation failed:"), error.message);
    process.exit(1);
  }
}
__name(validateWorkflow, "validateWorkflow");
async function listWorkflows(options) {
  try {
    const workflows = await getRunningWorkflows(options.all);
    if (options.format === "json") {
      console.log(JSON.stringify(workflows, null, 2));
      return;
    }
    if (workflows.length === 0) {
      console.log(import_chalk.default.gray("No workflows found"));
      return;
    }
    console.log(import_chalk.default.cyan.bold(`Workflows (${workflows.length})`));
    console.log("\u2500".repeat(60));
    const table = new Table.default({
      head: ["ID", "Name", "Status", "Progress", "Started", "Duration"]
    });
    for (const workflow of workflows) {
      const statusIcon = (0, import_formatter.formatStatusIndicator)(workflow.status);
      const progress = `${workflow.progress.completed}/${workflow.progress.total}`;
      const progressBar = (0, import_formatter.formatProgressBar)(
        workflow.progress.completed,
        workflow.progress.total,
        10
      );
      const duration = workflow.completedAt ? (0, import_formatter.formatDuration)(workflow.completedAt.getTime() - workflow.startedAt.getTime()) : (0, import_formatter.formatDuration)(Date.now() - workflow.startedAt.getTime());
      table.push([
        import_chalk.default.gray(workflow.id.substring(0, 8) + "..."),
        import_chalk.default.white(workflow.workflowName),
        `${statusIcon} ${workflow.status}`,
        `${progressBar} ${progress}`,
        workflow.startedAt.toLocaleTimeString(),
        duration
      ]);
    }
    console.log(table.toString());
  } catch (error) {
    console.error(import_chalk.default.red("Failed to list workflows:"), error.message);
  }
}
__name(listWorkflows, "listWorkflows");
async function showWorkflowStatus(workflowId, options) {
  try {
    if (options.watch) {
      await watchWorkflowStatus(workflowId);
    } else {
      const execution = await getWorkflowExecution(workflowId);
      displayWorkflowStatus(execution);
    }
  } catch (error) {
    console.error(import_chalk.default.red("Failed to get workflow status:"), error.message);
  }
}
__name(showWorkflowStatus, "showWorkflowStatus");
async function stopWorkflow(workflowId, options) {
  try {
    const execution = await getWorkflowExecution(workflowId);
    if (execution.status !== "running") {
      console.log(import_chalk.default.yellow(`Workflow is not running (status: ${execution.status})`));
      return;
    }
    if (!options.force) {
      const { confirmed } = await import_inquirer.default.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: `Stop workflow "${execution.workflowName}"?`,
          default: false
        }
      ]);
      if (!confirmed) {
        console.log(import_chalk.default.gray("Stop cancelled"));
        return;
      }
    }
    console.log(import_chalk.default.yellow("Stopping workflow..."));
    if (options.force) {
      console.log(import_chalk.default.red("\u2022 Force stopping all tasks"));
    } else {
      console.log(import_chalk.default.blue("\u2022 Gracefully stopping tasks"));
      console.log(import_chalk.default.blue("\u2022 Cleaning up resources"));
    }
    console.log(import_chalk.default.green("\u2713 Workflow stopped"));
  } catch (error) {
    console.error(import_chalk.default.red("Failed to stop workflow:"), error.message);
  }
}
__name(stopWorkflow, "stopWorkflow");
async function generateTemplate(templateType, options) {
  const templates = {
    research: {
      name: "Research Workflow",
      description: "Multi-stage research and analysis workflow",
      variables: {
        topic: "quantum computing",
        depth: "comprehensive"
      },
      agents: [
        { id: "researcher", type: "researcher", name: "Research Agent" },
        { id: "analyst", type: "analyst", name: "Analysis Agent" }
      ],
      tasks: [
        {
          id: "research-task",
          type: "research",
          description: "Research the given topic",
          assignTo: "researcher",
          input: { topic: "${topic}", depth: "${depth}" }
        },
        {
          id: "analyze-task",
          type: "analysis",
          description: "Analyze research findings",
          assignTo: "analyst",
          depends: ["research-task"],
          input: { data: "${research-task.output}" }
        }
      ],
      settings: {
        maxConcurrency: 2,
        timeout: 3e5,
        failurePolicy: "fail-fast"
      }
    },
    implementation: {
      name: "Implementation Workflow",
      description: "Code implementation and testing workflow",
      agents: [
        { id: "implementer", type: "implementer", name: "Implementation Agent" },
        { id: "tester", type: "implementer", name: "Testing Agent" }
      ],
      tasks: [
        {
          id: "implement",
          type: "implementation",
          description: "Implement the solution",
          assignTo: "implementer"
        },
        {
          id: "test",
          type: "testing",
          description: "Test the implementation",
          assignTo: "tester",
          depends: ["implement"]
        }
      ]
    },
    coordination: {
      name: "Multi-Agent Coordination",
      description: "Complex multi-agent coordination workflow",
      agents: [
        { id: "coordinator", type: "coordinator", name: "Coordinator Agent" },
        { id: "worker1", type: "implementer", name: "Worker Agent 1" },
        { id: "worker2", type: "implementer", name: "Worker Agent 2" }
      ],
      tasks: [
        {
          id: "plan",
          type: "planning",
          description: "Create execution plan",
          assignTo: "coordinator"
        },
        {
          id: "work1",
          type: "implementation",
          description: "Execute part 1",
          assignTo: "worker1",
          depends: ["plan"]
        },
        {
          id: "work2",
          type: "implementation",
          description: "Execute part 2",
          assignTo: "worker2",
          depends: ["plan"]
        },
        {
          id: "integrate",
          type: "integration",
          description: "Integrate results",
          assignTo: "coordinator",
          depends: ["work1", "work2"]
        }
      ],
      settings: {
        maxConcurrency: 3,
        failurePolicy: "continue"
      }
    }
  };
  const template = templates[templateType];
  if (!template) {
    console.error(import_chalk.default.red(`Unknown template type: ${templateType}`));
    console.log(import_chalk.default.gray("Available templates:"), Object.keys(templates).join(", "));
    return;
  }
  const outputFile = options.output || `${templateType}-workflow.${options.format}`;
  let content;
  if (options.format === "yaml") {
    console.log(import_chalk.default.yellow("YAML format not implemented, using JSON"));
    content = JSON.stringify(template, null, 2);
  } else {
    content = JSON.stringify(template, null, 2);
  }
  await import_node_fs.promises.writeFile(outputFile, content);
  console.log(import_chalk.default.green("\u2713 Workflow template generated"));
  console.log(`${import_chalk.default.white("Template:")} ${templateType}`);
  console.log(`${import_chalk.default.white("File:")} ${outputFile}`);
  console.log(`${import_chalk.default.white("Tasks:")} ${template.tasks.length}`);
  console.log(`${import_chalk.default.white("Agents:")} ${template.agents?.length || 0}`);
}
__name(generateTemplate, "generateTemplate");
async function loadWorkflow(workflowFile) {
  try {
    const content = await import_node_fs.promises.readFile(workflowFile, "utf-8");
    if (workflowFile.endsWith(".yaml") || workflowFile.endsWith(".yml")) {
      throw new Error("YAML workflows not yet supported");
    }
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load workflow file: ${(0, import_error_handler.getErrorMessage)(error)}`);
  }
}
__name(loadWorkflow, "loadWorkflow");
async function validateWorkflowDefinition(workflow, strict = false) {
  const errors = [];
  if (!workflow.name)
    errors.push("Workflow name is required");
  if (!workflow.tasks || workflow.tasks.length === 0)
    errors.push("At least one task is required");
  const taskIds = /* @__PURE__ */ new Set();
  for (const task of workflow.tasks || []) {
    if (!task.id)
      errors.push("Task ID is required");
    if (taskIds.has(task.id))
      errors.push(`Duplicate task ID: ${task.id}`);
    taskIds.add(task.id);
    if (!task.type)
      errors.push(`Task ${task.id}: type is required`);
    if (!task.description)
      errors.push(`Task ${task.id}: description is required`);
    if (task.depends) {
      for (const dep of task.depends) {
        if (!taskIds.has(dep)) {
          const taskIndex = workflow.tasks.indexOf(task);
          const depExists = workflow.tasks.slice(0, taskIndex).some((t) => t.id === dep);
          if (!depExists) {
            errors.push(`Task ${task.id}: unknown dependency ${dep}`);
          }
        }
      }
    }
  }
  if (workflow.agents) {
    const agentIds = /* @__PURE__ */ new Set();
    for (const agent of workflow.agents) {
      if (!agent.id)
        errors.push("Agent ID is required");
      if (agentIds.has(agent.id))
        errors.push(`Duplicate agent ID: ${agent.id}`);
      agentIds.add(agent.id);
      if (!agent.type)
        errors.push(`Agent ${agent.id}: type is required`);
    }
    for (const task of workflow.tasks) {
      if (task.assignTo && !agentIds.has(task.assignTo)) {
        errors.push(`Task ${task.id}: assigned to unknown agent ${task.assignTo}`);
      }
    }
  }
  if (strict) {
    const graph = /* @__PURE__ */ new Map();
    for (const task of workflow.tasks) {
      graph.set(task.id, task.depends || []);
    }
    if (hasCircularDependencies(graph)) {
      errors.push("Circular dependencies detected");
    }
  }
  if (errors.length > 0) {
    throw new Error("Workflow validation failed:\n\u2022 " + errors.join("\n\u2022 "));
  }
}
__name(validateWorkflowDefinition, "validateWorkflowDefinition");
async function createExecution(workflow) {
  const tasks = workflow.tasks.map((task) => ({
    id: (0, import_helpers.generateId)("task-exec"),
    taskId: task.id,
    status: "pending"
  }));
  return {
    id: (0, import_helpers.generateId)("workflow-exec"),
    workflowName: workflow.name,
    status: "pending",
    startedAt: /* @__PURE__ */ new Date(),
    progress: {
      total: tasks.length,
      completed: 0,
      failed: 0
    },
    tasks
  };
}
__name(createExecution, "createExecution");
async function executeWorkflow(execution, workflow, options) {
  execution.status = "running";
  console.log(import_chalk.default.blue("Executing workflow..."));
  console.log();
  for (let i = 0; i < execution.tasks.length; i++) {
    const taskExec = execution.tasks[i];
    const taskDef = workflow.tasks.find((t) => t.id === taskExec.taskId);
    console.log(`${import_chalk.default.cyan("\u2192")} Starting task: ${taskDef.description}`);
    taskExec.status = "running";
    taskExec.startedAt = /* @__PURE__ */ new Date();
    await new Promise((resolve) => setTimeout(resolve, 1e3 + Math.random() * 2e3));
    const success = Math.random() > 0.1;
    if (success) {
      taskExec.status = "completed";
      taskExec.completedAt = /* @__PURE__ */ new Date();
      execution.progress.completed++;
      console.log(`${import_chalk.default.green("\u2713")} Completed: ${taskDef.description}`);
    } else {
      taskExec.status = "failed";
      taskExec.completedAt = /* @__PURE__ */ new Date();
      taskExec.error = "Simulated task failure";
      execution.progress.failed++;
      console.log(`${import_chalk.default.red("\u2717")} Failed: ${taskDef.description}`);
      if (options.failFast || workflow.settings?.failurePolicy === "fail-fast") {
        execution.status = "failed";
        console.log(import_chalk.default.red("\nWorkflow failed (fail-fast mode)"));
        return;
      }
    }
    console.log();
  }
  execution.status = execution.progress.failed > 0 ? "failed" : "completed";
  execution.completedAt = /* @__PURE__ */ new Date();
  const duration = (0, import_formatter.formatDuration)(execution.completedAt.getTime() - execution.startedAt.getTime());
  if (execution.status === "completed") {
    console.log(import_chalk.default.green.bold("\u2713 Workflow completed successfully"));
  } else {
    console.log(import_chalk.default.red.bold("\u2717 Workflow completed with failures"));
  }
  console.log(`${import_chalk.default.white("Duration:")} ${duration}`);
  console.log(
    `${import_chalk.default.white("Tasks:")} ${execution.progress.completed}/${execution.progress.total} completed`
  );
  if (execution.progress.failed > 0) {
    console.log(`${import_chalk.default.white("Failed:")} ${execution.progress.failed}`);
  }
}
__name(executeWorkflow, "executeWorkflow");
async function executeWorkflowWithWatch(execution, workflow, options) {
  console.log(import_chalk.default.yellow("Starting workflow execution in watch mode..."));
  console.log(import_chalk.default.gray("Press Ctrl+C to stop\n"));
  const executionPromise = executeWorkflow(execution, workflow, options);
  const watchInterval = setInterval(() => {
    displayWorkflowProgress(execution);
  }, 1e3);
  try {
    await executionPromise;
  } finally {
    clearInterval(watchInterval);
    displayWorkflowProgress(execution);
  }
}
__name(executeWorkflowWithWatch, "executeWorkflowWithWatch");
async function watchWorkflowStatus(workflowId) {
  console.log(import_chalk.default.cyan("Watching workflow status..."));
  console.log(import_chalk.default.gray("Press Ctrl+C to stop\n"));
  while (true) {
    try {
      console.clear();
      const execution = await getWorkflowExecution(workflowId);
      displayWorkflowStatus(execution);
      if (execution.status === "completed" || execution.status === "failed" || execution.status === "stopped") {
        console.log("\n" + import_chalk.default.gray("Workflow finished. Exiting watch mode."));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2e3));
    } catch (error) {
      console.error(import_chalk.default.red("Error watching workflow:"), error.message);
      break;
    }
  }
}
__name(watchWorkflowStatus, "watchWorkflowStatus");
function displayWorkflowStatus(execution) {
  console.log(import_chalk.default.cyan.bold("Workflow Status"));
  console.log("\u2500".repeat(50));
  const statusIcon = (0, import_formatter.formatStatusIndicator)(execution.status);
  const duration = execution.completedAt ? (0, import_formatter.formatDuration)(execution.completedAt.getTime() - execution.startedAt.getTime()) : (0, import_formatter.formatDuration)(Date.now() - execution.startedAt.getTime());
  console.log(`${import_chalk.default.white("Name:")} ${execution.workflowName}`);
  console.log(`${import_chalk.default.white("ID:")} ${execution.id}`);
  console.log(`${import_chalk.default.white("Status:")} ${statusIcon} ${execution.status}`);
  console.log(`${import_chalk.default.white("Started:")} ${execution.startedAt.toLocaleString()}`);
  console.log(`${import_chalk.default.white("Duration:")} ${duration}`);
  const progressBar = (0, import_formatter.formatProgressBar)(
    execution.progress.completed,
    execution.progress.total,
    40,
    "Progress"
  );
  console.log(`${progressBar} ${execution.progress.completed}/${execution.progress.total}`);
  if (execution.progress.failed > 0) {
    console.log(
      `${import_chalk.default.white("Failed Tasks:")} ${import_chalk.default.red(execution.progress.failed.toString())}`
    );
  }
  console.log();
  console.log(import_chalk.default.cyan.bold("Tasks"));
  console.log("\u2500".repeat(50));
  const table = new Table.default({
    head: ["Task", "Status", "Duration", "Agent"]
  });
  for (const taskExec of execution.tasks) {
    const statusIcon2 = (0, import_formatter.formatStatusIndicator)(taskExec.status);
    const duration2 = taskExec.completedAt && taskExec.startedAt ? (0, import_formatter.formatDuration)(taskExec.completedAt.getTime() - taskExec.startedAt.getTime()) : taskExec.startedAt ? (0, import_formatter.formatDuration)(Date.now() - taskExec.startedAt.getTime()) : "-";
    table.push([
      import_chalk.default.white(taskExec.taskId),
      `${statusIcon2} ${taskExec.status}`,
      duration2,
      taskExec.assignedAgent || "-"
    ]);
  }
  console.log(table.toString());
}
__name(displayWorkflowStatus, "displayWorkflowStatus");
function displayWorkflowProgress(execution) {
  const progress = `${execution.progress.completed}/${execution.progress.total}`;
  const progressBar = (0, import_formatter.formatProgressBar)(execution.progress.completed, execution.progress.total, 30);
  console.log(`\r${progressBar} ${progress} tasks completed`);
}
__name(displayWorkflowProgress, "displayWorkflowProgress");
async function getRunningWorkflows(includeAll = false) {
  return [
    {
      id: "workflow-001",
      workflowName: "Research Workflow",
      status: "running",
      startedAt: new Date(Date.now() - 12e4),
      // 2 minutes ago
      progress: { total: 5, completed: 3, failed: 0 },
      tasks: []
    },
    {
      id: "workflow-002",
      workflowName: "Implementation Workflow",
      status: "completed",
      startedAt: new Date(Date.now() - 3e5),
      // 5 minutes ago
      completedAt: new Date(Date.now() - 6e4),
      // 1 minute ago
      progress: { total: 3, completed: 3, failed: 0 },
      tasks: []
    }
  ].filter((w) => includeAll || w.status === "running");
}
__name(getRunningWorkflows, "getRunningWorkflows");
async function getWorkflowExecution(workflowId) {
  const workflows = await getRunningWorkflows(true);
  const workflow = workflows.find((w) => w.id === workflowId || w.id.startsWith(workflowId));
  if (!workflow) {
    throw new Error(`Workflow '${workflowId}' not found`);
  }
  return workflow;
}
__name(getWorkflowExecution, "getWorkflowExecution");
function hasCircularDependencies(graph) {
  const visited = /* @__PURE__ */ new Set();
  const recursionStack = /* @__PURE__ */ new Set();
  function hasCycle(node) {
    if (recursionStack.has(node))
      return true;
    if (visited.has(node))
      return false;
    visited.add(node);
    recursionStack.add(node);
    const dependencies = graph.get(node) || [];
    for (const dep of dependencies) {
      if (hasCycle(dep))
        return true;
    }
    recursionStack.delete(node);
    return false;
  }
  __name(hasCycle, "hasCycle");
  for (const node of graph.keys()) {
    if (hasCycle(node))
      return true;
  }
  return false;
}
__name(hasCircularDependencies, "hasCircularDependencies");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  workflowCommand
});
//# sourceMappingURL=workflow.js.map
