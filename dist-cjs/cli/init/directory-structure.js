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
var directory_structure_exports = {};
__export(directory_structure_exports, {
  createDirectoryStructure: () => createDirectoryStructure
});
module.exports = __toCommonJS(directory_structure_exports);
async function createDirectoryStructure() {
  const fs = await import("fs/promises");
  const path = await import("path");
  const directories = [
    ".claude",
    ".claude/commands",
    ".claude/commands/swarm",
    ".claude/commands/sparc",
    ".claude/logs",
    ".claude/memory",
    ".claude/configs",
    "memory",
    "memory/agents",
    "memory/sessions",
    "coordination",
    "coordination/memory_bank",
    "coordination/subtasks",
    "coordination/orchestration",
    "reports"
  ];
  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`  \u2705 Created ${dir}/ directory`);
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
  const readmeFiles = {
    "memory/agents/README.md": createAgentsReadme(),
    "memory/sessions/README.md": createSessionsReadme(),
    "coordination/README.md": createCoordinationReadme(),
    "reports/README.md": createReportsReadme()
  };
  for (const [filePath, content] of Object.entries(readmeFiles)) {
    await fs.writeFile(filePath, content);
    console.log(`  \u2705 Created ${filePath}`);
  }
  const initialData = {
    agents: [],
    tasks: [],
    swarms: [],
    lastUpdated: Date.now(),
    version: "1.0.71"
  };
  await fs.writeFile("memory/claude-flow-data.json", JSON.stringify(initialData, null, 2));
  console.log("  \u2705 Created memory/claude-flow-data.json (persistence database)");
}
__name(createDirectoryStructure, "createDirectoryStructure");
function createAgentsReadme() {
  return `# Agents Directory

This directory stores persistent information about AI agents created and managed by Claude-Flow.

## Structure
- Each agent gets its own JSON file named by agent ID
- Agent files contain configuration, state, and memory
- Shared agent data is stored in agent-registry.json

## Usage
Agents are automatically managed by the Claude-Flow orchestration system. You can:
- View agent status with \`claude-flow agent list\`
- Create new agents with \`claude-flow agent spawn <type>\`
- Configure agents with \`claude-flow agent configure <id>\`

## Files
- \`agent-registry.json\`: Central agent registry
- \`agent-<id>.json\`: Individual agent data files
- \`templates/\`: Agent configuration templates
`;
}
__name(createAgentsReadme, "createAgentsReadme");
function createSessionsReadme() {
  return `# Sessions Directory

This directory stores information about Claude-Flow orchestration sessions.

## Structure
- Each session gets its own subdirectory
- Session data includes tasks, coordination state, and results
- Session logs are automatically rotated

## Usage
Sessions are managed automatically during orchestration:
- Start sessions with \`claude-flow start\`
- Monitor sessions with \`claude-flow status\`
- Review session history with \`claude-flow session list\`

## Files
- \`session-<id>/\`: Individual session directories
- \`active-sessions.json\`: Currently active sessions
- \`session-history.json\`: Historical session data
`;
}
__name(createSessionsReadme, "createSessionsReadme");
function createCoordinationReadme() {
  return `# Coordination Directory

This directory manages task coordination and orchestration data.

## Subdirectories
- \`memory_bank/\`: Shared memory for agent coordination
- \`subtasks/\`: Task breakdown and assignment data
- \`orchestration/\`: High-level orchestration patterns

## Usage
Coordination data is used for:
- Multi-agent task distribution
- Progress tracking and monitoring
- Resource allocation and balancing
- Error recovery and failover

Access coordination data through the Claude-Flow API or CLI commands.
`;
}
__name(createCoordinationReadme, "createCoordinationReadme");
function createReportsReadme() {
  return `# Reports Directory

This directory stores output reports from swarm operations and orchestration tasks.

## Structure
- Swarm reports are stored by operation ID
- Reports include execution logs, results, and metrics
- Multiple output formats supported (JSON, SQLite, CSV, HTML)

## Usage
Reports are generated automatically by swarm operations:
- View recent reports with \`claude-flow swarm list\`
- Check specific reports with \`claude-flow swarm status <id>\`
- Export reports in different formats using \`--output\` flags

## File Types
- \`*.json\`: Structured operation data
- \`*.sqlite\`: Database format for complex queries
- \`*.csv\`: Tabular data for analysis
- \`*.html\`: Human-readable reports
`;
}
__name(createReportsReadme, "createReportsReadme");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createDirectoryStructure
});
//# sourceMappingURL=directory-structure.js.map
