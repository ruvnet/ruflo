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
  SystemEvents: () => SystemEvents
});
module.exports = __toCommonJS(types_exports);
var SystemEvents = /* @__PURE__ */ ((SystemEvents2) => {
  SystemEvents2["AGENT_SPAWNED"] = "agent:spawned";
  SystemEvents2["AGENT_TERMINATED"] = "agent:terminated";
  SystemEvents2["AGENT_ERROR"] = "agent:error";
  SystemEvents2["AGENT_IDLE"] = "agent:idle";
  SystemEvents2["AGENT_ACTIVE"] = "agent:active";
  SystemEvents2["TASK_CREATED"] = "task:created";
  SystemEvents2["TASK_ASSIGNED"] = "task:assigned";
  SystemEvents2["TASK_STARTED"] = "task:started";
  SystemEvents2["TASK_COMPLETED"] = "task:completed";
  SystemEvents2["TASK_FAILED"] = "task:failed";
  SystemEvents2["TASK_CANCELLED"] = "task:cancelled";
  SystemEvents2["MEMORY_CREATED"] = "memory:created";
  SystemEvents2["MEMORY_UPDATED"] = "memory:updated";
  SystemEvents2["MEMORY_DELETED"] = "memory:deleted";
  SystemEvents2["MEMORY_SYNCED"] = "memory:synced";
  SystemEvents2["SYSTEM_READY"] = "system:ready";
  SystemEvents2["SYSTEM_SHUTDOWN"] = "system:shutdown";
  SystemEvents2["SYSTEM_ERROR"] = "system:error";
  SystemEvents2["SYSTEM_HEALTHCHECK"] = "system:healthcheck";
  SystemEvents2["RESOURCE_ACQUIRED"] = "resource:acquired";
  SystemEvents2["RESOURCE_RELEASED"] = "resource:released";
  SystemEvents2["DEADLOCK_DETECTED"] = "deadlock:detected";
  SystemEvents2["MESSAGE_SENT"] = "message:sent";
  SystemEvents2["MESSAGE_RECEIVED"] = "message:received";
  return SystemEvents2;
})(SystemEvents || {});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SystemEvents
});
//# sourceMappingURL=types.js.map
