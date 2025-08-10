#!/usr/bin/env node
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
var import_claude_code_wrapper = require("./claude-code-wrapper.js");
const useLegacy = process.env.CLAUDE_FLOW_LEGACY_MCP === "true" || process.argv.includes("--legacy");
async function main() {
  if (useLegacy) {
    console.error("Starting Claude-Flow MCP in legacy mode...");
    const module2 = await import("./server.js");
    if (module2.runMCPServer) {
      await module2.runMCPServer();
    } else if (module2.default) {
      await module2.default();
    } else {
      console.error("Could not find runMCPServer function in legacy server");
      process.exit(1);
    }
  } else {
    console.error("Starting Claude-Flow MCP with Claude Code wrapper...");
    const wrapper = new import_claude_code_wrapper.ClaudeCodeMCPWrapper();
    await wrapper.run();
  }
}
__name(main, "main");
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
//# sourceMappingURL=server-with-wrapper.js.map
