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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var types_exports = {};
__export(types_exports, {
  ProcessStatus: () => ProcessStatus,
  ProcessType: () => ProcessType
});
module.exports = __toCommonJS(types_exports);
var ProcessType = /* @__PURE__ */ ((ProcessType2) => {
  ProcessType2["ORCHESTRATOR"] = "orchestrator";
  ProcessType2["MCP_SERVER"] = "mcp-server";
  ProcessType2["MEMORY_MANAGER"] = "memory-manager";
  ProcessType2["TERMINAL_POOL"] = "terminal-pool";
  ProcessType2["COORDINATOR"] = "coordinator";
  ProcessType2["EVENT_BUS"] = "event-bus";
  return ProcessType2;
})(ProcessType || {});
var ProcessStatus = /* @__PURE__ */ ((ProcessStatus2) => {
  ProcessStatus2["STOPPED"] = "stopped";
  ProcessStatus2["STARTING"] = "starting";
  ProcessStatus2["RUNNING"] = "running";
  ProcessStatus2["STOPPING"] = "stopping";
  ProcessStatus2["ERROR"] = "error";
  ProcessStatus2["CRASHED"] = "crashed";
  return ProcessStatus2;
})(ProcessStatus || {});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProcessStatus,
  ProcessType
});
//# sourceMappingURL=types.js.map
