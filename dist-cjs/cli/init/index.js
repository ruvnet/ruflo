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
var init_exports = {};
__export(init_exports, {
  initCommand: () => initCommand
});
module.exports = __toCommonJS(init_exports);
var import_utils = require("../utils.js");
var import_directory_structure = require("./directory-structure.js");
var import_swarm_commands = require("./swarm-commands.js");
var import_sparc_environment = require("./sparc-environment.js");
var import_claude_config = require("./claude-config.js");
var import_batch_tools = require("./batch-tools.js");
async function initCommand(options = {}) {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    (0, import_utils.printSuccess)("Initializing Claude-Flow project...");
    console.log("\n\u{1F4C1} Phase 1: Creating directory structure...");
    await (0, import_directory_structure.createDirectoryStructure)();
    console.log("\n\u2699\uFE0F  Phase 2: Creating configuration...");
    await (0, import_claude_config.createClaudeConfig)(options);
    console.log("\n\u{1F916} Phase 3: Creating swarm commands...");
    await (0, import_swarm_commands.createSwarmCommands)();
    console.log("\n\u{1F527} Phase 4: Creating batch tools guides...");
    await (0, import_batch_tools.createBatchToolsGuide)();
    if (options.sparc) {
      console.log("\n\u{1F680} Phase 5: Creating SPARC environment...");
      await (0, import_sparc_environment.createSparcEnvironment)();
    }
    console.log("\n\u{1F389} Project initialized successfully!");
    console.log("   \u{1F4C1} Created .claude/ directory structure");
    console.log("   \u{1F4CB} Created comprehensive swarm command documentation");
    console.log("   \u{1F527} Created batch tools coordination guides");
    console.log("   \u{1F4D6} Created detailed usage examples with orchestration");
    console.log("\n   Next steps:");
    console.log('   1. Run "claude-flow swarm --help" to see swarm options');
    console.log("   2. Check .claude/commands/swarm/ for detailed documentation");
    console.log("   3. Review batch tools guide for orchestration patterns");
    console.log('   4. Run "claude-flow help" for all available commands');
    if (options.sparc) {
      console.log('   5. Run "claude-flow sparc modes" to see available SPARC modes');
      console.log("   6. Use TodoWrite/TodoRead for task coordination");
      console.log("   7. Use Task tool for parallel agent execution");
    }
  } catch (error) {
    (0, import_utils.printError)(
      `Failed to initialize project: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}
__name(initCommand, "initCommand");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  initCommand
});
//# sourceMappingURL=index.js.map
