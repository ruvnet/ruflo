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
var stdio_exports = {};
__export(stdio_exports, {
  StdioTransport: () => StdioTransport
});
module.exports = __toCommonJS(stdio_exports);
var import_node_process = require("node:process");
var import_node_readline = require("node:readline");
var import_errors = require("../../utils/errors.js");
class StdioTransport {
  constructor(logger) {
    this.logger = logger;
  }
  static {
    __name(this, "StdioTransport");
  }
  requestHandler;
  notificationHandler;
  readline;
  messageCount = 0;
  notificationCount = 0;
  running = false;
  async start() {
    if (this.running) {
      throw new import_errors.MCPTransportError("Transport already running");
    }
    this.logger.info("Starting stdio transport");
    try {
      this.readline = (0, import_node_readline.createInterface)({
        input: import_node_process.stdin,
        output: import_node_process.stdout,
        terminal: false
      });
      this.readline.on("line", (line) => {
        this.processMessage(line.trim()).catch((error) => {
          this.logger.error("Error processing message", { line, error });
        });
      });
      this.readline.on("close", () => {
        this.logger.info("Stdin closed");
        this.running = false;
      });
      this.running = true;
      this.logger.info("Stdio transport started");
    } catch (error) {
      throw new import_errors.MCPTransportError("Failed to start stdio transport", { error });
    }
  }
  async stop() {
    if (!this.running) {
      return;
    }
    this.logger.info("Stopping stdio transport");
    this.running = false;
    if (this.readline) {
      this.readline.close();
      this.readline = void 0;
    }
    this.logger.info("Stdio transport stopped");
  }
  onRequest(handler) {
    this.requestHandler = handler;
  }
  onNotification(handler) {
    this.notificationHandler = handler;
  }
  async getHealthStatus() {
    return {
      healthy: this.running,
      metrics: {
        messagesReceived: this.messageCount,
        notificationsSent: this.notificationCount,
        stdinOpen: this.readline ? 1 : 0
      }
    };
  }
  async processMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
      if (!message.jsonrpc || message.jsonrpc !== "2.0") {
        throw new Error("Invalid JSON-RPC version");
      }
      if (!message.method) {
        throw new Error("Missing method");
      }
    } catch (error) {
      this.logger.error("Failed to parse message", { line, error });
      let id = "unknown";
      try {
        const parsed = JSON.parse(line);
        if (parsed.id !== void 0) {
          id = parsed.id;
        }
      } catch {
      }
      await this.sendResponse({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32700,
          message: "Parse error"
        }
      });
      return;
    }
    this.messageCount++;
    if (message.id === void 0) {
      await this.handleNotification(message);
    } else {
      await this.handleRequest(message);
    }
  }
  async handleRequest(request) {
    if (!this.requestHandler) {
      await this.sendResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: "No request handler registered"
        }
      });
      return;
    }
    try {
      const response = await this.requestHandler(request);
      await this.sendResponse(response);
    } catch (error) {
      this.logger.error("Request handler error", { request, error });
      await this.sendResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: "Internal error",
          data: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
  async handleNotification(notification) {
    if (!this.notificationHandler) {
      this.logger.warn("Received notification but no handler registered", {
        method: notification.method
      });
      return;
    }
    try {
      await this.notificationHandler(notification);
    } catch (error) {
      this.logger.error("Notification handler error", { notification, error });
    }
  }
  async sendResponse(response) {
    try {
      const json = JSON.stringify(response);
      import_node_process.stdout.write(json + "\n");
    } catch (error) {
      this.logger.error("Failed to send response", { response, error });
    }
  }
  async connect() {
    if (!this.running) {
      await this.start();
    }
  }
  async disconnect() {
    await this.stop();
  }
  async sendRequest(request) {
    const json = JSON.stringify(request);
    import_node_process.stdout.write(json + "\n");
    throw new Error("STDIO transport sendRequest requires request/response correlation");
  }
  async sendNotification(notification) {
    try {
      const json = JSON.stringify(notification);
      import_node_process.stdout.write(json + "\n");
      this.notificationCount++;
    } catch (error) {
      this.logger.error("Failed to send notification", { notification, error });
      throw error;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StdioTransport
});
//# sourceMappingURL=stdio.js.map
