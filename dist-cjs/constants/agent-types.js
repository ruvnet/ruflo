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
var agent_types_exports = {};
__export(agent_types_exports, {
  LEGACY_AGENT_MAPPING: () => LEGACY_AGENT_MAPPING,
  ORCHESTRATION_STRATEGIES: () => ORCHESTRATION_STRATEGIES,
  SWARM_STRATEGIES: () => SWARM_STRATEGIES,
  VALID_ORCHESTRATION_STRATEGIES: () => VALID_ORCHESTRATION_STRATEGIES,
  VALID_SWARM_STRATEGIES: () => VALID_SWARM_STRATEGIES,
  getAgentTypeSchema: () => getAgentTypeSchema,
  getValidAgentTypes: () => getValidAgentTypes,
  isValidAgentType: () => isValidAgentType,
  resolveLegacyAgentType: () => resolveLegacyAgentType
});
module.exports = __toCommonJS(agent_types_exports);
var import_agent_loader = require("../agents/agent-loader.js");
const LEGACY_AGENT_MAPPING = import_agent_loader.LEGACY_AGENT_MAPPING;
async function getValidAgentTypes() {
  return await (0, import_agent_loader.getAvailableAgentTypes)();
}
__name(getValidAgentTypes, "getValidAgentTypes");
async function isValidAgentType(type) {
  return await (0, import_agent_loader.isValidAgentType)(type);
}
__name(isValidAgentType, "isValidAgentType");
const resolveLegacyAgentType = import_agent_loader.resolveLegacyAgentType;
async function getAgentTypeSchema() {
  const validTypes = await getValidAgentTypes();
  return {
    type: "string",
    enum: validTypes,
    description: "Type of specialized AI agent"
  };
}
__name(getAgentTypeSchema, "getAgentTypeSchema");
const SWARM_STRATEGIES = {
  AUTO: "auto",
  RESEARCH: "research",
  DEVELOPMENT: "development",
  ANALYSIS: "analysis",
  TESTING: "testing",
  OPTIMIZATION: "optimization",
  MAINTENANCE: "maintenance",
  CUSTOM: "custom"
};
const VALID_SWARM_STRATEGIES = Object.values(SWARM_STRATEGIES);
const ORCHESTRATION_STRATEGIES = {
  PARALLEL: "parallel",
  SEQUENTIAL: "sequential",
  ADAPTIVE: "adaptive",
  BALANCED: "balanced"
};
const VALID_ORCHESTRATION_STRATEGIES = Object.values(ORCHESTRATION_STRATEGIES);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LEGACY_AGENT_MAPPING,
  ORCHESTRATION_STRATEGIES,
  SWARM_STRATEGIES,
  VALID_ORCHESTRATION_STRATEGIES,
  VALID_SWARM_STRATEGIES,
  getAgentTypeSchema,
  getValidAgentTypes,
  isValidAgentType,
  resolveLegacyAgentType
});
//# sourceMappingURL=agent-types.js.map
