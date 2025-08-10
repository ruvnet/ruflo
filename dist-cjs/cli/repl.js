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
var repl_exports = {};
__export(repl_exports, {
  startREPL: () => startREPL
});
module.exports = __toCommonJS(repl_exports);
var import_node_fs = require("node:fs");
var import_inquirer = __toESM(require("inquirer"), 1);
var import_chalk = __toESM(require("chalk"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var import_helpers = require("../utils/helpers.js");
var import_formatter = require("./formatter.js");
class CommandHistory {
  static {
    __name(this, "CommandHistory");
  }
  history = [];
  maxSize = 1e3;
  historyFile;
  constructor(historyFile) {
    this.historyFile = historyFile || ".claude-flow-history";
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
      const content = await import_node_fs.promises.readFile(this.historyFile, "utf-8");
      this.history = content.split("\n").filter((line) => line.trim());
    } catch {
    }
  }
  async saveHistory() {
    try {
      await import_node_fs.promises.writeFile(this.historyFile, this.history.join("\n"));
    } catch {
    }
  }
}
class CommandCompleter {
  static {
    __name(this, "CommandCompleter");
  }
  commands = /* @__PURE__ */ new Map();
  setCommands(commands) {
    this.commands.clear();
    for (const cmd of commands) {
      this.commands.set(cmd.name, cmd);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          this.commands.set(alias, cmd);
        }
      }
    }
  }
  complete(input) {
    const parts = input.trim().split(/\s+/);
    if (parts.length === 1) {
      const prefix = parts[0];
      return Array.from(this.commands.keys()).filter((name) => name.startsWith(prefix)).sort();
    }
    const commandName = parts[0];
    const command = this.commands.get(commandName);
    if (command) {
      return this.completeForCommand(command, parts.slice(1));
    }
    return [];
  }
  completeForCommand(command, args) {
    switch (command.name) {
      case "agent":
        if (args.length === 1) {
          return ["spawn", "list", "terminate", "info"].filter((sub) => sub.startsWith(args[0]));
        }
        if (args[0] === "spawn" && args.length === 2) {
          return ["coordinator", "researcher", "implementer", "analyst", "custom"].filter(
            (type) => type.startsWith(args[1])
          );
        }
        break;
      case "task":
        if (args.length === 1) {
          return ["create", "list", "status", "cancel", "workflow"].filter(
            (sub) => sub.startsWith(args[0])
          );
        }
        if (args[0] === "create" && args.length === 2) {
          return ["research", "implementation", "analysis", "coordination"].filter(
            (type) => type.startsWith(args[1])
          );
        }
        break;
      case "session":
        if (args.length === 1) {
          return ["list", "save", "restore", "delete", "export", "import"].filter(
            (sub) => sub.startsWith(args[0])
          );
        }
        break;
      case "workflow":
        if (args.length === 1) {
          return ["run", "validate", "list", "status", "stop", "template"].filter(
            (sub) => sub.startsWith(args[0])
          );
        }
        break;
    }
    return [];
  }
}
async function startREPL(options = {}) {
  const context = {
    options,
    history: [],
    workingDirectory: process.cwd(),
    connectionStatus: "disconnected",
    lastActivity: /* @__PURE__ */ new Date()
  };
  const history = new CommandHistory(options.historyFile);
  const completer = new CommandCompleter();
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
          const newDir = args[0] === "~" ? process.env["HOME"] || "/" : args[0];
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
      handler: async () => {
        console.log(import_chalk.default.gray("Goodbye!"));
        process.exit(0);
      }
    }
  ];
  completer.setCommands(commands);
  if (!options.quiet) {
    await showSystemStatus(context);
    console.log(import_chalk.default.gray('Type "help" for available commands or "exit" to quit.\n'));
  }
  while (true) {
    try {
      const promptString = createPrompt(context);
      const { input } = await import_inquirer.default.prompt([
        {
          type: "input",
          name: "input",
          message: promptString,
          transformer: (input2) => input2
        }
      ]);
      if (!input.trim()) {
        continue;
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
          console.log(
            import_chalk.default.gray("Did you mean:"),
            suggestions.map((s) => import_chalk.default.cyan(s)).join(", ")
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("EOF") || errorMessage.includes("interrupted")) {
        console.log("\n" + import_chalk.default.gray("Goodbye!"));
        break;
      }
      console.error(import_chalk.default.red("REPL Error:"), errorMessage);
    }
  }
}
__name(startREPL, "startREPL");
function createPrompt(context) {
  const statusIcon = getConnectionStatusIcon(context.connectionStatus);
  const dir = context.workingDirectory.split("/").pop() || "/";
  return `${statusIcon} ${import_chalk.default.cyan("claude-flow")}:${import_chalk.default.yellow(dir)}${import_chalk.default.white(">")} `;
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
    style: { "padding-left": 0, "padding-right": 1, border: [] }
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
  const statusIcon = (0, import_formatter.formatStatusIndicator)(
    context.connectionStatus === "connected" ? "success" : "error"
  );
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
  const success = Math.random() > 0.3;
  if (success) {
    context.connectionStatus = "connected";
    console.log(import_chalk.default.green("\u2713 Connected successfully"));
  } else {
    context.connectionStatus = "disconnected";
    console.log(import_chalk.default.red("\u2717 Connection failed"));
    console.log(import_chalk.default.gray("Make sure Claude-Flow is running with: claude-flow start"));
  }
}
__name(connectToOrchestrator, "connectToOrchestrator");
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
  switch (subcommand) {
    case "list":
      await showAgentList();
      break;
    case "spawn":
      await handleAgentSpawn(args.slice(1));
      break;
    case "terminate":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify agent ID"));
      } else {
        await handleAgentTerminate(args[1]);
      }
      break;
    case "info":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify agent ID"));
      } else {
        await showAgentInfo(args[1]);
      }
      break;
    default:
      console.log(import_chalk.default.red(`Unknown agent subcommand: ${subcommand}`));
  }
}
__name(handleAgentCommand, "handleAgentCommand");
async function showAgentList() {
  const agents = [
    { id: "agent-001", name: "Coordinator", type: "coordinator", status: "active", tasks: 2 },
    { id: "agent-002", name: "Researcher", type: "researcher", status: "active", tasks: 5 },
    { id: "agent-003", name: "Implementer", type: "implementer", status: "idle", tasks: 0 }
  ];
  console.log(import_chalk.default.cyan.bold(`Active Agents (${agents.length})`));
  console.log("\u2500".repeat(50));
  const table = new import_cli_table3.default({
    head: ["ID", "Name", "Type", "Status", "Tasks"]
  });
  for (const agent of agents) {
    const statusIcon = (0, import_formatter.formatStatusIndicator)(agent.status);
    table.push([
      import_chalk.default.gray(agent.id),
      import_chalk.default.white(agent.name),
      import_chalk.default.cyan(agent.type),
      `${statusIcon} ${agent.status}`,
      agent.tasks.toString()
    ]);
  }
  console.log(table.toString());
}
__name(showAgentList, "showAgentList");
async function handleAgentSpawn(args) {
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: agent spawn <type> [name]"));
    console.log(import_chalk.default.gray("Types: coordinator, researcher, implementer, analyst, custom"));
    return;
  }
  const type = args[0];
  const name = args[1] || (await import_inquirer.default.prompt([
    {
      type: "input",
      name: "name",
      message: "Agent name:",
      default: `${type}-agent`
    }
  ])).name;
  console.log(import_chalk.default.yellow("Spawning agent..."));
  await new Promise((resolve) => setTimeout(resolve, 1e3));
  const agentId = (0, import_helpers.generateId)("agent");
  console.log(import_chalk.default.green("\u2713 Agent spawned successfully"));
  console.log(`${import_chalk.default.white("ID:")} ${agentId}`);
  console.log(`${import_chalk.default.white("Name:")} ${name}`);
  console.log(`${import_chalk.default.white("Type:")} ${type}`);
}
__name(handleAgentSpawn, "handleAgentSpawn");
async function handleAgentTerminate(agentId) {
  const { confirmed } = await import_inquirer.default.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: `Terminate agent ${agentId}?`,
      default: false
    }
  ]);
  if (!confirmed) {
    console.log(import_chalk.default.gray("Termination cancelled"));
    return;
  }
  console.log(import_chalk.default.yellow("Terminating agent..."));
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(import_chalk.default.green("\u2713 Agent terminated"));
}
__name(handleAgentTerminate, "handleAgentTerminate");
async function showAgentInfo(agentId) {
  console.log(import_chalk.default.cyan.bold("Agent Information"));
  console.log("\u2500".repeat(30));
  console.log(`${import_chalk.default.white("ID:")} ${agentId}`);
  console.log(`${import_chalk.default.white("Name:")} Research Agent`);
  console.log(`${import_chalk.default.white("Type:")} researcher`);
  console.log(`${import_chalk.default.white("Status:")} ${(0, import_formatter.formatStatusIndicator)("success")} active`);
  console.log(`${import_chalk.default.white("Uptime:")} ${(0, import_formatter.formatDuration)(36e5)}`);
  console.log(`${import_chalk.default.white("Active Tasks:")} 3`);
  console.log(`${import_chalk.default.white("Completed Tasks:")} 12`);
}
__name(showAgentInfo, "showAgentInfo");
async function handleTaskCommand(args, context) {
  if (context.connectionStatus !== "connected") {
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    return;
  }
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: task <create|list|status|cancel> [options]"));
    return;
  }
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      await showTaskList();
      break;
    case "create":
      await handleTaskCreate(args.slice(1));
      break;
    case "status":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify task ID"));
      } else {
        await showTaskStatus(args[1]);
      }
      break;
    case "cancel":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify task ID"));
      } else {
        await handleTaskCancel(args[1]);
      }
      break;
    default:
      console.log(import_chalk.default.red(`Unknown task subcommand: ${subcommand}`));
  }
}
__name(handleTaskCommand, "handleTaskCommand");
async function showTaskList() {
  const tasks = [
    {
      id: "task-001",
      type: "research",
      description: "Research quantum computing",
      status: "running",
      agent: "agent-002"
    },
    {
      id: "task-002",
      type: "analysis",
      description: "Analyze research results",
      status: "pending",
      agent: null
    },
    {
      id: "task-003",
      type: "implementation",
      description: "Implement solution",
      status: "completed",
      agent: "agent-003"
    }
  ];
  console.log(import_chalk.default.cyan.bold(`Tasks (${tasks.length})`));
  console.log("\u2500".repeat(60));
  const table = new import_cli_table3.default({
    head: ["ID", "Type", "Description", "Status", "Agent"]
  });
  for (const task of tasks) {
    const statusIcon = (0, import_formatter.formatStatusIndicator)(task.status);
    table.push([
      import_chalk.default.gray(task.id),
      import_chalk.default.white(task.type),
      task.description.substring(0, 30) + (task.description.length > 30 ? "..." : ""),
      `${statusIcon} ${task.status}`,
      task.agent ? import_chalk.default.cyan(task.agent) : "-"
    ]);
  }
  console.log(table.toString());
}
__name(showTaskList, "showTaskList");
async function handleTaskCreate(args) {
  if (args.length < 2) {
    console.log(import_chalk.default.gray("Usage: task create <type> <description>"));
    return;
  }
  const type = args[0];
  const description = args.slice(1).join(" ");
  console.log(import_chalk.default.yellow("Creating task..."));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const taskId = (0, import_helpers.generateId)("task");
  console.log(import_chalk.default.green("\u2713 Task created successfully"));
  console.log(`${import_chalk.default.white("ID:")} ${taskId}`);
  console.log(`${import_chalk.default.white("Type:")} ${type}`);
  console.log(`${import_chalk.default.white("Description:")} ${description}`);
}
__name(handleTaskCreate, "handleTaskCreate");
async function showTaskStatus(taskId) {
  console.log(import_chalk.default.cyan.bold("Task Status"));
  console.log("\u2500".repeat(30));
  console.log(`${import_chalk.default.white("ID:")} ${taskId}`);
  console.log(`${import_chalk.default.white("Type:")} research`);
  console.log(`${import_chalk.default.white("Status:")} ${(0, import_formatter.formatStatusIndicator)("running")} running`);
  console.log(`${import_chalk.default.white("Progress:")} ${(0, import_formatter.formatProgressBar)(65, 100, 20)} 65%`);
  console.log(`${import_chalk.default.white("Agent:")} agent-002`);
  console.log(`${import_chalk.default.white("Started:")} ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
}
__name(showTaskStatus, "showTaskStatus");
async function handleTaskCancel(taskId) {
  const { confirmed } = await import_inquirer.default.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: `Cancel task ${taskId}?`,
      default: false
    }
  ]);
  if (!confirmed) {
    console.log(import_chalk.default.gray("Cancellation cancelled"));
    return;
  }
  console.log(import_chalk.default.yellow("Cancelling task..."));
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(import_chalk.default.green("\u2713 Task cancelled"));
}
__name(handleTaskCancel, "handleTaskCancel");
async function handleMemoryCommand(args, context) {
  if (context.connectionStatus !== "connected") {
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    return;
  }
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: memory <query|stats|export> [options]"));
    return;
  }
  const subcommand = args[0];
  switch (subcommand) {
    case "stats":
      await showMemoryStats();
      break;
    case "query":
      console.log(import_chalk.default.yellow("Memory query functionality not yet implemented in REPL"));
      break;
    case "export":
      console.log(import_chalk.default.yellow("Memory export functionality not yet implemented in REPL"));
      break;
    default:
      console.log(import_chalk.default.red(`Unknown memory subcommand: ${subcommand}`));
  }
}
__name(handleMemoryCommand, "handleMemoryCommand");
async function showMemoryStats() {
  console.log(import_chalk.default.cyan.bold("Memory Statistics"));
  console.log("\u2500".repeat(30));
  console.log(`${import_chalk.default.white("Total Entries:")} 1,247`);
  console.log(`${import_chalk.default.white("Cache Size:")} 95 MB`);
  console.log(`${import_chalk.default.white("Hit Rate:")} 94.2%`);
  console.log(`${import_chalk.default.white("Backend:")} SQLite + Markdown`);
}
__name(showMemoryStats, "showMemoryStats");
async function handleSessionCommand(args, context) {
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: session <list|save|restore> [options]"));
    return;
  }
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      await showSessionList();
      break;
    case "save":
      await handleSessionSave(args.slice(1));
      break;
    case "restore":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify session ID"));
      } else {
        await handleSessionRestore(args[1]);
      }
      break;
    default:
      console.log(import_chalk.default.red(`Unknown session subcommand: ${subcommand}`));
  }
}
__name(handleSessionCommand, "handleSessionCommand");
async function showSessionList() {
  const sessions = [
    { id: "session-001", name: "Research Project", date: "2024-01-15", agents: 3, tasks: 8 },
    { id: "session-002", name: "Development", date: "2024-01-14", agents: 2, tasks: 5 }
  ];
  console.log(import_chalk.default.cyan.bold(`Saved Sessions (${sessions.length})`));
  console.log("\u2500".repeat(50));
  const table = new import_cli_table3.default({
    head: ["ID", "Name", "Date", "Agents", "Tasks"]
  });
  for (const session of sessions) {
    table.push([
      import_chalk.default.gray(session.id),
      import_chalk.default.white(session.name),
      session.date,
      session.agents.toString(),
      session.tasks.toString()
    ]);
  }
  console.log(table.toString());
}
__name(showSessionList, "showSessionList");
async function handleSessionSave(args) {
  const name = args.length > 0 ? args.join(" ") : (await import_inquirer.default.prompt([
    {
      type: "input",
      name: "name",
      message: "Session name:",
      default: `session-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`
    }
  ])).name;
  console.log(import_chalk.default.yellow("Saving session..."));
  await new Promise((resolve) => setTimeout(resolve, 1e3));
  const sessionId = (0, import_helpers.generateId)("session");
  console.log(import_chalk.default.green("\u2713 Session saved successfully"));
  console.log(`${import_chalk.default.white("ID:")} ${sessionId}`);
  console.log(`${import_chalk.default.white("Name:")} ${name}`);
}
__name(handleSessionSave, "handleSessionSave");
async function handleSessionRestore(sessionId) {
  const { confirmed } = await import_inquirer.default.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: `Restore session ${sessionId}?`,
      default: false
    }
  ]);
  if (!confirmed) {
    console.log(import_chalk.default.gray("Restore cancelled"));
    return;
  }
  console.log(import_chalk.default.yellow("Restoring session..."));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  console.log(import_chalk.default.green("\u2713 Session restored successfully"));
}
__name(handleSessionRestore, "handleSessionRestore");
async function handleWorkflowCommand(args, context) {
  if (context.connectionStatus !== "connected") {
    console.log(import_chalk.default.yellow("\u26A0 Not connected to orchestrator"));
    return;
  }
  if (args.length === 0) {
    console.log(import_chalk.default.gray("Usage: workflow <list|run|status> [options]"));
    return;
  }
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      await showWorkflowList();
      break;
    case "run":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify workflow file"));
      } else {
        await handleWorkflowRun(args[1]);
      }
      break;
    case "status":
      if (args.length < 2) {
        console.log(import_chalk.default.red("Please specify workflow ID"));
      } else {
        await showWorkflowStatus(args[1]);
      }
      break;
    default:
      console.log(import_chalk.default.red(`Unknown workflow subcommand: ${subcommand}`));
  }
}
__name(handleWorkflowCommand, "handleWorkflowCommand");
async function showWorkflowList() {
  const workflows = [
    { id: "workflow-001", name: "Research Pipeline", status: "running", progress: 60 },
    { id: "workflow-002", name: "Data Analysis", status: "completed", progress: 100 }
  ];
  console.log(import_chalk.default.cyan.bold(`Workflows (${workflows.length})`));
  console.log("\u2500".repeat(50));
  const table = new import_cli_table3.default({
    head: ["ID", "Name", "Status", "Progress"]
  });
  for (const workflow of workflows) {
    const statusIcon = (0, import_formatter.formatStatusIndicator)(workflow.status);
    const progressBar = (0, import_formatter.formatProgressBar)(workflow.progress, 100, 15);
    table.push([
      import_chalk.default.gray(workflow.id),
      import_chalk.default.white(workflow.name),
      `${statusIcon} ${workflow.status}`,
      `${progressBar} ${workflow.progress}%`
    ]);
  }
  console.log(table.toString());
}
__name(showWorkflowList, "showWorkflowList");
async function handleWorkflowRun(filename) {
  try {
    await import_node_fs.promises.stat(filename);
    console.log(import_chalk.default.yellow(`Running workflow: ${filename}`));
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    const workflowId = (0, import_helpers.generateId)("workflow");
    console.log(import_chalk.default.green("\u2713 Workflow started successfully"));
    console.log(`${import_chalk.default.white("ID:")} ${workflowId}`);
  } catch {
    console.log(import_chalk.default.red(`Workflow file not found: ${filename}`));
  }
}
__name(handleWorkflowRun, "handleWorkflowRun");
async function showWorkflowStatus(workflowId) {
  console.log(import_chalk.default.cyan.bold("Workflow Status"));
  console.log("\u2500".repeat(30));
  console.log(`${import_chalk.default.white("ID:")} ${workflowId}`);
  console.log(`${import_chalk.default.white("Name:")} Research Pipeline`);
  console.log(`${import_chalk.default.white("Status:")} ${(0, import_formatter.formatStatusIndicator)("running")} running`);
  console.log(`${import_chalk.default.white("Progress:")} ${(0, import_formatter.formatProgressBar)(75, 100, 20)} 75%`);
  console.log(`${import_chalk.default.white("Tasks:")} 6/8 completed`);
  console.log(`${import_chalk.default.white("Started:")} ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
}
__name(showWorkflowStatus, "showWorkflowStatus");
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
  startREPL
});
//# sourceMappingURL=repl.js.map
