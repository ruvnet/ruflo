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
var types_exports = {};
__export(types_exports, {
  SWARM_CONSTANTS: () => SWARM_CONSTANTS,
  default: () => types_default,
  isAgentId: () => isAgentId,
  isAgentState: () => isAgentState,
  isSwarmEvent: () => isSwarmEvent,
  isTaskDefinition: () => isTaskDefinition,
  isTaskId: () => isTaskId
});
module.exports = __toCommonJS(types_exports);
function isAgentId(obj) {
  return obj && typeof obj.id === "string" && typeof obj.swarmId === "string";
}
__name(isAgentId, "isAgentId");
function isTaskId(obj) {
  return obj && typeof obj.id === "string" && typeof obj.swarmId === "string";
}
__name(isTaskId, "isTaskId");
function isSwarmEvent(obj) {
  return obj && typeof obj.id === "string" && typeof obj.type === "string";
}
__name(isSwarmEvent, "isSwarmEvent");
function isTaskDefinition(obj) {
  return obj && isTaskId(obj.id) && typeof obj.type === "string";
}
__name(isTaskDefinition, "isTaskDefinition");
function isAgentState(obj) {
  return obj && isAgentId(obj.id) && typeof obj.status === "string";
}
__name(isAgentState, "isAgentState");
const SWARM_CONSTANTS = {
  // Timeouts
  DEFAULT_TASK_TIMEOUT: 5 * 60 * 1e3,
  // 5 minutes
  DEFAULT_AGENT_TIMEOUT: 30 * 1e3,
  // 30 seconds
  DEFAULT_HEARTBEAT_INTERVAL: 10 * 1e3,
  // 10 seconds
  // Limits
  MAX_AGENTS_PER_SWARM: 100,
  MAX_TASKS_PER_AGENT: 10,
  MAX_RETRIES: 3,
  // Quality thresholds
  MIN_QUALITY_THRESHOLD: 0.7,
  DEFAULT_QUALITY_THRESHOLD: 0.8,
  HIGH_QUALITY_THRESHOLD: 0.9,
  // Performance targets
  DEFAULT_THROUGHPUT_TARGET: 10,
  // tasks per minute
  DEFAULT_LATENCY_TARGET: 1e3,
  // milliseconds
  DEFAULT_RELIABILITY_TARGET: 0.95,
  // 95%
  // Resource limits
  DEFAULT_MEMORY_LIMIT: 512 * 1024 * 1024,
  // 512MB
  DEFAULT_CPU_LIMIT: 1,
  // 1 CPU core
  DEFAULT_DISK_LIMIT: 1024 * 1024 * 1024
  // 1GB
};
var types_default = {
  // Type exports are handled by TypeScript
  SWARM_CONSTANTS,
  // Utility functions
  isAgentId,
  isTaskId,
  isSwarmEvent,
  isTaskDefinition,
  isAgentState
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SWARM_CONSTANTS,
  isAgentId,
  isAgentState,
  isSwarmEvent,
  isTaskDefinition,
  isTaskId
});
//# sourceMappingURL=types.js.map
