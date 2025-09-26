export { MCPServer } from './server.js';
export { MCPLifecycleManager, LifecycleState } from './lifecycle-manager.js';
export { ToolRegistry } from './tools.js';
export { MCPProtocolManager } from './protocol-manager.js';
export { AuthManager, Permissions } from './auth.js';
export { MCPPerformanceMonitor } from './performance-monitor.js';
export { MCPOrchestrationIntegration } from './orchestration-integration.js';
export { StdioTransport } from './transports/stdio.js';
export { HttpTransport } from './transports/http.js';
export { RequestRouter } from './router.js';
export { SessionManager } from './session-manager.js';
export { LoadBalancer, RequestQueue } from './load-balancer.js';
export { createClaudeFlowTools } from './claude-flow-tools.js';
export { createSwarmTools } from './swarm-tools.js';
export class MCPIntegrationFactory {
    static async createIntegration(config) {
        const { mcpConfig, orchestrationConfig = {}, components = {}, logger } = config;
        const integration = new MCPOrchestrationIntegration(mcpConfig, {
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
            healthCheckInterval: 30000,
            reconnectAttempts: 3,
            reconnectDelay: 5000,
            enableMetrics: true,
            enableAlerts: true,
            ...orchestrationConfig
        }, components, logger);
        return integration;
    }
    static async createStandaloneServer(config) {
        const { mcpConfig, logger, enableLifecycleManagement = true, enablePerformanceMonitoring = true } = config;
        const eventBus = new (await import('node:events')).EventEmitter();
        const server = new MCPServer(mcpConfig, eventBus, logger);
        let lifecycleManager;
        let performanceMonitor;
        if (enableLifecycleManagement) {
            lifecycleManager = new MCPLifecycleManager(mcpConfig, logger, ()=>server);
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
    static async createDevelopmentSetup(logger) {
        const mcpConfig = {
            transport: 'stdio',
            enableMetrics: true,
            auth: {
                enabled: false,
                method: 'token'
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
            lifecycleManager: lifecycleManager,
            performanceMonitor: performanceMonitor,
            protocolManager
        };
    }
}
export const DefaultMCPConfigs = {
    development: {
        transport: 'stdio',
        enableMetrics: true,
        auth: {
            enabled: false,
            method: 'token'
        }
    },
    production: {
        transport: 'http',
        host: '0.0.0.0',
        port: 3000,
        tlsEnabled: true,
        enableMetrics: true,
        auth: {
            enabled: true,
            method: 'token'
        },
        loadBalancer: {
            enabled: true,
            maxRequestsPerSecond: 100,
            maxConcurrentRequests: 50
        },
        sessionTimeout: 3600000,
        maxSessions: 1000
    },
    testing: {
        transport: 'stdio',
        enableMetrics: false,
        auth: {
            enabled: false,
            method: 'token'
        }
    }
};
export const MCPUtils = {
    isValidProtocolVersion (version) {
        return typeof version.major === 'number' && typeof version.minor === 'number' && typeof version.patch === 'number' && version.major > 0;
    },
    compareVersions (a, b) {
        if (a.major !== b.major) return a.major - b.major;
        if (a.minor !== b.minor) return a.minor - b.minor;
        return a.patch - b.patch;
    },
    formatVersion (version) {
        return `${version.major}.${version.minor}.${version.patch}`;
    },
    parseVersion (versionString) {
        const parts = versionString.split('.').map((p)=>parseInt(p, 10));
        if (parts.length !== 3 || parts.some((p)=>isNaN(p))) {
            throw new Error(`Invalid version string: ${versionString}`);
        }
        return {
            major: parts[0],
            minor: parts[1],
            patch: parts[2]
        };
    },
    generateSessionId () {
        return `mcp_session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    },
    generateRequestId () {
        return `mcp_req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }
};

//# sourceMappingURL=index.js.map