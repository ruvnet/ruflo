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
var process_manager_exports = {};
__export(process_manager_exports, {
  ProcessManager: () => ProcessManager
});
module.exports = __toCommonJS(process_manager_exports);
var import_event_emitter = require("./event-emitter.js");
var import_chalk = __toESM(require("chalk"), 1);
var import_types = require("./types.js");
var import_orchestrator = require("../../../core/orchestrator.js");
var import_manager = require("../../../terminal/manager.js");
var import_manager2 = require("../../../memory/manager.js");
var import_manager3 = require("../../../coordination/manager.js");
var import_server = require("../../../mcp/server.js");
var import_event_bus = require("../../../core/event-bus.js");
var import_logger = require("../../../core/logger.js");
var import_config = require("../../../core/config.js");
class ProcessManager extends import_event_emitter.EventEmitter {
  static {
    __name(this, "ProcessManager");
  }
  processes = /* @__PURE__ */ new Map();
  orchestrator;
  terminalManager;
  memoryManager;
  coordinationManager;
  mcpServer;
  config;
  constructor() {
    super();
    this.initializeProcesses();
  }
  initializeProcesses() {
    const processDefinitions = [
      {
        id: "event-bus",
        name: "Event Bus",
        type: import_types.ProcessType.EVENT_BUS,
        status: import_types.ProcessStatus.STOPPED
      },
      {
        id: "orchestrator",
        name: "Orchestrator Engine",
        type: import_types.ProcessType.ORCHESTRATOR,
        status: import_types.ProcessStatus.STOPPED
      },
      {
        id: "memory-manager",
        name: "Memory Manager",
        type: import_types.ProcessType.MEMORY_MANAGER,
        status: import_types.ProcessStatus.STOPPED
      },
      {
        id: "terminal-pool",
        name: "Terminal Pool",
        type: import_types.ProcessType.TERMINAL_POOL,
        status: import_types.ProcessStatus.STOPPED
      },
      {
        id: "mcp-server",
        name: "MCP Server",
        type: import_types.ProcessType.MCP_SERVER,
        status: import_types.ProcessStatus.STOPPED
      },
      {
        id: "coordinator",
        name: "Coordination Manager",
        type: import_types.ProcessType.COORDINATOR,
        status: import_types.ProcessStatus.STOPPED
      }
    ];
    for (const process of processDefinitions) {
      this.processes.set(process.id, process);
    }
  }
  async initialize(configPath) {
    try {
      this.config = await import_config.configManager.load(configPath);
      this.emit("initialized", { config: this.config });
    } catch (error) {
      this.emit("error", { component: "ProcessManager", error });
      throw error;
    }
  }
  async startProcess(processId) {
    const process = this.processes.get(processId);
    if (!process) {
      throw new Error(`Unknown process: ${processId}`);
    }
    if (process.status === import_types.ProcessStatus.RUNNING) {
      throw new Error(`Process ${processId} is already running`);
    }
    this.updateProcessStatus(processId, import_types.ProcessStatus.STARTING);
    try {
      switch (process.type) {
        case import_types.ProcessType.EVENT_BUS:
          process.pid = Deno.pid;
          break;
        case import_types.ProcessType.MEMORY_MANAGER:
          this.memoryManager = new import_manager2.MemoryManager(this.config.memory, import_event_bus.eventBus, import_logger.logger);
          await this.memoryManager.initialize();
          break;
        case import_types.ProcessType.TERMINAL_POOL:
          this.terminalManager = new import_manager.TerminalManager(this.config.terminal, import_event_bus.eventBus, import_logger.logger);
          await this.terminalManager.initialize();
          break;
        case import_types.ProcessType.COORDINATOR:
          this.coordinationManager = new import_manager3.CoordinationManager(
            this.config.coordination,
            import_event_bus.eventBus,
            import_logger.logger
          );
          await this.coordinationManager.initialize();
          break;
        case import_types.ProcessType.MCP_SERVER:
          this.mcpServer = new import_server.MCPServer(this.config.mcp, import_event_bus.eventBus, import_logger.logger);
          await this.mcpServer.start();
          break;
        case import_types.ProcessType.ORCHESTRATOR:
          if (!this.terminalManager || !this.memoryManager || !this.coordinationManager || !this.mcpServer) {
            throw new Error("Required components not initialized");
          }
          this.orchestrator = new import_orchestrator.Orchestrator(
            this.config,
            this.terminalManager,
            this.memoryManager,
            this.coordinationManager,
            this.mcpServer,
            import_event_bus.eventBus,
            import_logger.logger
          );
          await this.orchestrator.initialize();
          break;
      }
      process.startTime = Date.now();
      this.updateProcessStatus(processId, import_types.ProcessStatus.RUNNING);
      this.emit("processStarted", { processId, process });
    } catch (error) {
      this.updateProcessStatus(processId, import_types.ProcessStatus.ERROR);
      process.metrics = {
        ...process.metrics,
        lastError: error.message
      };
      this.emit("processError", { processId, error });
      throw error;
    }
  }
  async stopProcess(processId) {
    const process = this.processes.get(processId);
    if (!process || process.status !== import_types.ProcessStatus.RUNNING) {
      throw new Error(`Process ${processId} is not running`);
    }
    this.updateProcessStatus(processId, import_types.ProcessStatus.STOPPING);
    try {
      switch (process.type) {
        case import_types.ProcessType.ORCHESTRATOR:
          if (this.orchestrator) {
            await this.orchestrator.shutdown();
            this.orchestrator = void 0;
          }
          break;
        case import_types.ProcessType.MCP_SERVER:
          if (this.mcpServer) {
            await this.mcpServer.stop();
            this.mcpServer = void 0;
          }
          break;
        case import_types.ProcessType.MEMORY_MANAGER:
          if (this.memoryManager) {
            await this.memoryManager.shutdown();
            this.memoryManager = void 0;
          }
          break;
        case import_types.ProcessType.TERMINAL_POOL:
          if (this.terminalManager) {
            await this.terminalManager.shutdown();
            this.terminalManager = void 0;
          }
          break;
        case import_types.ProcessType.COORDINATOR:
          if (this.coordinationManager) {
            await this.coordinationManager.shutdown();
            this.coordinationManager = void 0;
          }
          break;
      }
      this.updateProcessStatus(processId, import_types.ProcessStatus.STOPPED);
      this.emit("processStopped", { processId });
    } catch (error) {
      this.updateProcessStatus(processId, import_types.ProcessStatus.ERROR);
      this.emit("processError", { processId, error });
      throw error;
    }
  }
  async restartProcess(processId) {
    await this.stopProcess(processId);
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    await this.startProcess(processId);
  }
  async startAll() {
    const startOrder = [
      "event-bus",
      "memory-manager",
      "terminal-pool",
      "coordinator",
      "mcp-server",
      "orchestrator"
    ];
    for (const processId of startOrder) {
      try {
        await this.startProcess(processId);
      } catch (error) {
        console.error(import_chalk.default.red(`Failed to start ${processId}:`), error.message);
      }
    }
  }
  async stopAll() {
    const stopOrder = [
      "orchestrator",
      "mcp-server",
      "coordinator",
      "terminal-pool",
      "memory-manager",
      "event-bus"
    ];
    for (const processId of stopOrder) {
      const process = this.processes.get(processId);
      if (process && process.status === import_types.ProcessStatus.RUNNING) {
        try {
          await this.stopProcess(processId);
        } catch (error) {
          console.error(import_chalk.default.red(`Failed to stop ${processId}:`), error.message);
        }
      }
    }
  }
  getProcess(processId) {
    return this.processes.get(processId);
  }
  getAllProcesses() {
    return Array.from(this.processes.values());
  }
  getSystemStats() {
    const processes = this.getAllProcesses();
    const runningProcesses = processes.filter((p) => p.status === import_types.ProcessStatus.RUNNING);
    const stoppedProcesses = processes.filter((p) => p.status === import_types.ProcessStatus.STOPPED);
    const errorProcesses = processes.filter((p) => p.status === import_types.ProcessStatus.ERROR);
    return {
      totalProcesses: processes.length,
      runningProcesses: runningProcesses.length,
      stoppedProcesses: stoppedProcesses.length,
      errorProcesses: errorProcesses.length,
      systemUptime: this.getSystemUptime(),
      totalMemory: this.getTotalMemoryUsage(),
      totalCpu: this.getTotalCpuUsage()
    };
  }
  updateProcessStatus(processId, status) {
    const process = this.processes.get(processId);
    if (process) {
      process.status = status;
      this.emit("statusChanged", { processId, status });
    }
  }
  getSystemUptime() {
    const orchestrator = this.processes.get("orchestrator");
    if (orchestrator && orchestrator.startTime) {
      return Date.now() - orchestrator.startTime;
    }
    return 0;
  }
  getTotalMemoryUsage() {
    return 0;
  }
  getTotalCpuUsage() {
    return 0;
  }
  async getProcessLogs(processId, lines = 50) {
    return [
      `[${(/* @__PURE__ */ new Date()).toISOString()}] Process ${processId} started`,
      `[${(/* @__PURE__ */ new Date()).toISOString()}] Process ${processId} is running normally`
    ];
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProcessManager
});
//# sourceMappingURL=process-manager.js.map
