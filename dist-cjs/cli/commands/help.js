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
var help_exports = {};
__export(help_exports, {
  helpCommand: () => helpCommand
});
module.exports = __toCommonJS(help_exports);
var import_commander = require("commander");
var import_help_formatter = require("../help-formatter.js");
var import_chalk = __toESM(require("chalk"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
const helpCommand = new import_commander.Command().name("help").description("Show help information").argument("[command]", "Command to show help for").option("--all", "Show all available commands").action(async (command, options) => {
  if (command) {
    showCommandHelp(command);
  } else {
    showMainHelp();
  }
});
const HELP_TOPICS = [
  {
    name: "getting-started",
    description: "Basic introduction to Claude-Flow",
    category: "basic",
    tutorial: [
      "Welcome to Claude-Flow! This tutorial will get you started.",
      "1. First, initialize a configuration file:",
      "   claude-flow config init",
      "",
      "2. Start the orchestration system:",
      "   claude-flow start",
      "",
      "3. In another terminal, spawn your first agent:",
      '   claude-flow agent spawn researcher --name "My Research Agent"',
      "",
      "4. Create a task for the agent:",
      '   claude-flow task create research "Find information about AI trends"',
      "",
      "5. Monitor progress:",
      "   claude-flow status",
      "",
      "You can also use the interactive REPL mode:",
      "   claude-flow repl",
      "",
      "For more help, try: claude-flow help <topic>"
    ],
    related: ["agents", "tasks", "configuration"]
  },
  {
    name: "agents",
    description: "Working with Claude-Flow agents",
    category: "basic",
    examples: [
      {
        description: "Spawn a research agent",
        command: 'claude-flow agent spawn researcher --name "Research Assistant"',
        explanation: "Creates a new research agent with specialized capabilities for information gathering"
      },
      {
        description: "List all active agents",
        command: "claude-flow agent list",
        explanation: "Shows all currently running agents with their status and task counts"
      },
      {
        description: "Get detailed agent information",
        command: "claude-flow agent info agent-001",
        explanation: "Displays comprehensive information about a specific agent"
      },
      {
        description: "Terminate an agent",
        command: "claude-flow agent terminate agent-001",
        explanation: "Safely shuts down an agent and reassigns its tasks"
      }
    ],
    tutorial: [
      "Agents are the core workers in Claude-Flow. Each agent has:",
      "\u2022 A unique ID (automatically generated)",
      "\u2022 A name (for easy identification)",
      "\u2022 A type (coordinator, researcher, implementer, analyst, custom)",
      "\u2022 Capabilities (what the agent can do)",
      "\u2022 A system prompt (instructions for the agent)",
      "",
      "Agent Types:",
      "\u2022 coordinator: Plans and delegates tasks",
      "\u2022 researcher: Gathers and analyzes information",
      "\u2022 implementer: Writes code and creates solutions",
      "\u2022 analyst: Identifies patterns and generates insights",
      "\u2022 custom: User-defined behavior",
      "",
      "Best Practices:",
      "\u2022 Use descriptive names for your agents",
      "\u2022 Match agent types to your workflow needs",
      '\u2022 Monitor agent performance with "claude-flow status"',
      "\u2022 Terminate idle agents to free resources"
    ],
    related: ["tasks", "workflows", "coordination"]
  },
  {
    name: "tasks",
    description: "Creating and managing tasks",
    category: "basic",
    examples: [
      {
        description: "Create a research task",
        command: 'claude-flow task create research "Find papers on quantum computing" --priority 5',
        explanation: "Creates a high-priority research task with specific instructions"
      },
      {
        description: "Create a task with dependencies",
        command: 'claude-flow task create analysis "Analyze research results" --dependencies task-001',
        explanation: "Creates a task that waits for task-001 to complete before starting"
      },
      {
        description: "Assign task to specific agent",
        command: 'claude-flow task create implementation "Write API client" --assign agent-003',
        explanation: "Directly assigns a task to a specific agent"
      },
      {
        description: "Monitor task progress",
        command: "claude-flow task status task-001",
        explanation: "Shows detailed status and progress information for a task"
      },
      {
        description: "Cancel a running task",
        command: 'claude-flow task cancel task-001 --reason "Requirements changed"',
        explanation: "Stops a task and provides a reason for cancellation"
      }
    ],
    tutorial: [
      "Tasks are units of work that agents execute. Key concepts:",
      "",
      "Task Properties:",
      "\u2022 ID: Unique identifier",
      "\u2022 Type: Category of work (research, implementation, analysis, etc.)",
      "\u2022 Description: What needs to be done",
      "\u2022 Priority: Execution order (0-10, higher = more urgent)",
      "\u2022 Dependencies: Tasks that must complete first",
      "\u2022 Input: Data needed by the task",
      "\u2022 Status: Current state (pending, running, completed, failed)",
      "",
      "Task Lifecycle:",
      "1. Created (pending status)",
      "2. Queued (waiting for agent)",
      "3. Assigned (agent selected)",
      "4. Running (actively being worked on)",
      "5. Completed/Failed (final state)",
      "",
      "Task Dependencies:",
      "\u2022 Tasks can depend on other tasks",
      "\u2022 Dependencies must complete before task starts",
      "\u2022 Use for sequential workflows",
      "\u2022 Circular dependencies are not allowed"
    ],
    related: ["agents", "workflows", "coordination"]
  },
  {
    name: "claude",
    description: "Spawning Claude instances with specific configurations",
    category: "basic",
    examples: [
      {
        description: "Spawn Claude with web research capabilities",
        command: 'claude-flow claude spawn "implement user authentication" --research --parallel',
        explanation: "Creates a Claude instance with WebFetchTool and BatchTool for parallel web research"
      },
      {
        description: "Spawn Claude without permission prompts",
        command: 'claude-flow claude spawn "fix payment bug" --no-permissions',
        explanation: "Runs Claude with --dangerously-skip-permissions flag to avoid interruptions"
      },
      {
        description: "Spawn Claude with custom tools",
        command: 'claude-flow claude spawn "analyze codebase" --tools "View,Edit,GrepTool,LS"',
        explanation: "Specifies exactly which tools Claude can use for the task"
      },
      {
        description: "Spawn Claude with test coverage target",
        command: 'claude-flow claude spawn "write unit tests" --coverage 95 --commit feature',
        explanation: "Sets test coverage goal to 95% and commits after each feature"
      },
      {
        description: "Dry run to preview command",
        command: 'claude-flow claude spawn "build API" --mode backend-only --dry-run',
        explanation: "Shows what would be executed without actually running Claude"
      }
    ],
    tutorial: [
      "The claude spawn command launches Claude instances with specific configurations.",
      "",
      "Available Options:",
      "\u2022 --tools, -t: Specify allowed tools (default: View,Edit,Replace,GlobTool,GrepTool,LS,Bash)",
      "\u2022 --no-permissions: Skip permission prompts with --dangerously-skip-permissions",
      "\u2022 --config, -c: Path to MCP configuration file",
      "\u2022 --mode, -m: Development mode (full, backend-only, frontend-only, api-only)",
      "\u2022 --parallel: Enable BatchTool and dispatch_agent for parallel execution",
      "\u2022 --research: Enable WebFetchTool for web research capabilities",
      "\u2022 --coverage: Test coverage target percentage (default: 80)",
      "\u2022 --commit: Commit frequency (phase, feature, manual)",
      "\u2022 --verbose, -v: Enable verbose output",
      "\u2022 --dry-run, -d: Preview what would be executed",
      "",
      "Environment Variables Set:",
      "\u2022 CLAUDE_INSTANCE_ID: Unique identifier for the Claude instance",
      "\u2022 CLAUDE_FLOW_MODE: Development mode setting",
      "\u2022 CLAUDE_FLOW_COVERAGE: Target test coverage percentage",
      "\u2022 CLAUDE_FLOW_COMMIT: Commit frequency setting",
      "",
      "Common Use Cases:",
      "\u2022 Full-stack development: --mode full --parallel",
      "\u2022 API development: --mode backend-only --coverage 90",
      "\u2022 Bug fixing: --no-permissions --verbose",
      "\u2022 Research tasks: --research --parallel",
      "\u2022 Test writing: --coverage 95 --commit feature"
    ],
    related: ["agents", "tasks", "workflows"]
  },
  {
    name: "workflows",
    description: "Building complex multi-step workflows",
    category: "workflow",
    examples: [
      {
        description: "Run a workflow from file",
        command: "claude-flow workflow run research-pipeline.json --watch",
        explanation: "Executes a workflow definition and monitors progress in real-time"
      },
      {
        description: "Validate workflow before running",
        command: "claude-flow workflow validate my-workflow.json --strict",
        explanation: "Checks workflow syntax and dependencies without executing"
      },
      {
        description: "Generate workflow template",
        command: "claude-flow workflow template research --output research-workflow.json",
        explanation: "Creates a pre-configured workflow template for research tasks"
      },
      {
        description: "Monitor running workflows",
        command: "claude-flow workflow list --all",
        explanation: "Shows all workflows including completed ones"
      },
      {
        description: "Stop a running workflow",
        command: "claude-flow workflow stop workflow-001 --force",
        explanation: "Immediately stops all tasks in a workflow"
      }
    ],
    tutorial: [
      "Workflows orchestrate multiple tasks and agents. Structure:",
      "",
      "Workflow Definition (JSON):",
      "{",
      '  "name": "Research and Analysis",',
      '  "description": "Multi-stage research workflow",',
      '  "agents": [',
      '    {"id": "researcher", "type": "researcher"},',
      '    {"id": "analyzer", "type": "analyst"}',
      "  ],",
      '  "tasks": [',
      "    {",
      '      "id": "research-task",',
      '      "type": "research",',
      '      "description": "Gather information",',
      '      "assignTo": "researcher"',
      "    },",
      "    {",
      '      "id": "analyze-task",',
      '      "type": "analysis",',
      '      "description": "Analyze findings",',
      '      "assignTo": "analyzer",',
      '      "depends": ["research-task"]',
      "    }",
      "  ]",
      "}",
      "",
      "Workflow Features:",
      "\u2022 Variable substitution: ${variable}",
      "\u2022 Conditional execution",
      "\u2022 Parallel task execution",
      "\u2022 Error handling and retries",
      "\u2022 Progress monitoring",
      "",
      "Best Practices:",
      "\u2022 Start with simple workflows",
      "\u2022 Use descriptive task names",
      "\u2022 Plan dependencies carefully",
      "\u2022 Test with --dry-run first"
    ],
    related: ["tasks", "agents", "templates"]
  },
  {
    name: "configuration",
    description: "Configuring Claude-Flow settings",
    category: "configuration",
    examples: [
      {
        description: "Initialize default configuration",
        command: "claude-flow config init --template development",
        explanation: "Creates a configuration file optimized for development"
      },
      {
        description: "View current configuration",
        command: "claude-flow config show --diff",
        explanation: "Shows only settings that differ from defaults"
      },
      {
        description: "Update a setting",
        command: "claude-flow config set orchestrator.maxConcurrentAgents 20",
        explanation: "Changes the maximum number of concurrent agents"
      },
      {
        description: "Save configuration profile",
        command: "claude-flow config profile save production",
        explanation: "Saves current settings as a named profile"
      },
      {
        description: "Load configuration profile",
        command: "claude-flow config profile load development",
        explanation: "Switches to a previously saved configuration profile"
      }
    ],
    tutorial: [
      "Configuration controls all aspects of Claude-Flow behavior.",
      "",
      "Main Configuration Sections:",
      "",
      "\u2022 orchestrator: Core system settings",
      "  - maxConcurrentAgents: How many agents can run simultaneously",
      "  - taskQueueSize: Maximum pending tasks",
      "  - healthCheckInterval: How often to check system health",
      "",
      "\u2022 terminal: Terminal integration settings",
      "  - type: Terminal type (auto, vscode, native)",
      "  - poolSize: Number of terminal sessions to maintain",
      "",
      "\u2022 memory: Memory management settings",
      "  - backend: Storage type (sqlite, markdown, hybrid)",
      "  - cacheSizeMB: Memory cache size",
      "  - retentionDays: How long to keep data",
      "",
      "\u2022 mcp: Model Context Protocol settings",
      "  - transport: Communication method (stdio, http)",
      "  - port: Network port for HTTP transport",
      "",
      "Configuration Files:",
      "\u2022 Global: ~/.claude-flow/config.json",
      "\u2022 Project: ./claude-flow.config.json",
      "\u2022 Profiles: ~/.claude-flow/profiles/",
      "",
      "Environment Variables:",
      "\u2022 CLAUDE_FLOW_LOG_LEVEL: Override log level",
      "\u2022 CLAUDE_FLOW_MAX_AGENTS: Override agent limit",
      "\u2022 CLAUDE_FLOW_MCP_PORT: Override MCP port"
    ],
    related: ["profiles", "environment", "troubleshooting"]
  },
  {
    name: "monitoring",
    description: "Monitoring system health and performance",
    category: "advanced",
    examples: [
      {
        description: "Check system status",
        command: "claude-flow status --watch",
        explanation: "Continuously monitors system health and updates every few seconds"
      },
      {
        description: "Start monitoring dashboard",
        command: "claude-flow monitor --interval 5",
        explanation: "Opens a live dashboard with real-time metrics and graphs"
      },
      {
        description: "View component-specific status",
        command: "claude-flow status --component orchestrator",
        explanation: "Shows detailed status for a specific system component"
      },
      {
        description: "Monitor in compact mode",
        command: "claude-flow monitor --compact --no-graphs",
        explanation: "Simplified monitoring view without visual graphs"
      }
    ],
    tutorial: [
      "Claude-Flow provides comprehensive monitoring capabilities.",
      "",
      "Monitoring Commands:",
      "\u2022 status: Point-in-time system status",
      "\u2022 monitor: Live dashboard with continuous updates",
      "",
      "Key Metrics:",
      "\u2022 System Health: Overall status (healthy/degraded/unhealthy)",
      "\u2022 Resource Usage: CPU, memory, agent count",
      "\u2022 Component Status: Individual system components",
      "\u2022 Agent Activity: Active agents and their tasks",
      "\u2022 Task Queue: Pending and completed tasks",
      "\u2022 Performance Graphs: Historical trends",
      "",
      "Monitoring Best Practices:",
      "\u2022 Check status before starting large workflows",
      "\u2022 Monitor during heavy usage",
      "\u2022 Watch for resource exhaustion",
      "\u2022 Track task completion rates",
      "\u2022 Set up alerts for critical issues",
      "",
      "Troubleshooting with Monitoring:",
      "\u2022 High CPU: Too many concurrent tasks",
      "\u2022 High Memory: Large cache or memory leaks",
      "\u2022 Failed Tasks: Agent or system issues",
      "\u2022 Slow Performance: Resource constraints"
    ],
    related: ["status", "performance", "troubleshooting"]
  },
  {
    name: "sessions",
    description: "Managing sessions and state persistence",
    category: "advanced",
    examples: [
      {
        description: "Save current session",
        command: 'claude-flow session save "Development Session" --description "Working on API integration"',
        explanation: "Saves all current agents, tasks, and memory state"
      },
      {
        description: "List saved sessions",
        command: "claude-flow session list",
        explanation: "Shows all saved sessions with creation dates and metadata"
      },
      {
        description: "Restore a session",
        command: "claude-flow session restore session-001 --merge",
        explanation: "Restores session state, merging with current state"
      },
      {
        description: "Export session to file",
        command: "claude-flow session export session-001 backup.json --include-memory",
        explanation: "Creates a portable backup including agent memory"
      },
      {
        description: "Clean up old sessions",
        command: "claude-flow session clean --older-than 30 --dry-run",
        explanation: "Shows what sessions would be deleted (older than 30 days)"
      }
    ],
    tutorial: [
      "Sessions capture the complete state of your Claude-Flow environment.",
      "",
      "What Sessions Include:",
      "\u2022 All active agents and their configurations",
      "\u2022 Current task queue and status",
      "\u2022 Agent memory and conversation history",
      "\u2022 System configuration snapshot",
      "",
      "Session Use Cases:",
      "\u2022 Save work-in-progress",
      "\u2022 Share team configurations",
      "\u2022 Backup before major changes",
      "\u2022 Reproduce issues for debugging",
      "\u2022 Switch between projects",
      "",
      "Session Management:",
      "\u2022 Automatic checksums for integrity",
      "\u2022 Compression for large sessions",
      "\u2022 Selective restore (agents only, tasks only)",
      "\u2022 Version compatibility checking",
      "",
      "Best Practices:",
      "\u2022 Save sessions before major changes",
      "\u2022 Use descriptive names and tags",
      "\u2022 Regular cleanup of old sessions",
      "\u2022 Export important sessions as backups",
      "\u2022 Test restore before relying on sessions"
    ],
    related: ["backup", "state", "persistence"]
  },
  {
    name: "repl",
    description: "Using the interactive REPL mode",
    category: "basic",
    examples: [
      {
        description: "Start REPL mode",
        command: "claude-flow repl",
        explanation: "Opens interactive command line with tab completion"
      },
      {
        description: "REPL with custom history file",
        command: "claude-flow repl --history-file .my-history",
        explanation: "Uses a specific file for command history"
      },
      {
        description: "Skip welcome banner",
        command: "claude-flow repl --no-banner",
        explanation: "Starts REPL in minimal mode"
      }
    ],
    tutorial: [
      "The REPL (Read-Eval-Print Loop) provides an interactive interface.",
      "",
      "REPL Features:",
      "\u2022 Tab completion for commands and arguments",
      "\u2022 Command history (up/down arrows)",
      "\u2022 Real-time connection status",
      "\u2022 Built-in help system",
      "\u2022 Command aliases and shortcuts",
      "",
      "Special REPL Commands:",
      "\u2022 help: Show available commands",
      "\u2022 status: Check system status",
      "\u2022 connect: Connect to orchestrator",
      "\u2022 history: View command history",
      "\u2022 clear: Clear screen",
      "\u2022 cd/pwd: Navigate directories",
      "",
      "REPL Tips:",
      "\u2022 Use tab completion extensively",
      "\u2022 Check connection status regularly",
      '\u2022 Use "help <command>" for detailed help',
      "\u2022 History is saved between sessions",
      '\u2022 Ctrl+C or "exit" to quit'
    ],
    related: ["completion", "interactive", "commands"]
  },
  {
    name: "troubleshooting",
    description: "Diagnosing and fixing common issues",
    category: "troubleshooting",
    examples: [
      {
        description: "Check system health",
        command: "claude-flow status --component all",
        explanation: "Comprehensive health check of all components"
      },
      {
        description: "Enable debug logging",
        command: "claude-flow start --log-level debug",
        explanation: "Start with verbose logging for debugging"
      },
      {
        description: "Validate configuration",
        command: "claude-flow config validate claude-flow.config.json --strict",
        explanation: "Check configuration file for errors"
      },
      {
        description: "Reset to defaults",
        command: "claude-flow config reset --confirm",
        explanation: "Restore default configuration settings"
      }
    ],
    tutorial: [
      "Common issues and solutions:",
      "",
      "Connection Issues:",
      '\u2022 Problem: "Connection refused" errors',
      '\u2022 Solution: Ensure Claude-Flow is started with "claude-flow start"',
      "\u2022 Check: MCP transport settings match between client and server",
      "",
      "Agent Issues:",
      "\u2022 Problem: Agents not spawning",
      "\u2022 Solution: Check agent limits in configuration",
      "\u2022 Check: Available system resources",
      "",
      "Task Issues:",
      "\u2022 Problem: Tasks stuck in pending state",
      "\u2022 Solution: Verify agent availability and task dependencies",
      "\u2022 Check: Task queue size limits",
      "",
      "Performance Issues:",
      "\u2022 Problem: Slow response times",
      "\u2022 Solution: Reduce concurrent agents or increase resources",
      "\u2022 Check: Memory usage and cache settings",
      "",
      "Configuration Issues:",
      "\u2022 Problem: Settings not taking effect",
      "\u2022 Solution: Validate configuration file syntax",
      "\u2022 Check: Environment variable overrides",
      "",
      "Debug Commands:",
      "\u2022 claude-flow status: System health check",
      "\u2022 claude-flow config validate: Configuration check",
      "\u2022 claude-flow --verbose: Enable detailed logging",
      "\u2022 claude-flow monitor: Real-time diagnostics"
    ],
    related: ["monitoring", "configuration", "debugging"]
  }
];
function showMainHelp() {
  const mainHelp = {
    name: "claude-flow",
    description: "Advanced AI agent orchestration system",
    usage: `claude-flow <command> [<args>] [options]
    claude-flow <command> --help
    claude-flow --version`,
    commands: [
      {
        name: "hive-mind",
        description: "Manage hive mind swarm intelligence"
      },
      {
        name: "init",
        description: "Initialize Claude Flow configuration"
      },
      {
        name: "start",
        description: "Start orchestration system"
      },
      {
        name: "swarm",
        description: "Execute multi-agent swarm coordination"
      },
      {
        name: "agent",
        description: "Manage individual agents"
      },
      {
        name: "sparc",
        description: "Execute SPARC development modes"
      },
      {
        name: "memory",
        description: "Manage persistent memory operations"
      },
      {
        name: "github",
        description: "Automate GitHub workflows"
      },
      {
        name: "status",
        description: "Show system status and health"
      },
      {
        name: "config",
        description: "Manage configuration settings"
      },
      {
        name: "session",
        description: "Manage sessions and state persistence"
      },
      {
        name: "help",
        description: "Show help information"
      }
    ],
    globalOptions: [
      {
        flags: "--config <path>",
        description: "Configuration file path",
        defaultValue: ".claude/config.json"
      },
      {
        flags: "--verbose",
        description: "Enable verbose output"
      },
      {
        flags: "--quiet",
        description: "Suppress non-error output"
      },
      {
        flags: "--json",
        description: "Output in JSON format"
      },
      {
        flags: "--help",
        description: "Show help information"
      },
      {
        flags: "--version",
        description: "Show version information"
      }
    ],
    examples: [
      "claude-flow init --sparc",
      "claude-flow hive-mind wizard",
      'claude-flow swarm "Build REST API"',
      "claude-flow status --json"
    ]
  };
  console.log(import_help_formatter.HelpFormatter.formatHelp(mainHelp));
}
__name(showMainHelp, "showMainHelp");
function showCommandHelp(command) {
  const commandHelp = getCommandHelp(command);
  if (commandHelp) {
    console.log(import_help_formatter.HelpFormatter.formatHelp(commandHelp));
  } else {
    console.error(
      import_help_formatter.HelpFormatter.formatError(
        `Unknown command: ${command}`,
        "claude-flow help",
        "claude-flow help [command]"
      )
    );
  }
}
__name(showCommandHelp, "showCommandHelp");
function getCommandHelp(command) {
  const commandHelpMap = {
    "hive-mind": {
      name: "claude-flow hive-mind",
      description: "Manage hive mind swarm intelligence",
      usage: "claude-flow hive-mind <subcommand> [options]",
      commands: [
        { name: "init", description: "Initialize hive mind system" },
        { name: "spawn", description: "Create intelligent swarm with objective" },
        { name: "status", description: "View active swarms and metrics" },
        { name: "stop", description: "Stop a running swarm" },
        { name: "ps", description: "List all running processes" },
        { name: "resume", description: "Resume a paused swarm" },
        { name: "wizard", description: "Interactive setup wizard" }
      ],
      options: [
        {
          flags: "--queen-type <type>",
          description: "Queen coordination type",
          defaultValue: "adaptive",
          validValues: ["strategic", "tactical", "adaptive"]
        },
        {
          flags: "--workers <count>",
          description: "Number of worker agents",
          defaultValue: "5"
        },
        {
          flags: "--timeout <seconds>",
          description: "Operation timeout",
          defaultValue: "300"
        },
        {
          flags: "--no-consensus",
          description: "Disable consensus requirements"
        },
        {
          flags: "--help",
          description: "Show this help message"
        }
      ],
      examples: [
        'claude-flow hive-mind spawn "Build REST API" --queen-type strategic',
        "claude-flow hive-mind status --json",
        "claude-flow hive-mind stop swarm-123"
      ]
    },
    agent: {
      name: "claude-flow agent",
      description: "Manage individual agents",
      usage: "claude-flow agent <action> [options]",
      commands: [
        { name: "spawn", description: "Create a new agent" },
        { name: "list", description: "List all active agents" },
        { name: "info", description: "Show agent details" },
        { name: "terminate", description: "Stop an agent" }
      ],
      options: [
        {
          flags: "--type <type>",
          description: "Agent type",
          validValues: ["coordinator", "researcher", "coder", "analyst", "tester"]
        },
        {
          flags: "--name <name>",
          description: "Agent name"
        },
        {
          flags: "--json",
          description: "Output in JSON format"
        },
        {
          flags: "--help",
          description: "Show this help message"
        }
      ],
      examples: [
        'claude-flow agent spawn researcher --name "Research Bot"',
        "claude-flow agent list --json",
        "claude-flow agent terminate agent-123"
      ]
    }
  };
  return commandHelpMap[command] || null;
}
__name(getCommandHelp, "getCommandHelp");
function showAllTopics() {
  console.log(import_chalk.default.cyan.bold("All Help Topics"));
  console.log("\u2500".repeat(50));
  const table = new import_cli_table3.default({
    head: ["Topic", "Category", "Description"],
    style: { head: ["cyan"] }
  });
  for (const topic of HELP_TOPICS) {
    table.push([import_chalk.default.cyan(topic.name), import_chalk.default.yellow(topic.category), topic.description]);
  }
  console.log(table.toString());
  console.log();
  console.log(import_chalk.default.gray('Use "claude-flow help <topic>" for detailed information.'));
}
__name(showAllTopics, "showAllTopics");
async function showTopicHelp(topicName, options) {
  const topic = HELP_TOPICS.find((t) => t.name === topicName);
  if (!topic) {
    console.log(import_chalk.default.red(`Help topic '${topicName}' not found.`));
    console.log();
    const similar = HELP_TOPICS.filter(
      (t) => t.name.includes(topicName) || t.description.toLowerCase().includes(topicName.toLowerCase())
    );
    if (similar.length > 0) {
      console.log(import_chalk.default.gray("Did you mean:"));
      for (const suggestion of similar) {
        console.log(import_chalk.default.cyan(`  ${suggestion.name}`));
      }
    } else {
      console.log(import_chalk.default.gray('Use "claude-flow help --all" to see all topics.'));
    }
    return;
  }
  console.log(import_chalk.default.cyan.bold(`Help: ${topic.name}`));
  console.log("\u2500".repeat(50));
  console.log(import_chalk.default.white(topic.description));
  console.log();
  if (options.tutorial && topic.tutorial) {
    console.log(import_chalk.default.yellow.bold("Tutorial:"));
    console.log("\u2500".repeat(20));
    for (const line of topic.tutorial) {
      if (line.trim().startsWith("claude-flow")) {
        console.log(import_chalk.default.cyan(`  ${line}`));
      } else if (line.trim() === "") {
        console.log();
      } else {
        console.log(import_chalk.default.white(line));
      }
    }
    console.log();
  }
  if (options.examples && topic.examples) {
    console.log(import_chalk.default.yellow.bold("Examples:"));
    console.log("\u2500".repeat(20));
    for (const example of topic.examples) {
      console.log(import_chalk.default.white.bold(`${example.description}:`));
      console.log(import_chalk.default.cyan(`  ${example.command}`));
      if (example.explanation) {
        console.log(import_chalk.default.gray(`  ${example.explanation}`));
      }
      console.log();
    }
  }
  if (!options.examples && !options.tutorial) {
    if (topic.tutorial) {
      console.log(import_chalk.default.yellow.bold("Overview:"));
      console.log("\u2500".repeat(20));
      const overview = topic.tutorial.slice(0, 5);
      for (const line of overview) {
        if (line.trim() === "") {
          console.log();
        } else {
          console.log(import_chalk.default.white(line));
        }
      }
      console.log();
      console.log(import_chalk.default.gray("Use --tutorial for complete tutorial."));
      console.log();
    }
    if (topic.examples) {
      console.log(import_chalk.default.yellow.bold("Common Examples:"));
      console.log("\u2500".repeat(20));
      const commonExamples = topic.examples.slice(0, 3);
      for (const example of commonExamples) {
        console.log(import_chalk.default.cyan(`  ${example.command}`));
        console.log(import_chalk.default.gray(`    ${example.description}`));
      }
      if (topic.examples.length > 3) {
        console.log(import_chalk.default.gray(`    ... and ${topic.examples.length - 3} more`));
      }
      console.log();
      console.log(import_chalk.default.gray("Use --examples for all examples."));
      console.log();
    }
  }
  if (topic.related && topic.related.length > 0) {
    console.log(import_chalk.default.yellow.bold("Related Topics:"));
    console.log("\u2500".repeat(20));
    for (const related of topic.related) {
      console.log(import_chalk.default.cyan(`  claude-flow help ${related}`));
    }
    console.log();
  }
}
__name(showTopicHelp, "showTopicHelp");
async function startInteractiveHelp() {
  console.log(import_chalk.default.cyan.bold("Interactive Help Mode"));
  console.log("\u2500".repeat(30));
  console.log();
  while (true) {
    const categories = [
      { name: "Getting Started", value: "getting-started" },
      { name: "Agents", value: "agents" },
      { name: "Tasks", value: "tasks" },
      { name: "Workflows", value: "workflows" },
      { name: "Configuration", value: "configuration" },
      { name: "Monitoring", value: "monitoring" },
      { name: "Sessions", value: "sessions" },
      { name: "REPL Mode", value: "repl" },
      { name: "Troubleshooting", value: "troubleshooting" },
      { name: "Browse All Topics", value: "all" },
      { name: "Exit", value: "exit" }
    ];
    const result = await import_inquirer.default.prompt([
      {
        type: "list",
        name: "choice",
        message: "What would you like help with?",
        choices: categories
      }
    ]);
    const choice = result.choice;
    if (choice === "exit") {
      console.log(import_chalk.default.gray("Goodbye!"));
      break;
    }
    console.log();
    if (choice === "all") {
      showAllTopics();
    } else {
      await showTopicHelp(choice, { tutorial: true, examples: true });
    }
    console.log();
    console.log(import_chalk.default.gray("Press Enter to continue..."));
    await new Promise((resolve) => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(void 0);
      });
    });
    console.clear();
  }
}
__name(startInteractiveHelp, "startInteractiveHelp");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  helpCommand
});
//# sourceMappingURL=help.js.map
