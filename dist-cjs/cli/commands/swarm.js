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
var swarm_exports = {};
__export(swarm_exports, {
  swarmAction: () => swarmAction
});
module.exports = __toCommonJS(swarm_exports);
const import_meta = {};
var import_helpers = require("../../utils/helpers.js");
var import_node_fs = require("node:fs");
var import_cli_core = require("../cli-core.js");
var import_background_executor = require("../../coordination/background-executor.js");
var import_swarm_coordinator = require("../../coordination/swarm-coordinator.js");
var import_swarm_memory = require("../../memory/swarm-memory.js");
async function swarmAction(ctx) {
  if (ctx.flags.help || ctx.flags.h) {
    return;
  }
  const objective = ctx.args.join(" ").trim();
  if (!objective) {
    (0, import_cli_core.error)("Usage: swarm <objective>");
    console.log("\nExamples:");
    console.log('  claude-flow swarm "Build a REST API"');
    console.log('  claude-flow swarm "Research cloud architecture"');
    console.log("\nOptions:");
    console.log("  --dry-run              Show configuration without executing");
    console.log("  --strategy <type>      Strategy: auto, research, development, analysis");
    console.log("  --max-agents <n>       Maximum number of agents (default: 5)");
    console.log("  --timeout <minutes>    Timeout in minutes (default: 60)");
    console.log("  --research             Enable research capabilities");
    console.log("  --parallel             Enable parallel execution");
    console.log("  --review               Enable peer review between agents");
    console.log("  --monitor              Enable real-time monitoring");
    console.log("  --ui                   Use blessed terminal UI (requires node.js)");
    console.log("  --background           Run swarm in background mode");
    console.log("  --distributed          Enable distributed coordination");
    console.log("  --memory-namespace     Memory namespace for swarm (default: swarm)");
    console.log("  --persistence          Enable task persistence (default: true)");
    return;
  }
  const options = {
    strategy: ctx.flags.strategy || "auto",
    maxAgents: ctx.flags.maxAgents || ctx.flags["max-agents"] || 5,
    maxDepth: ctx.flags.maxDepth || ctx.flags["max-depth"] || 3,
    research: ctx.flags.research || false,
    parallel: ctx.flags.parallel || false,
    memoryNamespace: ctx.flags.memoryNamespace || ctx.flags["memory-namespace"] || "swarm",
    timeout: ctx.flags.timeout || 60,
    review: ctx.flags.review || false,
    coordinator: ctx.flags.coordinator || false,
    config: ctx.flags.config || ctx.flags.c,
    verbose: ctx.flags.verbose || ctx.flags.v || false,
    dryRun: ctx.flags.dryRun || ctx.flags["dry-run"] || ctx.flags.d || false,
    monitor: ctx.flags.monitor || false,
    ui: ctx.flags.ui || false,
    background: ctx.flags.background || false,
    persistence: ctx.flags.persistence || true,
    distributed: ctx.flags.distributed || false
  };
  const swarmId = (0, import_helpers.generateId)("swarm");
  if (options.dryRun) {
    (0, import_cli_core.warning)("DRY RUN - Swarm Configuration:");
    console.log(`Swarm ID: ${swarmId}`);
    console.log(`Objective: ${objective}`);
    console.log(`Strategy: ${options.strategy}`);
    console.log(`Max Agents: ${options.maxAgents}`);
    console.log(`Max Depth: ${options.maxDepth}`);
    console.log(`Research: ${options.research}`);
    console.log(`Parallel: ${options.parallel}`);
    console.log(`Review Mode: ${options.review}`);
    console.log(`Coordinator: ${options.coordinator}`);
    console.log(`Memory Namespace: ${options.memoryNamespace}`);
    console.log(`Timeout: ${options.timeout} minutes`);
    return;
  }
  if (options.ui) {
    try {
      const scriptPath = new URL(import_meta.url).pathname;
      const projectRoot = scriptPath.substring(0, scriptPath.indexOf("/src/"));
      const uiScriptPath = `${projectRoot}/src/cli/simple-commands/swarm-ui.js`;
      try {
        await import_node_fs.promises.stat(uiScriptPath);
      } catch {
        (0, import_cli_core.warning)("Swarm UI script not found. Falling back to standard mode.");
        options.ui = false;
      }
      if (options.ui) {
        const command = new Deno.Command("node", {
          args: [uiScriptPath],
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit"
        });
        const process = command.spawn();
        const { code } = await process.status;
        if (code !== 0) {
          (0, import_cli_core.error)(`Swarm UI exited with code ${code}`);
        }
        return;
      }
    } catch (err) {
      (0, import_cli_core.warning)(`Failed to launch blessed UI: ${err.message}`);
      console.log("Falling back to standard mode...");
      options.ui = false;
    }
  }
  (0, import_cli_core.success)(`\u{1F41D} Initializing Claude Swarm: ${swarmId}`);
  console.log(`\u{1F4CB} Objective: ${objective}`);
  console.log(`\u{1F3AF} Strategy: ${options.strategy}`);
  try {
    const coordinator = new import_swarm_coordinator.SwarmCoordinator({
      maxAgents: options.maxAgents,
      maxConcurrentTasks: options.parallel ? options.maxAgents : 1,
      taskTimeout: options.timeout * 60 * 1e3,
      // Convert minutes to milliseconds
      enableMonitoring: options.monitor,
      enableWorkStealing: options.parallel,
      enableCircuitBreaker: true,
      memoryNamespace: options.memoryNamespace,
      coordinationStrategy: options.distributed ? "distributed" : "centralized"
    });
    const executor = new import_background_executor.BackgroundExecutor({
      maxConcurrentTasks: options.maxAgents,
      defaultTimeout: options.timeout * 60 * 1e3,
      logPath: `./swarm-runs/${swarmId}/background-tasks`,
      enablePersistence: options.persistence
    });
    const memory = new import_swarm_memory.SwarmMemoryManager({
      namespace: options.memoryNamespace,
      enableDistribution: options.distributed,
      enableKnowledgeBase: true,
      persistencePath: `./swarm-runs/${swarmId}/memory`
    });
    await coordinator.start();
    await executor.start();
    await memory.initialize();
    const swarmDir = `./swarm-runs/${swarmId}`;
    await Deno.mkdir(swarmDir, { recursive: true });
    const objectiveId = await coordinator.createObjective(
      objective,
      options.strategy || "auto"
    );
    console.log(`
\u{1F4DD} Objective created with ID: ${objectiveId}`);
    const agentTypes = getAgentTypesForStrategy(options.strategy);
    const agents = [];
    for (let i = 0; i < Math.min(options.maxAgents, agentTypes.length); i++) {
      const agentType = agentTypes[i % agentTypes.length];
      const agentId = await coordinator.registerAgent(
        `${agentType}-${i + 1}`,
        agentType,
        getCapabilitiesForType(agentType)
      );
      agents.push(agentId);
      console.log(`  \u{1F916} Registered ${agentType} agent: ${agentId}`);
    }
    await import_node_fs.promises.writeFile(
      `${swarmDir}/config.json`,
      JSON.stringify(
        {
          swarmId,
          objectiveId,
          objective,
          options,
          agents,
          startTime: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      )
    );
    await coordinator.executeObjective(objectiveId);
    console.log(`
\u{1F680} Swarm execution started...`);
    if (options.background) {
      console.log(
        `Running in background mode. Check status with: claude-flow swarm status ${swarmId}`
      );
      await import_node_fs.promises.writeFile(
        `${swarmDir}/coordinator.json`,
        JSON.stringify(
          {
            coordinatorRunning: true,
            pid: Deno.pid,
            startTime: (/* @__PURE__ */ new Date()).toISOString()
          },
          null,
          2
        )
      );
    } else {
      await waitForObjectiveCompletion(coordinator, objectiveId, options);
      await import_node_fs.promises.writeFile(
        `${swarmDir}/status.json`,
        JSON.stringify(
          {
            status: "completed",
            endTime: (/* @__PURE__ */ new Date()).toISOString()
          },
          null,
          2
        )
      );
      const swarmStatus = coordinator.getSwarmStatus();
      console.log(`
\u{1F4CA} Swarm Summary:`);
      console.log(`  - Objectives: ${swarmStatus.objectives}`);
      console.log(`  - Tasks Completed: ${swarmStatus.tasks.completed}`);
      console.log(`  - Tasks Failed: ${swarmStatus.tasks.failed}`);
      console.log(`  - Agents Used: ${swarmStatus.agents.total}`);
      console.log(`  - Results saved to: ${swarmDir}`);
      (0, import_cli_core.success)(`
\u2705 Swarm ${swarmId} completed successfully`);
    }
    if (!options.background) {
      await coordinator.stop();
      await executor.stop();
      await memory.shutdown();
    }
  } catch (err) {
    (0, import_cli_core.error)(`Failed to execute swarm: ${err.message}`);
  }
}
__name(swarmAction, "swarmAction");
async function decomposeObjective(objective, options) {
  const subtasks = [];
  switch (options.strategy) {
    case "research":
      subtasks.push(
        { type: "research", description: `Research background information on: ${objective}` },
        { type: "analysis", description: `Analyze findings and identify key patterns` },
        { type: "synthesis", description: `Synthesize research into actionable insights` }
      );
      break;
    case "development":
      subtasks.push(
        { type: "planning", description: `Plan architecture and design for: ${objective}` },
        { type: "implementation", description: `Implement core functionality` },
        { type: "testing", description: `Test and validate implementation` },
        { type: "documentation", description: `Document the solution` }
      );
      break;
    case "analysis":
      subtasks.push(
        { type: "data-gathering", description: `Gather relevant data for: ${objective}` },
        { type: "analysis", description: `Perform detailed analysis` },
        { type: "visualization", description: `Create visualizations and reports` }
      );
      break;
    default:
      if (objective.toLowerCase().includes("build") || objective.toLowerCase().includes("create")) {
        subtasks.push(
          { type: "planning", description: `Plan solution for: ${objective}` },
          { type: "implementation", description: `Implement the solution` },
          { type: "testing", description: `Test and validate` }
        );
      } else if (objective.toLowerCase().includes("research") || objective.toLowerCase().includes("analyze")) {
        subtasks.push(
          { type: "research", description: `Research: ${objective}` },
          { type: "analysis", description: `Analyze findings` },
          { type: "report", description: `Generate report` }
        );
      } else {
        subtasks.push(
          { type: "exploration", description: `Explore requirements for: ${objective}` },
          { type: "execution", description: `Execute main tasks` },
          { type: "validation", description: `Validate results` }
        );
      }
  }
  return subtasks;
}
__name(decomposeObjective, "decomposeObjective");
async function executeParallelTasks(tasks, options, swarmId, swarmDir) {
  const promises = tasks.map(async (task, index) => {
    const agentId = (0, import_helpers.generateId)("agent");
    console.log(`  \u{1F916} Spawning agent ${agentId} for: ${task.type}`);
    const agentDir = `${swarmDir}/agents/${agentId}`;
    await Deno.mkdir(agentDir, { recursive: true });
    await import_node_fs.promises.writeFile(
      `${agentDir}/task.json`,
      JSON.stringify(
        {
          agentId,
          swarmId,
          task,
          status: "active",
          startTime: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      )
    );
    await executeAgentTask(agentId, task, options, agentDir);
    await import_node_fs.promises.writeFile(
      `${agentDir}/status.json`,
      JSON.stringify(
        {
          status: "completed",
          endTime: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      )
    );
    console.log(`  \u2705 Agent ${agentId} completed: ${task.type}`);
  });
  await Promise.all(promises);
}
__name(executeParallelTasks, "executeParallelTasks");
async function executeSequentialTasks(tasks, options, swarmId, swarmDir) {
  for (const [index, task] of tasks.entries()) {
    const agentId = (0, import_helpers.generateId)("agent");
    console.log(`  \u{1F916} Spawning agent ${agentId} for: ${task.type}`);
    const agentDir = `${swarmDir}/agents/${agentId}`;
    await Deno.mkdir(agentDir, { recursive: true });
    await import_node_fs.promises.writeFile(
      `${agentDir}/task.json`,
      JSON.stringify(
        {
          agentId,
          swarmId,
          task,
          status: "active",
          startTime: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      )
    );
    await executeAgentTask(agentId, task, options, agentDir);
    await import_node_fs.promises.writeFile(
      `${agentDir}/status.json`,
      JSON.stringify(
        {
          status: "completed",
          endTime: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      )
    );
    console.log(`  \u2705 Agent ${agentId} completed: ${task.type}`);
  }
}
__name(executeSequentialTasks, "executeSequentialTasks");
async function executeAgentTask(agentId, task, options, agentDir) {
  console.log(`    \u2192 Executing: ${task.type} task`);
  try {
    const checkClaude = new Deno.Command("which", { args: ["claude"] });
    const checkResult = await checkClaude.output();
    if (checkResult.success && options.simulate !== true) {
      const promptFile = `${agentDir}/prompt.txt`;
      const prompt = `You are an AI agent with ID: ${agentId}

Your task type is: ${task.type}
Your specific task is: ${task.description}

Please execute this task and provide a detailed response.
${task.type === "research" ? "Use web search and research tools as needed." : ""}
${task.type === "implementation" ? "Write clean, well-documented code." : ""}
${task.type === "testing" ? "Create comprehensive tests." : ""}

Provide your output in a structured format.

When you're done, please end with "TASK COMPLETED" on its own line.`;
      await import_node_fs.promises.writeFile(promptFile, prompt);
      let tools = "View,GlobTool,GrepTool,LS";
      if (task.type === "research" || options.research) {
        tools = "WebFetchTool,WebSearch";
      } else if (task.type === "implementation") {
        tools = "View,Edit,Replace,GlobTool,GrepTool,LS,Bash";
      }
      const claudeArgs = [
        "-p",
        // Non-interactive print mode
        task.description,
        // The prompt
        "--dangerously-skip-permissions",
        "--allowedTools",
        tools
      ];
      await import_node_fs.promises.writeFile(`${agentDir}/command.txt`, `claude ${claudeArgs.join(" ")}`);
      console.log(`    \u2192 Running: ${task.description}`);
      const wrapperScript = `#!/bin/bash
claude ${claudeArgs.map((arg) => `"${arg}"`).join(" ")} | tee "${agentDir}/output.txt"
exit \${PIPESTATUS[0]}`;
      const wrapperPath = `${agentDir}/wrapper.sh`;
      await import_node_fs.promises.writeFile(wrapperPath, wrapperScript);
      await Deno.chmod(wrapperPath, 493);
      console.log(`    \u250C\u2500 Claude Output \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
      const command = new Deno.Command("bash", {
        args: [wrapperPath],
        stdout: "inherit",
        // This allows real-time streaming to console
        stderr: "inherit"
      });
      try {
        const process = command.spawn();
        const { code, success: success2 } = await process.status;
        console.log(`    \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
        if (!success2) {
          throw new Error(`Claude exited with code ${code}`);
        }
        console.log(`    \u2713 Task completed`);
      } catch (err) {
        throw err;
      }
    } else {
      console.log(`    \u2192 Simulating: ${task.type} (claude CLI not available)`);
      const claudeFlowArgs = ["claude", "spawn", task.description];
      if (task.type === "research" || options.research) {
        claudeFlowArgs.push("--research");
      }
      if (options.parallel) {
        claudeFlowArgs.push("--parallel");
      }
      console.log(`    \u2192 Using: claude-flow ${claudeFlowArgs.join(" ")}`);
      const claudeFlowPath = new URL(import_meta.url).pathname;
      const projectRoot = claudeFlowPath.substring(0, claudeFlowPath.indexOf("/src/"));
      const claudeFlowBin = `${projectRoot}/bin/claude-flow`;
      const command = new Deno.Command(claudeFlowBin, {
        args: claudeFlowArgs,
        stdout: "piped",
        stderr: "piped"
      });
      const { code, stdout, stderr } = await command.output();
      await import_node_fs.promises.writeFile(`${agentDir}/output.txt`, new TextDecoder().decode(stdout));
      if (stderr.length > 0) {
        await import_node_fs.promises.writeFile(`${agentDir}/error.txt`, new TextDecoder().decode(stderr));
      }
      if (code !== 0) {
        console.log(`    \u26A0\uFE0F  Command exited with code ${code}`);
      }
    }
  } catch (err) {
    console.log(`    \u26A0\uFE0F  Error executing task: ${err.message}`);
    await import_node_fs.promises.writeFile(`${agentDir}/error.txt`, err.message);
  }
}
__name(executeAgentTask, "executeAgentTask");
function getAgentTypesForStrategy(strategy) {
  switch (strategy) {
    case "research":
      return ["researcher", "analyst", "coordinator"];
    case "development":
      return ["coder", "analyst", "reviewer", "coordinator"];
    case "analysis":
      return ["analyst", "researcher", "coordinator"];
    default:
      return ["coordinator", "researcher", "coder", "analyst"];
  }
}
__name(getAgentTypesForStrategy, "getAgentTypesForStrategy");
function getCapabilitiesForType(type) {
  switch (type) {
    case "researcher":
      return ["web-search", "data-collection", "analysis", "documentation"];
    case "coder":
      return ["coding", "testing", "debugging", "architecture"];
    case "analyst":
      return ["data-analysis", "visualization", "reporting", "insights"];
    case "reviewer":
      return ["code-review", "quality-assurance", "validation", "testing"];
    case "coordinator":
      return ["planning", "coordination", "task-management", "communication"];
    default:
      return ["general"];
  }
}
__name(getCapabilitiesForType, "getCapabilitiesForType");
async function waitForObjectiveCompletion(coordinator, objectiveId, options) {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      if (!objective) {
        clearInterval(checkInterval);
        resolve();
        return;
      }
      if (objective.status === "completed" || objective.status === "failed") {
        clearInterval(checkInterval);
        resolve();
        return;
      }
      if (options.verbose) {
        const swarmStatus = coordinator.getSwarmStatus();
        console.log(
          `Progress: ${swarmStatus.tasks.completed}/${swarmStatus.tasks.total} tasks completed`
        );
      }
    }, 5e3);
    setTimeout(
      () => {
        clearInterval(checkInterval);
        console.log("\u26A0\uFE0F  Swarm execution timed out");
        resolve();
      },
      options.timeout * 60 * 1e3
    );
  });
}
__name(waitForObjectiveCompletion, "waitForObjectiveCompletion");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  swarmAction
});
//# sourceMappingURL=swarm.js.map
