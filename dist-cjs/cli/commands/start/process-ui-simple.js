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
var process_ui_simple_exports = {};
__export(process_ui_simple_exports, {
  ProcessUI: () => ProcessUI
});
module.exports = __toCommonJS(process_ui_simple_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_types = require("./types.js");
class ProcessUI {
  static {
    __name(this, "ProcessUI");
  }
  processManager;
  running = false;
  selectedIndex = 0;
  constructor(processManager) {
    this.processManager = processManager;
    this.setupEventListeners();
  }
  setupEventListeners() {
    this.processManager.on(
      "statusChanged",
      ({ processId, status }) => {
        if (this.running) {
          this.render();
        }
      }
    );
    this.processManager.on(
      "processError",
      ({ processId, error }) => {
        if (this.running) {
          console.log(
            import_chalk.default.red(
              `
Process ${processId} error: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      }
    );
  }
  async start() {
    this.running = true;
    console.clear();
    this.render();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    while (this.running) {
      await Deno.stdout.write(encoder.encode("\nCommand: "));
      const buf = new Uint8Array(1024);
      const n = await Deno.stdin.read(buf);
      if (n === null)
        break;
      const input = decoder.decode(buf.subarray(0, n)).trim();
      if (input.length > 0) {
        await this.handleCommand(input);
      }
    }
  }
  async stop() {
    this.running = false;
    console.clear();
  }
  async handleCommand(input) {
    const processes = this.processManager.getAllProcesses();
    switch (input.toLowerCase()) {
      case "q":
      case "quit":
      case "exit":
        await this.handleExit();
        break;
      case "a":
      case "all":
        await this.startAll();
        break;
      case "z":
      case "stop-all":
        await this.stopAll();
        break;
      case "r":
      case "refresh":
        this.render();
        break;
      case "h":
      case "help":
      case "?":
        this.showHelp();
        break;
      default:
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= processes.length) {
          this.selectedIndex = num - 1;
          await this.showProcessMenu(processes[this.selectedIndex]);
        } else {
          console.log(import_chalk.default.yellow('Invalid command. Type "h" for help.'));
        }
        break;
    }
  }
  render() {
    console.clear();
    const processes = this.processManager.getAllProcesses();
    const stats = this.processManager.getSystemStats();
    console.log(import_chalk.default.cyan.bold("\u{1F9E0} Claude-Flow Process Manager"));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log(
      import_chalk.default.white("System Status:"),
      import_chalk.default.green(`${stats.runningProcesses}/${stats.totalProcesses} running`)
    );
    if (stats.errorProcesses > 0) {
      console.log(import_chalk.default.red(`\u26A0\uFE0F  ${stats.errorProcesses} processes with errors`));
    }
    console.log();
    console.log(import_chalk.default.white.bold("Processes:"));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    processes.forEach((process, index) => {
      const num = `[${index + 1}]`.padEnd(4);
      const status = this.getStatusDisplay(process.status);
      const name = process.name.padEnd(25);
      console.log(`${import_chalk.default.gray(num)} ${status} ${import_chalk.default.white(name)}`);
      if (process.metrics?.lastError) {
        console.log(import_chalk.default.red(`       Error: ${process.metrics.lastError}`));
      }
    });
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log(import_chalk.default.gray("Commands: [1-9] Select process [a] Start All [z] Stop All"));
    console.log(import_chalk.default.gray("[r] Refresh [h] Help [q] Quit"));
  }
  async showProcessMenu(process) {
    console.log();
    console.log(import_chalk.default.cyan.bold(`Selected: ${process.name}`));
    console.log(import_chalk.default.gray("\u2500".repeat(40)));
    if (process.status === import_types.ProcessStatus.STOPPED) {
      console.log("[s] Start");
    } else if (process.status === import_types.ProcessStatus.RUNNING) {
      console.log("[x] Stop");
      console.log("[r] Restart");
    }
    console.log("[d] Details");
    console.log("[c] Cancel");
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    await Deno.stdout.write(encoder.encode("\nAction: "));
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    if (n === null)
      return;
    const action = decoder.decode(buf.subarray(0, n)).trim().toLowerCase();
    switch (action) {
      case "s":
        if (process.status === import_types.ProcessStatus.STOPPED) {
          await this.startProcess(process.id);
        }
        break;
      case "x":
        if (process.status === import_types.ProcessStatus.RUNNING) {
          await this.stopProcess(process.id);
        }
        break;
      case "r":
        if (process.status === import_types.ProcessStatus.RUNNING) {
          await this.restartProcess(process.id);
        }
        break;
      case "d":
        this.showProcessDetails(process);
        await this.waitForKey();
        break;
    }
    this.render();
  }
  showProcessDetails(process) {
    console.log();
    console.log(import_chalk.default.cyan.bold(`\u{1F4CB} Process Details: ${process.name}`));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log(import_chalk.default.white("ID:"), process.id);
    console.log(import_chalk.default.white("Type:"), process.type);
    console.log(import_chalk.default.white("Status:"), this.getStatusDisplay(process.status), process.status);
    if (process.pid) {
      console.log(import_chalk.default.white("PID:"), process.pid);
    }
    if (process.startTime) {
      const uptime = Date.now() - process.startTime;
      console.log(import_chalk.default.white("Uptime:"), this.formatUptime(uptime));
    }
    if (process.metrics) {
      console.log();
      console.log(import_chalk.default.white.bold("Metrics:"));
      if (process.metrics.cpu !== void 0) {
        console.log(import_chalk.default.white("CPU:"), `${process.metrics.cpu.toFixed(1)}%`);
      }
      if (process.metrics.memory !== void 0) {
        console.log(import_chalk.default.white("Memory:"), `${process.metrics.memory.toFixed(0)} MB`);
      }
      if (process.metrics.restarts !== void 0) {
        console.log(import_chalk.default.white("Restarts:"), process.metrics.restarts);
      }
      if (process.metrics.lastError) {
        console.log(import_chalk.default.red("Last Error:"), process.metrics.lastError);
      }
    }
    console.log();
    console.log(import_chalk.default.gray("Press any key to continue..."));
  }
  async waitForKey() {
    const buf = new Uint8Array(1);
    await Deno.stdin.read(buf);
  }
  getStatusDisplay(status) {
    switch (status) {
      case import_types.ProcessStatus.RUNNING:
        return import_chalk.default.green("\u25CF");
      case import_types.ProcessStatus.STOPPED:
        return import_chalk.default.gray("\u25CB");
      case import_types.ProcessStatus.STARTING:
        return import_chalk.default.yellow("\u25D0");
      case import_types.ProcessStatus.STOPPING:
        return import_chalk.default.yellow("\u25D1");
      case import_types.ProcessStatus.ERROR:
        return import_chalk.default.red("\u2717");
      case import_types.ProcessStatus.CRASHED:
        return import_chalk.default.red("\u2620");
      default:
        return import_chalk.default.gray("?");
    }
  }
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1e3);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  showHelp() {
    console.log();
    console.log(import_chalk.default.cyan.bold("\u{1F9E0} Claude-Flow Process Manager - Help"));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log();
    console.log(import_chalk.default.white.bold("Commands:"));
    console.log("  1-9     - Select process by number");
    console.log("  a       - Start all processes");
    console.log("  z       - Stop all processes");
    console.log("  r       - Refresh display");
    console.log("  h/?     - Show this help");
    console.log("  q       - Quit");
    console.log();
    console.log(import_chalk.default.white.bold("Process Actions:"));
    console.log("  s       - Start selected process");
    console.log("  x       - Stop selected process");
    console.log("  r       - Restart selected process");
    console.log("  d       - Show process details");
    console.log();
    console.log(import_chalk.default.gray("Press any key to continue..."));
  }
  async startProcess(processId) {
    try {
      console.log(import_chalk.default.yellow(`Starting ${processId}...`));
      await this.processManager.startProcess(processId);
      console.log(import_chalk.default.green(`\u2713 Started ${processId}`));
    } catch (error) {
      console.log(import_chalk.default.red(`\u2717 Failed to start ${processId}: ${error.message}`));
    }
    await this.waitForKey();
  }
  async stopProcess(processId) {
    try {
      console.log(import_chalk.default.yellow(`Stopping ${processId}...`));
      await this.processManager.stopProcess(processId);
      console.log(import_chalk.default.green(`\u2713 Stopped ${processId}`));
    } catch (error) {
      console.log(import_chalk.default.red(`\u2717 Failed to stop ${processId}: ${error.message}`));
    }
    await this.waitForKey();
  }
  async restartProcess(processId) {
    try {
      console.log(import_chalk.default.yellow(`Restarting ${processId}...`));
      await this.processManager.restartProcess(processId);
      console.log(import_chalk.default.green(`\u2713 Restarted ${processId}`));
    } catch (error) {
      console.log(import_chalk.default.red(`\u2717 Failed to restart ${processId}: ${error.message}`));
    }
    await this.waitForKey();
  }
  async startAll() {
    try {
      console.log(import_chalk.default.yellow("Starting all processes..."));
      await this.processManager.startAll();
      console.log(import_chalk.default.green("\u2713 All processes started"));
    } catch (error) {
      console.log(import_chalk.default.red(`\u2717 Failed to start all: ${error.message}`));
    }
    await this.waitForKey();
    this.render();
  }
  async stopAll() {
    try {
      console.log(import_chalk.default.yellow("Stopping all processes..."));
      await this.processManager.stopAll();
      console.log(import_chalk.default.green("\u2713 All processes stopped"));
    } catch (error) {
      console.log(import_chalk.default.red(`\u2717 Failed to stop all: ${error.message}`));
    }
    await this.waitForKey();
    this.render();
  }
  async handleExit() {
    const processes = this.processManager.getAllProcesses();
    const hasRunning = processes.some((p) => p.status === import_types.ProcessStatus.RUNNING);
    if (hasRunning) {
      console.log();
      console.log(import_chalk.default.yellow("\u26A0\uFE0F  Some processes are still running."));
      console.log("Stop all processes before exiting? [y/N]: ");
      const decoder = new TextDecoder();
      const buf = new Uint8Array(1024);
      const n = await Deno.stdin.read(buf);
      if (n && decoder.decode(buf.subarray(0, n)).trim().toLowerCase() === "y") {
        await this.stopAll();
      }
    }
    await this.stop();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProcessUI
});
//# sourceMappingURL=process-ui-simple.js.map
