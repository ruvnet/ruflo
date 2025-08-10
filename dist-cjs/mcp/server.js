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
var server_exports = {};
__export(server_exports, {
  MCPServer: () => MCPServer
});
module.exports = __toCommonJS(server_exports);
var import_errors = require("../utils/errors.js");
var import_stdio = require("./transports/stdio.js");
var import_http = require("./transports/http.js");
var import_tools = require("./tools.js");
var import_router = require("./router.js");
var import_session_manager = require("./session-manager.js");
var import_auth = require("./auth.js");
var import_load_balancer = require("./load-balancer.js");
var import_claude_flow_tools = require("./claude-flow-tools.js");
var import_swarm_tools = require("./swarm-tools.js");
var import_ruv_swarm_tools = require("./ruv-swarm-tools.js");
var import_node_os = require("node:os");
var import_node_perf_hooks = require("node:perf_hooks");
class MCPServer {
  constructor(config, eventBus, logger, orchestrator, swarmCoordinator, agentManager, resourceManager, messagebus, monitor) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
    this.orchestrator = orchestrator;
    this.swarmCoordinator = swarmCoordinator;
    this.agentManager = agentManager;
    this.resourceManager = resourceManager;
    this.messagebus = messagebus;
    this.monitor = monitor;
    this.transport = this.createTransport();
    this.toolRegistry = new import_tools.ToolRegistry(logger);
    this.sessionManager = new import_session_manager.SessionManager(config, logger);
    this.authManager = new import_auth.AuthManager(config.auth || { enabled: false, method: "token" }, logger);
    if (config.loadBalancer?.enabled) {
      this.loadBalancer = new import_load_balancer.LoadBalancer(config.loadBalancer, logger);
      this.requestQueue = new import_load_balancer.RequestQueue(1e3, 3e4, logger);
    }
    this.router = new import_router.RequestRouter(this.toolRegistry, logger);
  }
  static {
    __name(this, "MCPServer");
  }
  transport;
  toolRegistry;
  router;
  sessionManager;
  authManager;
  loadBalancer;
  requestQueue;
  running = false;
  currentSession;
  serverInfo = {
    name: "Claude-Flow MCP Server",
    version: "1.0.0"
  };
  supportedProtocolVersion = {
    major: 2024,
    minor: 11,
    patch: 5
  };
  serverCapabilities = {
    logging: {
      level: "info"
    },
    tools: {
      listChanged: true
    },
    resources: {
      listChanged: false,
      subscribe: false
    },
    prompts: {
      listChanged: false
    }
  };
  async start() {
    if (this.running) {
      throw new import_errors.MCPError("MCP server already running");
    }
    this.logger.info("Starting MCP server", { transport: this.config.transport });
    try {
      this.transport.onRequest(async (request) => {
        return await this.handleRequest(request);
      });
      await this.transport.start();
      this.registerBuiltInTools();
      this.running = true;
      this.logger.info("MCP server started successfully");
    } catch (error) {
      this.logger.error("Failed to start MCP server", error);
      throw new import_errors.MCPError("Failed to start MCP server", { error });
    }
  }
  async stop() {
    if (!this.running) {
      return;
    }
    this.logger.info("Stopping MCP server");
    try {
      await this.transport.stop();
      if (this.sessionManager && "destroy" in this.sessionManager) {
        this.sessionManager.destroy();
      }
      for (const session of this.sessionManager.getActiveSessions()) {
        this.sessionManager.removeSession(session.id);
      }
      this.running = false;
      this.currentSession = void 0;
      this.logger.info("MCP server stopped");
    } catch (error) {
      this.logger.error("Error stopping MCP server", error);
      throw error;
    }
  }
  registerTool(tool) {
    this.toolRegistry.register(tool);
    this.logger.info("Tool registered", { name: tool.name });
  }
  async getHealthStatus() {
    try {
      const transportHealth = await this.transport.getHealthStatus();
      const registeredTools = this.toolRegistry.getToolCount();
      const { totalRequests, successfulRequests, failedRequests } = this.router.getMetrics();
      const sessionMetrics = this.sessionManager.getSessionMetrics();
      const metrics = {
        registeredTools,
        totalRequests,
        successfulRequests,
        failedRequests,
        totalSessions: sessionMetrics.total,
        activeSessions: sessionMetrics.active,
        authenticatedSessions: sessionMetrics.authenticated,
        expiredSessions: sessionMetrics.expired,
        ...transportHealth.metrics
      };
      if (this.loadBalancer) {
        const lbMetrics = this.loadBalancer.getMetrics();
        metrics.rateLimitedRequests = lbMetrics.rateLimitedRequests;
        metrics.averageResponseTime = lbMetrics.averageResponseTime;
        metrics.requestsPerSecond = lbMetrics.requestsPerSecond;
        metrics.circuitBreakerTrips = lbMetrics.circuitBreakerTrips;
      }
      const status = {
        healthy: this.running && transportHealth.healthy,
        metrics
      };
      if (transportHealth.error !== void 0) {
        status.error = transportHealth.error;
      }
      return status;
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  getMetrics() {
    const routerMetrics = this.router.getMetrics();
    const sessionMetrics = this.sessionManager.getSessionMetrics();
    const lbMetrics = this.loadBalancer?.getMetrics();
    return {
      totalRequests: routerMetrics.totalRequests,
      successfulRequests: routerMetrics.successfulRequests,
      failedRequests: routerMetrics.failedRequests,
      averageResponseTime: lbMetrics?.averageResponseTime || 0,
      activeSessions: sessionMetrics.active,
      toolInvocations: {},
      // TODO: Implement tool-specific metrics
      errors: {},
      // TODO: Implement error categorization
      lastReset: lbMetrics?.lastReset || /* @__PURE__ */ new Date()
    };
  }
  getSessions() {
    return this.sessionManager.getActiveSessions();
  }
  getSession(sessionId) {
    return this.sessionManager.getSession(sessionId);
  }
  terminateSession(sessionId) {
    this.sessionManager.removeSession(sessionId);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = void 0;
    }
  }
  async handleRequest(request) {
    this.logger.debug("Handling MCP request", {
      id: request.id,
      method: request.method
    });
    try {
      if (request.method === "initialize") {
        return await this.handleInitialize(request);
      }
      const session = this.getOrCreateSession();
      if (!session.isInitialized) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32002,
            message: "Server not initialized"
          }
        };
      }
      this.sessionManager.updateActivity(session.id);
      if (this.loadBalancer) {
        const allowed = await this.loadBalancer.shouldAllowRequest(session, request);
        if (!allowed) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32e3,
              message: "Rate limit exceeded or circuit breaker open"
            }
          };
        }
      }
      const requestMetrics = this.loadBalancer?.recordRequestStart(session, request);
      try {
        const result = await this.router.route(request);
        const response = {
          jsonrpc: "2.0",
          id: request.id,
          result
        };
        if (requestMetrics) {
          this.loadBalancer?.recordRequestEnd(requestMetrics, response);
        }
        return response;
      } catch (error) {
        if (requestMetrics) {
          this.loadBalancer?.recordRequestEnd(requestMetrics, void 0, error);
        }
        throw error;
      }
    } catch (error) {
      this.logger.error("Error handling MCP request", {
        id: request.id,
        method: request.method,
        error
      });
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: this.errorToMCPError(error)
      };
    }
  }
  async handleInitialize(request) {
    try {
      const params = request.params;
      if (!params) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32602,
            message: "Invalid params"
          }
        };
      }
      const session = this.sessionManager.createSession(this.config.transport);
      this.currentSession = session;
      this.sessionManager.initializeSession(session.id, params);
      const result = {
        protocolVersion: this.supportedProtocolVersion,
        capabilities: this.serverCapabilities,
        serverInfo: this.serverInfo,
        instructions: "Claude-Flow MCP Server ready for tool execution"
      };
      this.logger.info("Session initialized", {
        sessionId: session.id,
        clientInfo: params.clientInfo,
        protocolVersion: params.protocolVersion
      });
      return {
        jsonrpc: "2.0",
        id: request.id,
        result
      };
    } catch (error) {
      this.logger.error("Error during initialization", error);
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: this.errorToMCPError(error)
      };
    }
  }
  getOrCreateSession() {
    if (this.currentSession) {
      return this.currentSession;
    }
    const session = this.sessionManager.createSession(this.config.transport);
    this.currentSession = session;
    return session;
  }
  createTransport() {
    switch (this.config.transport) {
      case "stdio":
        return new import_stdio.StdioTransport(this.logger);
      case "http":
        return new import_http.HttpTransport(
          this.config.host || "localhost",
          this.config.port || 3e3,
          this.config.tlsEnabled || false,
          this.logger
        );
      default:
        throw new import_errors.MCPError(`Unknown transport type: ${this.config.transport}`);
    }
  }
  registerBuiltInTools() {
    this.registerTool({
      name: "system/info",
      description: "Get system information",
      inputSchema: {
        type: "object",
        properties: {}
      },
      handler: async () => {
        return {
          version: "1.0.0",
          platform: (0, import_node_os.platform)(),
          arch: (0, import_node_os.arch)(),
          runtime: "Node.js",
          uptime: import_node_perf_hooks.performance.now()
        };
      }
    });
    this.registerTool({
      name: "system/health",
      description: "Get system health status",
      inputSchema: {
        type: "object",
        properties: {}
      },
      handler: async () => {
        return await this.getHealthStatus();
      }
    });
    this.registerTool({
      name: "tools/list",
      description: "List all available tools",
      inputSchema: {
        type: "object",
        properties: {}
      },
      handler: async () => {
        return this.toolRegistry.listTools();
      }
    });
    this.registerTool({
      name: "tools/schema",
      description: "Get schema for a specific tool",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" }
        },
        required: ["name"]
      },
      handler: async (input) => {
        const tool = this.toolRegistry.getTool(input.name);
        if (!tool) {
          throw new Error(`Tool not found: ${input.name}`);
        }
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        };
      }
    });
    if (this.orchestrator) {
      const claudeFlowTools = (0, import_claude_flow_tools.createClaudeFlowTools)(this.logger);
      for (const tool of claudeFlowTools) {
        const originalHandler = tool.handler;
        tool.handler = async (input, context) => {
          const claudeFlowContext = {
            ...context,
            orchestrator: this.orchestrator
          };
          return await originalHandler(input, claudeFlowContext);
        };
        this.registerTool(tool);
      }
      this.logger.info("Registered Claude-Flow tools", { count: claudeFlowTools.length });
    } else {
      this.logger.warn("Orchestrator not available - Claude-Flow tools not registered");
    }
    if (this.swarmCoordinator || this.agentManager || this.resourceManager) {
      const swarmTools = (0, import_swarm_tools.createSwarmTools)(this.logger);
      for (const tool of swarmTools) {
        const originalHandler = tool.handler;
        tool.handler = async (input, context) => {
          const swarmContext = {
            ...context,
            swarmCoordinator: this.swarmCoordinator,
            agentManager: this.agentManager,
            resourceManager: this.resourceManager,
            messageBus: this.messagebus,
            monitor: this.monitor
          };
          return await originalHandler(input, swarmContext);
        };
        this.registerTool(tool);
      }
      this.logger.info("Registered Swarm tools", { count: swarmTools.length });
    } else {
      this.logger.warn("Swarm components not available - Swarm tools not registered");
    }
    this.registerRuvSwarmTools();
  }
  /**
   * Register ruv-swarm MCP tools if available
   */
  async registerRuvSwarmTools() {
    try {
      const available = await (0, import_ruv_swarm_tools.isRuvSwarmAvailable)(this.logger);
      if (!available) {
        this.logger.info("ruv-swarm not available - skipping ruv-swarm MCP tools registration");
        return;
      }
      const workingDirectory = process.cwd();
      const integration = await (0, import_ruv_swarm_tools.initializeRuvSwarmIntegration)(workingDirectory, this.logger);
      if (!integration.success) {
        this.logger.warn("Failed to initialize ruv-swarm integration", {
          error: integration.error
        });
        return;
      }
      const ruvSwarmTools = (0, import_ruv_swarm_tools.createRuvSwarmTools)(this.logger);
      for (const tool of ruvSwarmTools) {
        const originalHandler = tool.handler;
        tool.handler = async (input, context) => {
          const ruvSwarmContext = {
            ...context,
            workingDirectory,
            sessionId: `mcp-session-${Date.now()}`,
            swarmId: process.env.CLAUDE_SWARM_ID || `mcp-swarm-${Date.now()}`
          };
          return await originalHandler(input, ruvSwarmContext);
        };
        this.registerTool(tool);
      }
      this.logger.info("Registered ruv-swarm MCP tools", {
        count: ruvSwarmTools.length,
        integration: integration.data
      });
    } catch (error) {
      this.logger.error("Error registering ruv-swarm MCP tools", error);
    }
  }
  errorToMCPError(error) {
    if (error instanceof import_errors.MCPMethodNotFoundError) {
      return {
        code: -32601,
        message: error instanceof Error ? error.message : String(error),
        data: error.details
      };
    }
    if (error instanceof import_errors.MCPError) {
      return {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
        data: error.details
      };
    }
    if (error instanceof Error) {
      return {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      code: -32603,
      message: "Internal error",
      data: error
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MCPServer
});
//# sourceMappingURL=server.js.map
