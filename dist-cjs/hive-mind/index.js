"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var hive_mind_exports = {};
__export(hive_mind_exports, {
  Agent: () => import_Agent.Agent,
  Communication: () => import_Communication.Communication,
  ConsensusEngine: () => import_ConsensusEngine.ConsensusEngine,
  DatabaseManager: () => import_DatabaseManager.DatabaseManager,
  HiveMind: () => import_HiveMind.HiveMind,
  MCPToolWrapper: () => import_MCPToolWrapper.MCPToolWrapper,
  Memory: () => import_Memory.Memory,
  Queen: () => import_Queen.Queen,
  SwarmOrchestrator: () => import_SwarmOrchestrator.SwarmOrchestrator,
  default: () => import_HiveMind2.HiveMind
});
module.exports = __toCommonJS(hive_mind_exports);
var import_HiveMind = require("./core/HiveMind.js");
var import_Queen = require("./core/Queen.js");
var import_Agent = require("./core/Agent.js");
var import_Memory = require("./core/Memory.js");
var import_Communication = require("./core/Communication.js");
var import_DatabaseManager = require("./core/DatabaseManager.js");
var import_MCPToolWrapper = require("./integration/MCPToolWrapper.js");
var import_SwarmOrchestrator = require("./integration/SwarmOrchestrator.js");
var import_ConsensusEngine = require("./integration/ConsensusEngine.js");
__reExport(hive_mind_exports, require("./types.js"), module.exports);
var import_HiveMind2 = require("./core/HiveMind.js");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Agent,
  Communication,
  ConsensusEngine,
  DatabaseManager,
  HiveMind,
  MCPToolWrapper,
  Memory,
  Queen,
  SwarmOrchestrator,
  ...require("./types.js")
});
//# sourceMappingURL=index.js.map
