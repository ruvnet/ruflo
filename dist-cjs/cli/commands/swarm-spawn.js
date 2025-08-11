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
var swarm_spawn_exports = {};
__export(swarm_spawn_exports, {
  getSwarmState: () => getSwarmState,
  initializeSwarm: () => initializeSwarm,
  monitorSwarm: () => monitorSwarm,
  spawnSwarmAgent: () => spawnSwarmAgent
});
module.exports = __toCommonJS(swarm_spawn_exports);
const swarmStates = /* @__PURE__ */ new Map();
function initializeSwarm(swarmId, objective) {
  swarmStates.set(swarmId, {
    swarmId,
    objective,
    agents: /* @__PURE__ */ new Map(),
    startTime: Date.now()
  });
}
__name(initializeSwarm, "initializeSwarm");
async function spawnSwarmAgent(swarmId, agentType, task) {
  const swarm = swarmStates.get(swarmId);
  if (!swarm) {
    throw new Error(`Swarm ${swarmId} not found`);
  }
  const agentId = `${swarmId}-agent-${Date.now()}`;
  const agent = {
    id: agentId,
    type: agentType,
    status: "active",
    name: `${agentType}-${agentId}`,
    task
  };
  swarm.agents.set(agentId, agent);
  console.log(`[SWARM] Spawned ${agentType} agent: ${agentId}`);
  console.log(`[SWARM] Task: ${task}`);
  return agentId;
}
__name(spawnSwarmAgent, "spawnSwarmAgent");
async function monitorSwarm(swarmId) {
  const swarm = swarmStates.get(swarmId);
  if (!swarm) {
    throw new Error(`Swarm ${swarmId} not found`);
  }
  let running = true;
  const interval = setInterval(() => {
    if (!running) {
      clearInterval(interval);
      return;
    }
    console.log(`[MONITOR] Swarm ${swarmId} - Agents: ${swarm.agents.size}`);
    const activeAgents = Array.from(swarm.agents.values()).filter(
      (a) => a.status === "active"
    ).length;
    console.log(`[MONITOR] Active: ${activeAgents}`);
  }, 5e3);
  setTimeout(
    () => {
      running = false;
    },
    60 * 60 * 1e3
  );
}
__name(monitorSwarm, "monitorSwarm");
function getSwarmState(swarmId) {
  return swarmStates.get(swarmId);
}
__name(getSwarmState, "getSwarmState");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getSwarmState,
  initializeSwarm,
  monitorSwarm,
  spawnSwarmAgent
});
//# sourceMappingURL=swarm-spawn.js.map
