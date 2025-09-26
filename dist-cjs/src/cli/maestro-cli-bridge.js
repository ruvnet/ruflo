import { join } from 'path';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import { AgentManager } from '../agents/agent-manager.js';
import { Orchestrator } from '../core/orchestrator.js';
import { MaestroSwarmCoordinator } from '../maestro/maestro-swarm-coordinator.js';
import { agenticHookManager } from '../services/agentic-flow-hooks/index.js';
export class MaestroCLIBridge {
    bridgeConfig;
    swarmCoordinator;
    initializationCache = new Map();
    configCache;
    performanceMetrics = [];
    initialized = false;
    constructor(bridgeConfig = {}){
        this.bridgeConfig = bridgeConfig;
        this.bridgeConfig = {
            enablePerformanceMonitoring: true,
            initializationTimeout: 30000,
            cacheEnabled: true,
            logLevel: 'info',
            ...this.bridgeConfig
        };
    }
    async initializeOrchestrator() {
        const startTime = Date.now();
        try {
            if (this.swarmCoordinator && this.initialized) {
                console.log(chalk.green('✅ Using cached Maestro swarm coordinator'));
                return this.swarmCoordinator;
            }
            console.log(chalk.blue('🚀 Initializing Maestro orchestrator...'));
            const [config, eventBus, logger, memoryManager, agentManager, mainOrchestrator] = await Promise.all([
                this.getOrCreateConfig(),
                this.getOrCreateEventBus(),
                this.getOrCreateLogger(),
                this.getOrCreateMemoryManager(),
                this.getOrCreateAgentManager(),
                this.getOrCreateMainOrchestrator()
            ]);
            const maestroConfig = this.getOptimizedMaestroConfig();
            this.swarmCoordinator = new MaestroSwarmCoordinator(maestroConfig, eventBus, logger);
            await this.executeWithMonitoring('swarm_init', async ()=>{
                const swarmId = await this.swarmCoordinator.initialize();
                console.log(chalk.green(`✅ Native hive mind swarm initialized: ${swarmId}`));
            });
            this.initialized = true;
            const duration = Date.now() - startTime;
            console.log(chalk.green(`✅ Maestro orchestrator ready (${duration}ms)`));
            await this.reportPerformanceMetric('orchestrator_init', duration, true);
            return this.swarmCoordinator;
        } catch (error) {
            const duration = Date.now() - startTime;
            await this.reportPerformanceMetric('orchestrator_init', duration, false, error instanceof Error ? error.message : String(error));
            console.error(chalk.red(`❌ Failed to initialize Maestro orchestrator: ${error instanceof Error ? error.message : String(error)}`));
            throw error;
        }
    }
    async executeWithMonitoring(operation, fn, context) {
        if (!this.bridgeConfig.enablePerformanceMonitoring) {
            return await fn();
        }
        const startTime = Date.now();
        const startMemory = process.memoryUsage().heapUsed;
        try {
            await this.executePerformanceHook('performance-metric', {
                metric: `${operation}_start`,
                value: startTime,
                unit: 'timestamp',
                context: {
                    operation,
                    ...context
                }
            });
            const result = await fn();
            const endTime = Date.now();
            const endMemory = process.memoryUsage().heapUsed;
            const duration = endTime - startTime;
            const memoryDelta = endMemory - startMemory;
            await this.reportPerformanceMetric(operation, duration, true, undefined, memoryDelta);
            await this.executePerformanceHook('performance-metric', {
                metric: `${operation}_complete`,
                value: duration,
                unit: 'milliseconds',
                context: {
                    operation,
                    success: true,
                    memoryDelta: memoryDelta / 1024 / 1024,
                    ...context
                }
            });
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            const memoryDelta = process.memoryUsage().heapUsed - startMemory;
            await this.reportPerformanceMetric(operation, duration, false, error instanceof Error ? error.message : String(error), memoryDelta);
            await this.executePerformanceHook('performance-metric', {
                metric: `${operation}_error`,
                value: duration,
                unit: 'milliseconds',
                context: {
                    operation,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    memoryDelta: memoryDelta / 1024 / 1024,
                    ...context
                }
            });
            throw error;
        }
    }
    getOptimizedMaestroConfig() {
        return {
            hiveMindConfig: {
                name: 'maestro-specs-driven-swarm',
                topology: 'specs-driven',
                queenMode: 'strategic',
                maxAgents: 8,
                consensusThreshold: 0.66,
                memoryTTL: 86400000,
                autoSpawn: true,
                enableConsensus: true,
                enableMemory: true,
                enableCommunication: true
            },
            enableConsensusValidation: true,
            enableLivingDocumentation: true,
            enableSteeringIntegration: true,
            specsDirectory: join(process.cwd(), 'docs', 'maestro', 'specs'),
            steeringDirectory: join(process.cwd(), 'docs', 'maestro', 'steering')
        };
    }
    async getOrCreateConfig() {
        const cacheKey = 'config';
        if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
            return this.initializationCache.get(cacheKey);
        }
        const config = {
            env: process.env.NODE_ENV || 'development',
            logLevel: this.bridgeConfig.logLevel || 'info',
            enableMetrics: this.bridgeConfig.enablePerformanceMonitoring || true
        };
        if (this.bridgeConfig.cacheEnabled) {
            this.initializationCache.set(cacheKey, config);
        }
        return config;
    }
    async getOrCreateEventBus() {
        const cacheKey = 'eventBus';
        if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
            return this.initializationCache.get(cacheKey);
        }
        const eventBus = new EventEmitter();
        if (this.bridgeConfig.cacheEnabled) {
            this.initializationCache.set(cacheKey, eventBus);
        }
        return eventBus;
    }
    async getOrCreateLogger() {
        const cacheKey = 'logger';
        if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
            return this.initializationCache.get(cacheKey);
        }
        const logger = {
            debug: (message, ...args)=>{
                if (this.bridgeConfig.logLevel === 'debug') {
                    console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
                }
            },
            info: (message, ...args)=>{
                console.log(chalk.blue(`[INFO] ${message}`), ...args);
            },
            warn: (message, ...args)=>{
                console.log(chalk.yellow(`[WARN] ${message}`), ...args);
            },
            error: (message, ...args)=>{
                console.log(chalk.red(`[ERROR] ${message}`), ...args);
            },
            configure: async (config)=>{},
            level: this.bridgeConfig.logLevel
        };
        if (this.bridgeConfig.cacheEnabled) {
            this.initializationCache.set(cacheKey, logger);
        }
        return logger;
    }
    async getOrCreateMemoryManager() {
        const cacheKey = 'memoryManager';
        if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
            return this.initializationCache.get(cacheKey);
        }
        const memoryManager = {
            initialize: async ()=>{},
            shutdown: async ()=>{},
            createBank: async (agentId)=>`bank-${agentId}`,
            closeBank: async (bankId)=>{},
            store: async (entry)=>{},
            retrieve: async (id)=>undefined,
            query: async (query)=>[],
            update: async (id, updates)=>{},
            delete: async (id)=>{},
            getHealthStatus: async ()=>({
                    healthy: true
                }),
            performMaintenance: async ()=>{}
        };
        if (this.bridgeConfig.cacheEnabled) {
            this.initializationCache.set(cacheKey, memoryManager);
        }
        return memoryManager;
    }
    async getOrCreateAgentManager() {
        const cacheKey = 'agentManager';
        if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
            return this.initializationCache.get(cacheKey);
        }
        const config = await this.getOrCreateConfig();
        const eventBus = await this.getOrCreateEventBus();
        const logger = await this.getOrCreateLogger();
        const memoryManager = await this.getOrCreateMemoryManager();
        const agentManager = new AgentManager({
            maxAgents: 10
        }, logger, eventBus, memoryManager);
        if (this.bridgeConfig.cacheEnabled) {
            this.initializationCache.set(cacheKey, agentManager);
        }
        return agentManager;
    }
    async getOrCreateMainOrchestrator() {
        const cacheKey = 'mainOrchestrator';
        if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
            return this.initializationCache.get(cacheKey);
        }
        const config = await this.getOrCreateConfig();
        const eventBus = await this.getOrCreateEventBus();
        const logger = await this.getOrCreateLogger();
        const memoryManager = await this.getOrCreateMemoryManager();
        const mockTerminalManager = {};
        const mockCoordinationManager = {};
        const mockMCPServer = {};
        const orchestrator = new Orchestrator(config, mockTerminalManager, memoryManager, mockCoordinationManager, mockMCPServer, eventBus, logger);
        if (this.bridgeConfig.cacheEnabled) {
            this.initializationCache.set(cacheKey, orchestrator);
        }
        return orchestrator;
    }
    async executePerformanceHook(type, data) {
        try {
            await agenticHookManager.executeHooks(type, data, {
                sessionId: `maestro-cli-${Date.now()}`,
                timestamp: Date.now(),
                correlationId: `maestro-performance`,
                metadata: {
                    source: 'maestro-cli-bridge'
                },
                memory: {
                    namespace: 'maestro',
                    provider: 'memory',
                    cache: new Map()
                },
                neural: {
                    modelId: 'default',
                    patterns: null,
                    training: null
                },
                performance: {
                    metrics: new Map(),
                    bottlenecks: [],
                    optimizations: []
                }
            });
        } catch (error) {
            console.warn(chalk.yellow(`⚠️  Performance hook failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
    async reportPerformanceMetric(operation, duration, success, error, memoryUsage) {
        const metric = {
            operation,
            duration,
            success,
            timestamp: Date.now(),
            memoryUsage,
            error
        };
        this.performanceMetrics.push(metric);
        if (this.performanceMetrics.length > 100) {
            this.performanceMetrics.shift();
        }
        if (this.bridgeConfig.logLevel === 'debug') {
            const memoryInfo = memoryUsage ? ` (${(memoryUsage / 1024 / 1024).toFixed(2)}MB)` : '';
            console.log(chalk.gray(`[PERF] ${operation}: ${duration}ms ${success ? '✓' : '✗'}${memoryInfo}`));
        }
    }
    getPerformanceSummary() {
        const successful = this.performanceMetrics.filter((m)=>m.success);
        const failed = this.performanceMetrics.filter((m)=>!m.success);
        const avgDuration = successful.length > 0 ? successful.reduce((sum, m)=>sum + m.duration, 0) / successful.length : 0;
        return {
            totalOperations: this.performanceMetrics.length,
            successfulOperations: successful.length,
            failedOperations: failed.length,
            successRate: this.performanceMetrics.length > 0 ? successful.length / this.performanceMetrics.length * 100 : 0,
            averageDuration: Math.round(avgDuration),
            recentMetrics: this.performanceMetrics.slice(-10)
        };
    }
    async validateConfiguration() {
        const issues = [];
        try {
            const nodeVersion = process.versions.node;
            const majorVersion = parseInt(nodeVersion.split('.')[0]);
            if (majorVersion < 16) {
                issues.push(`Node.js version ${nodeVersion} is not supported. Minimum required: 16.0.0`);
            }
            const memoryUsage = process.memoryUsage();
            const availableMemory = memoryUsage.heapTotal;
            if (availableMemory < 100 * 1024 * 1024) {
                issues.push('Low available memory detected. Maestro requires at least 100MB heap space');
            }
            const specsDir = join(process.cwd(), 'docs', 'maestro', 'specs');
            try {
                const fs = await import('fs/promises');
                await fs.access(specsDir, fs.constants.F_OK);
            } catch  {}
            return {
                valid: issues.length === 0,
                issues
            };
        } catch (error) {
            issues.push(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                valid: false,
                issues
            };
        }
    }
    clearCache() {
        this.initializationCache.clear();
        this.configCache = undefined;
        this.initialized = false;
        console.log(chalk.gray('🧹 Maestro CLI bridge cache cleared'));
    }
    async shutdown() {
        if (this.swarmCoordinator) {
            await this.swarmCoordinator.shutdown();
        }
        this.clearCache();
        this.performanceMetrics = [];
        console.log(chalk.green('✅ Maestro CLI bridge shutdown complete'));
    }
}

//# sourceMappingURL=maestro-cli-bridge.js.map