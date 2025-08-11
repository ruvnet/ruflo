"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ruv_swarm_integration_exports = {};
__export(ruv_swarm_integration_exports, {
  RuvSwarmConfigHelpers: () => RuvSwarmConfigHelpers,
  RuvSwarmIntegration: () => RuvSwarmIntegration,
  default: () => ruv_swarm_integration_default,
  getRuvSwarmIntegration: () => getRuvSwarmIntegration,
  initializeRuvSwarmIntegration: () => initializeRuvSwarmIntegration
});
module.exports = __toCommonJS(ruv_swarm_integration_exports);
var import_config_manager = require("./config-manager.js");
var import_ruv_swarm_config = require("./ruv-swarm-config.js");
class RuvSwarmIntegration {
  static {
    __name(this, "RuvSwarmIntegration");
  }
  configManager;
  ruvSwarmManager;
  constructor(configManager2, ruvSwarmManager) {
    this.configManager = configManager2;
    this.ruvSwarmManager = ruvSwarmManager;
  }
  /**
   * Synchronize main config with ruv-swarm config
   */
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
  /**
   * Get unified command arguments for ruv-swarm CLI
   */
  getUnifiedCommandArgs() {
    const mainArgs = this.configManager.getRuvSwarmArgs();
    const ruvSwarmArgs = this.ruvSwarmManager.getCommandArgs();
    const unified = [...mainArgs];
    for (let i = 0; i < ruvSwarmArgs.length; i += 2) {
      const flag = ruvSwarmArgs[i];
      const value = ruvSwarmArgs[i + 1];
      if (!unified.includes(flag)) {
        unified.push(flag, value);
      }
    }
    return unified;
  }
  /**
   * Initialize ruv-swarm integration
   */
  async initialize() {
    try {
      if (!this.configManager.isRuvSwarmEnabled()) {
        return {
          success: false,
          message: "ruv-swarm is disabled in main configuration"
        };
      }
      this.syncConfiguration();
      const mainValidation = this.validateMainConfig();
      if (!mainValidation.valid) {
        return {
          success: false,
          message: `Main config validation failed: ${mainValidation.errors.join(", ")}`
        };
      }
      const ruvSwarmValidation = this.ruvSwarmManager.validateConfig();
      if (!ruvSwarmValidation.valid) {
        return {
          success: false,
          message: `ruv-swarm config validation failed: ${ruvSwarmValidation.errors.join(", ")}`
        };
      }
      return {
        success: true,
        message: "ruv-swarm integration initialized and configured"
      };
    } catch (error) {
      const message = `Failed to initialize ruv-swarm integration: ${error.message}`;
      return {
        success: false,
        message
      };
    }
  }
  /**
   * Validate main configuration for ruv-swarm compatibility
   */
  validateMainConfig() {
    const errors = [];
    const ruvSwarmConfig = this.configManager.getRuvSwarmConfig();
    if (!ruvSwarmConfig.defaultTopology) {
      errors.push("ruvSwarm.defaultTopology is required");
    }
    if (ruvSwarmConfig.maxAgents <= 0) {
      errors.push("ruvSwarm.maxAgents must be greater than 0");
    }
    if (!ruvSwarmConfig.defaultStrategy) {
      errors.push("ruvSwarm.defaultStrategy is required");
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
  /**
   * Get current integration status
   */
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
  /**
   * Check if configurations are synchronized
   */
  isConfigurationSynchronized() {
    const mainConfig = this.configManager.getRuvSwarmConfig();
    const ruvSwarmConfig = this.ruvSwarmManager.getConfig();
    return ruvSwarmConfig.swarm.defaultTopology === mainConfig.defaultTopology && ruvSwarmConfig.swarm.maxAgents === mainConfig.maxAgents && ruvSwarmConfig.swarm.defaultStrategy === mainConfig.defaultStrategy && ruvSwarmConfig.swarm.enableHooks === mainConfig.enableHooks && ruvSwarmConfig.memory.enablePersistence === mainConfig.enablePersistence && ruvSwarmConfig.neural.enableTraining === mainConfig.enableNeuralTraining;
  }
  /**
   * Update configuration and sync
   */
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
function getRuvSwarmIntegration() {
  if (!integrationInstance) {
    const ruvSwarmManager = (0, import_ruv_swarm_config.getRuvSwarmConfigManager)(logger);
    integrationInstance = new RuvSwarmIntegration(import_config_manager.configManager, ruvSwarmManager);
  }
  return integrationInstance;
}
__name(getRuvSwarmIntegration, "getRuvSwarmIntegration");
async function initializeRuvSwarmIntegration() {
  const integration = getRuvSwarmIntegration();
  return integration.initialize();
}
__name(initializeRuvSwarmIntegration, "initializeRuvSwarmIntegration");
class RuvSwarmConfigHelpers {
  static {
    __name(this, "RuvSwarmConfigHelpers");
  }
  /**
   * Quick setup for development environment
   */
  static setupDevelopmentConfig() {
    const integration = getRuvSwarmIntegration();
    integration.updateConfiguration({
      main: {
        enabled: true,
        defaultTopology: "hierarchical",
        maxAgents: 8,
        defaultStrategy: "specialized",
        autoInit: true,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: true
      }
    });
  }
  /**
   * Quick setup for research environment
   */
  static setupResearchConfig() {
    const integration = getRuvSwarmIntegration();
    integration.updateConfiguration({
      main: {
        enabled: true,
        defaultTopology: "mesh",
        maxAgents: 12,
        defaultStrategy: "adaptive",
        autoInit: true,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: true
      }
    });
  }
  /**
   * Quick setup for production environment
   */
  static setupProductionConfig() {
    const integration = getRuvSwarmIntegration();
    integration.updateConfiguration({
      main: {
        enabled: true,
        defaultTopology: "star",
        maxAgents: 6,
        defaultStrategy: "balanced",
        autoInit: false,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: false
      }
    });
  }
  /**
   * Get configuration for specific use case
   */
  static getConfigForUseCase(useCase) {
    const integration = getRuvSwarmIntegration();
    switch (useCase) {
      case "development":
        return {
          topology: "hierarchical",
          maxAgents: 8,
          strategy: "specialized",
          features: ["hooks", "persistence", "neural-training"]
        };
      case "research":
        return {
          topology: "mesh",
          maxAgents: 12,
          strategy: "adaptive",
          features: ["hooks", "persistence", "neural-training", "advanced-metrics"]
        };
      case "production":
        return {
          topology: "star",
          maxAgents: 6,
          strategy: "balanced",
          features: ["hooks", "persistence"]
        };
      default:
        return integration.getStatus().mainConfig;
    }
  }
}
var ruv_swarm_integration_default = {
  RuvSwarmIntegration,
  getRuvSwarmIntegration,
  initializeRuvSwarmIntegration,
  RuvSwarmConfigHelpers
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RuvSwarmConfigHelpers,
  RuvSwarmIntegration,
  getRuvSwarmIntegration,
  initializeRuvSwarmIntegration
});
//# sourceMappingURL=ruv-swarm-integration.js.map
