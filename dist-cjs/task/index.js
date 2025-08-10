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
  CLI_EXAMPLES: () => CLI_EXAMPLES,
  TaskCoordinator: () => import_coordination.TaskCoordinator,
  TaskEngine: () => import_engine.TaskEngine,
  USAGE_EXAMPLES: () => USAGE_EXAMPLES,
  createTaskCancelCommand: () => import_commands.createTaskCancelCommand,
  createTaskCreateCommand: () => import_commands.createTaskCreateCommand,
  createTaskListCommand: () => import_commands.createTaskListCommand,
  createTaskStatusCommand: () => import_commands.createTaskStatusCommand,
  createTaskTodos: () => createTaskTodos,
  createTaskWorkflowCommand: () => import_commands.createTaskWorkflowCommand,
  default: () => task_default,
  initializeTaskManagement: () => initializeTaskManagement,
  launchParallelAgents: () => launchParallelAgents,
  retrieveCoordinationData: () => retrieveCoordinationData,
  storeCoordinationData: () => storeCoordinationData
});
module.exports = __toCommonJS(task_exports);
var import_engine = require("./engine.js");
var import_commands = require("./commands.js");
var import_coordination = require("./coordination.js");
async function initializeTaskManagement(config = {}) {
  const { TaskEngine: TaskEngine2 } = await import("./engine.js");
  const { TaskCoordinator: TaskCoordinator2 } = await import("./coordination.js");
  const {
    createTaskCreateCommand: createTaskCreateCommand2,
    createTaskListCommand: createTaskListCommand2,
    createTaskStatusCommand: createTaskStatusCommand2,
    createTaskCancelCommand: createTaskCancelCommand2,
    createTaskWorkflowCommand: createTaskWorkflowCommand2
  } = await import("./commands.js");
  const taskEngine = new TaskEngine2(config.maxConcurrentTasks || 10, config.memoryManager);
  const taskCoordinator = new TaskCoordinator2(taskEngine, config.memoryManager);
  const commandContext = {
    taskEngine,
    taskCoordinator,
    memoryManager: config.memoryManager,
    logger: config.logger
  };
  const commands = {
    create: createTaskCreateCommand2(commandContext),
    list: createTaskListCommand2(commandContext),
    status: createTaskStatusCommand2(commandContext),
    cancel: createTaskCancelCommand2(commandContext),
    workflow: createTaskWorkflowCommand2(commandContext)
  };
  return {
    taskEngine,
    taskCoordinator,
    commands
  };
}
__name(initializeTaskManagement, "initializeTaskManagement");
async function createTaskTodos(objective, options = {}, coordinator) {
  if (!coordinator) {
    throw new Error("TaskCoordinator instance required for todo creation");
  }
  const context = {
    sessionId: `session-${Date.now()}`,
    coordinationMode: options.batchOptimized ? "distributed" : "centralized"
  };
  return await coordinator.createTaskTodos(objective, context, options);
}
__name(createTaskTodos, "createTaskTodos");
async function launchParallelAgents(tasks, coordinator) {
  if (!coordinator) {
    throw new Error("TaskCoordinator instance required for agent launching");
  }
  const context = {
    sessionId: `session-${Date.now()}`,
    coordinationMode: "distributed"
  };
  return await coordinator.launchParallelAgents(tasks, context);
}
__name(launchParallelAgents, "launchParallelAgents");
async function storeCoordinationData(key, value, options = {}, coordinator) {
  if (!coordinator) {
    throw new Error("TaskCoordinator instance required for memory storage");
  }
  await coordinator.storeInMemory(key, value, options);
}
__name(storeCoordinationData, "storeCoordinationData");
async function retrieveCoordinationData(key, namespace, coordinator) {
  if (!coordinator) {
    throw new Error("TaskCoordinator instance required for memory retrieval");
  }
  return await coordinator.retrieveFromMemory(key, namespace);
}
__name(retrieveCoordinationData, "retrieveCoordinationData");
const USAGE_EXAMPLES = {
  todoWrite: `
// Example: Using TodoWrite for task coordination
import { createTaskTodos } from './task.js';

const todos = await createTaskTodos(
  "Build e-commerce platform",
  {
    strategy: 'development',
    batchOptimized: true,
    parallelExecution: true,
    memoryCoordination: true
  },
  coordinator
);

// This creates a structured todo list with:
// - System architecture design (high priority)
// - Frontend development (parallel execution)
// - Backend development (parallel execution) 
// - Testing and integration (depends on frontend/backend)
`,
  taskTool: `
// Example: Using Task tool pattern for parallel agents
import { launchParallelAgents } from './task.js';

const agentIds = await launchParallelAgents([
  {
    agentType: 'researcher',
    objective: 'Research best practices for microservices',
    mode: 'researcher',
    memoryKey: 'microservices_research',
    batchOptimized: true
  },
  {
    agentType: 'architect',
    objective: 'Design system architecture based on research',
    mode: 'architect',
    memoryKey: 'system_architecture',
    batchOptimized: true
  },
  {
    agentType: 'coder',
    objective: 'Implement core services',
    mode: 'coder',
    memoryKey: 'core_implementation',
    batchOptimized: true
  }
], coordinator);
`,
  memoryCoordination: `
// Example: Using Memory for cross-agent coordination
import { storeCoordinationData, retrieveCoordinationData } from './task.js';

// Store research findings for other agents
await storeCoordinationData(
  'research_findings',
  {
    bestPractices: [...],
    technologies: [...],
    patterns: [...]
  },
  {
    namespace: 'project_coordination',
    tags: ['research', 'architecture']
  },
  coordinator
);

// Retrieve findings in another agent
const findings = await retrieveCoordinationData(
  'research_findings',
  'project_coordination',
  coordinator
);
`,
  batchOperations: `
// Example: Coordinated batch operations
import { TaskCoordinator } from './task.js';

const results = await coordinator.coordinateBatchOperations([
  {
    type: 'read',
    targets: ['src/**/*.ts'],
    configuration: { pattern: 'class.*{' }
  },
  {
    type: 'analyze',
    targets: ['package.json', 'tsconfig.json'],
    configuration: { focus: 'dependencies' }
  },
  {
    type: 'search',
    targets: ['docs/**/*.md'],
    configuration: { term: 'API documentation' }
  }
], context);
`,
  swarmCoordination: `
// Example: Swarm coordination patterns
await coordinator.coordinateSwarm(
  "Comprehensive system development",
  {
    sessionId: 'dev-session-1',
    coordinationMode: 'hierarchical'
  },
  [
    { type: 'lead-architect', role: 'team-lead', capabilities: ['design', 'coordination'] },
    { type: 'frontend-dev-1', role: 'coder', capabilities: ['react', 'ui'] },
    { type: 'frontend-dev-2', role: 'coder', capabilities: ['react', 'testing'] },
    { type: 'backend-dev-1', role: 'coder', capabilities: ['nodejs', 'api'] },
    { type: 'backend-dev-2', role: 'coder', capabilities: ['database', 'scaling'] },
    { type: 'devops-engineer', role: 'specialist', capabilities: ['deployment', 'monitoring'] }
  ]
);
`
};
const CLI_EXAMPLES = {
  taskCreate: `
# Create a complex task with dependencies and scheduling
claude-flow task create development "Implement user authentication system" \\
  --priority 80 \\
  --dependencies "task-123,task-456" \\
  --dep-type finish-to-start \\
  --assign backend-team \\
  --tags "auth,security,backend" \\
  --deadline "2024-02-15T18:00:00Z" \\
  --cpu 2 \\
  --memory 1024 \\
  --max-retries 5 \\
  --rollback previous-checkpoint
`,
  taskList: `
# List tasks with advanced filtering and visualization
claude-flow task list \\
  --status running,pending \\
  --priority 70-100 \\
  --tags auth,security \\
  --sort deadline \\
  --sort-dir asc \\
  --format table \\
  --show-dependencies \\
  --show-progress \\
  --limit 20
`,
  taskStatus: `
# Get detailed task status with all metrics
claude-flow task status task-789 \\
  --show-logs \\
  --show-checkpoints \\
  --show-metrics \\
  --show-dependencies \\
  --show-resources \\
  --watch
`,
  taskCancel: `
# Cancel task with safe rollback and cascade
claude-flow task cancel task-789 \\
  --reason "Requirements changed" \\
  --cascade \\
  --dry-run
`,
  taskWorkflow: `
# Create and execute workflows
claude-flow task workflow create "E-commerce Platform" \\
  --description "Complete e-commerce development workflow" \\
  --max-concurrent 8 \\
  --strategy priority-based \\
  --error-handling continue-on-error

claude-flow task workflow execute workflow-123 \\
  --variables '{"environment":"staging","version":"2.1.0"}' \\
  --monitor

claude-flow task workflow visualize workflow-123 \\
  --format dot \\
  --output workflow-graph.dot
`
};
var task_default = {
  initializeTaskManagement,
  createTaskTodos,
  launchParallelAgents,
  storeCoordinationData,
  retrieveCoordinationData,
  USAGE_EXAMPLES,
  CLI_EXAMPLES
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLI_EXAMPLES,
  TaskCoordinator,
  TaskEngine,
  USAGE_EXAMPLES,
  createTaskCancelCommand,
  createTaskCreateCommand,
  createTaskListCommand,
  createTaskStatusCommand,
  createTaskTodos,
  createTaskWorkflowCommand,
  initializeTaskManagement,
  launchParallelAgents,
  retrieveCoordinationData,
  storeCoordinationData
});
//# sourceMappingURL=index.js.map
