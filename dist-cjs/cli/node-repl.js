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
var node_repl_exports = {};
__export(node_repl_exports, {
  startNodeREPL: () => startNodeREPL
});
module.exports = __toCommonJS(node_repl_exports);
var import_readline = __toESM(require("readline"), 1);
var import_promises = __toESM(require("fs/promises"), 1);
var import_path = __toESM(require("path"), 1);
var import_child_process = require("child_process");
var import_chalk = __toESM(require("chalk"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
class CommandHistory {
  static {
    __name(this, "CommandHistory");
  }
  history = [];
  maxSize = 1e3;
  historyFile;
  constructor(historyFile) {
    this.historyFile = historyFile || import_path.default.join(process.cwd(), ".claude-flow-history");
    this.loadHistory();
  }
  add(command) {
    if (command.trim() && command !== this.history[this.history.length - 1]) {
      this.history.push(command);
      if (this.history.length > this.maxSize) {
        this.history = this.history.slice(-this.maxSize);
      }
      this.saveHistory();
    }
  }
  get() {
    return [...this.history];
  }
  search(query) {
    return this.history.filter((cmd) => cmd.includes(query));
  }
  async loadHistory() {
    try {
      const content = await import_promises.default.readFile(this.historyFile, "utf-8");
      this.history = content.split("\n").filter((line) => line.trim());
    } catch {
    }
  }
  async saveHistory() {
    try {
      await import_promises.default.writeFile(this.historyFile, this.history.join("\n"));
    } catch {
    }
  }
}
async function startNodeREPL(options = {}) {
  const rl = import_readline.default.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ""
  });
  const context = {
    options,
    history: [],
    workingDirectory: process.cwd(),
    connectionStatus: "disconnected",
    lastActivity: /* @__PURE__ */ new Date(),
    rl
  };
  const history = new CommandHistory(options.historyFile);
  const commands = [
    {
      name: "help",
      aliases: ["h", "?"],
      description: "Show available commands or help for a specific command",
      usage: "help [command]",
      examples: ["help", "help agent", "help task create"],
      handler: async (args) => {
        if (args.length === 0) {
          showHelp(commands);
        } else {
          showCommandHelp(commands, args[0]);
        }
      }
    },
    {
      name: "status",
      aliases: ["st"],
      description: "Show system status and connection info",
      usage: "status [component]",
      examples: ["status", "status orchestrator"],
      handler: async (args, ctx) => {
        await showSystemStatus(ctx, args[0]);
      }
    },
    {
      name: "connect",
      aliases: ["conn"],
      description: "Connect to Claude-Flow orchestrator",
      usage: "connect [host:port]",
      examples: ["connect", "connect localhost:3000"],
      handler: async (args, ctx) => {
        await connectToOrchestrator(ctx, args[0]);
      }
    },
    {
      name: "agent",
      description: "Agent management (spawn, list, terminate, info)",
      usage: "agent <subcommand> [options]",
      examples: [
        "agent list",
        'agent spawn researcher --name "Research Agent"',
        "agent info agent-001",
        "agent terminate agent-001"
      ],
      handler: async (args, ctx) => {
        await handleAgentCommand(args, ctx);
      }
    },
    {
      name: "task",
      description: "Task management (create, list, status, cancel)",
      usage: "task <subcommand> [options]",
      examples: [
        "task list",
        'task create research "Find quantum computing papers"',
        "task status task-001",
        "task cancel task-001"
      ],
      handler: async (args, ctx) => {
        await handleTaskCommand(args, ctx);
      }
    },
    {
      name: "memory",
      description: "Memory operations (query, stats, export)",
      usage: "memory <subcommand> [options]",
      examples: ["memory stats", "memory query --agent agent-001", "memory export memory.json"],
      handler: async (args, ctx) => {
        await handleMemoryCommand(args, ctx);
      }
    },
    {
      name: "session",
      description: "Session management (save, restore, list)",
      usage: "session <subcommand> [options]",
      examples: [
        "session list",
        'session save "Development Session"',
        "session restore session-001"
      ],
      handler: async (args, ctx) => {
        await handleSessionCommand(args, ctx);
      }
    },
    {
      name: "workflow",
      description: "Workflow operations (run, list, status)",
      usage: "workflow <subcommand> [options]",
      examples: ["workflow list", "workflow run workflow.json", "workflow status workflow-001"],
      handler: async (args, ctx) => {
        await handleWorkflowCommand(args, ctx);
      }
    },
    {
      name: "monitor",
      aliases: ["mon"],
      description: "Start monitoring mode",
      usage: "monitor [--interval seconds]",
      examples: ["monitor", "monitor --interval 5"],
      handler: async (args) => {
        console.log(import_chalk.default.cyan("Starting monitor mode..."));
        console.log(import_chalk.default.gray("(This would start the live dashboard)"));
      }
    },
    {
      name: "history",
      aliases: ["hist"],
      description: "Show command history",
      usage: "history [--search query]",
      examples: ["history", "history --search agent"],
      handler: async (args) => {
        const searchQuery = args.indexOf("--search") >= 0 ? args[args.indexOf("--search") + 1] : null;
        const historyItems = searchQuery ? history.search(searchQuery) : history.get();
        console.log(
          import_chalk.default.cyan.bold(`Command History${searchQuery ? ` (search: ${searchQuery})` : ""}`)
        );
        console.log("\u2500".repeat(50));
        if (historyItems.length === 0) {
          console.log(import_chalk.default.gray("No commands in history"));
          return;
        }
        const recent = historyItems.slice(-20);
        recent.forEach((cmd, i) => {
          const lineNumber = historyItems.length - recent.length + i + 1;
          console.log(`${import_chalk.default.gray(lineNumber.toString().padStart(3))} ${cmd}`);
        });
      }
    },
    {
      name: "clear",
      aliases: ["cls"],
      description: "Clear the screen",
      handler: async () => {
        console.clear();
      }
    },
    {
      name: "cd",
      description: "Change working directory",
      usage: "cd <directory>",
      examples: ["cd /path/to/project", "cd .."],
      handler: async (args, ctx) => {
        if (args.length === 0) {
          console.log(ctx.workingDirectory);
          return;
        }
        try {
          const newDir = args[0] === "~" ? process.env.HOME || "/" : args[0];
          process.chdir(newDir);
          ctx.workingDirectory = process.cwd();
          console.log(import_chalk.default.gray(`Changed to: ${ctx.workingDirectory}`));
        } catch (error) {
          console.error(
            import_chalk.default.red("Error:"),
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    },
    {
      name: "pwd",
      description: "Print working directory",
      handler: async (_, ctx) => {
        console.log(ctx.workingDirectory);
      }
    },
    {
      name: "echo",
      description: "Echo arguments",
      usage: "echo <text>",
      examples: ['echo "Hello, world!"'],
      handler: async (args) => {
        console.log(args.join(" "));
      }
    },
    {
      name: "exit",
      aliases: ["quit", "q"],
      description: "Exit the REPL",
      handler: async (_, ctx) => {
        console.log(import_chalk.default.gray("Goodbye!"));
        ctx.rl.close();
        process.exit(0);
      }
    }
  ];
  if (options.banner !== false) {
    displayBanner();
  }
  await showSystemStatus(context);
  console.log(import_chalk.default.gray('Type "help" for available commands or "exit" to quit.\n'));
  const processCommand = /* @__PURE__ */ __name(async (input) => {
    if (!input.trim()) {
      return;
    }
    history.add(input);
    context.history.push(input);
    context.lastActivity = /* @__PURE__ */ new Date();
    const args = parseCommand(input);
    const [commandName, ...commandArgs] = args;
    const command = commands.find(
      (c) => c.name === commandName || c.aliases && c.aliases.includes(commandName)
    );
    if (command) {
      try {
        await command.handler(commandArgs, context);
      } catch (error) {
        console.error(
          import_chalk.default.red("Command failed:"),
          error instanceof Error ? error.message : String(error)
        );
      }
    } else {
      console.log(import_chalk.default.red(`Unknown command: ${commandName}`));
      console.log(import_chalk.default.gray('Type "help" for available commands'));
      const suggestions = findSimilarCommands(commandName, commands);
      if (suggestions.length > 0) {
        console.log(import_chalk.default.gray("Did you mean:"), suggestions.map((s) => import_chalk.default.cyan(s)).join(", "));
      }
    }
  }, "processCommand");
  const showPrompt = /* @__PURE__ */ __name(() => {
    const prompt = createPrompt(context);
    rl.setPrompt(prompt);
    rl.prompt();
  }, "showPrompt");
  rl.on("line", async (input) => {
    try {
      await processCommand(input);
    } catch (error) {
      console.error(
        import_chalk.default.red("REPL Error:"),
        error instanceof Error ? error.message : String(error)
      );
    }
    showPrompt();
  });
  rl.on("close", () => {
    console.log("\n" + import_chalk.default.gray("Goodbye!"));
    process.exit(0);
  });
  rl.on("SIGINT", () => {
    console.log("\n" + import_chalk.default.gray('Use "exit" to quit or Ctrl+D'));
    showPrompt();
  });
  showPrompt();
}
__name(startNodeREPL, "startNodeREPL");
function displayBanner() {
  const banner = `
${import_chalk.default.cyan.bold("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")}
${import_chalk.default.cyan.bold("\u2551")}             ${import_chalk.default.white.bold("\u{1F9E0} Claude-Flow REPL")}                        ${import_chalk.default.cyan.bold("\u2551")}
${import_chalk.default.cyan.bold("\u2551")}          ${import_chalk.default.gray("Interactive AI Agent Orchestration")}             ${import_chalk.default.cyan.bold("\u2551")}
${import_chalk.default.cyan.bold("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D")}
`;
  console.log(banner);
}
__name(displayBanner, "displayBanner");
function createPrompt(context) {
  const statusIcon = getConnectionStatusIcon(context.connectionStatus);
  const dir = import_path.default.basename(context.workingDirectory) || "/";
  return `${statusIcon} ${import_chalk.default.cyan("claude-flow")}:${import_chalk.default.yellow(dir)}${import_chalk.default.white("> ")}`;
}
__name(createPrompt, "createPrompt");
function getConnectionStatusIcon(status) {
  switch (status) {
    case "connected":
      return import_chalk.default.green("\u25CF");
    case "connecting":
      return import_chalk.default.yellow("\u25D0");
    case "disconnected":
      return import_chalk.default.red("\u25CB");
    default:
      return import_chalk.default.gray("?");
  }
}
__name(getConnectionStatusIcon, "getConnectionStatusIcon");
function parseCommand(input) {
  const args = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuotes = true;
        quoteChar = char;
      } else if (char === " " || char === "	") {
        if (current.trim()) {
          args.push(current.trim());
          current = "";
        }
      } else {
        current += char;
      }
    }
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}
__name(parseCommand, "parseCommand");
function showHelp(commands) {
  console.log(import_chalk.default.cyan.bold("Claude-Flow Interactive REPL"));
  console.log("\u2500".repeat(50));
  console.log();
  console.log(import_chalk.default.white.bold("Available Commands:"));
  console.log();
  const table = new import_cli_table3.default({
    head: ["Command", "Aliases", "Description"],
    style: { head: ["cyan"] }
  });
  for (const cmd of commands) {
    table.push([
      import_chalk.default.cyan(cmd.name),
      cmd.aliases ? import_chalk.default.gray(cmd.aliases.join(", ")) : "",
      cmd.description
    ]);
  }
  console.log(table.toString());
  console.log();
  console.log(import_chalk.default.gray("Tips:"));
  console.log(import_chalk.default.gray("\u2022 Use TAB for command completion"));
  console.log(import_chalk.default.gray('\u2022 Use "help <command>" for detailed help'));
  console.log(import_chalk.default.gray("\u2022 Use UP/DOWN arrows for command history"));
  console.log(import_chalk.default.gray('\u2022 Use Ctrl+C or "exit" to quit'));
}
__name(showHelp, "showHelp");
function showCommandHelp(commands, commandName) {
  const command = commands.find(
    (c) => c.name === commandName || c.aliases && c.aliases.includes(commandName)
  );
  if (!command) {
    console.log(import_chalk.default.red(`Unknown command: ${commandName}`));
    return;
  }
  console.log(import_chalk.default.cyan.bold(`Command: ${command.name}`));
  console.log("\u2500".repeat(30));
  console.log(`${import_chalk.default.white("Description:")} ${command.description}`);
  if (command.aliases) {
    console.log(`${import_chalk.default.white("Aliases:")} ${command.aliases.join(", ")}`);
  }
  if (command.usage) {
    console.log(`${import_chalk.default.white("Usage:")} ${command.usage}`);
  }
  if (command.examples) {
    console.log();
    console.log(import_chalk.default.white.bold("Examples:"));
    for (const example of command.examples) {
      console.log(`  ${import_chalk.default.gray("$")} ${import_chalk.default.cyan(example)}`);
    }
  }
}
__name(showCommandHelp, "showCommandHelp");
async function showSystemStatus(context, component) {
  console.log(import_chalk.default.cyan.bold("System Status"));
  console.log("\u2500".repeat(30));
  const statusIcon = context.connectionStatus === "connected" ? import_chalk.default.green("\u2713") : import_chalk.default.red("\u2717");
  console.log(`${statusIcon} Connection: ${context.connectionStatus}`);
  console.log(`${import_chalk.default.white("Working Directory:")} ${context.workingDirectory}`);
  console.log(`${import_chalk.default.white("Last Activity:")} ${context.lastActivity.toLocaleTimeString()}`);
  if (context.currentSession) {
    console.log(`${import_chalk.default.white("Current Session:")} ${context.currentSession}`);
  }
  console.log(`${import_chalk.default.white("Commands in History:")} ${context.history.length}`);
  if (context.connectionStatus === "disconnected") {
    console.log();
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    console.log(import_chalk.default.gray('Use "connect" command to establish connection'));
  }
}
__name(showSystemStatus, "showSystemStatus");
async function connectToOrchestrator(context, target) {
  const host = target || "localhost:3000";
  console.log(import_chalk.default.yellow(`Connecting to ${host}...`));
  context.connectionStatus = "connecting";
  await new Promise((resolve) => setTimeout(resolve, 1e3));
  try {
    const result = await executeCliCommand(["status"]);
    if (result.success) {
      context.connectionStatus = "connected";
      console.log(import_chalk.default.green("\u2713 Connected successfully"));
    } else {
      context.connectionStatus = "disconnected";
      console.log(import_chalk.default.red("\u2717 Connection failed"));
      console.log(import_chalk.default.gray("Make sure Claude-Flow is running with: npx claude-flow start"));
    }
  } catch (error) {
    context.connectionStatus = "disconnected";
    console.log(import_chalk.default.red("\u2717 Connection failed"));
    console.log(import_chalk.default.gray("Make sure Claude-Flow is running with: npx claude-flow start"));
  }
}
__name(connectToOrchestrator, "connectToOrchestrator");
async function executeCliCommand(args) {
  return new Promise((resolve) => {
    const child = (0, import_child_process.spawn)("npx", ["tsx", "src/cli/simple-cli.ts", ...args], {
      stdio: "pipe",
      cwd: process.cwd()
    });
    let output = "";
    let error = "";
    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      error += data.toString();
    });
    child.on("close", (code) => {
      resolve({
        success: code === 0,
        output: output || error
      });
    });
    child.on("error", (err) => {
      resolve({
        success: false,
        output: err.message
      });
    });
  });
}
__name(executeCliCommand, "executeCliCommand");
async function handleAgentCommand(args, context) {
  if (context.connectionStatus !== "connected") {
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    console.log(import_chalk.default.gray('Use "connect" to establish connection first'));
    return;
  }
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: agent <spawn|list|terminate|info> [options]"));
    return;
  }
  const subcommand = args[0];
  const cliArgs = ["agent", ...args];
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(
      import_chalk.default.red("Error executing agent command:"),
      error instanceof Error ? error.message : String(error)
    );
  }
}
__name(handleAgentCommand, "handleAgentCommand");
async function handleTaskCommand(args, context) {
  if (context.connectionStatus !== "connected") {
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    return;
  }
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: task <create|list|status|cancel> [options]"));
    return;
  }
  const cliArgs = ["task", ...args];
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(
      import_chalk.default.red("Error executing task command:"),
      error instanceof Error ? error.message : String(error)
    );
  }
}
__name(handleTaskCommand, "handleTaskCommand");
async function handleMemoryCommand(args, context) {
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: memory <query|stats|export> [options]"));
    return;
  }
  const cliArgs = ["memory", ...args];
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(
      import_chalk.default.red("Error executing memory command:"),
      error instanceof Error ? error.message : String(error)
    );
  }
}
__name(handleMemoryCommand, "handleMemoryCommand");
async function handleSessionCommand(args, context) {
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: session <list|save|restore> [options]"));
    return;
  }
  const cliArgs = ["session", ...args];
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(
      import_chalk.default.red("Error executing session command:"),
      error instanceof Error ? error.message : String(error)
    );
  }
}
__name(handleSessionCommand, "handleSessionCommand");
async function handleWorkflowCommand(args, context) {
  if (context.connectionStatus !== "connected") {
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    return;
  }
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: workflow <list|run|status> [options]"));
    return;
  }
  const cliArgs = ["workflow", ...args];
  try {
    const result = await executeCliCommand(cliArgs);
    console.log(result.output);
  } catch (error) {
    console.error(
      import_chalk.default.red("Error executing workflow command:"),
      error instanceof Error ? error.message : String(error)
    );
  }
}
__name(handleWorkflowCommand, "handleWorkflowCommand");
function findSimilarCommands(input, commands) {
  const allNames = commands.flatMap((c) => [c.name, ...c.aliases || []]);
  return allNames.filter((name) => {
    const commonChars = input.split("").filter((char) => name.includes(char)).length;
    return commonChars >= Math.min(2, input.length / 2);
  }).slice(0, 3);
}
__name(findSimilarCommands, "findSimilarCommands");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startNodeREPL
});
//# sourceMappingURL=node-repl.js.map
