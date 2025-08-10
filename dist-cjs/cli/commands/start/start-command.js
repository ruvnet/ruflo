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
var start_command_exports = {};
__export(start_command_exports, {
  startCommand: () => startCommand
});
module.exports = __toCommonJS(start_command_exports);
var import_node_fs = require("node:fs");
var import_command = require("@cliffy/command");
var import_chalk = __toESM(require("chalk"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_process_manager = require("./process-manager.js");
var import_process_ui = require("./process-ui.js");
var import_system_monitor = require("./system-monitor.js");
var import_event_bus = require("../../../core/event-bus.js");
const startCommand = new import_command.Command().description("Start the Claude-Flow orchestration system").option("-d, --daemon", "Run as daemon in background").option("-p, --port <port:number>", "MCP server port", { default: 3e3 }).option("--mcp-transport <transport:string>", "MCP transport type (stdio, http)", {
  default: "stdio"
}).option("-u, --ui", "Launch interactive process management UI").option("-v, --verbose", "Enable verbose logging").option("--auto-start", "Automatically start all processes").option("--config <path:string>", "Configuration file path").option("--force", "Force start even if already running").option("--health-check", "Perform health checks before starting").option("--timeout <seconds:number>", "Startup timeout in seconds", { default: 60 }).action(async (options) => {
  console.log(import_chalk.default.cyan("\u{1F9E0} Claude-Flow Orchestration System"));
  console.log(import_chalk.default.gray("\u2500".repeat(60)));
  try {
    if (!options.force && await isSystemRunning()) {
      console.log(import_chalk.default.yellow("\u26A0 Claude-Flow is already running"));
      const { shouldContinue } = await import_inquirer.default.prompt([
        {
          type: "confirm",
          name: "shouldContinue",
          message: "Stop existing instance and restart?",
          default: false
        }
      ]);
      if (!shouldContinue) {
        console.log(import_chalk.default.gray('Use --force to override or "claude-flow stop" first'));
        return;
      }
      await stopExistingInstance();
    }
    if (options.healthCheck) {
      console.log(import_chalk.default.blue("Running pre-flight health checks..."));
      await performHealthChecks();
    }
    const processManager = new import_process_manager.ProcessManager();
    console.log(import_chalk.default.blue("Initializing system components..."));
    const initPromise = processManager.initialize(options.config);
    const timeoutPromise = new Promise(
      (_, reject) => setTimeout(
        () => reject(new Error("Initialization timeout")),
        (options.timeout || 30) * 1e3
      )
    );
    await Promise.race([initPromise, timeoutPromise]);
    const systemMonitor = new import_system_monitor.SystemMonitor(processManager);
    systemMonitor.start();
    setupSystemEventHandlers(processManager, systemMonitor, options);
    if (options.port) {
      const mcpProcess = processManager.getProcess("mcp-server");
      if (mcpProcess) {
        mcpProcess.config = { ...mcpProcess.config, port: options.port };
      }
    }
    if (options.mcpTransport) {
      const mcpProcess = processManager.getProcess("mcp-server");
      if (mcpProcess) {
        mcpProcess.config = { ...mcpProcess.config, transport: options.mcpTransport };
      }
    }
    if (options.verbose) {
      setupVerboseLogging(systemMonitor);
    }
    if (options.ui) {
      try {
        const { ClaudeCodeWebServer } = await import("../../simple-commands/web-server.js");
        console.log(import_chalk.default.blue("Starting Web UI server..."));
        const webServer = new ClaudeCodeWebServer(options.port);
        await webServer.start();
        const openCommand = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        try {
          const { exec } = await import("child_process");
          exec(`${openCommand} http://localhost:${options.port}/console`);
        } catch {
        }
        console.log(
          import_chalk.default.green("\u2728 Web UI is running at:"),
          import_chalk.default.cyan(`http://localhost:${options.port}/console`)
        );
        console.log(import_chalk.default.gray("Press Ctrl+C to stop"));
        const shutdownWebUI = /* @__PURE__ */ __name(async () => {
          console.log("\n" + import_chalk.default.yellow("Shutting down Web UI..."));
          await webServer.stop();
          systemMonitor.stop();
          await processManager.stopAll();
          console.log(import_chalk.default.green("\u2713 Shutdown complete"));
          process.exit(0);
        }, "shutdownWebUI");
        Deno.addSignalListener("SIGINT", shutdownWebUI);
        Deno.addSignalListener("SIGTERM", shutdownWebUI);
        await new Promise(() => {
        });
      } catch (webError) {
        console.log(import_chalk.default.yellow("Web UI not available, falling back to Terminal UI"));
        const ui = new import_process_ui.ProcessUI(processManager);
        await ui.start();
        systemMonitor.stop();
        await processManager.stopAll();
        console.log(import_chalk.default.green.bold("\u2713"), "Shutdown complete");
        process.exit(0);
      }
    } else if (options.daemon) {
      console.log(import_chalk.default.yellow("Starting in daemon mode..."));
      if (options.autoStart) {
        console.log(import_chalk.default.blue("Starting all system processes..."));
        await startWithProgress(processManager, "all");
      } else {
        console.log(import_chalk.default.blue("Starting core processes..."));
        await startWithProgress(processManager, "core");
      }
      const pid = Deno.pid;
      const pidData = {
        pid,
        startTime: Date.now(),
        config: options.config || "default",
        processes: processManager.getAllProcesses().map((p) => ({ id: p.id, status: p.status }))
      };
      await import_node_fs.promises.writeFile(".claude-flow.pid", JSON.stringify(pidData, null, 2));
      console.log(import_chalk.default.gray(`Process ID: ${pid}`));
      await waitForSystemReady(processManager);
      console.log(import_chalk.default.green.bold("\u2713"), "Daemon started successfully");
      console.log(import_chalk.default.gray('Use "claude-flow status" to check system status'));
      console.log(import_chalk.default.gray('Use "claude-flow monitor" for real-time monitoring'));
      await new Promise(() => {
      });
    } else {
      console.log(import_chalk.default.cyan("Starting in interactive mode..."));
      console.log();
      console.log(import_chalk.default.white.bold("Quick Actions:"));
      console.log("  [1] Start all processes");
      console.log("  [2] Start core processes only");
      console.log("  [3] Launch process management UI");
      console.log("  [4] Show system status");
      console.log("  [q] Quit");
      console.log();
      console.log(import_chalk.default.gray("Press a key to select an option..."));
      const decoder = new TextDecoder();
      while (true) {
        const buf = new Uint8Array(1);
        await Deno.stdin.read(buf);
        const key = decoder.decode(buf);
        switch (key) {
          case "1":
            console.log(import_chalk.default.cyan("\nStarting all processes..."));
            await startWithProgress(processManager, "all");
            console.log(import_chalk.default.green.bold("\u2713"), "All processes started");
            break;
          case "2":
            console.log(import_chalk.default.cyan("\nStarting core processes..."));
            await startWithProgress(processManager, "core");
            console.log(import_chalk.default.green.bold("\u2713"), "Core processes started");
            break;
          case "3":
            const ui = new import_process_ui.ProcessUI(processManager);
            await ui.start();
            break;
          case "4":
            console.clear();
            systemMonitor.printSystemHealth();
            console.log();
            systemMonitor.printEventLog(10);
            console.log();
            console.log(import_chalk.default.gray("Press any key to continue..."));
            await Deno.stdin.read(new Uint8Array(1));
            break;
          case "q":
          case "Q":
            console.log(import_chalk.default.yellow("\nShutting down..."));
            await processManager.stopAll();
            systemMonitor.stop();
            console.log(import_chalk.default.green.bold("\u2713"), "Shutdown complete");
            process.exit(0);
            break;
        }
        console.clear();
        console.log(import_chalk.default.cyan("\u{1F9E0} Claude-Flow Interactive Mode"));
        console.log(import_chalk.default.gray("\u2500".repeat(60)));
        const stats = processManager.getSystemStats();
        console.log(
          import_chalk.default.white("System Status:"),
          import_chalk.default.green(`${stats.runningProcesses}/${stats.totalProcesses} processes running`)
        );
        console.log();
        console.log(import_chalk.default.white.bold("Quick Actions:"));
        console.log("  [1] Start all processes");
        console.log("  [2] Start core processes only");
        console.log("  [3] Launch process management UI");
        console.log("  [4] Show system status");
        console.log("  [q] Quit");
        console.log();
        console.log(import_chalk.default.gray("Press a key to select an option..."));
      }
    }
  } catch (error) {
    console.error(import_chalk.default.red.bold("Failed to start:"), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    console.log(import_chalk.default.yellow("Performing cleanup..."));
    try {
      await cleanupOnFailure();
    } catch (cleanupError) {
      console.error(import_chalk.default.red("Cleanup failed:"), cleanupError.message);
    }
    process.exit(1);
  }
});
async function isSystemRunning() {
  try {
    const pidData = await import_node_fs.promises.readFile(".claude-flow.pid", "utf-8");
    const data = JSON.parse(pidData);
    try {
      Deno.kill(data.pid, "SIGTERM");
      return false;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
__name(isSystemRunning, "isSystemRunning");
async function stopExistingInstance() {
  try {
    const pidData = await import_node_fs.promises.readFile(".claude-flow.pid", "utf-8");
    const data = JSON.parse(pidData);
    console.log(import_chalk.default.yellow("Stopping existing instance..."));
    Deno.kill(data.pid, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 2e3));
    try {
      Deno.kill(data.pid, "SIGKILL");
    } catch {
    }
    await Deno.remove(".claude-flow.pid").catch(() => {
    });
    console.log(import_chalk.default.green("\u2713 Existing instance stopped"));
  } catch (error) {
    console.warn(
      import_chalk.default.yellow("Warning: Could not stop existing instance"),
      error.message
    );
  }
}
__name(stopExistingInstance, "stopExistingInstance");
async function performHealthChecks() {
  const checks = [
    { name: "Disk Space", check: checkDiskSpace },
    { name: "Memory Available", check: checkMemoryAvailable },
    { name: "Network Connectivity", check: checkNetworkConnectivity },
    { name: "Required Dependencies", check: checkDependencies }
  ];
  for (const { name, check } of checks) {
    try {
      console.log(import_chalk.default.gray(`  Checking ${name}...`));
      await check();
      console.log(import_chalk.default.green(`  \u2713 ${name} OK`));
    } catch (error) {
      console.log(import_chalk.default.red(`  \u2717 ${name} Failed: ${error.message}`));
      throw error;
    }
  }
}
__name(performHealthChecks, "performHealthChecks");
async function checkDiskSpace() {
  const stats = await import_node_fs.promises.stat(".");
  if (!stats.isDirectory) {
    throw new Error("Current directory is not accessible");
  }
}
__name(checkDiskSpace, "checkDiskSpace");
async function checkMemoryAvailable() {
  const memoryInfo = Deno.memoryUsage();
  if (memoryInfo.heapUsed > 500 * 1024 * 1024) {
    throw new Error("High memory usage detected");
  }
}
__name(checkMemoryAvailable, "checkMemoryAvailable");
async function checkNetworkConnectivity() {
  try {
    const response = await fetch("https://httpbin.org/status/200", {
      method: "GET",
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) {
      throw new Error(`Network check failed: ${response.status}`);
    }
  } catch {
    console.log(import_chalk.default.yellow("  \u26A0 Network connectivity check skipped (offline mode?)"));
  }
}
__name(checkNetworkConnectivity, "checkNetworkConnectivity");
async function checkDependencies() {
  const requiredDirs = [".claude-flow", "memory", "logs"];
  for (const dir of requiredDirs) {
    try {
      await Deno.mkdir(dir, { recursive: true });
    } catch (error) {
      throw new Error(`Cannot create required directory: ${dir}`);
    }
  }
}
__name(checkDependencies, "checkDependencies");
function setupSystemEventHandlers(processManager, systemMonitor, options) {
  const shutdownHandler = /* @__PURE__ */ __name(async () => {
    console.log("\n" + import_chalk.default.yellow("Received shutdown signal, shutting down gracefully..."));
    systemMonitor.stop();
    await processManager.stopAll();
    await cleanupOnShutdown();
    console.log(import_chalk.default.green("\u2713 Shutdown complete"));
    process.exit(0);
  }, "shutdownHandler");
  Deno.addSignalListener("SIGINT", shutdownHandler);
  Deno.addSignalListener("SIGTERM", shutdownHandler);
  if (options.verbose) {
    setupVerboseLogging(systemMonitor);
  }
  processManager.on("processError", (event) => {
    console.error(import_chalk.default.red(`Process error in ${event.processId}:`), event.error);
    if (event.processId === "orchestrator") {
      console.error(import_chalk.default.red.bold("Critical process failed, initiating recovery..."));
    }
  });
}
__name(setupSystemEventHandlers, "setupSystemEventHandlers");
async function startWithProgress(processManager, mode) {
  const processes = mode === "all" ? [
    "event-bus",
    "memory-manager",
    "terminal-pool",
    "coordinator",
    "mcp-server",
    "orchestrator"
  ] : ["event-bus", "memory-manager", "mcp-server"];
  for (let i = 0; i < processes.length; i++) {
    const processId = processes[i];
    const progress = `[${i + 1}/${processes.length}]`;
    console.log(import_chalk.default.gray(`${progress} Starting ${processId}...`));
    try {
      await processManager.startProcess(processId);
      console.log(import_chalk.default.green(`${progress} \u2713 ${processId} started`));
    } catch (error) {
      console.log(import_chalk.default.red(`${progress} \u2717 ${processId} failed: ${error.message}`));
      if (processId === "orchestrator" || processId === "mcp-server") {
        throw error;
      }
    }
    if (i < processes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
__name(startWithProgress, "startWithProgress");
async function waitForSystemReady(processManager) {
  console.log(import_chalk.default.blue("Waiting for system to be ready..."));
  const maxWait = 3e4;
  const checkInterval = 1e3;
  let waited = 0;
  while (waited < maxWait) {
    const stats = processManager.getSystemStats();
    if (stats.errorProcesses === 0 && stats.runningProcesses >= 3) {
      console.log(import_chalk.default.green("\u2713 System ready"));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
    waited += checkInterval;
  }
  console.log(
    import_chalk.default.yellow("\u26A0 System startup completed but some processes may not be fully ready")
  );
}
__name(waitForSystemReady, "waitForSystemReady");
async function cleanupOnFailure() {
  try {
    await Deno.remove(".claude-flow.pid").catch(() => {
    });
    console.log(import_chalk.default.gray("Cleaned up PID file"));
  } catch {
  }
}
__name(cleanupOnFailure, "cleanupOnFailure");
async function cleanupOnShutdown() {
  try {
    await Deno.remove(".claude-flow.pid").catch(() => {
    });
    console.log(import_chalk.default.gray("Cleaned up PID file"));
  } catch {
  }
}
__name(cleanupOnShutdown, "cleanupOnShutdown");
function setupVerboseLogging(monitor) {
  console.log(import_chalk.default.gray("Verbose logging enabled"));
  setInterval(() => {
    console.log();
    console.log(import_chalk.default.cyan("--- System Health Report ---"));
    monitor.printSystemHealth();
    console.log(import_chalk.default.cyan("--- End Report ---"));
  }, 3e4);
  import_event_bus.eventBus.on("process:started", (data) => {
    console.log(import_chalk.default.green(`[VERBOSE] Process started: ${data.processId}`));
  });
  import_event_bus.eventBus.on("process:stopped", (data) => {
    console.log(import_chalk.default.yellow(`[VERBOSE] Process stopped: ${data.processId}`));
  });
  import_event_bus.eventBus.on("process:error", (data) => {
    console.log(import_chalk.default.red(`[VERBOSE] Process error: ${data.processId} - ${data.error}`));
  });
}
__name(setupVerboseLogging, "setupVerboseLogging");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startCommand
});
//# sourceMappingURL=start-command.js.map
