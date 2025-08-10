#!/usr/bin/env node
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
var cli_core_exports = {};
__export(cli_core_exports, {
  CLI: () => CLI,
  VERSION: () => VERSION,
  error: () => error,
  info: () => info,
  success: () => success,
  warning: () => warning
});
module.exports = __toCommonJS(cli_core_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_fs_extra = __toESM(require("fs-extra"), 1);
const VERSION = "1.0.45";
class CLI {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }
  static {
    __name(this, "CLI");
  }
  commands = /* @__PURE__ */ new Map();
  globalOptions = [
    {
      name: "help",
      short: "h",
      description: "Show help",
      type: "boolean"
    },
    {
      name: "version",
      short: "v",
      description: "Show version",
      type: "boolean"
    },
    {
      name: "config",
      short: "c",
      description: "Path to configuration file",
      type: "string"
    },
    {
      name: "verbose",
      description: "Enable verbose logging",
      type: "boolean"
    },
    {
      name: "log-level",
      description: "Set log level (debug, info, warn, error)",
      type: "string",
      default: "info"
    }
  ];
  command(cmd) {
    const cmdName = typeof cmd.name === "function" ? cmd.name() : cmd.name || "unknown";
    this.commands.set(cmdName, cmd);
    if (cmd.aliases && typeof cmd.aliases[Symbol.iterator] === "function") {
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
    return this;
  }
  async run(args = process.argv.slice(2)) {
    const flags = this.parseArgs(args);
    if (flags.version || flags.v) {
      console.log(`${this.name} v${VERSION}`);
      return;
    }
    const commandName = flags._[0]?.toString() || "";
    if (!commandName || flags.help || flags.h) {
      this.showHelp();
      return;
    }
    const command = this.commands.get(commandName);
    if (!command) {
      console.error(import_chalk.default.red(`Unknown command: ${commandName}`));
      console.log(`Run "${this.name} help" for available commands`);
      process.exit(1);
    }
    const ctx = {
      args: flags._.slice(1).map(String),
      flags,
      config: await this.loadConfig(flags.config)
    };
    try {
      if (command.action) {
        await command.action(ctx);
      } else {
        console.log(import_chalk.default.yellow(`Command '${commandName}' has no action defined`));
      }
    } catch (error2) {
      console.error(
        import_chalk.default.red(`Error executing command '${commandName}':`),
        error2.message
      );
      if (flags.verbose) {
        console.error(error2);
      }
      process.exit(1);
    }
  }
  parseArgs(args) {
    const result = { _: [] };
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg.startsWith("--")) {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          result[key] = args[i + 1];
          i += 2;
        } else {
          result[key] = true;
          i++;
        }
      } else if (arg.startsWith("-")) {
        const key = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          result[key] = args[i + 1];
          i += 2;
        } else {
          result[key] = true;
          i++;
        }
      } else {
        result._.push(arg);
        i++;
      }
    }
    return result;
  }
  async loadConfig(configPath) {
    const configFile = configPath || "claude-flow.config.json";
    try {
      const content = await import_fs_extra.default.readFile(configFile, "utf8");
      return JSON.parse(content);
    } catch {
      return void 0;
    }
  }
  getBooleanFlags() {
    const flags = [];
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.type === "boolean") {
        flags.push(opt.name);
        if (opt.short)
          flags.push(opt.short);
      }
    }
    return flags;
  }
  getStringFlags() {
    const flags = [];
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.type === "string" || opt.type === "number") {
        flags.push(opt.name);
        if (opt.short)
          flags.push(opt.short);
      }
    }
    return flags;
  }
  getAliases() {
    const aliases = {};
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.short) {
        aliases[opt.short] = opt.name;
      }
    }
    return aliases;
  }
  getDefaults() {
    const defaults = {};
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.default !== void 0) {
        defaults[opt.name] = opt.default;
      }
    }
    return defaults;
  }
  getAllOptions() {
    const options = [];
    for (const cmd of this.commands.values()) {
      if (cmd.options) {
        options.push(...cmd.options);
      }
    }
    return options;
  }
  showHelp() {
    console.log(`
${import_chalk.default.bold(import_chalk.default.blue(`\u{1F9E0} ${this.name} v${VERSION}`))} - ${this.description}

${import_chalk.default.bold("USAGE:")}
  ${this.name} [COMMAND] [OPTIONS]

${import_chalk.default.bold("COMMANDS:")}
${this.formatCommands()}

${import_chalk.default.bold("GLOBAL OPTIONS:")}
${this.formatOptions(this.globalOptions)}

${import_chalk.default.bold("EXAMPLES:")}
  ${this.name} start                                    # Start orchestrator
  ${this.name} agent spawn researcher --name "Bot"     # Spawn research agent
  ${this.name} task create research "Analyze data"     # Create task
  ${this.name} config init                             # Initialize config
  ${this.name} status                                  # Show system status

For more detailed help on specific commands, use:
  ${this.name} [COMMAND] --help

Documentation: https://github.com/ruvnet/claude-code-flow
Issues: https://github.com/ruvnet/claude-code-flow/issues

Created by rUv - Built with \u2764\uFE0F for the Claude community
`);
  }
  formatCommands() {
    const commands = Array.from(new Set(this.commands.values()));
    return commands.filter((cmd) => cmd && cmd.name).map((cmd) => `  ${String(cmd.name).padEnd(20)} ${cmd.description || ""}`).join("\n");
  }
  formatOptions(options) {
    return options.map((opt) => {
      const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
      return `  ${flags.padEnd(25)} ${opt.description}`;
    }).join("\n");
  }
}
function success(message) {
  console.log(import_chalk.default.green(`\u2705 ${message}`));
}
__name(success, "success");
function error(message) {
  console.error(import_chalk.default.red(`\u274C ${message}`));
}
__name(error, "error");
function warning(message) {
  console.warn(import_chalk.default.yellow(`\u26A0\uFE0F  ${message}`));
}
__name(warning, "warning");
function info(message) {
  console.log(import_chalk.default.blue(`\u2139\uFE0F  ${message}`));
}
__name(info, "info");
async function main() {
  if (process.argv[1] && (process.argv[1].endsWith("cli-core.js") || process.argv[1].endsWith("cli-core.ts"))) {
    const cli = new CLI("claude-flow", "Advanced AI Agent Orchestration System");
    const { setupCommands } = await import("./commands/index.js");
    setupCommands(cli);
    await cli.run();
  }
}
__name(main, "main");
main().catch(console.error);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLI,
  VERSION,
  error,
  info,
  success,
  warning
});
//# sourceMappingURL=cli-core.js.map
