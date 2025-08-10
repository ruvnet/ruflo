#!/usr/bin/env -S deno run --allow-all
"use strict";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const import_meta = {};
var import_version = require("../core/version.js");
const chalk = {
  red: (text) => `\x1B[31m${text}\x1B[0m`,
  green: (text) => `\x1B[32m${text}\x1B[0m`,
  yellow: (text) => `\x1B[33m${text}\x1B[0m`,
  blue: (text) => `\x1B[34m${text}\x1B[0m`,
  gray: (text) => `\x1B[90m${text}\x1B[0m`,
  bold: (text) => `\x1B[1m${text}\x1B[0m`
};
function printHelp() {
  console.log(`
\u{1F9E0} Claude-Flow v${import_version.VERSION} - Advanced AI Agent Orchestration System

USAGE:
  claude-flow [COMMAND] [OPTIONS]

COMMANDS:
  init                  Initialize Claude Code integration files
  start                 Start the orchestration system
  agent                 Manage agents (spawn, list, terminate, info)
  task                  Manage tasks (create, list, status, cancel, workflow)
  memory               Manage memory (query, export, import, stats, cleanup)
  mcp                  Manage MCP server (status, tools, start, stop)
  config               Manage configuration (show, get, set, init, validate)
  status               Show system status
  monitor              Monitor system in real-time
  session              Manage terminal sessions
  workflow             Execute workflow files
  claude               Spawn Claude instances with specific configurations
  version              Show version information
  help                 Show this help message

OPTIONS:
  -c, --config <path>   Path to configuration file
  -v, --verbose         Enable verbose logging
  --help                Show help for any command

EXAMPLES:
  claude-flow init                    # Initialize Claude Code integration
  claude-flow start                   # Start orchestration system
  claude-flow agent spawn researcher  # Spawn a research agent
  claude-flow task create research "Analyze authentication patterns"
  claude-flow memory store key "value"
  claude-flow status                  # Check system status

For more info: https://github.com/ruvnet/claude-code-flow
`);
}
__name(printHelp, "printHelp");
function printSuccess(message) {
  console.log(chalk.green("\u2705 " + message));
}
__name(printSuccess, "printSuccess");
function printError(message) {
  console.log(chalk.red("\u274C " + message));
}
__name(printError, "printError");
function printWarning(message) {
  console.log(chalk.yellow("\u26A0\uFE0F  " + message));
}
__name(printWarning, "printWarning");
async function main() {
  const args = Deno.args;
  const command = args[0] || "help";
  const subArgs = args.slice(1);
  switch (command) {
    case "--help":
    case "-h":
    case "help":
      printHelp();
      break;
    case "--version":
    case "-v":
    case "version":
      console.log(`Claude-Flow v${import_version.VERSION}`);
      break;
    case "init":
      printSuccess("Initializing Claude Code integration files...");
      console.log("\u{1F4DD} This command would create:");
      console.log("   - CLAUDE.md (Claude Code configuration)");
      console.log("   - memory-bank.md (Memory system documentation)");
      console.log("   - coordination.md (Agent coordination documentation)");
      console.log("   - Memory folder structure");
      console.log("\n\u{1F4A1} To run locally, clone the repo and use:");
      console.log("   git clone https://github.com/ruvnet/claude-code-flow.git");
      console.log("   cd claude-code-flow");
      console.log("   npm install -g claude-flow");
      console.log("   claude-flow init");
      break;
    case "install":
      console.log(chalk.blue("\u{1F4E6} Installing Claude-Flow..."));
      console.log("\nRun these commands to install:");
      console.log(chalk.gray("  # Using npm (recommended)"));
      console.log("  npm install -g claude-flow");
      console.log("");
      console.log(chalk.gray("  # Or using Deno"));
      console.log("  deno install --allow-all --name claude-flow \\");
      console.log(
        "    https://raw.githubusercontent.com/ruvnet/claude-code-flow/main/src/cli/index.ts"
      );
      console.log("");
      console.log(chalk.gray("  # Or clone and build from source"));
      console.log("  git clone https://github.com/ruvnet/claude-code-flow.git");
      console.log("  cd claude-code-flow");
      console.log("  deno task build");
      break;
    default:
      printWarning(`Command '${command}' requires local installation.`);
      console.log("\n\u{1F4E5} To use all features, install Claude-Flow:");
      console.log("   npm install -g claude-flow");
      console.log("\n\u{1F310} Or run directly with Deno:");
      console.log("   deno install --allow-all --name claude-flow \\");
      console.log(
        "     https://raw.githubusercontent.com/ruvnet/claude-code-flow/main/src/cli/index.ts"
      );
      console.log("\n\u{1F4DA} Documentation: https://github.com/ruvnet/claude-code-flow");
      console.log("\u{1F4AC} Issues: https://github.com/ruvnet/claude-code-flow/issues");
      break;
  }
}
__name(main, "main");
if (import_meta.url === `file://${Deno.execPath()}`) {
  main().catch((error) => {
    printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
//# sourceMappingURL=index-remote.js.map
