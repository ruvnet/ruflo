import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { deepMerge } from '../utils/helpers.js';
export const defaultRuvSwarmConfig = {
    swarm: {
        defaultTopology: 'mesh',
        maxAgents: 8,
        defaultStrategy: 'adaptive',
        autoInit: true,
        enableHooks: true
    },
    agents: {
        defaultCapabilities: [
            'filesystem',
            'search',
            'memory',
            'coordination'
        ],
        spawnTimeout: 30000,
        heartbeatInterval: 5000,
        maxRetries: 3
    },
    tasks: {
        defaultStrategy: 'adaptive',
        defaultPriority: 'medium',
        timeout: 300000,
        enableMonitoring: true
    },
    memory: {
        enablePersistence: true,
        compressionLevel: 6,
        ttl: 86400000,
        maxSize: 100 * 1024 * 1024
    },
    neural: {
        enableTraining: true,
        patterns: [
            'convergent',
            'divergent',
            'lateral',
            'systems'
        ],
        learningRate: 0.1,
        trainingIterations: 10
    },
    monitoring: {
        enableMetrics: true,
        metricsInterval: 10000,
        enableAlerts: true,
        alertThresholds: {
            cpu: 80,
            memory: 85,
            taskFailureRate: 20
        }
    },
    integration: {
        enableMCPTools: true,
        enableCLICommands: true,
        enableHooks: true,
        sessionTimeout: 3600000
    }
};
export class RuvSwarmConfigManager {
    logger;
    config;
    configPath;
    constructor(logger, configPath){
        this.logger = logger;
        this.configPath = configPath || join(process.cwd(), '.claude', 'ruv-swarm-config.json');
        this.config = this.loadConfig();
    }
    loadConfig() {
        try {
            if (existsSync(this.configPath)) {
                const configData = readFileSync(this.configPath, 'utf-8');
                const userConfig = JSON.parse(configData);
                const mergedConfig = deepMerge(defaultRuvSwarmConfig, userConfig);
                this.logger.debug('Loaded ruv-swarm config from file', {
                    path: this.configPath,
                    config: mergedConfig
                });
                return mergedConfig;
            }
        } catch (error) {
            this.logger.warn('Failed to load ruv-swarm config, using defaults', {
                error: error instanceof Error ? error instanceof Error ? error.message : String(error) : error
            });
        }
        this.logger.debug('Using default ruv-swarm config');
        return {
            ...defaultRuvSwarmConfig
        };
    }
    saveConfig() {
        try {
            const configDir = join(this.configPath, '..');
            if (!existsSync(configDir)) {
                const fs = require('fs');
                fs.mkdirSync(configDir, {
                    recursive: true
                });
            }
            writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
            this.logger.debug('Saved ruv-swarm config to file', {
                path: this.configPath
            });
        } catch (error) {
            this.logger.error('Failed to save ruv-swarm config', {
                error: error instanceof Error ? error instanceof Error ? error.message : String(error) : error
            });
        }
    }
    getConfig() {
        return {
            ...this.config
        };
    }
    updateConfig(updates) {
        this.config = deepMerge(this.config, updates);
        this.saveConfig();
        this.logger.info('Updated ruv-swarm config', {
            updates
        });
    }
    resetConfig() {
        this.config = {
            ...defaultRuvSwarmConfig
        };
        this.saveConfig();
        this.logger.info('Reset ruv-swarm config to defaults');
    }
    getSwarmConfig() {
        return this.config.swarm;
    }
    getAgentsConfig() {
        return this.config.agents;
    }
    getTasksConfig() {
        return this.config.tasks;
    }
    getMemoryConfig() {
        return this.config.memory;
    }
    getNeuralConfig() {
        return this.config.neural;
    }
    getMonitoringConfig() {
        return this.config.monitoring;
    }
    getIntegrationConfig() {
        return this.config.integration;
    }
    updateSwarmConfig(updates) {
        this.updateConfig({
            swarm: {
                ...this.config.swarm,
                ...updates
            }
        });
    }
    updateAgentsConfig(updates) {
        this.updateConfig({
            agents: {
                ...this.config.agents,
                ...updates
            }
        });
    }
    updateTasksConfig(updates) {
        this.updateConfig({
            tasks: {
                ...this.config.tasks,
                ...updates
            }
        });
    }
    updateMemoryConfig(updates) {
        this.updateConfig({
            memory: {
                ...this.config.memory,
                ...updates
            }
        });
    }
    updateNeuralConfig(updates) {
        this.updateConfig({
            neural: {
                ...this.config.neural,
                ...updates
            }
        });
    }
    updateMonitoringConfig(updates) {
        this.updateConfig({
            monitoring: {
                ...this.config.monitoring,
                ...updates
            }
        });
    }
    updateIntegrationConfig(updates) {
        this.updateConfig({
            integration: {
                ...this.config.integration,
                ...updates
            }
        });
    }
    validateConfig() {
        const errors = [];
        if (this.config.swarm.maxAgents < 1 || this.config.swarm.maxAgents > 100) {
            errors.push('swarm.maxAgents must be between 1 and 100');
        }
        if (this.config.agents.spawnTimeout < 1000) {
            errors.push('agents.spawnTimeout must be at least 1000ms');
        }
        if (this.config.agents.heartbeatInterval < 1000) {
            errors.push('agents.heartbeatInterval must be at least 1000ms');
        }
        if (this.config.tasks.timeout < 10000) {
            errors.push('tasks.timeout must be at least 10000ms');
        }
        if (this.config.memory.maxSize < 1024 * 1024) {
            errors.push('memory.maxSize must be at least 1MB');
        }
        if (this.config.memory.compressionLevel < 0 || this.config.memory.compressionLevel > 9) {
            errors.push('memory.compressionLevel must be between 0 and 9');
        }
        if (this.config.neural.learningRate <= 0 || this.config.neural.learningRate > 1) {
            errors.push('neural.learningRate must be between 0 and 1');
        }
        if (this.config.neural.trainingIterations < 1) {
            errors.push('neural.trainingIterations must be at least 1');
        }
        const { alertThresholds } = this.config.monitoring;
        if (alertThresholds.cpu < 0 || alertThresholds.cpu > 100) {
            errors.push('monitoring.alertThresholds.cpu must be between 0 and 100');
        }
        if (alertThresholds.memory < 0 || alertThresholds.memory > 100) {
            errors.push('monitoring.alertThresholds.memory must be between 0 and 100');
        }
        if (alertThresholds.taskFailureRate < 0 || alertThresholds.taskFailureRate > 100) {
            errors.push('monitoring.alertThresholds.taskFailureRate must be between 0 and 100');
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    getCommandArgs() {
        const args = [];
        args.push('--topology', this.config.swarm.defaultTopology);
        args.push('--max-agents', String(this.config.swarm.maxAgents));
        args.push('--strategy', this.config.swarm.defaultStrategy);
        if (this.config.swarm.enableHooks) {
            args.push('--enable-hooks');
        }
        args.push('--task-strategy', this.config.tasks.defaultStrategy);
        args.push('--task-priority', this.config.tasks.defaultPriority);
        args.push('--task-timeout', String(this.config.tasks.timeout));
        if (this.config.tasks.enableMonitoring) {
            args.push('--enable-monitoring');
        }
        if (this.config.memory.enablePersistence) {
            args.push('--enable-persistence');
            args.push('--compression-level', String(this.config.memory.compressionLevel));
            args.push('--memory-ttl', String(this.config.memory.ttl));
        }
        if (this.config.neural.enableTraining) {
            args.push('--enable-training');
            args.push('--learning-rate', String(this.config.neural.learningRate));
            args.push('--training-iterations', String(this.config.neural.trainingIterations));
        }
        return args;
    }
}
let configManagerInstance = null;
export function getRuvSwarmConfigManager(logger, configPath) {
    if (!configManagerInstance) {
        configManagerInstance = new RuvSwarmConfigManager(logger, configPath);
    }
    return configManagerInstance;
}
export default {
    RuvSwarmConfigManager,
    getRuvSwarmConfigManager,
    defaultRuvSwarmConfig
};

//# sourceMappingURL=ruv-swarm-config.js.map