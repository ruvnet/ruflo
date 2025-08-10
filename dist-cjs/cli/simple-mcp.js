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
var simple_mcp_exports = {};
__export(simple_mcp_exports, {
  createMCPCommand: () => createMCPCommand
});
module.exports = __toCommonJS(simple_mcp_exports);
var import_commander = require("commander");
var import_http = __toESM(require("http"), 1);
function printSuccess(message) {
  console.log(`\u2705 ${message}`);
}
__name(printSuccess, "printSuccess");
function printError(message) {
  console.error(`\u274C Error: ${message}`);
}
__name(printError, "printError");
async function checkMCPStatus(host, port) {
  return new Promise((resolve) => {
    const options = {
      hostname: host,
      port,
      path: "/health",
      method: "GET",
      timeout: 2e3
    };
    const req = import_http.default.request(options, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404);
    });
    req.on("error", () => {
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
__name(checkMCPStatus, "checkMCPStatus");
function createMCPCommand() {
  const mcpCmd = new import_commander.Command("mcp").description("Manage MCP server and tools").action(() => {
    printSuccess("MCP Server Management");
    console.log("\n\u{1F310} Available MCP commands:");
    console.log("  \u2022 mcp start - Start the MCP server");
    console.log("  \u2022 mcp status - Show MCP server status");
    console.log("  \u2022 mcp tools - List available MCP tools");
    console.log("  \u2022 mcp stop - Stop the MCP server");
    console.log('\n\u{1F4A1} Use "mcp start --port 3001" to use a different port');
  });
  mcpCmd.command("start").description("Start the MCP server").option("--port <port>", "Port for MCP server", "3000").option("--host <host>", "Host for MCP server", "localhost").option("--transport <transport>", "Transport type (stdio, http)", "http").action(async (options) => {
    console.log("Starting MCP server...");
    console.log("(This command is handled by the MCP module)");
  });
  mcpCmd.command("status").description("Show MCP server status").option("--port <port>", "Port to check", "3000").option("--host <host>", "Host to check", "localhost").action(async (options) => {
    printSuccess("MCP Server Status:");
    const host = options.host || "localhost";
    const port = parseInt(options.port) || 3e3;
    const isRunning = await checkMCPStatus(host, port);
    if (isRunning) {
      console.log("\u{1F7E2} Status: Running");
      console.log(`\u{1F4CD} Address: ${host}:${port}`);
      console.log("\u{1F510} Authentication: Disabled");
      console.log("\u{1F527} Tools: System, Health, Tools");
      console.log("\u{1F4E1} Transport: http");
      console.log('\n\u{1F4A1} Use "mcp tools" to see available tools');
    } else {
      console.log('\u{1F7E1} Status: Not running (use "mcp start" to start)');
      console.log(`\u{1F4CD} Checked address: ${host}:${port}`);
      console.log("\u{1F510} Authentication: Disabled");
      console.log("\u{1F527} Tools: System, Health, Tools (when running)");
    }
  });
  mcpCmd.command("tools").description("List available MCP tools").action(() => {
    printSuccess("Available MCP Tools:");
    console.log("\n\u{1F4CA} System Tools:");
    console.log("  \u2022 system/info - Get system information");
    console.log("  \u2022 system/health - Get system health status");
    console.log("\n\u{1F527} Tool Management:");
    console.log("  \u2022 tools/list - List all available tools");
    console.log("  \u2022 tools/schema - Get schema for a specific tool");
    console.log("\n\u{1F4A1} Note: Additional tools available when orchestrator is running");
  });
  mcpCmd.command("stop").description("Stop the MCP server").action(() => {
    printSuccess("Stopping MCP server...");
    console.log("\u{1F6D1} MCP server stop requested");
    console.log('\u{1F4A1} Use Ctrl+C in the terminal running "mcp start" to stop');
  });
  return mcpCmd;
}
__name(createMCPCommand, "createMCPCommand");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createMCPCommand
});
//# sourceMappingURL=simple-mcp.js.map
