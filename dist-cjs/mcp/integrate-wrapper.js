#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var integrate_wrapper_exports = {};
__export(integrate_wrapper_exports, {
  MCPIntegration: () => MCPIntegration,
  injectClaudeCodeClient: () => injectClaudeCodeClient
});
module.exports = __toCommonJS(integrate_wrapper_exports);
const import_meta = {};
var import_child_process = require("child_process");
var import_client = require("@modelcontextprotocol/sdk/client/index.js");
var import_stdio = require("@modelcontextprotocol/sdk/client/stdio.js");
var import_claude_code_wrapper = require("./claude-code-wrapper.js");
class MCPIntegration {
  static {
    __name(this, "MCPIntegration");
  }
  claudeCodeClient;
  wrapper;
  constructor() {
    this.wrapper = new import_claude_code_wrapper.ClaudeCodeMCPWrapper();
  }
  async connectToClaudeCode() {
    try {
      const claudeCodeProcess = (0, import_child_process.spawn)("npx", ["-y", "@anthropic/claude-code", "mcp"], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      const transport = new import_stdio.StdioClientTransport({
        command: "npx",
        args: ["-y", "@anthropic/claude-code", "mcp"]
      });
      this.claudeCodeClient = new import_client.Client(
        {
          name: "claude-flow-wrapper-client",
          version: "1.0.0"
        },
        {
          capabilities: {}
        }
      );
      await this.claudeCodeClient.connect(transport);
      this.wrapper.claudeCodeMCP = this.claudeCodeClient;
      console.log("Connected to Claude Code MCP server");
    } catch (error) {
      console.error("Failed to connect to Claude Code MCP:", error);
      throw error;
    }
  }
  async start() {
    await this.connectToClaudeCode();
    await this.wrapper.run();
  }
}
function injectClaudeCodeClient(wrapper, client) {
  wrapper.forwardToClaudeCode = async function(toolName, args) {
    try {
      const result = await client.callTool(toolName, args);
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error calling Claude Code tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      };
    }
  };
}
__name(injectClaudeCodeClient, "injectClaudeCodeClient");
if (import_meta.url === `file://${process.argv[1]}`) {
  const integration = new MCPIntegration();
  integration.start().catch(console.error);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MCPIntegration,
  injectClaudeCodeClient
});
//# sourceMappingURL=integrate-wrapper.js.map
