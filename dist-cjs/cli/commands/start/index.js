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
var start_exports = {};
__export(start_exports, {
  ProcessManager: () => import_process_manager.ProcessManager,
  ProcessUI: () => import_process_ui.ProcessUI,
  SystemMonitor: () => import_system_monitor.SystemMonitor,
  startCommand: () => import_start_command.startCommand
});
module.exports = __toCommonJS(start_exports);
var import_start_command = require("./start-command.js");
var import_process_manager = require("./process-manager.js");
var import_process_ui = require("./process-ui.js");
var import_system_monitor = require("./system-monitor.js");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProcessManager,
  ProcessUI,
  SystemMonitor,
  startCommand
});
//# sourceMappingURL=index.js.map
