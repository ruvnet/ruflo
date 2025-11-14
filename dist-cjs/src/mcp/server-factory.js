import { MCPServer } from './server.js';
import { MCP2025Server } from './server-mcp-2025.js';
export class MCPServerFactory {
    static async createServer(config, eventBus, logger, orchestrator, swarmCoordinator, agentManager, resourceManager, messagebus, monitor) {
        const features = config.features || {};
        const useMCP2025 = features.enableMCP2025 === true;
        if (useMCP2025) {
            logger.info('Creating MCP 2025-11 server with enhanced features');
            return await this.createMCP2025Server(config, eventBus, logger, orchestrator);
        } else {
            logger.info('Creating legacy MCP server (backward compatibility mode)');
            return this.createLegacyServer(config, eventBus, logger, orchestrator, swarmCoordinator, agentManager, resourceManager, messagebus, monitor);
        }
    }
    static async createMCP2025Server(config, eventBus, logger, orchestrator) {
        const features = config.features || {};
        const mcp2025Config = config.mcp2025 || {};
        const serverConfig = {
            serverId: mcp2025Config.serverId || `claude-flow-${Date.now()}`,
            transport: config.transport || 'stdio',
            enableMCP2025: true,
            supportLegacyClients: features.supportLegacyClients !== false,
            async: {
                enabled: features.enableAsyncJobs !== false,
                maxJobs: mcp2025Config.async?.maxJobs || 100,
                jobTTL: mcp2025Config.async?.jobTTL || 3600000,
                persistence: mcp2025Config.async?.persistence || 'memory'
            },
            registry: {
                enabled: features.enableRegistryIntegration === true,
                url: mcp2025Config.registry?.url || 'https://registry.mcp.run',
                apiKey: mcp2025Config.registry?.apiKey,
                updateInterval: mcp2025Config.registry?.updateInterval || 60000,
                retryAttempts: mcp2025Config.registry?.retryAttempts || 3
            },
            validation: {
                enabled: features.enableSchemaValidation !== false,
                strictMode: mcp2025Config.validation?.strictMode || false
            },
            toolsDirectory: mcp2025Config.toolsDirectory,
            orchestratorContext: orchestrator
        };
        const server = new MCP2025Server(serverConfig, eventBus, logger);
        await server.initialize();
        logger.info('MCP 2025-11 server created successfully', {
            serverId: serverConfig.serverId,
            features: {
                versionNegotiation: true,
                asyncJobs: serverConfig.async.enabled,
                registry: serverConfig.registry.enabled,
                validation: serverConfig.validation.enabled,
                progressiveDisclosure: true
            }
        });
        return server;
    }
    static createLegacyServer(config, eventBus, logger, orchestrator, swarmCoordinator, agentManager, resourceManager, messagebus, monitor) {
        const legacyConfig = {
            transport: config.transport,
            host: config.host,
            port: config.port,
            tlsEnabled: config.tlsEnabled,
            enableMetrics: config.enableMetrics,
            auth: config.auth,
            loadBalancer: config.loadBalancer,
            sessionTimeout: config.sessionTimeout,
            maxSessions: config.maxSessions
        };
        const server = new MCPServer(legacyConfig, eventBus, logger, orchestrator, swarmCoordinator, agentManager, resourceManager, messagebus, monitor);
        logger.info('Legacy MCP server created successfully', {
            transport: config.transport,
            mode: 'backward-compatibility'
        });
        return server;
    }
    static detectOptimalConfig(currentConfig) {
        const extended = {
            ...currentConfig,
            features: {
                enableMCP2025: process.env.NODE_ENV !== 'production',
                enableVersionNegotiation: true,
                enableAsyncJobs: true,
                enableRegistryIntegration: false,
                enableSchemaValidation: true,
                supportLegacyClients: true,
                enableProgressiveDisclosure: true
            },
            mcp2025: {
                async: {
                    enabled: true,
                    maxJobs: 100,
                    jobTTL: 3600000,
                    persistence: 'memory'
                },
                registry: {
                    enabled: false,
                    url: process.env.MCP_REGISTRY_URL || 'https://registry.mcp.run',
                    apiKey: process.env.MCP_REGISTRY_API_KEY
                },
                validation: {
                    enabled: true,
                    strictMode: false
                }
            }
        };
        return extended;
    }
    static validateConfig(config) {
        const errors = [];
        const warnings = [];
        if (!config.transport) {
            errors.push('Transport type is required');
        }
        if (config.features?.enableMCP2025) {
            if (config.features.enableRegistryIntegration && !config.mcp2025?.registry?.apiKey) {
                warnings.push('Registry integration enabled but no API key provided');
            }
            if (config.mcp2025?.async?.persistence === 'redis') {
                warnings.push('Redis persistence not yet implemented, falling back to memory');
            }
            if (config.mcp2025?.async?.persistence === 'sqlite') {
                warnings.push('SQLite persistence not yet implemented, falling back to memory');
            }
        }
        if (config.transport === 'http') {
            if (!config.host) {
                warnings.push('HTTP transport enabled but no host specified, using default');
            }
            if (!config.port) {
                warnings.push('HTTP transport enabled but no port specified, using default');
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
}
export async function createMCPServer(config, eventBus, logger, options) {
    const extendedConfig = options?.autoDetectFeatures ? MCPServerFactory.detectOptimalConfig(config) : config;
    const validation = MCPServerFactory.validateConfig(extendedConfig);
    if (!validation.valid) {
        throw new Error(`Invalid MCP configuration: ${validation.errors.join(', ')}`);
    }
    for (const warning of validation.warnings){
        logger.warn('MCP configuration warning', {
            warning
        });
    }
    return await MCPServerFactory.createServer(extendedConfig, eventBus, logger, options?.orchestrator, options?.swarmCoordinator, options?.agentManager, options?.resourceManager, options?.messagebus, options?.monitor);
}
export function isMCP2025Available() {
    try {
        require.resolve('uuid');
        require.resolve('ajv');
        require.resolve('ajv-formats');
        return true;
    } catch  {
        return false;
    }
}
export function getServerCapabilities(config) {
    const capabilities = [];
    if (config.features?.enableMCP2025) {
        capabilities.push('mcp-2025-11');
        if (config.features.enableVersionNegotiation) {
            capabilities.push('version-negotiation');
        }
        if (config.features.enableAsyncJobs) {
            capabilities.push('async-jobs');
        }
        if (config.features.enableRegistryIntegration) {
            capabilities.push('registry');
        }
        if (config.features.enableSchemaValidation) {
            capabilities.push('schema-validation');
        }
        if (config.features.enableProgressiveDisclosure) {
            capabilities.push('progressive-disclosure');
        }
    }
    if (config.features?.supportLegacyClients !== false) {
        capabilities.push('backward-compatible');
    }
    return capabilities;
}

//# sourceMappingURL=server-factory.js.map