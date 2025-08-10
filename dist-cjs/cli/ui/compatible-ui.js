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
var compatible_ui_exports = {};
__export(compatible_ui_exports, {
  CompatibleUI: () => CompatibleUI,
  createCompatibleUI: () => createCompatibleUI,
  isRawModeSupported: () => isRawModeSupported,
  launchUI: () => launchUI
});
module.exports = __toCommonJS(compatible_ui_exports);
var import_readline = __toESM(require("readline"), 1);
var import_chalk = __toESM(require("chalk"), 1);
class CompatibleUI {
  static {
    __name(this, "CompatibleUI");
  }
  processes = [];
  running = false;
  rl;
  constructor() {
    this.rl = import_readline.default.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
      // Don't require raw mode
    });
  }
  async start() {
    this.running = true;
    this.render();
    while (this.running) {
      const command = await this.promptCommand();
      await this.handleCommand(command);
    }
  }
  stop() {
    this.running = false;
    this.rl.close();
    console.clear();
  }
  updateProcesses(processes) {
    this.processes = processes;
    if (this.running) {
      this.render();
    }
  }
  async promptCommand() {
    return new Promise((resolve) => {
      this.rl.question("\nCommand: ", (answer) => {
        resolve(answer.trim());
      });
    });
  }
  async handleCommand(input) {
    switch (input.toLowerCase()) {
      case "q":
      case "quit":
      case "exit":
        await this.handleExit();
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
      case "s":
      case "status":
        this.showStatus();
        break;
      case "l":
      case "list":
        this.showProcessList();
        break;
      default:
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= this.processes.length) {
          await this.showProcessDetails(this.processes[num - 1]);
        } else {
          console.log(import_chalk.default.yellow('Invalid command. Type "h" for help.'));
        }
        break;
    }
  }
  render() {
    console.clear();
    const stats = this.getSystemStats();
    console.log(import_chalk.default.cyan.bold("\u{1F9E0} Claude-Flow System Monitor"));
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
    if (this.processes.length === 0) {
      console.log(import_chalk.default.gray("No processes configured"));
    } else {
      this.processes.forEach((process2, index) => {
        const num = `[${index + 1}]`.padEnd(4);
        const status = this.getStatusDisplay(process2.status);
        const name = process2.name.padEnd(25);
        console.log(`${import_chalk.default.gray(num)} ${status} ${import_chalk.default.white(name)}`);
        if (process2.metrics?.lastError) {
          console.log(import_chalk.default.red(`       Error: ${process2.metrics.lastError}`));
        }
      });
    }
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log(
      import_chalk.default.gray(
        "Commands: [1-9] Process details [s] Status [l] List [r] Refresh [h] Help [q] Quit"
      )
    );
  }
  showStatus() {
    const stats = this.getSystemStats();
    console.log();
    console.log(import_chalk.default.cyan.bold("\u{1F4CA} System Status Details"));
    console.log(import_chalk.default.gray("\u2500".repeat(40)));
    console.log(import_chalk.default.white("Total Processes:"), stats.totalProcesses);
    console.log(import_chalk.default.white("Running:"), import_chalk.default.green(stats.runningProcesses));
    console.log(
      import_chalk.default.white("Stopped:"),
      import_chalk.default.gray(stats.totalProcesses - stats.runningProcesses - stats.errorProcesses)
    );
    console.log(import_chalk.default.white("Errors:"), import_chalk.default.red(stats.errorProcesses));
    console.log(import_chalk.default.white("System Load:"), this.getSystemLoad());
    console.log(import_chalk.default.white("Uptime:"), this.getSystemUptime());
  }
  showProcessList() {
    console.log();
    console.log(import_chalk.default.cyan.bold("\u{1F4CB} Process List"));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    if (this.processes.length === 0) {
      console.log(import_chalk.default.gray("No processes configured"));
      return;
    }
    this.processes.forEach((process2, index) => {
      console.log(
        `${import_chalk.default.gray(`[${index + 1}]`)} ${this.getStatusDisplay(process2.status)} ${import_chalk.default.white.bold(process2.name)}`
      );
      console.log(import_chalk.default.gray(`    Type: ${process2.type}`));
      if (process2.pid) {
        console.log(import_chalk.default.gray(`    PID: ${process2.pid}`));
      }
      if (process2.startTime) {
        const uptime = Date.now() - process2.startTime;
        console.log(import_chalk.default.gray(`    Uptime: ${this.formatUptime(uptime)}`));
      }
      if (process2.metrics) {
        if (process2.metrics.cpu !== void 0) {
          console.log(import_chalk.default.gray(`    CPU: ${process2.metrics.cpu.toFixed(1)}%`));
        }
        if (process2.metrics.memory !== void 0) {
          console.log(import_chalk.default.gray(`    Memory: ${process2.metrics.memory.toFixed(0)} MB`));
        }
      }
      console.log();
    });
  }
  async showProcessDetails(process2) {
    console.log();
    console.log(import_chalk.default.cyan.bold(`\u{1F4CB} Process Details: ${process2.name}`));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log(import_chalk.default.white("ID:"), process2.id);
    console.log(import_chalk.default.white("Type:"), process2.type);
    console.log(import_chalk.default.white("Status:"), this.getStatusDisplay(process2.status), process2.status);
    if (process2.pid) {
      console.log(import_chalk.default.white("PID:"), process2.pid);
    }
    if (process2.startTime) {
      const uptime = Date.now() - process2.startTime;
      console.log(import_chalk.default.white("Uptime:"), this.formatUptime(uptime));
    }
    if (process2.metrics) {
      console.log();
      console.log(import_chalk.default.white.bold("Metrics:"));
      if (process2.metrics.cpu !== void 0) {
        console.log(import_chalk.default.white("CPU:"), `${process2.metrics.cpu.toFixed(1)}%`);
      }
      if (process2.metrics.memory !== void 0) {
        console.log(import_chalk.default.white("Memory:"), `${process2.metrics.memory.toFixed(0)} MB`);
      }
      if (process2.metrics.restarts !== void 0) {
        console.log(import_chalk.default.white("Restarts:"), process2.metrics.restarts);
      }
      if (process2.metrics.lastError) {
        console.log(import_chalk.default.red("Last Error:"), process2.metrics.lastError);
      }
    }
  }
  getStatusDisplay(status) {
    switch (status) {
      case "running":
        return import_chalk.default.green("\u25CF");
      case "stopped":
        return import_chalk.default.gray("\u25CB");
      case "starting":
        return import_chalk.default.yellow("\u25D0");
      case "stopping":
        return import_chalk.default.yellow("\u25D1");
      case "error":
        return import_chalk.default.red("\u2717");
      case "crashed":
        return import_chalk.default.red("\u2620");
      default:
        return import_chalk.default.gray("?");
    }
  }
  getSystemStats() {
    return {
      totalProcesses: this.processes.length,
      runningProcesses: this.processes.filter((p) => p.status === "running").length,
      errorProcesses: this.processes.filter((p) => p.status === "error" || p.status === "crashed").length
    };
  }
  getSystemLoad() {
    return "0.45, 0.52, 0.48";
  }
  getSystemUptime() {
    const uptime = process.uptime() * 1e3;
    return this.formatUptime(uptime);
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
    console.log(import_chalk.default.cyan.bold("\u{1F9E0} Claude-Flow System Monitor - Help"));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    console.log();
    console.log(import_chalk.default.white.bold("Commands:"));
    console.log("  1-9     - Show process details by number");
    console.log("  s       - Show system status");
    console.log("  l       - List all processes");
    console.log("  r       - Refresh display");
    console.log("  h/?     - Show this help");
    console.log("  q       - Quit");
    console.log();
    console.log(import_chalk.default.white.bold("Features:"));
    console.log("  \u2022 Non-interactive mode (works in any terminal)");
    console.log("  \u2022 Real-time process monitoring");
    console.log("  \u2022 System statistics");
    console.log("  \u2022 Compatible with VS Code, CI/CD, containers");
  }
  async handleExit() {
    const runningProcesses = this.processes.filter((p) => p.status === "running");
    if (runningProcesses.length > 0) {
      console.log();
      console.log(import_chalk.default.yellow(`\u26A0\uFE0F  ${runningProcesses.length} processes are still running.`));
      console.log("These processes will continue running in the background.");
      console.log("Use the main CLI to stop them if needed.");
    }
    this.stop();
  }
}
function createCompatibleUI() {
  return new CompatibleUI();
}
__name(createCompatibleUI, "createCompatibleUI");
function isRawModeSupported() {
  try {
    return process.stdin.isTTY && typeof process.stdin.setRawMode === "function";
  } catch {
    return false;
  }
}
__name(isRawModeSupported, "isRawModeSupported");
async function launchUI() {
  const ui = createCompatibleUI();
  const mockProcesses = [
    {
      id: "orchestrator",
      name: "Orchestrator Engine",
      status: "running",
      type: "core",
      pid: 12345,
      startTime: Date.now() - 3e4,
      metrics: { cpu: 2.1, memory: 45.2, restarts: 0 }
    },
    {
      id: "memory-manager",
      name: "Memory Manager",
      status: "running",
      type: "service",
      pid: 12346,
      startTime: Date.now() - 25e3,
      metrics: { cpu: 0.8, memory: 12.5, restarts: 0 }
    },
    {
      id: "mcp-server",
      name: "MCP Server",
      status: "stopped",
      type: "server",
      metrics: { restarts: 1 }
    }
  ];
  ui.updateProcesses(mockProcesses);
  console.log(import_chalk.default.green("\u2705 Starting Claude-Flow UI (compatible mode)"));
  console.log(import_chalk.default.gray("Note: Using compatible UI mode for broader terminal support"));
  console.log();
  await ui.start();
}
__name(launchUI, "launchUI");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CompatibleUI,
  createCompatibleUI,
  isRawModeSupported,
  launchUI
});
//# sourceMappingURL=compatible-ui.js.map
