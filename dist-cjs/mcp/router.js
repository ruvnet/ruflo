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
var router_exports = {};
__export(router_exports, {
  RequestRouter: () => RequestRouter
});
module.exports = __toCommonJS(router_exports);
var import_errors = require("../utils/errors.js");
class RequestRouter {
  constructor(toolRegistry, logger) {
    this.toolRegistry = toolRegistry;
    this.logger = logger;
  }
  static {
    __name(this, "RequestRouter");
  }
  totalRequests = 0;
  successfulRequests = 0;
  failedRequests = 0;
  /**
   * Routes a request to the appropriate handler
   */
  async route(request) {
    this.totalRequests++;
    try {
      const { method, params } = request;
      if (method.startsWith("rpc.")) {
        return await this.handleRPCMethod(method, params);
      }
      if (method.startsWith("tools.")) {
        return await this.handleToolMethod(method, params);
      }
      const tool = this.toolRegistry.getTool(method);
      if (tool) {
        const result = await this.toolRegistry.executeTool(method, params);
        this.successfulRequests++;
        return result;
      }
      throw new import_errors.MCPMethodNotFoundError(method);
    } catch (error) {
      this.failedRequests++;
      throw error;
    }
  }
  /**
   * Gets router metrics
   */
  getMetrics() {
    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests
    };
  }
  /**
   * Handles built-in RPC methods
   */
  async handleRPCMethod(method, params) {
    switch (method) {
      case "rpc.discover":
        return this.discoverMethods();
      case "rpc.ping":
        return { pong: true };
      case "rpc.describe":
        return this.describeMethod(params);
      default:
        throw new import_errors.MCPMethodNotFoundError(method);
    }
  }
  /**
   * Handles tool-related methods
   */
  async handleToolMethod(method, params) {
    switch (method) {
      case "tools.list":
        return this.toolRegistry.listTools();
      case "tools.invoke":
        return await this.invokeTool(params);
      case "tools.describe":
        return this.describeTool(params);
      default:
        throw new import_errors.MCPMethodNotFoundError(method);
    }
  }
  /**
   * Discovers all available methods
   */
  discoverMethods() {
    const methods = {
      "rpc.discover": "Discover all available methods",
      "rpc.ping": "Ping the server",
      "rpc.describe": "Describe a specific method",
      "tools.list": "List all available tools",
      "tools.invoke": "Invoke a specific tool",
      "tools.describe": "Describe a specific tool"
    };
    for (const tool of this.toolRegistry.listTools()) {
      methods[tool.name] = tool.description;
    }
    return methods;
  }
  /**
   * Describes a specific method
   */
  describeMethod(params) {
    if (!params || typeof params !== "object" || !("method" in params)) {
      throw new Error("Invalid params: method required");
    }
    const { method } = params;
    const tool = this.toolRegistry.getTool(method);
    if (tool) {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      };
    }
    const builtInMethods = {
      "rpc.discover": {
        description: "Discover all available methods",
        inputSchema: { type: "object", properties: {} }
      },
      "rpc.ping": {
        description: "Ping the server",
        inputSchema: { type: "object", properties: {} }
      },
      "rpc.describe": {
        description: "Describe a specific method",
        inputSchema: {
          type: "object",
          properties: {
            method: { type: "string" }
          },
          required: ["method"]
        }
      },
      "tools.list": {
        description: "List all available tools",
        inputSchema: { type: "object", properties: {} }
      },
      "tools.invoke": {
        description: "Invoke a specific tool",
        inputSchema: {
          type: "object",
          properties: {
            tool: { type: "string" },
            input: { type: "object" }
          },
          required: ["tool", "input"]
        }
      },
      "tools.describe": {
        description: "Describe a specific tool",
        inputSchema: {
          type: "object",
          properties: {
            tool: { type: "string" }
          },
          required: ["tool"]
        }
      }
    };
    if (method in builtInMethods) {
      return builtInMethods[method];
    }
    throw new import_errors.MCPMethodNotFoundError(method);
  }
  /**
   * Invokes a tool
   */
  async invokeTool(params) {
    if (!params || typeof params !== "object" || !("tool" in params)) {
      throw new Error("Invalid params: tool required");
    }
    const { tool, input } = params;
    return await this.toolRegistry.executeTool(tool, input || {});
  }
  /**
   * Describes a specific tool
   */
  describeTool(params) {
    if (!params || typeof params !== "object" || !("tool" in params)) {
      throw new Error("Invalid params: tool required");
    }
    const { tool: toolName } = params;
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RequestRouter
});
//# sourceMappingURL=router.js.map
