"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ruv_swarm_config_exports = {};
__export(ruv_swarm_config_exports, {
  RuvSwarmConfigManager: () => RuvSwarmConfigManager,
  default: () => ruv_swarm_config_default,
  defaultRuvSwarmConfig: () => defaultRuvSwarmConfig,
  getRuvSwarmConfigManager: () => getRuvSwarmConfigManager
});
module.exports = __toCommonJS(ruv_swarm_config_exports);
var import_fs = require("fs");
var import_path = require("path");
var import_helpers = require("../utils/helpers.js");
var import_fs2 = __toESM(require("fs"), 1);
const defaultRuvSwarmConfig = {
  swarm: {
    defaultTopology: "mesh",
    maxAgents: 8,
    defaultStrategy: "adaptive",
    autoInit: true,
    enableHooks: true
  },
  agents: {
    defaultCapabilities: ["filesystem", "search", "memory", "coordination"],
    spawnTimeout: 3e4,
    heartbeatInterval: 5e3,
    maxRetries: 3
  },
  tasks: {
    defaultStrategy: "adaptive",
    defaultPriority: "medium",
    timeout: 3e5,
    // 5 minutes
    enableMonitoring: true
  },
  memory: {
    enablePersistence: true,
    compressionLevel: 6,
    ttl: 864e5,
    // 24 hours
    maxSize: 100 * 1024 * 1024
    // 100MB
  },
  neural: {
    enableTraining: true,
    patterns: ["convergent", "divergent", "lateral", "systems"],
    learningRate: 0.1,
    trainingIterations: 10
  },
  monitoring: {
    enableMetrics: true,
    metricsInterval: 1e4,
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
    sessionTimeout: 36e5
    // 1 hour
  }
};
class RuvSwarmConfigManager {
  constructor(logger, configPath) {
    this.logger = logger;
    this.configPath = configPath || (0, import_path.join)(process.cwd(), ".claude", "ruv-swarm-config.json");
    this.config = this.loadConfig();
  }
  static {
    __name(this, "RuvSwarmConfigManager");
  }
  config;
  configPath;
  /**
   * Load configuration from file or use defaults
   */
  loadConfig() {
    try {
      if ((0, import_fs.existsSync)(this.configPath)) {
        const configData = (0, import_fs.readFileSync)(this.configPath, "utf-8");
        const userConfig = JSON.parse(configData);
        const mergedConfig = (0, import_helpers.deepMerge)(defaultRuvSwarmConfig, userConfig);
        this.logger.debug("Loaded ruv-swarm config from file", {
          path: this.configPath,
          config: mergedConfig
        });
        return mergedConfig;
      }
    } catch (error) {
      this.logger.warn("Failed to load ruv-swarm config, using defaults", {
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : error
      });
    }
    this.logger.debug("Using default ruv-swarm config");
    return { ...defaultRuvSwarmConfig };
  }
  /**
   * Save configuration to file
   */
  saveConfig() {
    try {
      const configDir = (0, import_path.join)(this.configPath, "..");
      if (!(0, import_fs.existsSync)(configDir)) {
        import_fs2.default.mkdirSync(configDir, { recursive: true });
      }
      (0, import_fs.writeFileSync)(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
      this.logger.debug("Saved ruv-swarm config to file", { path: this.configPath });
    } catch (error) {
      this.logger.error("Failed to save ruv-swarm config", {
        error: error instanceof Error ? error instanceof Error ? error.message : String(error) : error
      });
    }
  }
  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }
  /**
   * Update configuration
   */
  updateConfig(updates) {
    this.config = (0, import_helpers.deepMerge)(this.config, updates);
    this.saveConfig();
    this.logger.info("Updated ruv-swarm config", { updates });
  }
  /**
   * Reset configuration to defaults
   */
  resetConfig() {
    this.config = { ...defaultRuvSwarmConfig };
    this.saveConfig();
    this.logger.info("Reset ruv-swarm config to defaults");
  }
  /**
   * Get specific configuration section
   */
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
  /**
   * Update specific configuration section
   */
  updateSwarmConfig(updates) {
    this.updateConfig({ swarm: { ...this.config.swarm, ...updates } });
  }
  updateAgentsConfig(updates) {
    this.updateConfig({ agents: { ...this.config.agents, ...updates } });
  }
  updateTasksConfig(updates) {
    this.updateConfig({ tasks: { ...this.config.tasks, ...updates } });
  }
  updateMemoryConfig(updates) {
    this.updateConfig({ memory: { ...this.config.memory, ...updates } });
  }
  updateNeuralConfig(updates) {
    this.updateConfig({ neural: { ...this.config.neural, ...updates } });
  }
  updateMonitoringConfig(updates) {
    this.updateConfig({ monitoring: { ...this.config.monitoring, ...updates } });
  }
  updateIntegrationConfig(updates) {
    this.updateConfig({ integration: { ...this.config.integration, ...updates } });
  }
  /**
   * Validate configuration
   */
  validateConfig() {
    const errors = [];
    if (this.config.swarm.maxAgents < 1 || this.config.swarm.maxAgents > 100) {
      errors.push("swarm.maxAgents must be between 1 and 100");
    }
    if (this.config.agents.spawnTimeout < 1e3) {
      errors.push("agents.spawnTimeout must be at least 1000ms");
    }
    if (this.config.agents.heartbeatInterval < 1e3) {
      errors.push("agents.heartbeatInterval must be at least 1000ms");
    }
    if (this.config.tasks.timeout < 1e4) {
      errors.push("tasks.timeout must be at least 10000ms");
    }
    if (this.config.memory.maxSize < 1024 * 1024) {
      errors.push("memory.maxSize must be at least 1MB");
    }
    if (this.config.memory.compressionLevel < 0 || this.config.memory.compressionLevel > 9) {
      errors.push("memory.compressionLevel must be between 0 and 9");
    }
    if (this.config.neural.learningRate <= 0 || this.config.neural.learningRate > 1) {
      errors.push("neural.learningRate must be between 0 and 1");
    }
    if (this.config.neural.trainingIterations < 1) {
      errors.push("neural.trainingIterations must be at least 1");
    }
    const { alertThresholds } = this.config.monitoring;
    if (alertThresholds.cpu < 0 || alertThresholds.cpu > 100) {
      errors.push("monitoring.alertThresholds.cpu must be between 0 and 100");
    }
    if (alertThresholds.memory < 0 || alertThresholds.memory > 100) {
      errors.push("monitoring.alertThresholds.memory must be between 0 and 100");
    }
    if (alertThresholds.taskFailureRate < 0 || alertThresholds.taskFailureRate > 100) {
      errors.push("monitoring.alertThresholds.taskFailureRate must be between 0 and 100");
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
  /**
   * Get configuration as command-line arguments for ruv-swarm
   */
  getCommandArgs() {
    const args = [];
    args.push("--topology", this.config.swarm.defaultTopology);
    args.push("--max-agents", String(this.config.swarm.maxAgents));
    args.push("--strategy", this.config.swarm.defaultStrategy);
    if (this.config.swarm.enableHooks) {
      args.push("--enable-hooks");
    }
    args.push("--task-strategy", this.config.tasks.defaultStrategy);
    args.push("--task-priority", this.config.tasks.defaultPriority);
    args.push("--task-timeout", String(this.config.tasks.timeout));
    if (this.config.tasks.enableMonitoring) {
      args.push("--enable-monitoring");
    }
    if (this.config.memory.enablePersistence) {
      args.push("--enable-persistence");
      args.push("--compression-level", String(this.config.memory.compressionLevel));
      args.push("--memory-ttl", String(this.config.memory.ttl));
    }
    if (this.config.neural.enableTraining) {
      args.push("--enable-training");
      args.push("--learning-rate", String(this.config.neural.learningRate));
      args.push("--training-iterations", String(this.config.neural.trainingIterations));
    }
    return args;
  }
}
let configManagerInstance = null;
function getRuvSwarmConfigManager(logger, configPath) {
  if (!configManagerInstance) {
    configManagerInstance = new RuvSwarmConfigManager(logger, configPath);
  }
  return configManagerInstance;
}
__name(getRuvSwarmConfigManager, "getRuvSwarmConfigManager");
var ruv_swarm_config_default = {
  RuvSwarmConfigManager,
  getRuvSwarmConfigManager,
  defaultRuvSwarmConfig
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RuvSwarmConfigManager,
  defaultRuvSwarmConfig,
  getRuvSwarmConfigManager
});
//# sourceMappingURL=ruv-swarm-config.js.map
