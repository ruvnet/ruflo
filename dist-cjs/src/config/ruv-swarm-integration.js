import { configManager } from './config-manager.js';
import { getRuvSwarmConfigManager } from './ruv-swarm-config.js';
export class RuvSwarmIntegration {
    configManager;
    ruvSwarmManager;
    constructor(configManager, ruvSwarmManager){
        this.configManager = configManager;
        this.ruvSwarmManager = ruvSwarmManager;
    }
    syncConfiguration() {
        const mainConfig = this.configManager.getRuvSwarmConfig();
        const ruvSwarmConfig = this.ruvSwarmManager.getConfig();
        if (mainConfig.enabled) {
            this.ruvSwarmManager.updateSwarmConfig({
                defaultTopology: mainConfig.defaultTopology,
                maxAgents: mainConfig.maxAgents,
                defaultStrategy: mainConfig.defaultStrategy,
                enableHooks: mainConfig.enableHooks
            });
            this.ruvSwarmManager.updateIntegrationConfig({
                enableMCPTools: true,
                enableCLICommands: true,
                enableHooks: mainConfig.enableHooks
            });
            this.ruvSwarmManager.updateMemoryConfig({
                enablePersistence: mainConfig.enablePersistence
            });
            this.ruvSwarmManager.updateNeuralConfig({
                enableTraining: mainConfig.enableNeuralTraining
            });
        }
    }
    getUnifiedCommandArgs() {
        const mainArgs = this.configManager.getRuvSwarmArgs();
        const ruvSwarmArgs = this.ruvSwarmManager.getCommandArgs();
        const unified = [
            ...mainArgs
        ];
        for(let i = 0; i < ruvSwarmArgs.length; i += 2){
            const flag = ruvSwarmArgs[i];
            const value = ruvSwarmArgs[i + 1];
            if (!unified.includes(flag)) {
                unified.push(flag, value);
            }
        }
        return unified;
    }
    async initialize() {
        try {
            if (!this.configManager.isRuvSwarmEnabled()) {
                return {
                    success: false,
                    message: 'ruv-swarm is disabled in main configuration'
                };
            }
            this.syncConfiguration();
            const mainValidation = this.validateMainConfig();
            if (!mainValidation.valid) {
                return {
                    success: false,
                    message: `Main config validation failed: ${mainValidation.errors.join(', ')}`
                };
            }
            const ruvSwarmValidation = this.ruvSwarmManager.validateConfig();
            if (!ruvSwarmValidation.valid) {
                return {
                    success: false,
                    message: `ruv-swarm config validation failed: ${ruvSwarmValidation.errors.join(', ')}`
                };
            }
            return {
                success: true,
                message: 'ruv-swarm integration initialized and configured'
            };
        } catch (error) {
            const message = `Failed to initialize ruv-swarm integration: ${error.message}`;
            return {
                success: false,
                message
            };
        }
    }
    validateMainConfig() {
        const errors = [];
        const ruvSwarmConfig = this.configManager.getRuvSwarmConfig();
        if (!ruvSwarmConfig.defaultTopology) {
            errors.push('ruvSwarm.defaultTopology is required');
        }
        if (ruvSwarmConfig.maxAgents <= 0) {
            errors.push('ruvSwarm.maxAgents must be greater than 0');
        }
        if (!ruvSwarmConfig.defaultStrategy) {
            errors.push('ruvSwarm.defaultStrategy is required');
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    getStatus() {
        const mainConfig = this.configManager.getRuvSwarmConfig();
        const ruvSwarmConfig = this.ruvSwarmManager.getConfig();
        return {
            enabled: mainConfig.enabled,
            mainConfig,
            ruvSwarmConfig,
            synchronized: this.isConfigurationSynchronized()
        };
    }
    isConfigurationSynchronized() {
        const mainConfig = this.configManager.getRuvSwarmConfig();
        const ruvSwarmConfig = this.ruvSwarmManager.getConfig();
        return ruvSwarmConfig.swarm.defaultTopology === mainConfig.defaultTopology && ruvSwarmConfig.swarm.maxAgents === mainConfig.maxAgents && ruvSwarmConfig.swarm.defaultStrategy === mainConfig.defaultStrategy && ruvSwarmConfig.swarm.enableHooks === mainConfig.enableHooks && ruvSwarmConfig.memory.enablePersistence === mainConfig.enablePersistence && ruvSwarmConfig.neural.enableTraining === mainConfig.enableNeuralTraining;
    }
    updateConfiguration(updates) {
        if (updates.main) {
            this.configManager.setRuvSwarmConfig(updates.main);
        }
        if (updates.ruvSwarm) {
            this.ruvSwarmManager.updateConfig(updates.ruvSwarm);
        }
        this.syncConfiguration();
    }
}
let integrationInstance = null;
export function getRuvSwarmIntegration() {
    if (!integrationInstance) {
        const ruvSwarmManager = getRuvSwarmConfigManager(logger);
        integrationInstance = new RuvSwarmIntegration(configManager, ruvSwarmManager);
    }
    return integrationInstance;
}
export async function initializeRuvSwarmIntegration() {
    const integration = getRuvSwarmIntegration();
    return integration.initialize();
}
export class RuvSwarmConfigHelpers {
    static setupDevelopmentConfig() {
        const integration = getRuvSwarmIntegration();
        integration.updateConfiguration({
            main: {
                enabled: true,
                defaultTopology: 'hierarchical',
                maxAgents: 8,
                defaultStrategy: 'specialized',
                autoInit: true,
                enableHooks: true,
                enablePersistence: true,
                enableNeuralTraining: true
            }
        });
    }
    static setupResearchConfig() {
        const integration = getRuvSwarmIntegration();
        integration.updateConfiguration({
            main: {
                enabled: true,
                defaultTopology: 'mesh',
                maxAgents: 12,
                defaultStrategy: 'adaptive',
                autoInit: true,
                enableHooks: true,
                enablePersistence: true,
                enableNeuralTraining: true
            }
        });
    }
    static setupProductionConfig() {
        const integration = getRuvSwarmIntegration();
        integration.updateConfiguration({
            main: {
                enabled: true,
                defaultTopology: 'star',
                maxAgents: 6,
                defaultStrategy: 'balanced',
                autoInit: false,
                enableHooks: true,
                enablePersistence: true,
                enableNeuralTraining: false
            }
        });
    }
    static getConfigForUseCase(useCase) {
        const integration = getRuvSwarmIntegration();
        switch(useCase){
            case 'development':
                return {
                    topology: 'hierarchical',
                    maxAgents: 8,
                    strategy: 'specialized',
                    features: [
                        'hooks',
                        'persistence',
                        'neural-training'
                    ]
                };
            case 'research':
                return {
                    topology: 'mesh',
                    maxAgents: 12,
                    strategy: 'adaptive',
                    features: [
                        'hooks',
                        'persistence',
                        'neural-training',
                        'advanced-metrics'
                    ]
                };
            case 'production':
                return {
                    topology: 'star',
                    maxAgents: 6,
                    strategy: 'balanced',
                    features: [
                        'hooks',
                        'persistence'
                    ]
                };
            default:
                return integration.getStatus().mainConfig;
        }
    }
}
export default {
    RuvSwarmIntegration,
    getRuvSwarmIntegration,
    initializeRuvSwarmIntegration,
    RuvSwarmConfigHelpers
};

//# sourceMappingURL=ruv-swarm-integration.js.map