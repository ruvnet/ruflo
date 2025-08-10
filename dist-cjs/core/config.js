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
var config_exports = {};
__export(config_exports, {
  ConfigManager: () => ConfigManager,
  SECURITY_CLASSIFICATIONS: () => SECURITY_CLASSIFICATIONS,
  SENSITIVE_PATHS: () => SENSITIVE_PATHS,
  configManager: () => configManager,
  loadConfig: () => loadConfig
});
module.exports = __toCommonJS(config_exports);
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var import_crypto = require("crypto");
var import_helpers = require("../utils/helpers.js");
var import_errors = require("../utils/errors.js");
const SECURITY_CLASSIFICATIONS = {
  credentials: { level: "secret", encrypted: true },
  "credentials.apiKey": { level: "secret", maskPattern: "****...****", encrypted: true },
  "credentials.token": { level: "secret", maskPattern: "****...****", encrypted: true },
  "credentials.password": { level: "secret", maskPattern: "********", encrypted: true },
  "mcp.apiKey": { level: "confidential", maskPattern: "****...****" },
  "logging.destination": { level: "internal" },
  orchestrator: { level: "internal" },
  terminal: { level: "public" }
};
const SENSITIVE_PATHS = ["credentials", "apiKey", "token", "password", "secret", "key", "auth"];
const FORMAT_PARSERS = {
  json: {
    parse: JSON.parse,
    stringify: (obj) => JSON.stringify(obj, null, 2),
    extension: ".json"
  },
  yaml: {
    parse: (content) => {
      const lines = content.split("\n");
      const result = {};
      let current = result;
      const stack = [result];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
          continue;
        const indent = line.length - line.trimStart().length;
        const colonIndex = trimmed.indexOf(":");
        if (colonIndex === -1)
          continue;
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        let parsedValue = value;
        if (value === "true")
          parsedValue = true;
        else if (value === "false")
          parsedValue = false;
        else if (!isNaN(Number(value)) && value !== "")
          parsedValue = Number(value);
        else if (value.startsWith('"') && value.endsWith('"')) {
          parsedValue = value.slice(1, -1);
        }
        current[key] = parsedValue;
      }
      return result;
    },
    stringify: (obj) => {
      const stringify = /* @__PURE__ */ __name((obj2, indent = 0) => {
        const spaces = "  ".repeat(indent);
        let result = "";
        for (const [key, value] of Object.entries(obj2)) {
          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            result += `${spaces}${key}:
${stringify(value, indent + 1)}`;
          } else {
            const formattedValue = typeof value === "string" ? `"${value}"` : String(value);
            result += `${spaces}${key}: ${formattedValue}
`;
          }
        }
        return result;
      }, "stringify");
      return stringify(obj);
    },
    extension: ".yaml"
  },
  toml: {
    parse: (content) => {
      const lines = content.split("\n");
      const result = {};
      let currentSection = result;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
          continue;
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          const sectionName = trimmed.slice(1, -1);
          currentSection = result[sectionName] = {};
          continue;
        }
        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex === -1)
          continue;
        const key = trimmed.substring(0, equalsIndex).trim();
        const value = trimmed.substring(equalsIndex + 1).trim();
        let parsedValue = value;
        if (value === "true")
          parsedValue = true;
        else if (value === "false")
          parsedValue = false;
        else if (!isNaN(Number(value)) && value !== "")
          parsedValue = Number(value);
        else if (value.startsWith('"') && value.endsWith('"')) {
          parsedValue = value.slice(1, -1);
        }
        currentSection[key] = parsedValue;
      }
      return result;
    },
    stringify: (obj) => {
      let result = "";
      for (const [section, values] of Object.entries(obj)) {
        if (typeof values === "object" && values !== null && !Array.isArray(values)) {
          result += `[${section}]
`;
          for (const [key, value] of Object.entries(values)) {
            const formattedValue = typeof value === "string" ? `"${value}"` : String(value);
            result += `${key} = ${formattedValue}
`;
          }
          result += "\n";
        }
      }
      return result;
    },
    extension: ".toml"
  }
};
const DEFAULT_CONFIG = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100,
    healthCheckInterval: 3e4,
    // 30 seconds
    shutdownTimeout: 3e4
    // 30 seconds
  },
  terminal: {
    type: "auto",
    poolSize: 5,
    recycleAfter: 10,
    // recycle after 10 uses
    healthCheckInterval: 6e4,
    // 1 minute
    commandTimeout: 3e5
    // 5 minutes
  },
  memory: {
    backend: "hybrid",
    cacheSizeMB: 100,
    syncInterval: 5e3,
    // 5 seconds
    conflictResolution: "crdt",
    retentionDays: 30
  },
  coordination: {
    maxRetries: 3,
    retryDelay: 1e3,
    // 1 second
    deadlockDetection: true,
    resourceTimeout: 6e4,
    // 1 minute
    messageTimeout: 3e4
    // 30 seconds
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
  credentials: {
    // Encrypted credentials storage
  },
  security: {
    encryptionEnabled: true,
    auditLogging: true,
    maskSensitiveValues: true,
    allowEnvironmentOverrides: true
  }
};
class ConfigManager {
  static {
    __name(this, "ConfigManager");
  }
  static instance;
  config;
  configPath;
  profiles = /* @__PURE__ */ new Map();
  currentProfile;
  userConfigDir;
  changeHistory = [];
  encryptionKey;
  validationRules = /* @__PURE__ */ new Map();
  formatParsers = FORMAT_PARSERS;
  constructor() {
    this.config = deepClone(DEFAULT_CONFIG);
    this.userConfigDir = this.getUserConfigDir();
    this.setupValidationRules();
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
   * Initialize async components
   */
  async init() {
    await this.initializeEncryption();
  }
  /**
   * Initializes encryption for sensitive configuration values
   */
  async initializeEncryption() {
    try {
      const keyFile = (0, import_path.join)(this.userConfigDir, ".encryption-key");
      try {
        await import_fs.promises.access(keyFile);
        this.encryptionKey = (0, import_crypto.randomBytes)(32);
      } catch {
        this.encryptionKey = (0, import_crypto.randomBytes)(32);
      }
    } catch (error) {
      console.warn("Failed to initialize encryption:", error.message);
    }
  }
  /**
   * Sets up validation rules for configuration paths
   */
  setupValidationRules() {
    this.validationRules.set("orchestrator.maxConcurrentAgents", {
      type: "number",
      required: true,
      min: 1,
      max: 100,
      validator: (value, config) => {
        if (value > config.terminal?.poolSize * 2) {
          return "maxConcurrentAgents should not exceed 2x terminal pool size";
        }
        return null;
      }
    });
    this.validationRules.set("orchestrator.taskQueueSize", {
      type: "number",
      required: true,
      min: 1,
      max: 1e4,
      dependencies: ["orchestrator.maxConcurrentAgents"],
      validator: (value, config) => {
        const maxAgents = config.orchestrator?.maxConcurrentAgents || 1;
        if (value < maxAgents * 10) {
          return "taskQueueSize should be at least 10x maxConcurrentAgents";
        }
        return null;
      }
    });
    this.validationRules.set("terminal.type", {
      type: "string",
      required: true,
      values: ["auto", "vscode", "native"]
    });
    this.validationRules.set("terminal.poolSize", {
      type: "number",
      required: true,
      min: 1,
      max: 50
    });
    this.validationRules.set("memory.backend", {
      type: "string",
      required: true,
      values: ["sqlite", "markdown", "hybrid"]
    });
    this.validationRules.set("memory.cacheSizeMB", {
      type: "number",
      required: true,
      min: 1,
      max: 1e4,
      validator: (value) => {
        if (value > 1e3) {
          return "Large cache sizes may impact system performance";
        }
        return null;
      }
    });
    this.validationRules.set("security.encryptionEnabled", {
      type: "boolean",
      required: true
    });
    this.validationRules.set("credentials.apiKey", {
      type: "string",
      pattern: /^[a-zA-Z0-9_-]+$/,
      validator: (value) => {
        if (value && value.length < 16) {
          return "API key should be at least 16 characters long";
        }
        return null;
      }
    });
  }
  /**
   * Loads configuration from various sources
   */
  async load(configPath) {
    if (configPath !== void 0) {
      this.configPath = configPath;
    }
    let config = deepClone(DEFAULT_CONFIG);
    if (configPath) {
      const fileConfig = await this.loadFromFile(configPath);
      config = deepMergeConfig(config, fileConfig);
    }
    const envConfig = this.loadFromEnv();
    config = deepMergeConfig(config, envConfig);
    this.validate(config);
    this.config = config;
    return config;
  }
  /**
   * Gets the current configuration with optional security masking
   */
  get(maskSensitive = false) {
    const config = deepClone(this.config);
    if (maskSensitive && this.config.security?.maskSensitiveValues) {
      return this.maskSensitiveValues(config);
    }
    return config;
  }
  /**
   * Gets configuration with security masking applied
   */
  getSecure() {
    return this.get(true);
  }
  /**
   * Gets all configuration values (alias for get method for backward compatibility)
   */
  async getAll() {
    return this.get();
  }
  /**
   * Updates configuration values with change tracking
   */
  update(updates, options = {}) {
    const oldConfig = deepClone(this.config);
    this.trackChanges(oldConfig, updates, options);
    this.config = deepMergeConfig(this.config, updates);
    this.validateWithDependencies(this.config);
    return this.get();
  }
  /**
   * Loads default configuration
   */
  loadDefault() {
    this.config = deepClone(DEFAULT_CONFIG);
  }
  /**
   * Saves configuration to file with format support
   */
  async save(path, format) {
    const savePath = path || this.configPath;
    if (!savePath) {
      throw new import_errors.ConfigError("No configuration file path specified");
    }
    const detectedFormat = format || this.detectFormat(savePath);
    const parser = this.formatParsers[detectedFormat];
    if (!parser) {
      throw new import_errors.ConfigError(`Unsupported format for saving: ${detectedFormat}`);
    }
    const configToSave = this.getConfigForSaving();
    const content = parser.stringify(configToSave);
    await import_fs.promises.writeFile(savePath, content, "utf8");
    this.recordChange({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      path: "CONFIG_SAVED",
      oldValue: null,
      newValue: savePath,
      source: "file"
    });
  }
  /**
   * Gets configuration suitable for saving (excludes runtime-only values)
   */
  getConfigForSaving() {
    const config = deepClone(this.config);
    if (config.credentials) {
      delete config.credentials;
    }
    return config;
  }
  /**
   * Gets user configuration directory
   */
  getUserConfigDir() {
    const home = (0, import_os.homedir)();
    return (0, import_path.join)(home, ".claude-flow");
  }
  /**
   * Creates user config directory if it doesn't exist
   */
  async ensureUserConfigDir() {
    try {
      await import_fs.promises.mkdir(this.userConfigDir, { recursive: true });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new import_errors.ConfigError(`Failed to create config directory: ${error.message}`);
      }
    }
  }
  /**
   * Loads all profiles from the profiles directory
   */
  async loadProfiles() {
    const profilesDir = (0, import_path.join)(this.userConfigDir, "profiles");
    try {
      const entries = await import_fs.promises.readdir(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          const profileName = entry.name.replace(".json", "");
          const profilePath = (0, import_path.join)(profilesDir, entry.name);
          try {
            const content = await import_fs.promises.readFile(profilePath, "utf8");
            const profileConfig = (0, import_helpers.safeParseJSON)(content);
            if (profileConfig) {
              this.profiles.set(profileName, profileConfig);
            }
          } catch (error) {
            console.warn(`Failed to load profile ${profileName}: ${error.message}`);
          }
        }
      }
    } catch (error) {
    }
  }
  /**
   * Applies a named profile
   */
  async applyProfile(profileName) {
    await this.loadProfiles();
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new import_errors.ConfigError(`Profile '${profileName}' not found`);
    }
    this.config = deepMergeConfig(this.config, profile);
    this.currentProfile = profileName;
    this.validate(this.config);
  }
  /**
   * Saves current configuration as a profile
   */
  async saveProfile(profileName, config) {
    await this.ensureUserConfigDir();
    const profilesDir = (0, import_path.join)(this.userConfigDir, "profiles");
    await import_fs.promises.mkdir(profilesDir, { recursive: true });
    const profileConfig = config || this.config;
    const profilePath = (0, import_path.join)(profilesDir, `${profileName}.json`);
    const content = JSON.stringify(profileConfig, null, 2);
    await import_fs.promises.writeFile(profilePath, content, "utf8");
    this.profiles.set(profileName, profileConfig);
  }
  /**
   * Deletes a profile
   */
  async deleteProfile(profileName) {
    const profilePath = (0, import_path.join)(this.userConfigDir, "profiles", `${profileName}.json`);
    try {
      await import_fs.promises.unlink(profilePath);
      this.profiles.delete(profileName);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new import_errors.ConfigError(`Profile '${profileName}' not found`);
      }
      throw new import_errors.ConfigError(`Failed to delete profile: ${error.message}`);
    }
  }
  /**
   * Lists all available profiles
   */
  async listProfiles() {
    await this.loadProfiles();
    return Array.from(this.profiles.keys());
  }
  /**
   * Gets a specific profile configuration
   */
  async getProfile(profileName) {
    await this.loadProfiles();
    return this.profiles.get(profileName);
  }
  /**
   * Gets the current active profile name
   */
  getCurrentProfile() {
    return this.currentProfile;
  }
  /**
   * Sets a configuration value by path with change tracking and validation
   */
  set(path, value, options = {}) {
    const oldValue = this.getValue(path);
    this.recordChange({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      path,
      oldValue,
      newValue: value,
      user: options.user,
      reason: options.reason,
      source: options.source || "cli"
    });
    if (this.isSensitivePath(path) && this.config.security?.encryptionEnabled) {
      value = this.encryptValue(value);
    }
    const keys = path.split(".");
    let current = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    this.validatePath(path, value);
    this.validateWithDependencies(this.config);
  }
  /**
   * Gets a configuration value by path with decryption for sensitive values
   */
  getValue(path, decrypt = true) {
    const keys = path.split(".");
    let current = this.config;
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        return void 0;
      }
    }
    if (decrypt && this.isSensitivePath(path) && this.isEncryptedValue(current)) {
      try {
        return this.decryptValue(current);
      } catch (error) {
        console.warn(`Failed to decrypt value at path ${path}:`, error.message);
        return current;
      }
    }
    return current;
  }
  /**
   * Resets configuration to defaults
   */
  reset() {
    this.config = deepClone(DEFAULT_CONFIG);
    delete this.currentProfile;
  }
  /**
   * Gets configuration schema for validation
   */
  getSchema() {
    return {
      orchestrator: {
        maxConcurrentAgents: { type: "number", min: 1, max: 100 },
        taskQueueSize: { type: "number", min: 1, max: 1e4 },
        healthCheckInterval: { type: "number", min: 1e3, max: 3e5 },
        shutdownTimeout: { type: "number", min: 1e3, max: 3e5 }
      },
      terminal: {
        type: { type: "string", values: ["auto", "vscode", "native"] },
        poolSize: { type: "number", min: 1, max: 50 },
        recycleAfter: { type: "number", min: 1, max: 1e3 },
        healthCheckInterval: { type: "number", min: 1e3, max: 36e5 },
        commandTimeout: { type: "number", min: 1e3, max: 36e5 }
      },
      memory: {
        backend: { type: "string", values: ["sqlite", "markdown", "hybrid"] },
        cacheSizeMB: { type: "number", min: 1, max: 1e4 },
        syncInterval: { type: "number", min: 1e3, max: 3e5 },
        conflictResolution: { type: "string", values: ["crdt", "timestamp", "manual"] },
        retentionDays: { type: "number", min: 1, max: 3650 }
      },
      coordination: {
        maxRetries: { type: "number", min: 0, max: 100 },
        retryDelay: { type: "number", min: 100, max: 6e4 },
        deadlockDetection: { type: "boolean" },
        resourceTimeout: { type: "number", min: 1e3, max: 36e5 },
        messageTimeout: { type: "number", min: 1e3, max: 3e5 }
      },
      mcp: {
        transport: { type: "string", values: ["stdio", "http", "websocket"] },
        port: { type: "number", min: 1, max: 65535 },
        tlsEnabled: { type: "boolean" }
      },
      logging: {
        level: { type: "string", values: ["debug", "info", "warn", "error"] },
        format: { type: "string", values: ["json", "text"] },
        destination: { type: "string", values: ["console", "file"] }
      }
    };
  }
  /**
   * Validates a value against schema
   */
  validateValue(value, schema, path) {
    if (schema.type === "number") {
      if (typeof value !== "number" || isNaN(value)) {
        throw new import_errors.ValidationError(`${path}: must be a number`);
      }
      if (schema.min !== void 0 && value < schema.min) {
        throw new import_errors.ValidationError(`${path}: must be at least ${schema.min}`);
      }
      if (schema.max !== void 0 && value > schema.max) {
        throw new import_errors.ValidationError(`${path}: must be at most ${schema.max}`);
      }
    } else if (schema.type === "string") {
      if (typeof value !== "string") {
        throw new import_errors.ValidationError(`${path}: must be a string`);
      }
      if (schema.values && !schema.values.includes(value)) {
        throw new import_errors.ValidationError(`${path}: must be one of [${schema.values.join(", ")}]`);
      }
    } else if (schema.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new import_errors.ValidationError(`${path}: must be a boolean`);
      }
    }
  }
  /**
   * Gets configuration diff between current and default
   */
  getDiff() {
    const defaultConfig = DEFAULT_CONFIG;
    const diff = {};
    const findDifferences = /* @__PURE__ */ __name((current, defaults, path = "") => {
      for (const key in current) {
        const currentValue = current[key];
        const defaultValue = defaults[key];
        const fullPath = path ? `${path}.${key}` : key;
        if (typeof currentValue === "object" && currentValue !== null && !Array.isArray(currentValue)) {
          if (typeof defaultValue === "object" && defaultValue !== null) {
            const nestedDiff = {};
            findDifferences(currentValue, defaultValue, fullPath);
            if (Object.keys(nestedDiff).length > 0) {
              if (!path) {
                diff[key] = nestedDiff;
              }
            }
          }
        } else if (currentValue !== defaultValue) {
          const pathParts = fullPath.split(".");
          let target = diff;
          for (let i = 0; i < pathParts.length - 1; i++) {
            if (!target[pathParts[i]]) {
              target[pathParts[i]] = {};
            }
            target = target[pathParts[i]];
          }
          target[pathParts[pathParts.length - 1]] = currentValue;
        }
      }
    }, "findDifferences");
    findDifferences(this.config, defaultConfig);
    return diff;
  }
  /**
   * Exports configuration with metadata
   */
  export() {
    return {
      version: "1.0.0",
      exported: (/* @__PURE__ */ new Date()).toISOString(),
      profile: this.currentProfile,
      config: this.config,
      diff: this.getDiff()
    };
  }
  /**
   * Imports configuration from export
   */
  import(data) {
    if (!data.config) {
      throw new import_errors.ConfigError("Invalid configuration export format");
    }
    this.validateWithDependencies(data.config);
    this.config = data.config;
    this.currentProfile = data.profile;
    this.recordChange({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      path: "CONFIG_IMPORTED",
      oldValue: null,
      newValue: data.version || "unknown",
      source: "file"
    });
  }
  /**
   * Loads configuration from file with format detection
   */
  async loadFromFile(path) {
    try {
      const content = await import_fs.promises.readFile(path, "utf8");
      const format = this.detectFormat(path, content);
      const parser = this.formatParsers[format];
      if (!parser) {
        throw new import_errors.ConfigError(`Unsupported configuration format: ${format}`);
      }
      const config = parser.parse(content);
      if (!config) {
        throw new import_errors.ConfigError(`Invalid ${format.toUpperCase()} in configuration file: ${path}`);
      }
      return config;
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw new import_errors.ConfigError(
        `Failed to load configuration from ${path}: ${error.message}`
      );
    }
  }
  /**
   * Detects configuration file format
   */
  detectFormat(path, content) {
    const ext = path.split(".").pop()?.toLowerCase();
    if (ext === "yaml" || ext === "yml")
      return "yaml";
    if (ext === "toml")
      return "toml";
    if (ext === "json")
      return "json";
    if (content) {
      const trimmed = content.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("["))
        return "json";
      if (trimmed.includes("=") && trimmed.includes("["))
        return "toml";
      if (trimmed.includes(":") && !trimmed.includes("="))
        return "yaml";
    }
    return "json";
  }
  /**
   * Loads configuration from environment variables
   */
  loadFromEnv() {
    const config = {};
    const maxAgents = process.env.CLAUDE_FLOW_MAX_AGENTS;
    if (maxAgents) {
      if (!config.orchestrator) {
        config.orchestrator = {};
      }
      config.orchestrator = {
        ...DEFAULT_CONFIG.orchestrator,
        ...config.orchestrator,
        maxConcurrentAgents: parseInt(maxAgents, 10)
      };
    }
    const terminalType = process.env.CLAUDE_FLOW_TERMINAL_TYPE;
    if (terminalType === "vscode" || terminalType === "native" || terminalType === "auto") {
      config.terminal = {
        ...DEFAULT_CONFIG.terminal,
        ...config.terminal,
        type: terminalType
      };
    }
    const memoryBackend = process.env.CLAUDE_FLOW_MEMORY_BACKEND;
    if (memoryBackend === "sqlite" || memoryBackend === "markdown" || memoryBackend === "hybrid") {
      config.memory = {
        ...DEFAULT_CONFIG.memory,
        ...config.memory,
        backend: memoryBackend
      };
    }
    const mcpTransport = process.env.CLAUDE_FLOW_MCP_TRANSPORT;
    if (mcpTransport === "stdio" || mcpTransport === "http" || mcpTransport === "websocket") {
      config.mcp = {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        transport: mcpTransport
      };
    }
    const mcpPort = process.env.CLAUDE_FLOW_MCP_PORT;
    if (mcpPort) {
      config.mcp = {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        port: parseInt(mcpPort, 10)
      };
    }
    const logLevel = process.env.CLAUDE_FLOW_LOG_LEVEL;
    if (logLevel === "debug" || logLevel === "info" || logLevel === "warn" || logLevel === "error") {
      config.logging = {
        ...DEFAULT_CONFIG.logging,
        ...config.logging,
        level: logLevel
      };
    }
    return config;
  }
  /**
   * Validates configuration with dependency checking
   */
  validateWithDependencies(config) {
    const errors = [];
    const warnings = [];
    for (const [path, rule] of this.validationRules.entries()) {
      const value = this.getValueByPath(config, path);
      try {
        this.validatePath(path, value, config);
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (config.orchestrator.maxConcurrentAgents > config.terminal.poolSize * 3) {
      warnings.push("High agent-to-terminal ratio may cause resource contention");
    }
    if (config.memory.cacheSizeMB > 1e3 && config.memory.backend === "sqlite") {
      warnings.push("Large cache size with SQLite backend may impact performance");
    }
    if (config.mcp.transport === "http" && !config.mcp.tlsEnabled) {
      warnings.push("HTTP transport without TLS is not recommended for production");
    }
    if (warnings.length > 0 && config.logging?.level === "debug") {
      console.warn("Configuration warnings:", warnings);
    }
    if (errors.length > 0) {
      throw new import_errors.ValidationError(`Configuration validation failed:
${errors.join("\n")}`);
    }
  }
  /**
   * Validates a specific configuration path
   */
  validatePath(path, value, config) {
    const rule = this.validationRules.get(path);
    if (!rule)
      return;
    const currentConfig = config || this.config;
    if (rule.required && (value === void 0 || value === null)) {
      throw new import_errors.ValidationError(`${path} is required`);
    }
    if (value === void 0 || value === null)
      return;
    if (rule.type === "number" && (typeof value !== "number" || isNaN(value))) {
      throw new import_errors.ValidationError(`${path} must be a number`);
    }
    if (rule.type === "string" && typeof value !== "string") {
      throw new import_errors.ValidationError(`${path} must be a string`);
    }
    if (rule.type === "boolean" && typeof value !== "boolean") {
      throw new import_errors.ValidationError(`${path} must be a boolean`);
    }
    if (typeof value === "number") {
      if (rule.min !== void 0 && value < rule.min) {
        throw new import_errors.ValidationError(`${path} must be at least ${rule.min}`);
      }
      if (rule.max !== void 0 && value > rule.max) {
        throw new import_errors.ValidationError(`${path} must be at most ${rule.max}`);
      }
    }
    if (rule.values && !rule.values.includes(value)) {
      throw new import_errors.ValidationError(`${path} must be one of: ${rule.values.join(", ")}`);
    }
    if (rule.pattern && typeof value === "string" && !rule.pattern.test(value)) {
      throw new import_errors.ValidationError(`${path} does not match required pattern`);
    }
    if (rule.validator) {
      const result = rule.validator(value, currentConfig);
      if (result) {
        throw new import_errors.ValidationError(`${path}: ${result}`);
      }
    }
  }
  /**
   * Gets a value from a configuration object by path
   */
  getValueByPath(obj, path) {
    const keys = path.split(".");
    let current = obj;
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
   * Legacy validate method for backward compatibility
   */
  validate(config) {
    this.validateWithDependencies(config);
  }
  /**
   * Masks sensitive values in configuration
   */
  maskSensitiveValues(config) {
    const maskedConfig = deepClone(config);
    const maskObject = /* @__PURE__ */ __name((obj, path = "") => {
      if (!obj || typeof obj !== "object")
        return obj;
      const masked = {};
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (this.isSensitivePath(currentPath)) {
          const classification = SECURITY_CLASSIFICATIONS[currentPath];
          masked[key] = classification?.maskPattern || "****";
        } else if (typeof value === "object" && value !== null) {
          masked[key] = maskObject(value, currentPath);
        } else {
          masked[key] = value;
        }
      }
      return masked;
    }, "maskObject");
    return maskObject(maskedConfig);
  }
  /**
   * Tracks changes to configuration
   */
  trackChanges(oldConfig, updates, options) {
    for (const [key, value] of Object.entries(updates)) {
      this.recordChange({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        path: key,
        oldValue: oldConfig[key],
        newValue: value,
        user: options.user,
        reason: options.reason,
        source: options.source || "cli"
      });
    }
  }
  /**
   * Records a configuration change
   */
  recordChange(change) {
    this.changeHistory.push(change);
    if (this.changeHistory.length > 1e3) {
      this.changeHistory.shift();
    }
  }
  /**
   * Checks if a path contains sensitive information
   */
  isSensitivePath(path) {
    return SENSITIVE_PATHS.some(
      (sensitive) => path.toLowerCase().includes(sensitive.toLowerCase())
    );
  }
  /**
   * Encrypts a sensitive value
   */
  encryptValue(value) {
    if (!this.encryptionKey) {
      return value;
    }
    try {
      const iv = (0, import_crypto.randomBytes)(16);
      const key = (0, import_crypto.createHash)("sha256").update(this.encryptionKey).digest();
      const cipher = (0, import_crypto.createCipheriv)("aes-256-cbc", key, iv);
      let encrypted = cipher.update(JSON.stringify(value), "utf8", "hex");
      encrypted += cipher.final("hex");
      return `encrypted:${iv.toString("hex")}:${encrypted}`;
    } catch (error) {
      console.warn("Failed to encrypt value:", error.message);
      return value;
    }
  }
  /**
   * Decrypts a sensitive value
   */
  decryptValue(encryptedValue) {
    if (!this.encryptionKey || !this.isEncryptedValue(encryptedValue)) {
      return encryptedValue;
    }
    try {
      const parts = encryptedValue.replace("encrypted:", "").split(":");
      if (parts.length !== 2)
        return encryptedValue;
      const iv = Buffer.from(parts[0], "hex");
      const encrypted = parts[1];
      const key = (0, import_crypto.createHash)("sha256").update(this.encryptionKey).digest();
      const decipher = (0, import_crypto.createDecipheriv)("aes-256-cbc", key, iv);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return JSON.parse(decrypted);
    } catch (error) {
      console.warn("Failed to decrypt value:", error.message);
      return encryptedValue;
    }
  }
  /**
   * Checks if a value is encrypted
   */
  isEncryptedValue(value) {
    return typeof value === "string" && value.startsWith("encrypted:");
  }
}
const configManager = ConfigManager.getInstance();
async function loadConfig(path) {
  return await configManager.load(path);
}
__name(loadConfig, "loadConfig");
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
__name(deepClone, "deepClone");
function deepMergeConfig(target, ...sources) {
  const result = deepClone(target);
  for (const source of sources) {
    if (!source)
      continue;
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
    if (source.credentials) {
      result.credentials = { ...result.credentials, ...source.credentials };
    }
    if (source.security) {
      result.security = { ...result.security, ...source.security };
    }
  }
  return result;
}
__name(deepMergeConfig, "deepMergeConfig");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConfigManager,
  SECURITY_CLASSIFICATIONS,
  SENSITIVE_PATHS,
  configManager,
  loadConfig
});
//# sourceMappingURL=config.js.map
