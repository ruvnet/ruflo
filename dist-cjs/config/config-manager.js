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
var config_manager_exports = {};
__export(config_manager_exports, {
  ConfigError: () => ConfigError,
  ConfigManager: () => ConfigManager,
  configManager: () => configManager
});
module.exports = __toCommonJS(config_manager_exports);
var import_fs = require("fs");
var import_path = __toESM(require("path"), 1);
var import_os = __toESM(require("os"), 1);
const DEFAULT_CONFIG = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100,
    healthCheckInterval: 3e4,
    shutdownTimeout: 3e4
  },
  terminal: {
    type: "auto",
    poolSize: 5,
    recycleAfter: 10,
    healthCheckInterval: 6e4,
    commandTimeout: 3e5
  },
  memory: {
    backend: "hybrid",
    cacheSizeMB: 100,
    syncInterval: 5e3,
    conflictResolution: "crdt",
    retentionDays: 30
  },
  coordination: {
    maxRetries: 3,
    retryDelay: 1e3,
    deadlockDetection: true,
    resourceTimeout: 6e4,
    messageTimeout: 3e4
  },
  mcp: {
    transport: "stdio",
    port: 3e3,
    tlsEnabled: false
  },
  logging: {
    level: "info",
    format: "json",
    destination: "console"
  },
  ruvSwarm: {
    enabled: true,
    defaultTopology: "mesh",
    maxAgents: 8,
    defaultStrategy: "adaptive",
    autoInit: true,
    enableHooks: true,
    enablePersistence: true,
    enableNeuralTraining: true,
    configPath: ".claude/ruv-swarm-config.json"
  },
  claude: {
    model: "claude-3-sonnet-20240229",
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1,
    timeout: 6e4,
    retryAttempts: 3,
    retryDelay: 1e3
  }
};
class ConfigError extends Error {
  static {
    __name(this, "ConfigError");
  }
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}
class ConfigManager {
  static {
    __name(this, "ConfigManager");
  }
  static instance;
  config;
  configPath;
  userConfigDir;
  constructor() {
    this.config = this.deepClone(DEFAULT_CONFIG);
    this.userConfigDir = import_path.default.join(import_os.default.homedir(), ".claude-flow");
  }
  /**
   * Gets the singleton instance
   */
  static getInstance() {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }
  /**
   * Initialize configuration from file or create default
   */
  async init(configPath = "claude-flow.config.json") {
    try {
      await this.load(configPath);
      console.log(`\u2705 Configuration loaded from: ${configPath}`);
    } catch (error) {
      await this.createDefaultConfig(configPath);
      console.log(`\u2705 Default configuration created: ${configPath}`);
    }
  }
  /**
   * Creates a default configuration file
   */
  async createDefaultConfig(configPath) {
    const config = this.deepClone(DEFAULT_CONFIG);
    const content = JSON.stringify(config, null, 2);
    await import_fs.promises.writeFile(configPath, content, "utf8");
    this.configPath = configPath;
  }
  /**
   * Loads configuration from file
   */
  async load(configPath) {
    if (configPath) {
      this.configPath = configPath;
    }
    if (!this.configPath) {
      throw new ConfigError("No configuration file path specified");
    }
    try {
      const content = await import_fs.promises.readFile(this.configPath, "utf8");
      const fileConfig = JSON.parse(content);
      this.config = this.deepMerge(DEFAULT_CONFIG, fileConfig);
      this.loadFromEnv();
      this.validate(this.config);
      return this.config;
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new ConfigError(`Configuration file not found: ${this.configPath}`);
      }
      throw new ConfigError(`Failed to load configuration: ${error.message}`);
    }
  }
  /**
   * Shows current configuration
   */
  show() {
    return this.deepClone(this.config);
  }
  /**
   * Gets a configuration value by path
   */
  get(path2) {
    const keys = path2.split(".");
    let current = this.config;
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        return void 0;
      }
    }
    return current;
  }
  /**
   * Sets a configuration value by path
   */
  set(path2, value) {
    const keys = path2.split(".");
    let current = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
    this.validate(this.config);
  }
  /**
   * Saves current configuration to file
   */
  async save(configPath) {
    const savePath = configPath || this.configPath;
    if (!savePath) {
      throw new ConfigError("No configuration file path specified");
    }
    const content = JSON.stringify(this.config, null, 2);
    await import_fs.promises.writeFile(savePath, content, "utf8");
  }
  /**
   * Validates the configuration
   */
  validate(config) {
    if (config.orchestrator.maxConcurrentAgents < 1 || config.orchestrator.maxConcurrentAgents > 100) {
      throw new ConfigError("orchestrator.maxConcurrentAgents must be between 1 and 100");
    }
    if (config.orchestrator.taskQueueSize < 1 || config.orchestrator.taskQueueSize > 1e4) {
      throw new ConfigError("orchestrator.taskQueueSize must be between 1 and 10000");
    }
    if (!["auto", "vscode", "native"].includes(config.terminal.type)) {
      throw new ConfigError("terminal.type must be one of: auto, vscode, native");
    }
    if (config.terminal.poolSize < 1 || config.terminal.poolSize > 50) {
      throw new ConfigError("terminal.poolSize must be between 1 and 50");
    }
    if (!["sqlite", "markdown", "hybrid"].includes(config.memory.backend)) {
      throw new ConfigError("memory.backend must be one of: sqlite, markdown, hybrid");
    }
    if (config.memory.cacheSizeMB < 1 || config.memory.cacheSizeMB > 1e4) {
      throw new ConfigError("memory.cacheSizeMB must be between 1 and 10000");
    }
    if (config.coordination.maxRetries < 0 || config.coordination.maxRetries > 100) {
      throw new ConfigError("coordination.maxRetries must be between 0 and 100");
    }
    if (!["stdio", "http", "websocket"].includes(config.mcp.transport)) {
      throw new ConfigError("mcp.transport must be one of: stdio, http, websocket");
    }
    if (config.mcp.port < 1 || config.mcp.port > 65535) {
      throw new ConfigError("mcp.port must be between 1 and 65535");
    }
    if (!["debug", "info", "warn", "error"].includes(config.logging.level)) {
      throw new ConfigError("logging.level must be one of: debug, info, warn, error");
    }
    if (!["json", "text"].includes(config.logging.format)) {
      throw new ConfigError("logging.format must be one of: json, text");
    }
    if (!["console", "file"].includes(config.logging.destination)) {
      throw new ConfigError("logging.destination must be one of: console, file");
    }
    if (!["mesh", "hierarchical", "ring", "star"].includes(config.ruvSwarm.defaultTopology)) {
      throw new ConfigError(
        "ruvSwarm.defaultTopology must be one of: mesh, hierarchical, ring, star"
      );
    }
    if (config.ruvSwarm.maxAgents < 1 || config.ruvSwarm.maxAgents > 100) {
      throw new ConfigError("ruvSwarm.maxAgents must be between 1 and 100");
    }
    if (!["balanced", "specialized", "adaptive"].includes(config.ruvSwarm.defaultStrategy)) {
      throw new ConfigError(
        "ruvSwarm.defaultStrategy must be one of: balanced, specialized, adaptive"
      );
    }
    if (config.claude) {
      if (config.claude.model) {
        const validModels = [
          "claude-3-opus-20240229",
          "claude-3-sonnet-20240229",
          "claude-3-haiku-20240307",
          "claude-2.1",
          "claude-2.0",
          "claude-instant-1.2"
        ];
        if (!validModels.includes(config.claude.model)) {
          throw new ConfigError(`claude.model must be one of: ${validModels.join(", ")}`);
        }
      }
      if (config.claude.temperature !== void 0) {
        if (config.claude.temperature < 0 || config.claude.temperature > 1) {
          throw new ConfigError("claude.temperature must be between 0 and 1");
        }
      }
      if (config.claude.maxTokens !== void 0) {
        if (config.claude.maxTokens < 1 || config.claude.maxTokens > 1e5) {
          throw new ConfigError("claude.maxTokens must be between 1 and 100000");
        }
      }
      if (config.claude.topP !== void 0) {
        if (config.claude.topP < 0 || config.claude.topP > 1) {
          throw new ConfigError("claude.topP must be between 0 and 1");
        }
      }
    }
  }
  /**
   * Loads configuration from environment variables
   */
  loadFromEnv() {
    const maxAgents = process.env.CLAUDE_FLOW_MAX_AGENTS;
    if (maxAgents) {
      this.config.orchestrator.maxConcurrentAgents = parseInt(maxAgents, 10);
    }
    const terminalType = process.env.CLAUDE_FLOW_TERMINAL_TYPE;
    if (terminalType === "vscode" || terminalType === "native" || terminalType === "auto") {
      this.config.terminal.type = terminalType;
    }
    const memoryBackend = process.env.CLAUDE_FLOW_MEMORY_BACKEND;
    if (memoryBackend === "sqlite" || memoryBackend === "markdown" || memoryBackend === "hybrid") {
      this.config.memory.backend = memoryBackend;
    }
    const mcpTransport = process.env.CLAUDE_FLOW_MCP_TRANSPORT;
    if (mcpTransport === "stdio" || mcpTransport === "http" || mcpTransport === "websocket") {
      this.config.mcp.transport = mcpTransport;
    }
    const mcpPort = process.env.CLAUDE_FLOW_MCP_PORT;
    if (mcpPort) {
      this.config.mcp.port = parseInt(mcpPort, 10);
    }
    const logLevel = process.env.CLAUDE_FLOW_LOG_LEVEL;
    if (logLevel === "debug" || logLevel === "info" || logLevel === "warn" || logLevel === "error") {
      this.config.logging.level = logLevel;
    }
    const ruvSwarmEnabled = process.env.CLAUDE_FLOW_RUV_SWARM_ENABLED;
    if (ruvSwarmEnabled === "true" || ruvSwarmEnabled === "false") {
      this.config.ruvSwarm.enabled = ruvSwarmEnabled === "true";
    }
    const ruvSwarmTopology = process.env.CLAUDE_FLOW_RUV_SWARM_TOPOLOGY;
    if (ruvSwarmTopology === "mesh" || ruvSwarmTopology === "hierarchical" || ruvSwarmTopology === "ring" || ruvSwarmTopology === "star") {
      this.config.ruvSwarm.defaultTopology = ruvSwarmTopology;
    }
    const ruvSwarmMaxAgents = process.env.CLAUDE_FLOW_RUV_SWARM_MAX_AGENTS;
    if (ruvSwarmMaxAgents) {
      this.config.ruvSwarm.maxAgents = parseInt(ruvSwarmMaxAgents, 10);
    }
    if (!this.config.claude) {
      this.config.claude = {};
    }
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (claudeApiKey) {
      this.config.claude.apiKey = claudeApiKey;
    }
    const claudeModel = process.env.CLAUDE_MODEL;
    if (claudeModel) {
      this.config.claude.model = claudeModel;
    }
    const claudeTemperature = process.env.CLAUDE_TEMPERATURE;
    if (claudeTemperature) {
      this.config.claude.temperature = parseFloat(claudeTemperature);
    }
    const claudeMaxTokens = process.env.CLAUDE_MAX_TOKENS;
    if (claudeMaxTokens) {
      this.config.claude.maxTokens = parseInt(claudeMaxTokens, 10);
    }
    const claudeTopP = process.env.CLAUDE_TOP_P;
    if (claudeTopP) {
      this.config.claude.topP = parseFloat(claudeTopP);
    }
    const claudeTopK = process.env.CLAUDE_TOP_K;
    if (claudeTopK) {
      this.config.claude.topK = parseInt(claudeTopK, 10);
    }
    const claudeSystemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;
    if (claudeSystemPrompt) {
      this.config.claude.systemPrompt = claudeSystemPrompt;
    }
  }
  /**
   * Deep clone helper
   */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  /**
   * Get ruv-swarm specific configuration
   */
  getRuvSwarmConfig() {
    return this.deepClone(this.config.ruvSwarm);
  }
  /**
   * Get available configuration templates
   */
  getAvailableTemplates() {
    return ["default", "development", "production", "testing"];
  }
  /**
   * Create a configuration template
   */
  createTemplate(name, config) {
    console.log(`Creating template: ${name}`, config);
  }
  /**
   * Get format parsers
   */
  getFormatParsers() {
    return {
      json: { extension: ".json", parse: JSON.parse, stringify: JSON.stringify },
      yaml: {
        extension: ".yaml",
        parse: (content) => content,
        stringify: (obj) => JSON.stringify(obj)
      }
    };
  }
  /**
   * Validate configuration file
   */
  validateFile(path2) {
    try {
      require("fs").readFileSync(path2, "utf8");
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Get path history
   */
  getPathHistory() {
    return [];
  }
  /**
   * Get change history
   */
  getChangeHistory() {
    return [];
  }
  /**
   * Backup configuration
   */
  async backup(path2) {
    const backupPath = `${path2}.backup.${Date.now()}`;
    const content = JSON.stringify(this.config, null, 2);
    await import_fs.promises.writeFile(backupPath, content, "utf8");
    console.log(`Configuration backed up to: ${backupPath}`);
  }
  /**
   * Restore configuration from backup
   */
  async restore(path2) {
    const content = await import_fs.promises.readFile(path2, "utf8");
    this.config = JSON.parse(content);
    console.log(`Configuration restored from: ${path2}`);
  }
  /**
   * Update ruv-swarm configuration
   */
  setRuvSwarmConfig(updates) {
    this.config.ruvSwarm = { ...this.config.ruvSwarm, ...updates };
    this.validate(this.config);
  }
  /**
   * Check if ruv-swarm is enabled
   */
  isRuvSwarmEnabled() {
    return this.config.ruvSwarm.enabled;
  }
  /**
   * Generate ruv-swarm command arguments from configuration
   */
  getRuvSwarmArgs() {
    const args = [];
    const config = this.config.ruvSwarm;
    if (!config.enabled) {
      return args;
    }
    args.push("--topology", config.defaultTopology);
    args.push("--max-agents", String(config.maxAgents));
    args.push("--strategy", config.defaultStrategy);
    if (config.enableHooks) {
      args.push("--enable-hooks");
    }
    if (config.enablePersistence) {
      args.push("--enable-persistence");
    }
    if (config.enableNeuralTraining) {
      args.push("--enable-training");
    }
    if (config.configPath) {
      args.push("--config-path", config.configPath);
    }
    return args;
  }
  /**
   * Get Claude API configuration
   */
  getClaudeConfig() {
    return this.deepClone(this.config.claude || {});
  }
  /**
   * Update Claude API configuration
   */
  setClaudeConfig(updates) {
    if (!this.config.claude) {
      this.config.claude = {};
    }
    this.config.claude = { ...this.config.claude, ...updates };
    this.validate(this.config);
  }
  /**
   * Check if Claude API is configured
   */
  isClaudeAPIConfigured() {
    return !!(this.config.claude?.apiKey || process.env.ANTHROPIC_API_KEY);
  }
  /**
   * Deep merge helper
   */
  deepMerge(target, source) {
    const result = this.deepClone(target);
    if (source.orchestrator) {
      result.orchestrator = { ...result.orchestrator, ...source.orchestrator };
    }
    if (source.terminal) {
      result.terminal = { ...result.terminal, ...source.terminal };
    }
    if (source.memory) {
      result.memory = { ...result.memory, ...source.memory };
    }
    if (source.coordination) {
      result.coordination = { ...result.coordination, ...source.coordination };
    }
    if (source.mcp) {
      result.mcp = { ...result.mcp, ...source.mcp };
    }
    if (source.logging) {
      result.logging = { ...result.logging, ...source.logging };
    }
    if (source.ruvSwarm) {
      result.ruvSwarm = { ...result.ruvSwarm, ...source.ruvSwarm };
    }
    if (source.claude) {
      result.claude = { ...result.claude, ...source.claude };
    }
    return result;
  }
}
const configManager = ConfigManager.getInstance();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConfigError,
  ConfigManager,
  configManager
});
//# sourceMappingURL=config-manager.js.map
