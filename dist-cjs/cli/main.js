#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const import_meta = {};
var import_cli_core = require("./cli-core.js");
var import_commands = require("./commands/index.js");
var import_node_url = require("node:url");
var import_node_path = require("node:path");
async function main() {
  const cli = new import_cli_core.CLI("claude-flow", "Advanced AI Agent Orchestration System");
  (0, import_commands.setupCommands)(cli);
  await cli.run();
}
__name(main, "main");
const __filename = (0, import_node_url.fileURLToPath)(import_meta.url);
const __dirname = (0, import_node_path.dirname)(__filename);
const isMainModule = process.argv[1] === __filename || process.argv[1].endsWith("/main.js");
if (isMainModule) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
//# sourceMappingURL=main.js.map
