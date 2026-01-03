import { createInProcessServer } from './in-process-server.js';
import { createClaudeFlowTools } from './claude-flow-tools.js';
import { logger } from '../core/logger.js';
import { createToolFilter } from './tool-filter.js';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-code/sdk';
import { z } from 'zod';
export class ClaudeFlowToolRegistry {
    inProcessServer;
    sdkServer;
    tools;
    config;
    toolFilter;
    constructor(config){
        this.config = config;
        this.tools = new Map();
        if (config.toolFilter?.enabled) {
            this.toolFilter = createToolFilter(config.toolFilter, logger);
        }
        logger.info('ClaudeFlowToolRegistry initialized', {
            enableInProcess: config.enableInProcess,
            enableMetrics: config.enableMetrics,
            toolFilterEnabled: config.toolFilter?.enabled ?? false
        });
    }
    setToolFilter(config) {
        this.toolFilter = createToolFilter(config, logger);
        logger.info('Tool filter updated', {
            mode: config.mode,
            enabled: config.enabled
        });
    }
    async initialize() {
        logger.info('Loading Claude-Flow tools...');
        const claudeFlowTools = await createClaudeFlowTools(logger);
        for (const tool of claudeFlowTools){
            this.tools.set(tool.name, tool);
        }
        logger.info(`Loaded ${this.tools.size} Claude-Flow tools`);
        if (this.config.enableInProcess) {
            await this.createInProcessServer();
        }
    }
    async createInProcessServer() {
        logger.info('Creating in-process MCP server...');
        this.inProcessServer = createInProcessServer({
            name: 'claude-flow',
            version: '2.0.0',
            enableMetrics: this.config.enableMetrics,
            enableCaching: this.config.enableCaching
        });
        for (const [name, tool] of this.tools){
            this.inProcessServer.registerTool(tool);
        }
        if (this.config.orchestratorContext) {
            this.inProcessServer.setContext({
                orchestrator: this.config.orchestratorContext,
                sessionId: 'in-process-session'
            });
        }
        await this.createSdkServer();
        logger.info('In-process MCP server created', {
            toolCount: this.inProcessServer.getToolNames().length
        });
    }
    async createSdkServer() {
        if (!this.inProcessServer) {
            throw new Error('In-process server not initialized');
        }
        const sdkTools = Array.from(this.tools.values()).map((tool)=>{
            return this.convertToSdkTool(tool);
        });
        this.sdkServer = createSdkMcpServer({
            name: 'claude-flow',
            version: '2.0.0',
            tools: sdkTools
        });
        logger.info('SDK MCP server created', {
            toolCount: sdkTools.length
        });
    }
    convertToSdkTool(mcpTool) {
        const zodSchema = this.jsonSchemaToZod(mcpTool.inputSchema);
        return tool(mcpTool.name, mcpTool.description, zodSchema, async (args, extra)=>{
            if (this.inProcessServer) {
                return await this.inProcessServer.callTool(mcpTool.name, args);
            }
            const result = await mcpTool.handler(args, {
                orchestrator: this.config.orchestratorContext,
                sessionId: 'sdk-session'
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                    }
                ],
                isError: false
            };
        });
    }
    jsonSchemaToZod(schema) {
        const zodSchema = {};
        if (!schema.properties) {
            return {};
        }
        for (const [key, prop] of Object.entries(schema.properties)){
            const p = prop;
            if (p.type === 'string') {
                zodSchema[key] = p.enum ? z.enum(p.enum) : z.string();
                if (p.default !== undefined) {
                    zodSchema[key] = zodSchema[key].default(p.default);
                }
                if (!schema.required?.includes(key)) {
                    zodSchema[key] = zodSchema[key].optional();
                }
            } else if (p.type === 'number' || p.type === 'integer') {
                zodSchema[key] = z.number();
                if (p.default !== undefined) {
                    zodSchema[key] = zodSchema[key].default(p.default);
                }
                if (!schema.required?.includes(key)) {
                    zodSchema[key] = zodSchema[key].optional();
                }
            } else if (p.type === 'boolean') {
                zodSchema[key] = z.boolean();
                if (p.default !== undefined) {
                    zodSchema[key] = zodSchema[key].default(p.default);
                }
                if (!schema.required?.includes(key)) {
                    zodSchema[key] = zodSchema[key].optional();
                }
            } else if (p.type === 'array') {
                zodSchema[key] = z.array(z.any());
                if (!schema.required?.includes(key)) {
                    zodSchema[key] = zodSchema[key].optional();
                }
            } else if (p.type === 'object') {
                zodSchema[key] = z.record(z.any());
                if (!schema.required?.includes(key)) {
                    zodSchema[key] = zodSchema[key].optional();
                }
            } else {
                zodSchema[key] = z.any();
                if (!schema.required?.includes(key)) {
                    zodSchema[key] = zodSchema[key].optional();
                }
            }
            if (p.description) {
                zodSchema[key] = zodSchema[key].describe(p.description);
            }
        }
        return zodSchema;
    }
    getSdkServerConfig() {
        return this.sdkServer;
    }
    getInProcessServer() {
        return this.inProcessServer;
    }
    getTool(name) {
        return this.tools.get(name);
    }
    getToolNames() {
        let tools = Array.from(this.tools.values());
        if (this.toolFilter) {
            tools = this.toolFilter.filterTools(tools);
        }
        return tools.map((t)=>t.name);
    }
    getAllToolNames() {
        return Array.from(this.tools.keys());
    }
    getFilterStats() {
        return this.toolFilter?.getFilterStats() ?? null;
    }
    shouldUseInProcess(toolName) {
        return this.tools.has(toolName);
    }
    async routeToolCall(toolName, args, context) {
        const startTime = performance.now();
        try {
            if (this.shouldUseInProcess(toolName) && this.inProcessServer) {
                logger.debug('Routing to in-process server', {
                    toolName
                });
                const result = await this.inProcessServer.callTool(toolName, args, context);
                const duration = performance.now() - startTime;
                logger.info('In-process tool call completed', {
                    toolName,
                    duration: `${duration.toFixed(2)}ms`,
                    transport: 'in-process'
                });
                return result;
            }
            logger.warn('Tool not found in in-process registry', {
                toolName
            });
            throw new Error(`Tool not available: ${toolName}`);
        } catch (error) {
            logger.error('Tool routing failed', {
                toolName,
                error
            });
            throw error;
        }
    }
    getMetrics() {
        if (!this.inProcessServer) {
            return {
                error: 'In-process server not initialized'
            };
        }
        const stats = this.inProcessServer.getStats();
        const metrics = this.inProcessServer.getMetrics();
        return {
            stats,
            recentMetrics: metrics.slice(-10),
            summary: {
                totalCalls: metrics.length,
                averageLatency: stats.averageDuration,
                cacheHitRate: stats.cacheHitRate
            }
        };
    }
    getPerformanceComparison() {
        const metrics = this.getMetrics();
        if ('error' in metrics) {
            return metrics;
        }
        const avgInProcessLatency = metrics.stats.averageDuration;
        const estimatedIPCLatency = avgInProcessLatency * 50;
        return {
            inProcessLatency: `${avgInProcessLatency.toFixed(2)}ms`,
            estimatedIPCLatency: `${estimatedIPCLatency.toFixed(2)}ms`,
            speedupFactor: `${(estimatedIPCLatency / avgInProcessLatency).toFixed(1)}x`,
            recommendation: 'Use in-process for all Claude-Flow tools for maximum performance'
        };
    }
    async cleanup() {
        if (this.inProcessServer) {
            this.inProcessServer.clearCache();
            this.inProcessServer.clearMetrics();
        }
        this.tools.clear();
        logger.info('Tool registry cleaned up');
    }
}
export async function createToolRegistry(config) {
    const registry = new ClaudeFlowToolRegistry(config);
    await registry.initialize();
    return registry;
}
export async function createClaudeFlowSdkServer(orchestratorContext) {
    const registry = await createToolRegistry({
        enableInProcess: true,
        enableMetrics: true,
        enableCaching: true,
        orchestratorContext
    });
    const sdkServer = registry.getSdkServerConfig();
    if (!sdkServer) {
        throw new Error('Failed to create SDK server');
    }
    return sdkServer;
}

//# sourceMappingURL=tool-registry.js.map