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
var commands_exports = {};
__export(commands_exports, {
  createTaskCancelCommand: () => createTaskCancelCommand,
  createTaskCreateCommand: () => createTaskCreateCommand,
  createTaskListCommand: () => createTaskListCommand,
  createTaskStatusCommand: () => createTaskStatusCommand,
  createTaskWorkflowCommand: () => createTaskWorkflowCommand
});
module.exports = __toCommonJS(commands_exports);
function createTaskCreateCommand(context) {
  return {
    name: "create",
    description: "Create a new task",
    execute: async (args) => {
      try {
        const task = await context.taskEngine.createTask(args);
        context.logger?.info("Task created successfully", { taskId: task.id });
        return task;
      } catch (error) {
        context.logger?.error("Failed to create task", error);
        throw error;
      }
    }
  };
}
__name(createTaskCreateCommand, "createTaskCreateCommand");
function createTaskListCommand(context) {
  return {
    name: "list",
    description: "List all tasks",
    execute: async (filter, sort, limit, offset) => {
      try {
        const result = await context.taskEngine.listTasks(filter, sort, limit, offset);
        context.logger?.info("Tasks listed successfully", { count: result.tasks.length });
        return result;
      } catch (error) {
        context.logger?.error("Failed to list tasks", error);
        throw error;
      }
    }
  };
}
__name(createTaskListCommand, "createTaskListCommand");
function createTaskStatusCommand(context) {
  return {
    name: "status",
    description: "Get task status",
    execute: async (taskId) => {
      try {
        const status = await context.taskEngine.getTaskStatus(taskId);
        if (!status) {
          throw new Error(`Task ${taskId} not found`);
        }
        context.logger?.info("Task status retrieved", { taskId });
        return status;
      } catch (error) {
        context.logger?.error("Failed to get task status", error);
        throw error;
      }
    }
  };
}
__name(createTaskStatusCommand, "createTaskStatusCommand");
function createTaskCancelCommand(context) {
  return {
    name: "cancel",
    description: "Cancel a task",
    execute: async (taskId, reason = "User requested", rollback = true) => {
      try {
        await context.taskEngine.cancelTask(taskId, reason, rollback);
        context.logger?.info("Task cancelled successfully", { taskId, reason });
        return { success: true, taskId, reason };
      } catch (error) {
        context.logger?.error("Failed to cancel task", error);
        throw error;
      }
    }
  };
}
__name(createTaskCancelCommand, "createTaskCancelCommand");
function createTaskWorkflowCommand(context) {
  return {
    name: "workflow",
    description: "Manage task workflows",
    execute: async (action, ...args) => {
      try {
        switch (action) {
          case "create":
            const [workflowData] = args;
            const createdWorkflow = await context.taskEngine.createWorkflow(workflowData);
            context.logger?.info("Workflow created successfully", {
              workflowId: createdWorkflow.id
            });
            return createdWorkflow;
          case "execute":
            const [workflowToExecute] = args;
            await context.taskEngine.executeWorkflow(workflowToExecute);
            context.logger?.info("Workflow execution started", {
              workflowId: workflowToExecute.id
            });
            return { success: true, workflowId: workflowToExecute.id };
          case "list":
            context.logger?.info("Workflow list requested");
            return { workflows: [] };
          case "get":
            const [workflowId] = args;
            context.logger?.info("Workflow details requested", { workflowId });
            return { workflowId };
          default:
            throw new Error(`Unknown workflow action: ${action}`);
        }
      } catch (error) {
        context.logger?.error("Workflow operation failed", error);
        throw error;
      }
    }
  };
}
__name(createTaskWorkflowCommand, "createTaskWorkflowCommand");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createTaskCancelCommand,
  createTaskCreateCommand,
  createTaskListCommand,
  createTaskStatusCommand,
  createTaskWorkflowCommand
});
//# sourceMappingURL=commands.js.map
