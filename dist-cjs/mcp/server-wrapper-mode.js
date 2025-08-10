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
const isWrapperMode = process.env.CLAUDE_FLOW_WRAPPER_MODE === "true" || process.argv.includes("--wrapper");
async function main() {
  if (isWrapperMode) {
    console.error("Starting Claude-Flow MCP in wrapper mode...");
    const wrapper = new import_claude_code_wrapper.ClaudeCodeMCPWrapper();
    await wrapper.run();
  } else {
    console.error("Starting Claude-Flow MCP in direct mode...");
    const { runMCPServer } = await import("./server.js");
    await runMCPServer();
  }
}
__name(main, "main");
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
//# sourceMappingURL=server-wrapper-mode.js.map
