#!/usr/bin/env -S deno run --allow-all
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
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
var import_simple_cli = require("./simple-cli.ts");
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_logger = require("../core/logger.js");
var import_config = require("../core/config.js");
var import_formatter = require("./formatter.js");
var import_repl = require("./repl.js");
var import_completion = require("./completion.js");
var import_version = require("../core/version.js");
const cli = new import_commander.Command().name("claude-flow").version(import_version.VERSION).description("Claude-Flow: Advanced AI agent orchestration system for multi-agent coordination").option("-c, --config <path>", "Path to configuration file", "./claude-flow.config.json").option("-v, --verbose", "Enable verbose logging").option("-q, --quiet", "Suppress non-essential output").option("--log-level <level>", "Set log level (debug, info, warn, error)", "info").option("--no-color", "Disable colored output").option("--json", "Output in JSON format where applicable").option("--profile <profile>", "Use named configuration profile").action(async (options) => {
  await setupLogging(options);
  if (!options.quiet) {
    (0, import_formatter.displayBanner)(import_version.VERSION);
    console.log(import_chalk.default.gray('Type "help" for available commands or "exit" to quit.\n'));
  }
  await (0, import_repl.startREPL)(options);
});
const replCommand = new import_commander.Command("repl").description("Start interactive REPL mode with command completion").option("--no-banner", "Skip welcome banner").option("--history-file <path>", "Custom history file path").action(async (options) => {
  await setupLogging(options);
  if (options.banner !== false) {
    (0, import_formatter.displayBanner)(import_version.VERSION);
  }
  await (0, import_repl.startREPL)(options);
});
cli.addCommand(replCommand);
const versionCommand = new import_commander.Command("version").description("Show detailed version information").option("--short", "Show version number only").action(async (options) => {
  if (options.short) {
    console.log(import_version.VERSION);
  } else {
    (0, import_formatter.displayVersion)(import_version.VERSION, import_version.BUILD_DATE);
  }
});
cli.addCommand(versionCommand);
const completionCommand = new import_commander.Command("completion").description("Generate shell completion scripts").argument("[shell]", "Shell type").option("--install", "Install completion script automatically").action(async (shell, options) => {
  const generator = new import_completion.CompletionGenerator();
  await generator.generate(shell || "detect", options.install === true);
});
cli.addCommand(completionCommand);
async function handleError(error, options) {
  const formatted = (0, import_formatter.formatError)(error);
  if (options?.json) {
    console.error(
      JSON.stringify({
        error: true,
        message: formatted,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      })
    );
  } else {
    console.error(import_chalk.default.red(import_chalk.default.bold("\u2717 Error:")), formatted);
  }
  if (process.env["CLAUDE_FLOW_DEBUG"] === "true" || options?.verbose) {
    console.error(import_chalk.default.gray("\nStack trace:"));
    console.error(error);
  }
  if (!options?.quiet) {
    console.error(import_chalk.default.gray("\nTry running with --verbose for more details"));
    console.error(import_chalk.default.gray('Or use "claude-flow help" to see available commands'));
  }
  process.exit(1);
}
__name(handleError, "handleError");
async function setupLogging(options) {
  let logLevel = options.logLevel;
  if (options.verbose)
    logLevel = "debug";
  if (options.quiet)
    logLevel = "warn";
  await import_logger.logger.configure({
    level: logLevel,
    format: options.json ? "json" : "text",
    destination: "console"
  });
  try {
    if (options.config) {
      await import_config.configManager.load(options.config);
    } else {
      try {
        await import_config.configManager.load("./claude-flow.config.json");
      } catch {
        import_config.configManager.loadDefault();
      }
    }
    if (options.profile) {
      await import_config.configManager.applyProfile(options.profile);
    }
  } catch (error) {
    import_logger.logger.warn("Failed to load configuration:", error.message);
    import_config.configManager.loadDefault();
  }
}
__name(setupLogging, "setupLogging");
function setupSignalHandlers() {
  const gracefulShutdown = /* @__PURE__ */ __name(() => {
    console.log("\n" + import_chalk.default.gray("Gracefully shutting down..."));
    process.exit(0);
  }, "gracefulShutdown");
  Deno.addSignalListener("SIGINT", gracefulShutdown);
  Deno.addSignalListener("SIGTERM", gracefulShutdown);
}
__name(setupSignalHandlers, "setupSignalHandlers");
if (false) {
  let globalOptions = {};
  try {
    setupSignalHandlers();
    const args = Deno.args;
    globalOptions = {
      verbose: args.includes("-v") || args.includes("--verbose"),
      quiet: args.includes("-q") || args.includes("--quiet"),
      json: args.includes("--json"),
      noColor: args.includes("--no-color")
    };
    if (globalOptions.noColor) {
    }
    cli.parse(args);
  } catch (error) {
    handleError(error, globalOptions);
  }
}
//# sourceMappingURL=index.js.map
