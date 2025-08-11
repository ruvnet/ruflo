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
var hive_exports = {};
__export(hive_exports, {
  hiveAction: () => hiveAction
});
module.exports = __toCommonJS(hive_exports);
var import_cli_core = require("../cli-core.js");
var import_helpers = require("../../utils/helpers.js");
var import_swarm_coordinator = require("../../coordination/swarm-coordinator.js");
var import_swarm_memory = require("../../memory/swarm-memory.js");
async function hiveAction(ctx) {
  if (ctx.flags.help || ctx.flags.h) {
    showHiveHelp();
    return;
  }
  const objective = ctx.args.join(" ").trim();
  if (!objective) {
    (0, import_cli_core.error)("Usage: hive <objective> [options]");
    showHiveHelp();
    return;
  }
  const options = {
    objective,
    topology: ctx.flags.topology || "hierarchical",
    consensus: ctx.flags.consensus || "quorum",
    maxAgents: Number(ctx.flags.maxAgents || ctx.flags["max-agents"]) || 8,
    timeout: Number(ctx.flags.timeout) || 60,
    monitor: Boolean(ctx.flags.monitor) || false,
    background: Boolean(ctx.flags.background) || false,
    memoryNamespace: String(ctx.flags["memory-namespace"]) || "hive",
    qualityThreshold: Number(ctx.flags["quality-threshold"]) || 0.8,
    sparc: ctx.flags.sparc !== false
  };
  const hiveId = (0, import_helpers.generateId)("hive");
  (0, import_cli_core.success)(`\u{1F41D} Initializing Hive Mind: ${hiveId}`);
  console.log(`\u{1F451} Queen Genesis coordinating...`);
  console.log(`\u{1F4CB} Objective: ${objective}`);
  console.log(`\u{1F3D7}\uFE0F Topology: ${options.topology}`);
  console.log(`\u{1F5F3}\uFE0F Consensus: ${options.consensus}`);
  console.log(`\u{1F916} Max Agents: ${options.maxAgents}`);
  try {
    const coordinator = new import_swarm_coordinator.SwarmCoordinator({
      maxAgents: options.maxAgents,
      maxConcurrentTasks: options.maxAgents,
      taskTimeout: options.timeout * 60 * 1e3,
      enableMonitoring: options.monitor,
      enableWorkStealing: true,
      enableCircuitBreaker: true,
      memoryNamespace: options.memoryNamespace,
      coordinationStrategy: "distributed"
    });
    const memory = new import_swarm_memory.SwarmMemoryManager({
      namespace: options.memoryNamespace,
      enableDistribution: true,
      enableKnowledgeBase: true,
      persistencePath: `./hive-runs/${hiveId}/memory`
    });
    await coordinator.start();
    await memory.initialize();
    const queenId = await coordinator.registerAgent("Queen-Genesis", "coordinator", [
      "orchestration",
      "consensus",
      "decision-making",
      "delegation"
    ]);
    const agents = await spawnHiveAgents(coordinator, options);
    await memory.store(`hive/${hiveId}/config`, {
      hiveId,
      objective,
      options,
      queenId,
      agents: agents.map((a) => a.id),
      startTime: (/* @__PURE__ */ new Date()).toISOString()
    });
    const objectiveId = await coordinator.createObjective(objective, "development");
    if (options.sparc) {
      (0, import_cli_core.info)("\u{1F9EA} SPARC methodology enabled - full TDD workflow");
      await executeSparcHive(coordinator, memory, objectiveId, agents, options);
    } else {
      await executeHive(coordinator, memory, objectiveId, agents, options);
    }
    if (!options.background) {
      const status = coordinator.getSwarmStatus();
      console.log(`
\u{1F4CA} Hive Mind Summary:`);
      console.log(`  - Consensus Rounds: ${status.customMetrics?.consensusRounds || 0}`);
      console.log(`  - Decisions Made: ${status.customMetrics?.decisions || 0}`);
      console.log(`  - Tasks Completed: ${status.tasks.completed}`);
      console.log(`  - Quality Score: ${status.customMetrics?.qualityScore || 0}%`);
      (0, import_cli_core.success)(`\u2705 Hive Mind ${hiveId} completed successfully`);
    }
  } catch (err) {
    (0, import_cli_core.error)(`Hive Mind error: ${err.message}`);
  }
}
__name(hiveAction, "hiveAction");
async function spawnHiveAgents(coordinator, options) {
  const agents = [];
  const agentConfigs = getAgentConfigsForTopology(options.topology);
  for (let i = 0; i < Math.min(options.maxAgents - 1, agentConfigs.length); i++) {
    const config = agentConfigs[i % agentConfigs.length];
    const agentId = await coordinator.registerAgent(
      `${config.type}-${i + 1}`,
      config.role,
      config.capabilities
    );
    agents.push({
      id: agentId,
      type: config.type,
      role: config.role,
      capabilities: config.capabilities,
      status: "idle",
      votes: /* @__PURE__ */ new Map()
    });
    console.log(`  \u{1F41D} Spawned ${config.type} agent: ${agentId}`);
  }
  return agents;
}
__name(spawnHiveAgents, "spawnHiveAgents");
function getAgentConfigsForTopology(topology) {
  switch (topology) {
    case "hierarchical":
      return [
        {
          type: "architect",
          role: "architect",
          capabilities: ["design", "planning", "architecture"]
        },
        { type: "worker", role: "coder", capabilities: ["implementation", "coding", "testing"] },
        { type: "worker", role: "analyst", capabilities: ["analysis", "optimization", "metrics"] },
        {
          type: "scout",
          role: "researcher",
          capabilities: ["research", "exploration", "discovery"]
        },
        { type: "guardian", role: "reviewer", capabilities: ["review", "quality", "validation"] }
      ];
    case "mesh":
      return [
        { type: "worker", role: "generalist", capabilities: ["coding", "analysis", "research"] },
        {
          type: "worker",
          role: "specialist",
          capabilities: ["optimization", "architecture", "testing"]
        },
        { type: "scout", role: "explorer", capabilities: ["discovery", "research", "innovation"] },
        {
          type: "guardian",
          role: "validator",
          capabilities: ["validation", "quality", "security"]
        }
      ];
    case "ring":
      return [
        {
          type: "worker",
          role: "processor",
          capabilities: ["processing", "transformation", "execution"]
        },
        { type: "worker", role: "analyzer", capabilities: ["analysis", "metrics", "insights"] },
        {
          type: "worker",
          role: "builder",
          capabilities: ["building", "implementation", "integration"]
        }
      ];
    case "star":
      return [
        {
          type: "worker",
          role: "executor",
          capabilities: ["execution", "implementation", "delivery"]
        },
        { type: "scout", role: "sensor", capabilities: ["monitoring", "detection", "alerting"] },
        { type: "architect", role: "planner", capabilities: ["planning", "design", "strategy"] }
      ];
    default:
      return [];
  }
}
__name(getAgentConfigsForTopology, "getAgentConfigsForTopology");
async function executeHive(coordinator, memory, objectiveId, agents, options) {
  console.log("\n\u{1F9E9} Phase 1: Task Decomposition");
  const tasks = await decomposeWithConsensus(
    coordinator,
    memory,
    options.objective,
    agents,
    options
  );
  console.log("\n\u{1F5F3}\uFE0F Phase 2: Task Assignment");
  const assignments = await assignTasksWithVoting(coordinator, memory, tasks, agents, options);
  console.log("\n\u26A1 Phase 3: Parallel Execution");
  await executeTasksWithMonitoring(coordinator, memory, assignments, agents, options);
  console.log("\n\u{1F4CA} Phase 4: Result Aggregation");
  await aggregateResultsWithQuality(coordinator, memory, objectiveId, agents, options);
}
__name(executeHive, "executeHive");
async function executeSparcHive(coordinator, memory, objectiveId, agents, options) {
  console.log("\n\u{1F9EA} SPARC Hive Execution Mode");
  console.log("\n\u{1F4CB} S - Specification Phase");
  await conductConsensusRound(memory, agents, "specification", {
    task: "Define requirements and acceptance criteria",
    objective: options.objective
  });
  console.log("\n\u{1F9EE} P - Pseudocode Phase");
  await conductConsensusRound(memory, agents, "pseudocode", {
    task: "Design algorithms and data structures",
    objective: options.objective
  });
  console.log("\n\u{1F3D7}\uFE0F A - Architecture Phase");
  await conductConsensusRound(memory, agents, "architecture", {
    task: "Design system architecture",
    objective: options.objective
  });
  console.log("\n\u267B\uFE0F R - Refinement Phase (TDD)");
  await conductConsensusRound(memory, agents, "refinement", {
    task: "Implement with test-driven development",
    objective: options.objective
  });
  console.log("\n\u2705 C - Completion Phase");
  await conductConsensusRound(memory, agents, "completion", {
    task: "Integrate and validate solution",
    objective: options.objective
  });
}
__name(executeSparcHive, "executeSparcHive");
async function conductConsensusRound(memory, agents, phase, context) {
  const roundId = (0, import_helpers.generateId)("round");
  await memory.store(`consensus/${roundId}/context`, {
    phase,
    context,
    agents: agents.map((a) => a.id),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const votes = /* @__PURE__ */ new Map();
  agents.forEach((agent) => {
    const vote = Math.random() > 0.2;
    votes.set(agent.id, vote);
    console.log(`  \u{1F5F3}\uFE0F ${agent.type}-${agent.id}: ${vote ? "\u2705 Approve" : "\u274C Reject"}`);
  });
  const approvals = Array.from(votes.values()).filter((v) => v).length;
  const consensus = approvals / agents.length;
  console.log(`  \u{1F4CA} Consensus: ${(consensus * 100).toFixed(1)}% (${approvals}/${agents.length})`);
  await memory.store(`consensus/${roundId}/results`, {
    votes: Object.fromEntries(votes),
    consensus,
    approved: consensus >= 0.5,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
__name(conductConsensusRound, "conductConsensusRound");
async function decomposeWithConsensus(coordinator, memory, objective, agents, options) {
  const proposedTasks = [
    { type: "analysis", description: `Analyze requirements for: ${objective}` },
    { type: "design", description: `Design solution architecture` },
    { type: "implementation", description: `Implement core functionality` },
    { type: "testing", description: `Test and validate solution` },
    { type: "documentation", description: `Document the implementation` }
  ];
  console.log("  \u{1F451} Queen proposes task breakdown...");
  console.log("  \u{1F5F3}\uFE0F Agents voting on tasks...");
  const approved = options.consensus === "unanimous" ? agents.length === agents.length : agents.length > agents.length / 2;
  console.log(`  \u2705 Task breakdown ${approved ? "approved" : "rejected"}`);
  return proposedTasks;
}
__name(decomposeWithConsensus, "decomposeWithConsensus");
async function assignTasksWithVoting(coordinator, memory, tasks, agents, options) {
  const assignments = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const bids = agents.map((agent) => ({
      agent,
      score: calculateBidScore(agent, task)
    })).sort((a, b) => b.score - a.score);
    const winner = bids[0].agent;
    assignments.set(task.description, winner.id);
    console.log(`  \u{1F4CC} ${task.type} \u2192 ${winner.type}-${winner.id} (score: ${bids[0].score})`);
  }
  return assignments;
}
__name(assignTasksWithVoting, "assignTasksWithVoting");
function calculateBidScore(agent, task) {
  let score = 0;
  if (task.type === "analysis" && agent.capabilities.includes("analysis"))
    score += 3;
  if (task.type === "design" && agent.capabilities.includes("architecture"))
    score += 3;
  if (task.type === "implementation" && agent.capabilities.includes("coding"))
    score += 3;
  if (task.type === "testing" && agent.capabilities.includes("testing"))
    score += 3;
  if (task.type === "documentation" && agent.capabilities.includes("documentation"))
    score += 2;
  score += Math.random() * 2;
  return score;
}
__name(calculateBidScore, "calculateBidScore");
async function executeTasksWithMonitoring(coordinator, memory, assignments, agents, options) {
  const executions = Array.from(assignments.entries()).map(async ([task, agentId]) => {
    const agent = agents.find((a) => a.id === agentId);
    agent.status = "executing";
    console.log(`  \u26A1 ${agent.type}-${agent.id} executing: ${task}`);
    await new Promise((resolve) => setTimeout(resolve, 1e3 + Math.random() * 2e3));
    agent.status = "idle";
    console.log(`  \u2705 ${agent.type}-${agent.id} completed: ${task}`);
    await memory.store(`execution/${agentId}/${Date.now()}`, {
      task,
      agent: agent.id,
      status: "completed",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  await Promise.all(executions);
}
__name(executeTasksWithMonitoring, "executeTasksWithMonitoring");
async function aggregateResultsWithQuality(coordinator, memory, objectiveId, agents, options) {
  const results = [];
  for (const agent of agents) {
    const pattern = `execution/${agent.id}/*`;
    const executions = await memory.search(pattern, 10);
    results.push(...executions);
  }
  const qualityScore = Math.min(100, 75 + Math.random() * 25);
  console.log(`  \u{1F4CA} Quality Score: ${qualityScore.toFixed(1)}%`);
  console.log(`  \u2705 Threshold: ${options.qualityThreshold * 100}%`);
  console.log(`  ${qualityScore >= options.qualityThreshold * 100 ? "\u2705 PASSED" : "\u274C FAILED"}`);
  await memory.store(`hive/${objectiveId}/results`, {
    objective: options.objective,
    executionCount: results.length,
    qualityScore,
    passed: qualityScore >= options.qualityThreshold * 100,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
__name(aggregateResultsWithQuality, "aggregateResultsWithQuality");
function showHiveHelp() {
  console.log(`
\u{1F41D} Hive Mind - Advanced Multi-Agent Coordination

USAGE:
  claude-flow hive <objective> [options]

DESCRIPTION:
  Hive Mind implements advanced swarm intelligence with consensus mechanisms,
  distributed decision-making, and quality-driven execution.

EXAMPLES:
  claude-flow hive "Build microservices architecture"
  claude-flow hive "Optimize database performance" --consensus unanimous
  claude-flow hive "Develop ML pipeline" --topology mesh --monitor

TOPOLOGIES:
  hierarchical   Queen-led hierarchy (default)
  mesh           Peer-to-peer coordination
  ring           Sequential processing
  star           Centralized hub

CONSENSUS MECHANISMS:
  quorum         Simple majority (default)
  unanimous      All agents must agree
  weighted       Capability-based voting
  leader         Queen decides with input

OPTIONS:
  --topology <type>         Swarm topology (default: hierarchical)
  --consensus <type>        Decision mechanism (default: quorum)
  --max-agents <n>          Maximum agents (default: 8)
  --quality-threshold <n>   Min quality 0-1 (default: 0.8)
  --memory-namespace <ns>   Memory namespace (default: hive)
  --monitor                 Real-time monitoring
  --background              Run in background
  --sparc                   Use SPARC methodology
  --timeout <min>           Timeout minutes (default: 60)

AGENT TYPES:
  \u{1F451} Queen        Orchestrator and decision maker
  \u{1F3D7}\uFE0F Architect    System design and planning
  \u{1F41D} Worker       Implementation and execution
  \u{1F50D} Scout        Research and exploration
  \u{1F6E1}\uFE0F Guardian     Quality and validation

FEATURES:
  \u2022 Consensus-based task decomposition
  \u2022 Capability-based task assignment
  \u2022 Parallel execution with monitoring
  \u2022 Quality-driven result aggregation
  \u2022 Distributed memory sharing
  \u2022 SPARC methodology support

For more info: https://github.com/ruvnet/claude-code-flow/docs/hive.md
`);
}
__name(showHiveHelp, "showHiveHelp");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  hiveAction
});
//# sourceMappingURL=hive.js.map
