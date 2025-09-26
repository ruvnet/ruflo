import { MCPError as MCPErrorClass, MCPMethodNotFoundError } from '../utils/errors.js';
import { StdioTransport } from './transports/stdio.js';
import { HttpTransport } from './transports/http.js';
import { ToolRegistry } from './tools.js';
import { RequestRouter } from './router.js';
import { SessionManager } from './session-manager.js';
import { AuthManager } from './auth.js';
import { LoadBalancer, RequestQueue } from './load-balancer.js';
import { createClaudeFlowTools } from './claude-flow-tools.js';
import { createSwarmTools } from './swarm-tools.js';
import { createRuvSwarmTools, isRuvSwarmAvailable, initializeRuvSwarmIntegration } from './ruv-swarm-tools.js';
import { platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
export class MCPServer {
    config;
    eventBus;
    logger;
    orchestrator;
    swarmCoordinator;
    agentManager;
    resourceManager;
    messagebus;
    monitor;
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
        name: 'Claude-Flow MCP Server',
        version: '1.0.0'
    };
    supportedProtocolVersion = {
        major: 2024,
        minor: 11,
        patch: 5
    };
    serverCapabilities = {
        logging: {
            level: 'info'
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
    constructor(config, eventBus, logger, orchestrator, swarmCoordinator, agentManager, resourceManager, messagebus, monitor){
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
        this.toolRegistry = new ToolRegistry(logger);
        this.sessionManager = new SessionManager(config, logger);
        this.authManager = new AuthManager(config.auth || {
            enabled: false,
            method: 'token'
        }, logger);
        if (config.loadBalancer?.enabled) {
            this.loadBalancer = new LoadBalancer(config.loadBalancer, logger);
            this.requestQueue = new RequestQueue(1000, 30000, logger);
        }
        this.router = new RequestRouter(this.toolRegistry, logger);
    }
    async start() {
        if (this.running) {
            throw new MCPErrorClass('MCP server already running');
        }
        this.logger.info('Starting MCP server', {
            transport: this.config.transport
        });
        try {
            this.transport.onRequest(async (request)=>{
                return await this.handleRequest(request);
            });
            await this.transport.start();
            this.registerBuiltInTools();
            this.running = true;
            this.logger.info('MCP server started successfully');
        } catch (error) {
            this.logger.error('Failed to start MCP server', error);
            throw new MCPErrorClass('Failed to start MCP server', {
                error
            });
        }
    }
    async stop() {
        if (!this.running) {
            return;
        }
        this.logger.info('Stopping MCP server');
        try {
            await this.transport.stop();
            if (this.sessionManager && 'destroy' in this.sessionManager) {
                this.sessionManager.destroy();
            }
            for (const session of this.sessionManager.getActiveSessions()){
                this.sessionManager.removeSession(session.id);
            }
            this.running = false;
            this.currentSession = undefined;
            this.logger.info('MCP server stopped');
        } catch (error) {
            this.logger.error('Error stopping MCP server', error);
            throw error;
        }
    }
    registerTool(tool) {
        this.toolRegistry.register(tool);
        this.logger.info('Tool registered', {
            name: tool.name
        });
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
            if (transportHealth.error !== undefined) {
                status.error = transportHealth.error;
            }
            return status;
        } catch (error) {
            return {
                healthy: false,
                error: error instanceof Error ? error.message : 'Unknown error'
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
            errors: {},
            lastReset: lbMetrics?.lastReset || new Date()
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
            this.currentSession = undefined;
        }
    }
    async handleRequest(request) {
        this.logger.debug('Handling MCP request', {
            id: request.id,
            method: request.method
        });
        try {
            if (request.method === 'initialize') {
                return await this.handleInitialize(request);
            }
            const session = this.getOrCreateSession();
            if (!session.isInitialized) {
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32002,
                        message: 'Server not initialized'
                    }
                };
            }
            this.sessionManager.updateActivity(session.id);
            if (this.loadBalancer) {
                const allowed = await this.loadBalancer.shouldAllowRequest(session, request);
                if (!allowed) {
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32000,
                            message: 'Rate limit exceeded or circuit breaker open'
                        }
                    };
                }
            }
            const requestMetrics = this.loadBalancer?.recordRequestStart(session, request);
            try {
                const result = await this.router.route(request);
                const response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result
                };
                if (requestMetrics) {
                    this.loadBalancer?.recordRequestEnd(requestMetrics, response);
                }
                return response;
            } catch (error) {
                if (requestMetrics) {
                    this.loadBalancer?.recordRequestEnd(requestMetrics, undefined, error);
                }
                throw error;
            }
        } catch (error) {
            this.logger.error('Error handling MCP request', {
                id: request.id,
                method: request.method,
                error
            });
            return {
                jsonrpc: '2.0',
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
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32602,
                        message: 'Invalid params'
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
                instructions: 'Claude-Flow MCP Server ready for tool execution'
            };
            this.logger.info('Session initialized', {
                sessionId: session.id,
                clientInfo: params.clientInfo,
                protocolVersion: params.protocolVersion
            });
            return {
                jsonrpc: '2.0',
                id: request.id,
                result
            };
        } catch (error) {
            this.logger.error('Error during initialization', error);
            return {
                jsonrpc: '2.0',
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
        switch(this.config.transport){
            case 'stdio':
                return new StdioTransport(this.logger);
            case 'http':
                return new HttpTransport(this.config.host || 'localhost', this.config.port || 3000, this.config.tlsEnabled || false, this.logger);
            default:
                throw new MCPErrorClass(`Unknown transport type: ${this.config.transport}`);
        }
    }
    registerBuiltInTools() {
        this.registerTool({
            name: 'system/info',
            description: 'Get system information',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async ()=>{
                return {
                    version: '1.0.0',
                    platform: platform(),
                    arch: arch(),
                    runtime: 'Node.js',
                    uptime: performance.now()
                };
            }
        });
        this.registerTool({
            name: 'system/health',
            description: 'Get system health status',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async ()=>{
                return await this.getHealthStatus();
            }
        });
        this.registerTool({
            name: 'tools/list',
            description: 'List all available tools',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async ()=>{
                return this.toolRegistry.listTools();
            }
        });
        this.registerTool({
            name: 'tools/schema',
            description: 'Get schema for a specific tool',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string'
                    }
                },
                required: [
                    'name'
                ]
            },
            handler: async (input)=>{
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
            const claudeFlowTools = createClaudeFlowTools(this.logger);
            for (const tool of claudeFlowTools){
                const originalHandler = tool.handler;
                tool.handler = async (input, context)=>{
                    const claudeFlowContext = {
                        ...context,
                        orchestrator: this.orchestrator
                    };
                    return await originalHandler(input, claudeFlowContext);
                };
                this.registerTool(tool);
            }
            this.logger.info('Registered Claude-Flow tools', {
                count: claudeFlowTools.length
            });
        } else {
            this.logger.warn('Orchestrator not available - Claude-Flow tools not registered');
        }
        if (this.swarmCoordinator || this.agentManager || this.resourceManager) {
            const swarmTools = createSwarmTools(this.logger);
            for (const tool of swarmTools){
                const originalHandler = tool.handler;
                tool.handler = async (input, context)=>{
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
            this.logger.info('Registered Swarm tools', {
                count: swarmTools.length
            });
        } else {
            this.logger.warn('Swarm components not available - Swarm tools not registered');
        }
        this.registerRuvSwarmTools();
    }
    async registerRuvSwarmTools() {
        try {
            const available = await isRuvSwarmAvailable(this.logger);
            if (!available) {
                this.logger.info('ruv-swarm not available - skipping ruv-swarm MCP tools registration');
                return;
            }
            const workingDirectory = process.cwd();
            const integration = await initializeRuvSwarmIntegration(workingDirectory, this.logger);
            if (!integration.success) {
                this.logger.warn('Failed to initialize ruv-swarm integration', {
                    error: integration.error
                });
                return;
            }
            const ruvSwarmTools = createRuvSwarmTools(this.logger);
            for (const tool of ruvSwarmTools){
                const originalHandler = tool.handler;
                tool.handler = async (input, context)=>{
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
            this.logger.info('Registered ruv-swarm MCP tools', {
                count: ruvSwarmTools.length,
                integration: integration.data
            });
        } catch (error) {
            this.logger.error('Error registering ruv-swarm MCP tools', error);
        }
    }
    errorToMCPError(error) {
        if (error instanceof MCPMethodNotFoundError) {
            return {
                code: -32601,
                message: error instanceof Error ? error.message : String(error),
                data: error.details
            };
        }
        if (error instanceof MCPErrorClass) {
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
            message: 'Internal error',
            data: error
        };
    }
}

//# sourceMappingURL=server.js.map