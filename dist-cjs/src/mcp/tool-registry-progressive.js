import { createInProcessServer } from './in-process-server.js';
import { DynamicToolLoader } from './tools/loader.js';
import { createSearchToolsTool } from './tools/system/search.js';
import { logger } from '../core/logger.js';
import { join } from 'path';
let sdkCache = null;
let sdkLoadAttempted = false;
async function getSDK() {
    if (sdkLoadAttempted) {
        return sdkCache;
    }
    sdkLoadAttempted = true;
    try {
        const sdk = await import('@anthropic-ai/claude-code/sdk');
        const zodModule = await import('zod');
        sdkCache = {
            tool: sdk.tool,
            createSdkMcpServer: sdk.createSdkMcpServer,
            z: zodModule.z
        };
        logger.info('Claude Code SDK loaded successfully');
    } catch (error) {
        logger.info('Claude Code SDK not available, operating without SDK integration');
        sdkCache = null;
    }
    return sdkCache;
}
export class ProgressiveToolRegistry {
    toolLoader;
    inProcessServer;
    sdkServer;
    config;
    toolCache = new Map();
    constructor(config){
        this.config = config;
        const toolsDir = config.toolsDirectory || join(__dirname, 'tools');
        this.toolLoader = new DynamicToolLoader(toolsDir, logger);
        logger.info('ProgressiveToolRegistry initialized', {
            enableInProcess: config.enableInProcess,
            enableMetrics: config.enableMetrics,
            toolsDirectory: toolsDir,
            mode: 'progressive-disclosure'
        });
    }
    async initialize() {
        logger.info('Initializing progressive tool registry...');
        await this.toolLoader.scanTools();
        const stats = this.toolLoader.getStats();
        logger.info('Tool metadata scan complete', {
            totalTools: stats.totalTools,
            categories: stats.categories,
            toolsByCategory: stats.toolsByCategory,
            mode: 'metadata-only',
            tokenSavings: '98.7%'
        });
        await this.registerCoreTools();
        if (this.config.enableInProcess) {
            await this.createInProcessServer();
        }
        logger.info('Progressive tool registry initialized', {
            totalToolsDiscovered: stats.totalTools,
            coreToolsLoaded: this.toolCache.size,
            approach: 'progressive-disclosure'
        });
    }
    async registerCoreTools() {
        logger.info('Registering core system tools...');
        const searchTool = createSearchToolsTool(this.toolLoader, logger);
        this.toolCache.set(searchTool.name, searchTool);
        logger.info('Core tools registered', {
            coreTools: Array.from(this.toolCache.keys())
        });
    }
    async createInProcessServer() {
        logger.info('Creating progressive in-process MCP server...');
        this.inProcessServer = createInProcessServer({
            name: 'claude-flow',
            version: '2.7.32',
            enableMetrics: this.config.enableMetrics,
            enableCaching: this.config.enableCaching
        });
        for (const [name, tool] of this.toolCache){
            this.inProcessServer.registerTool(tool);
        }
        if (this.config.orchestratorContext) {
            this.inProcessServer.setContext({
                orchestrator: this.config.orchestratorContext,
                sessionId: 'progressive-session'
            });
        }
        await this.createSdkServer();
        const stats = this.toolLoader.getStats();
        logger.info('Progressive in-process MCP server created', {
            discoveredTools: stats.totalTools,
            initiallyLoaded: this.toolCache.size,
            lazyLoadEnabled: true
        });
    }
    async createSdkServer() {
        if (!this.inProcessServer) {
            throw new Error('In-process server not initialized');
        }
        const sdk = await getSDK();
        if (!sdk) {
            logger.info('SDK not available, skipping SDK server creation');
            return;
        }
        const stats = this.toolLoader.getStats();
        const allToolNames = this.toolLoader.getAllToolNames();
        const sdkTools = allToolNames.map((toolName)=>{
            return this.createLazySdkTool(toolName, sdk);
        });
        this.sdkServer = sdk.createSdkMcpServer({
            name: 'claude-flow',
            version: '2.7.32',
            tools: sdkTools
        });
        logger.info('SDK MCP server created with progressive disclosure', {
            totalTools: sdkTools.length,
            mode: 'lazy-loading'
        });
    }
    createLazySdkTool(toolName, sdk) {
        const metadata = this.toolLoader.getToolMetadata(toolName);
        if (!metadata) {
            logger.warn('Tool metadata not found', {
                toolName
            });
            return null;
        }
        const zodSchema = sdk.z.object({}).passthrough();
        return sdk.tool(toolName, metadata.description, zodSchema, async (args, extra)=>{
            const mcpTool = await this.getOrLoadTool(toolName);
            if (!mcpTool) {
                throw new Error(`Tool not found: ${toolName}`);
            }
            if (this.inProcessServer) {
                return await this.inProcessServer.callTool(toolName, args);
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
    async getOrLoadTool(toolName) {
        if (this.toolCache.has(toolName)) {
            return this.toolCache.get(toolName);
        }
        logger.debug('Lazy loading tool', {
            toolName
        });
        const tool = await this.toolLoader.loadTool(toolName, logger);
        if (tool) {
            this.toolCache.set(toolName, tool);
            if (this.inProcessServer) {
                this.inProcessServer.registerTool(tool);
            }
            logger.info('Tool lazy loaded and cached', {
                toolName,
                totalCached: this.toolCache.size
            });
        }
        return tool;
    }
    async getTool(name) {
        return await this.getOrLoadTool(name) || undefined;
    }
    getToolNames() {
        return this.toolLoader.getAllToolNames();
    }
    searchTools(query) {
        return this.toolLoader.searchTools(query);
    }
    getSdkServerConfig() {
        return this.sdkServer;
    }
    getInProcessServer() {
        return this.inProcessServer;
    }
    shouldUseInProcess(toolName) {
        return this.toolLoader.getToolMetadata(toolName) !== undefined;
    }
    async routeToolCall(toolName, args, context) {
        const startTime = performance.now();
        try {
            const tool = await this.getOrLoadTool(toolName);
            if (!tool) {
                throw new Error(`Tool not available: ${toolName}`);
            }
            if (this.shouldUseInProcess(toolName) && this.inProcessServer) {
                logger.debug('Routing to in-process server', {
                    toolName
                });
                const result = await this.inProcessServer.callTool(toolName, args, context);
                const duration = performance.now() - startTime;
                logger.info('In-process tool call completed', {
                    toolName,
                    duration: `${duration.toFixed(2)}ms`,
                    transport: 'in-process',
                    lazyLoaded: !this.toolCache.has(toolName)
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
        const loaderStats = this.toolLoader.getStats();
        if (!this.inProcessServer) {
            return {
                discovery: loaderStats,
                error: 'In-process server not initialized'
            };
        }
        const serverStats = this.inProcessServer.getStats();
        const serverMetrics = this.inProcessServer.getMetrics();
        const estimatedOldTokens = loaderStats.totalTools * 3000;
        const estimatedNewTokens = loaderStats.totalTools * 40;
        const tokenSavingsPercent = (estimatedOldTokens - estimatedNewTokens) / estimatedOldTokens * 100;
        return {
            discovery: loaderStats,
            loading: {
                totalDiscovered: loaderStats.totalTools,
                currentlyLoaded: this.toolCache.size,
                lazyLoadPercentage: (this.toolCache.size / loaderStats.totalTools * 100).toFixed(2) + '%'
            },
            performance: {
                stats: serverStats,
                recentMetrics: serverMetrics.slice(-10),
                summary: {
                    totalCalls: serverMetrics.length,
                    averageLatency: serverStats.averageDuration,
                    cacheHitRate: serverStats.cacheHitRate
                }
            },
            tokenSavings: {
                estimatedOldApproach: `${estimatedOldTokens.toLocaleString()} tokens`,
                estimatedNewApproach: `${estimatedNewTokens.toLocaleString()} tokens`,
                savingsPercent: `${tokenSavingsPercent.toFixed(2)}%`,
                savingsRatio: `${(estimatedOldTokens / estimatedNewTokens).toFixed(1)}x`
            }
        };
    }
    getPerformanceComparison() {
        const metrics = this.getMetrics();
        if ('error' in metrics) {
            return metrics;
        }
        const avgInProcessLatency = metrics.performance.stats.averageDuration;
        const estimatedIPCLatency = avgInProcessLatency * 50;
        return {
            inProcessLatency: `${avgInProcessLatency.toFixed(2)}ms`,
            estimatedIPCLatency: `${estimatedIPCLatency.toFixed(2)}ms`,
            speedupFactor: `${(estimatedIPCLatency / avgInProcessLatency).toFixed(1)}x`,
            tokenSavings: metrics.tokenSavings,
            recommendation: 'Use progressive disclosure with in-process execution for maximum performance and minimal token usage'
        };
    }
    async reload() {
        logger.info('Reloading tool registry...');
        this.toolCache.clear();
        await this.toolLoader.reload();
        await this.registerCoreTools();
        logger.info('Tool registry reloaded');
    }
    async cleanup() {
        if (this.inProcessServer) {
            this.inProcessServer.clearCache();
            this.inProcessServer.clearMetrics();
        }
        this.toolCache.clear();
        this.toolLoader.clearCache();
        logger.info('Progressive tool registry cleaned up');
    }
}
export async function createProgressiveToolRegistry(config) {
    const registry = new ProgressiveToolRegistry(config);
    await registry.initialize();
    return registry;
}
export async function createProgressiveClaudeFlowSdkServer(orchestratorContext) {
    const registry = await createProgressiveToolRegistry({
        enableInProcess: true,
        enableMetrics: true,
        enableCaching: true,
        orchestratorContext
    });
    const sdkServer = registry.getSdkServerConfig();
    if (!sdkServer) {
        throw new Error('Failed to create SDK server');
    }
    logger.info('Progressive Claude Flow SDK server created', {
        totalTools: registry.getToolNames().length,
        approach: 'progressive-disclosure',
        tokenSavings: '98.7%'
    });
    return sdkServer;
}

//# sourceMappingURL=tool-registry-progressive.js.map