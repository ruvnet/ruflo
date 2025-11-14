import { VersionNegotiator, BackwardCompatibilityAdapter } from './protocol/version-negotiation.js';
import { MCPAsyncJobManager } from './async/job-manager-mcp25.js';
import { MCPRegistryClient } from './registry/mcp-registry-client-2025.js';
import { SchemaValidator, upgradeToolSchema } from './validation/schema-validator-2025.js';
import { ProgressiveToolRegistry } from './tool-registry-progressive.js';
export class MCP2025Server {
    config;
    eventBus;
    logger;
    versionNegotiator;
    compatibilityAdapter;
    jobManager;
    registryClient;
    schemaValidator;
    toolRegistry;
    sessions = new Map();
    MAX_SESSIONS = 10000;
    SESSION_TTL = 3600000;
    sessionCleanupInterval;
    constructor(config, eventBus, logger){
        this.config = config;
        this.eventBus = eventBus;
        this.logger = logger;
        this.versionNegotiator = new VersionNegotiator(logger);
        this.compatibilityAdapter = new BackwardCompatibilityAdapter(logger);
        this.schemaValidator = new SchemaValidator(logger);
        this.toolRegistry = new ProgressiveToolRegistry({
            enableInProcess: true,
            enableMetrics: true,
            enableCaching: true,
            orchestratorContext: config.orchestratorContext,
            toolsDirectory: config.toolsDirectory
        });
        this.logger.info('MCP 2025-11 server created', {
            serverId: config.serverId,
            mcp2025Enabled: config.enableMCP2025,
            legacySupport: config.supportLegacyClients
        });
    }
    async initialize() {
        this.logger.info('Initializing MCP 2025-11 server');
        await this.toolRegistry.initialize();
        this.sessionCleanupInterval = setInterval(()=>this.cleanupExpiredSessions(), 300000);
        if (this.config.async.enabled) {
            this.jobManager = new MCPAsyncJobManager(null, this.logger, {
                maxJobs: this.config.async.maxJobs,
                jobTTL: this.config.async.jobTTL
            });
            this.logger.info('Async job manager initialized');
        }
        if (this.config.registry.enabled) {
            this.registryClient = new MCPRegistryClient(this.config.registry, this.logger, ()=>this.toolRegistry.getToolNames(), ()=>this.versionNegotiator.getServerCapabilities(), async ()=>this.getHealthStatus());
            try {
                await this.registryClient.register();
            } catch (error) {
                this.logger.error('Failed to register with MCP Registry', {
                    error
                });
            }
        }
        this.logger.info('MCP 2025-11 server initialized successfully');
    }
    async handleHandshake(clientHandshake, sessionId) {
        const isLegacy = this.compatibilityAdapter.isLegacyRequest(clientHandshake);
        let handshake;
        if (isLegacy && this.config.supportLegacyClients) {
            this.logger.info('Legacy client detected, enabling compatibility mode', {
                sessionId
            });
            handshake = this.compatibilityAdapter.convertToModern(clientHandshake);
        } else {
            handshake = clientHandshake;
        }
        const negotiation = await this.versionNegotiator.negotiate(handshake);
        if (!negotiation.success) {
            throw new Error(`Version negotiation failed: ${negotiation.error}`);
        }
        if (this.sessions.size >= this.MAX_SESSIONS) {
            const oldestSession = Array.from(this.sessions.entries()).sort((a, b)=>a[1].createdAt - b[1].createdAt)[0];
            if (oldestSession) {
                this.sessions.delete(oldestSession[0]);
                this.logger.warn('Session limit reached, removed oldest session', {
                    removedSessionId: oldestSession[0]
                });
            }
        }
        const now = Date.now();
        this.sessions.set(sessionId, {
            clientId: handshake.client_id || 'unknown',
            version: negotiation.agreed_version,
            capabilities: negotiation.agreed_capabilities,
            isLegacy,
            createdAt: now,
            lastAccess: now
        });
        const serverHandshake = this.versionNegotiator.createServerHandshake(this.config.serverId, this.config.transport, {
            name: 'Claude Flow',
            version: '2.7.32',
            description: 'Enterprise AI orchestration with MCP 2025-11 support'
        });
        serverHandshake.mcp_version = negotiation.agreed_version;
        serverHandshake.capabilities = negotiation.agreed_capabilities;
        this.logger.info('Handshake completed', {
            sessionId,
            version: serverHandshake.mcp_version,
            capabilities: serverHandshake.capabilities,
            isLegacy
        });
        return serverHandshake;
    }
    async handleToolCall(request, sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastAccess = Date.now();
        }
        if (session?.isLegacy) {
            return this.handleLegacyToolCall(request, sessionId);
        }
        const mcpRequest = request;
        if (!mcpRequest.tool_id) {
            throw new Error('Missing tool_id in request');
        }
        const tool = await this.toolRegistry.getTool(mcpRequest.tool_id);
        if (!tool) {
            throw new Error(`Tool not found: ${mcpRequest.tool_id}`);
        }
        if (this.config.validation.enabled) {
            const validation = this.schemaValidator.validateInput(upgradeToolSchema(tool.inputSchema), mcpRequest.arguments);
            if (!validation.valid) {
                throw new Error(`Invalid input: ${validation.errors?.map((e)=>e.message).join(', ')}`);
            }
        }
        const hasAsyncCapability = session?.capabilities.includes('async');
        const isAsyncRequest = mcpRequest.mode === 'async' && hasAsyncCapability;
        if (isAsyncRequest && this.jobManager) {
            this.logger.info('Submitting async job', {
                tool_id: mcpRequest.tool_id,
                request_id: mcpRequest.request_id
            });
            return await this.jobManager.submitJob(mcpRequest, async (args, onProgress)=>{
                return await tool.handler(args, {
                    orchestrator: this.config.orchestratorContext,
                    sessionId
                });
            });
        } else {
            this.logger.info('Executing tool synchronously', {
                tool_id: mcpRequest.tool_id,
                request_id: mcpRequest.request_id
            });
            const startTime = Date.now();
            const result = await tool.handler(mcpRequest.arguments, {
                orchestrator: this.config.orchestratorContext,
                sessionId
            });
            if (this.config.validation.enabled && tool.metadata?.outputSchema) {
                const validation = this.schemaValidator.validateOutput(tool.metadata.outputSchema, result);
                if (!validation.valid) {
                    this.logger.warn('Output validation failed', {
                        tool_id: mcpRequest.tool_id,
                        errors: validation.errors
                    });
                }
            }
            return {
                request_id: mcpRequest.request_id,
                status: 'success',
                result,
                metadata: {
                    duration_ms: Date.now() - startTime
                }
            };
        }
    }
    async handleLegacyToolCall(request, sessionId) {
        this.logger.info('Handling legacy tool call', {
            toolName: request.name || request.method,
            sessionId
        });
        const toolId = request.name || request.method;
        const args = request.arguments || request.params || {};
        const tool = await this.toolRegistry.getTool(toolId);
        if (!tool) {
            throw new Error(`Tool not found: ${toolId}`);
        }
        const result = await tool.handler(args, {
            orchestrator: this.config.orchestratorContext,
            sessionId
        });
        return this.compatibilityAdapter.convertToLegacy({
            result,
            status: 'success'
        }, true);
    }
    async pollJob(job_id) {
        if (!this.jobManager) {
            throw new Error('Async jobs not enabled');
        }
        return await this.jobManager.pollJob(job_id);
    }
    async resumeJob(job_id) {
        if (!this.jobManager) {
            throw new Error('Async jobs not enabled');
        }
        return await this.jobManager.resumeJob(job_id);
    }
    async cancelJob(job_id) {
        if (!this.jobManager) {
            throw new Error('Async jobs not enabled');
        }
        return await this.jobManager.cancelJob(job_id);
    }
    async listJobs(filter) {
        if (!this.jobManager) {
            throw new Error('Async jobs not enabled');
        }
        return await this.jobManager.listJobs(filter);
    }
    async getHealthStatus() {
        const startTime = Date.now();
        const latency = Date.now() - startTime;
        let status = 'healthy';
        if (latency > 100) {
            status = 'degraded';
        }
        if (latency > 500) {
            status = 'unhealthy';
        }
        return {
            status,
            latency_ms: latency
        };
    }
    getMetrics() {
        return {
            sessions: {
                total: this.sessions.size,
                byVersion: this.getSessionsByVersion(),
                legacy: Array.from(this.sessions.values()).filter((s)=>s.isLegacy).length
            },
            jobs: this.jobManager?.getMetrics(),
            tools: this.toolRegistry.getMetrics(),
            validation: this.schemaValidator.getCacheStats()
        };
    }
    getSessionsByVersion() {
        const counts = {};
        for (const session of this.sessions.values()){
            counts[session.version] = (counts[session.version] || 0) + 1;
        }
        return counts;
    }
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleaned = 0;
        for (const [sessionId, session] of this.sessions.entries()){
            if (now - session.lastAccess > this.SESSION_TTL) {
                this.sessions.delete(sessionId);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.info('Cleaned up expired sessions', {
                count: cleaned
            });
        }
    }
    async cleanup() {
        this.logger.info('Cleaning up MCP 2025-11 server');
        if (this.sessionCleanupInterval) {
            clearInterval(this.sessionCleanupInterval);
        }
        if (this.registryClient) {
            await this.registryClient.unregister();
        }
        this.schemaValidator.clearCache();
        await this.toolRegistry.cleanup();
        this.sessions.clear();
        this.logger.info('Cleanup complete');
    }
}

//# sourceMappingURL=server-mcp-2025.js.map