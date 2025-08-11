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
var mcp_exports = {};
__export(mcp_exports, {
  AuthManager: () => import_auth.AuthManager,
  DefaultMCPConfigs: () => DefaultMCPConfigs,
  HttpTransport: () => import_http.HttpTransport,
  LifecycleState: () => import_lifecycle_manager.LifecycleState,
  LoadBalancer: () => import_load_balancer.LoadBalancer,
  MCPIntegrationFactory: () => MCPIntegrationFactory,
  MCPLifecycleManager: () => import_lifecycle_manager.MCPLifecycleManager,
  MCPOrchestrationIntegration: () => import_orchestration_integration.MCPOrchestrationIntegration,
  MCPPerformanceMonitor: () => import_performance_monitor.MCPPerformanceMonitor,
  MCPProtocolManager: () => import_protocol_manager.MCPProtocolManager,
  MCPServer: () => import_server.MCPServer,
  MCPUtils: () => MCPUtils,
  Permissions: () => import_auth.Permissions,
  RequestQueue: () => import_load_balancer.RequestQueue,
  RequestRouter: () => import_router.RequestRouter,
  SessionManager: () => import_session_manager.SessionManager,
  StdioTransport: () => import_stdio.StdioTransport,
  ToolRegistry: () => import_tools.ToolRegistry,
  createClaudeFlowTools: () => import_claude_flow_tools.createClaudeFlowTools,
  createSwarmTools: () => import_swarm_tools.createSwarmTools
});
module.exports = __toCommonJS(mcp_exports);
var import_server = require("./server.js");
var import_lifecycle_manager = require("./lifecycle-manager.js");
var import_tools = require("./tools.js");
var import_protocol_manager = require("./protocol-manager.js");
var import_auth = require("./auth.js");
var import_performance_monitor = require("./performance-monitor.js");
var import_orchestration_integration = require("./orchestration-integration.js");
var import_stdio = require("./transports/stdio.js");
var import_http = require("./transports/http.js");
var import_router = require("./router.js");
var import_session_manager = require("./session-manager.js");
var import_load_balancer = require("./load-balancer.js");
var import_claude_flow_tools = require("./claude-flow-tools.js");
var import_swarm_tools = require("./swarm-tools.js");
class MCPIntegrationFactory {
  static {
    __name(this, "MCPIntegrationFactory");
  }
  /**
   * Create a complete MCP integration with all components
   */
  static async createIntegration(config) {
    const { mcpConfig, orchestrationConfig = {}, components = {}, logger } = config;
    const integration = new MCPOrchestrationIntegration(
      mcpConfig,
      {
        enabledIntegrations: {
          orchestrator: true,
          swarm: true,
          agents: true,
          resources: true,
          memory: true,
          monitoring: true,
          terminals: true
        },
        autoStart: true,
        healthCheckInterval: 3e4,
        reconnectAttempts: 3,
        reconnectDelay: 5e3,
        enableMetrics: true,
        enableAlerts: true,
        ...orchestrationConfig
      },
      components,
      logger
    );
    return integration;
  }
  /**
   * Create a standalone MCP server (without orchestration integration)
   */
  static async createStandaloneServer(config) {
    const {
      mcpConfig,
      logger,
      enableLifecycleManagement = true,
      enablePerformanceMonitoring = true
    } = config;
    const eventBus = new (await import("node:events")).EventEmitter();
    const server = new MCPServer(mcpConfig, eventBus, logger);
    let lifecycleManager;
    let performanceMonitor;
    if (enableLifecycleManagement) {
      lifecycleManager = new MCPLifecycleManager(mcpConfig, logger, () => server);
    }
    if (enablePerformanceMonitoring) {
      performanceMonitor = new MCPPerformanceMonitor(logger);
    }
    return {
      server,
      lifecycleManager,
      performanceMonitor
    };
  }
  /**
   * Create a development/testing MCP setup
   */
  static async createDevelopmentSetup(logger) {
    const mcpConfig = {
      transport: "stdio",
      enableMetrics: true,
      auth: {
        enabled: false,
        method: "token"
      }
    };
    const { server, lifecycleManager, performanceMonitor } = await this.createStandaloneServer({
      mcpConfig,
      logger,
      enableLifecycleManagement: true,
      enablePerformanceMonitoring: true
    });
    const protocolManager = new MCPProtocolManager(logger);
    return {
      server,
      lifecycleManager,
      performanceMonitor,
      protocolManager
    };
  }
}
const DefaultMCPConfigs = {
  /**
   * Development configuration with stdio transport
   */
  development: {
    transport: "stdio",
    enableMetrics: true,
    auth: {
      enabled: false,
      method: "token"
    }
  },
  /**
   * Production configuration with HTTP transport and authentication
   */
  production: {
    transport: "http",
    host: "0.0.0.0",
    port: 3e3,
    tlsEnabled: true,
    enableMetrics: true,
    auth: {
      enabled: true,
      method: "token"
    },
    loadBalancer: {
      enabled: true,
      maxRequestsPerSecond: 100,
      maxConcurrentRequests: 50
    },
    sessionTimeout: 36e5,
    // 1 hour
    maxSessions: 1e3
  },
  /**
   * Testing configuration with minimal features
   */
  testing: {
    transport: "stdio",
    enableMetrics: false,
    auth: {
      enabled: false,
      method: "token"
    }
  }
};
const MCPUtils = {
  /**
   * Validate MCP protocol version
   */
  isValidProtocolVersion(version) {
    return typeof version.major === "number" && typeof version.minor === "number" && typeof version.patch === "number" && version.major > 0;
  },
  /**
   * Compare two protocol versions
   */
  compareVersions(a, b) {
    if (a.major !== b.major)
      return a.major - b.major;
    if (a.minor !== b.minor)
      return a.minor - b.minor;
    return a.patch - b.patch;
  },
  /**
   * Format protocol version as string
   */
  formatVersion(version) {
    return `${version.major}.${version.minor}.${version.patch}`;
  },
  /**
   * Parse protocol version from string
   */
  parseVersion(versionString) {
    const parts = versionString.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 3 || parts.some((p) => isNaN(p))) {
      throw new Error(`Invalid version string: ${versionString}`);
    }
    return {
      major: parts[0],
      minor: parts[1],
      patch: parts[2]
    };
  },
  /**
   * Generate a random session ID
   */
  generateSessionId() {
    return `mcp_session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  },
  /**
   * Generate a random request ID
   */
  generateRequestId() {
    return `mcp_req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthManager,
  DefaultMCPConfigs,
  HttpTransport,
  LifecycleState,
  LoadBalancer,
  MCPIntegrationFactory,
  MCPLifecycleManager,
  MCPOrchestrationIntegration,
  MCPPerformanceMonitor,
  MCPProtocolManager,
  MCPServer,
  MCPUtils,
  Permissions,
  RequestQueue,
  RequestRouter,
  SessionManager,
  StdioTransport,
  ToolRegistry,
  createClaudeFlowTools,
  createSwarmTools
});
//# sourceMappingURL=index.js.map
