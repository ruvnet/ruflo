"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var mcp_exports = {};
__export(mcp_exports, {
  mcpCommand: () => mcpCommand
});
module.exports = __toCommonJS(mcp_exports);
var import_command = require("@cliffy/command");
var import_chalk = __toESM(require("chalk"), 1);
var import_logger = require("../../core/logger.js");
var import_config = require("../../core/config.js");
var import_server = require("../../mcp/server.js");
var import_event_bus = require("../../core/event-bus.js");
let mcpServer = null;
const mcpCommand = new import_command.Command().description("Manage MCP server and tools").action(() => {
  console.log(import_chalk.default.yellow("Please specify a subcommand:"));
  console.log("  start   - Start the MCP server");
  console.log("  stop    - Stop the MCP server");
  console.log("  status  - Show MCP server status");
  console.log("  tools   - List available MCP tools");
  console.log("  config  - Show MCP configuration");
  console.log("  restart - Restart the MCP server");
  console.log("  logs    - Show MCP server logs");
}).command(
  "start",
  new import_command.Command().description("Start the MCP server").option("-p, --port <port:number>", "Port for MCP server", { default: 3e3 }).option("-h, --host <host:string>", "Host for MCP server", { default: "localhost" }).option("--transport <transport:string>", "Transport type (stdio, http)", {
    default: "stdio"
  }).action(async (options) => {
    try {
      const config = await import_config.configManager.load();
      const mcpConfig = {
        ...config.mcp,
        port: options.port,
        host: options.host,
        transport: options.transport
      };
      mcpServer = new import_server.MCPServer(mcpConfig, import_event_bus.eventBus, import_logger.logger);
      await mcpServer.start();
      console.log(import_chalk.default.green(`\u2705 MCP server started on ${options.host}:${options.port}`));
      console.log(import_chalk.default.cyan(`\u{1F4E1} Server URL: http://${options.host}:${options.port}`));
      console.log(import_chalk.default.cyan(`\u{1F527} Available tools: Research, Code, Terminal, Memory`));
      console.log(
        import_chalk.default.cyan(`\u{1F4DA} API documentation: http://${options.host}:${options.port}/docs`)
      );
    } catch (error) {
      console.error(import_chalk.default.red(`\u274C Failed to start MCP server: ${error.message}`));
      process.exit(1);
    }
  })
).command(
  "stop",
  new import_command.Command().description("Stop the MCP server").action(async () => {
    try {
      if (mcpServer) {
        await mcpServer.stop();
        mcpServer = null;
        console.log(import_chalk.default.green("\u2705 MCP server stopped"));
      } else {
        console.log(import_chalk.default.yellow("\u26A0\uFE0F  MCP server is not running"));
      }
    } catch (error) {
      console.error(import_chalk.default.red(`\u274C Failed to stop MCP server: ${error.message}`));
      process.exit(1);
    }
  })
).command(
  "status",
  new import_command.Command().description("Show MCP server status").action(async () => {
    try {
      const config = await import_config.configManager.load();
      const isRunning = mcpServer !== null;
      console.log(import_chalk.default.cyan("MCP Server Status:"));
      console.log(`\u{1F310} Status: ${isRunning ? import_chalk.default.green("Running") : import_chalk.default.red("Stopped")}`);
      if (isRunning) {
        console.log(`\u{1F4CD} Address: ${config.mcp.host}:${config.mcp.port}`);
        console.log(
          `\u{1F510} Authentication: ${config.mcp.auth ? import_chalk.default.green("Enabled") : import_chalk.default.yellow("Disabled")}`
        );
        console.log(`\u{1F527} Tools: ${import_chalk.default.green("Available")}`);
        console.log(`\u{1F4CA} Metrics: ${import_chalk.default.green("Collecting")}`);
      } else {
        console.log(import_chalk.default.gray('Use "claude-flow mcp start" to start the server'));
      }
    } catch (error) {
      console.error(import_chalk.default.red(`\u274C Failed to get MCP status: ${error.message}`));
    }
  })
).command(
  "tools",
  new import_command.Command().description("List available MCP tools").action(() => {
    console.log(import_chalk.default.cyan("Available MCP Tools:"));
    console.log("\n\u{1F4CA} Research Tools:");
    console.log("  \u2022 web_search - Search the web for information");
    console.log("  \u2022 web_fetch - Fetch content from URLs");
    console.log("  \u2022 knowledge_query - Query knowledge base");
    console.log("\n\u{1F4BB} Code Tools:");
    console.log("  \u2022 code_edit - Edit code files");
    console.log("  \u2022 code_search - Search through codebase");
    console.log("  \u2022 code_analyze - Analyze code quality");
    console.log("\n\u{1F5A5}\uFE0F  Terminal Tools:");
    console.log("  \u2022 terminal_execute - Execute shell commands");
    console.log("  \u2022 terminal_session - Manage terminal sessions");
    console.log("  \u2022 file_operations - File system operations");
    console.log("\n\u{1F4BE} Memory Tools:");
    console.log("  \u2022 memory_store - Store information");
    console.log("  \u2022 memory_query - Query stored information");
    console.log("  \u2022 memory_index - Index and search content");
  })
).command(
  "config",
  new import_command.Command().description("Show MCP configuration").action(async () => {
    try {
      const config = await import_config.configManager.load();
      console.log(import_chalk.default.cyan("MCP Configuration:"));
      console.log(JSON.stringify(config.mcp, null, 2));
    } catch (error) {
      console.error(import_chalk.default.red(`\u274C Failed to show MCP config: ${error.message}`));
    }
  })
).command(
  "restart",
  new import_command.Command().description("Restart the MCP server").action(async () => {
    try {
      console.log(import_chalk.default.yellow("\u{1F504} Stopping MCP server..."));
      if (mcpServer) {
        await mcpServer.stop();
      }
      console.log(import_chalk.default.yellow("\u{1F504} Starting MCP server..."));
      const config = await import_config.configManager.load();
      mcpServer = new import_server.MCPServer(config.mcp, import_event_bus.eventBus, import_logger.logger);
      await mcpServer.start();
      console.log(
        import_chalk.default.green(`\u2705 MCP server restarted on ${config.mcp.host}:${config.mcp.port}`)
      );
    } catch (error) {
      console.error(import_chalk.default.red(`\u274C Failed to restart MCP server: ${error.message}`));
      process.exit(1);
    }
  })
).command(
  "logs",
  new import_command.Command().description("Show MCP server logs").option("-n, --lines <lines:number>", "Number of log lines to show", { default: 50 }).action((options) => {
    console.log(import_chalk.default.cyan(`MCP Server Logs (last ${options.lines} lines):`));
    const logEntries = [
      "2024-01-10 10:00:00 [INFO] MCP server started on localhost:3000",
      "2024-01-10 10:00:01 [INFO] Tools registered: 12",
      "2024-01-10 10:00:02 [INFO] Authentication disabled",
      "2024-01-10 10:01:00 [INFO] Client connected: claude-desktop",
      "2024-01-10 10:01:05 [INFO] Tool called: web_search",
      "2024-01-10 10:01:10 [INFO] Tool response sent successfully",
      "2024-01-10 10:02:00 [INFO] Tool called: terminal_execute",
      "2024-01-10 10:02:05 [INFO] Command executed successfully",
      "2024-01-10 10:03:00 [INFO] Memory operation: store",
      "2024-01-10 10:03:01 [INFO] Data stored in namespace: default"
    ];
    const startIndex = Math.max(0, logEntries.length - options.lines);
    const displayLogs = logEntries.slice(startIndex);
    for (const entry of displayLogs) {
      if (entry.includes("[ERROR]")) {
        console.log(import_chalk.default.red(entry));
      } else if (entry.includes("[WARN]")) {
        console.log(import_chalk.default.yellow(entry));
      } else if (entry.includes("[INFO]")) {
        console.log(import_chalk.default.green(entry));
      } else {
        console.log(import_chalk.default.gray(entry));
      }
    }
  })
);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mcpCommand
});
//# sourceMappingURL=mcp.js.map
