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
var prompt_defaults_exports = {};
__export(prompt_defaults_exports, {
  PromptDefaultsManager: () => PromptDefaultsManager,
  applyNonInteractiveDefaults: () => applyNonInteractiveDefaults,
  getPromptDefault: () => getPromptDefault,
  getPromptDefaultsManager: () => getPromptDefaultsManager
});
module.exports = __toCommonJS(prompt_defaults_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
class PromptDefaultsManager {
  static {
    __name(this, "PromptDefaultsManager");
  }
  config = {};
  configPath;
  environmentDefaults = /* @__PURE__ */ new Map();
  constructor(configPath) {
    this.configPath = configPath || (0, import_node_path.join)((0, import_node_os.homedir)(), ".claude-flow", "prompt-defaults.json");
    this.loadConfig();
    this.loadEnvironmentDefaults();
  }
  /**
   * Load configuration from file
   */
  loadConfig() {
    try {
      if ((0, import_node_fs.existsSync)(this.configPath)) {
        const content = (0, import_node_fs.readFileSync)(this.configPath, "utf-8");
        this.config = JSON.parse(content);
      }
    } catch (error) {
      this.config = {};
    }
  }
  /**
   * Save configuration to file
   */
  saveConfig() {
    try {
      const dir = (0, import_node_path.join)(this.configPath, "..");
      if (!(0, import_node_fs.existsSync)(dir)) {
        require("fs").mkdirSync(dir, { recursive: true });
      }
      (0, import_node_fs.writeFileSync)(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
    }
  }
  /**
   * Load defaults from environment variables
   */
  loadEnvironmentDefaults() {
    const env = process.env;
    if (env.CLAUDE_AUTO_APPROVE === "1" || env.CLAUDE_AUTO_APPROVE === "true") {
      this.environmentDefaults.set("confirm:*", true);
    }
    if (env.CLAUDE_DEFAULT_MODEL) {
      this.environmentDefaults.set("select:model", env.CLAUDE_DEFAULT_MODEL);
    }
    if (env.CLAUDE_DEFAULT_REGION) {
      this.environmentDefaults.set("select:region", env.CLAUDE_DEFAULT_REGION);
    }
    if (env.CLAUDE_PROMPT_DEFAULTS) {
      try {
        const defaults = JSON.parse(env.CLAUDE_PROMPT_DEFAULTS);
        Object.entries(defaults).forEach(([key, value]) => {
          this.environmentDefaults.set(key, value);
        });
      } catch (error) {
      }
    }
  }
  /**
   * Get default value for a prompt
   */
  getDefault(promptId, command, promptType) {
    const envKey = `${promptType || "text"}:${promptId}`;
    if (this.environmentDefaults.has(envKey)) {
      return this.environmentDefaults.get(envKey);
    }
    const wildcardKey = `${promptType || "text"}:*`;
    if (this.environmentDefaults.has(wildcardKey)) {
      return this.environmentDefaults.get(wildcardKey);
    }
    if (command && this.config.command?.[command]) {
      const commandDefault = this.config.command[command].find(
        (d) => d.id === promptId || d.pattern && this.matchPattern(promptId, d.pattern)
      );
      if (commandDefault) {
        return commandDefault.defaultValue;
      }
    }
    const currentEnv = "development";
    if (this.config.environment?.[currentEnv]) {
      const envDefault = this.config.environment[currentEnv].find(
        (d) => d.id === promptId || d.pattern && this.matchPattern(promptId, d.pattern)
      );
      if (envDefault) {
        return envDefault.defaultValue;
      }
    }
    if (this.config.global) {
      const globalDefault = this.config.global.find(
        (d) => d.id === promptId || d.pattern && this.matchPattern(promptId, d.pattern)
      );
      if (globalDefault) {
        return globalDefault.defaultValue;
      }
    }
    return void 0;
  }
  /**
   * Set a default value
   */
  setDefault(promptId, defaultValue, options = {}) {
    const defaultEntry = {
      id: promptId,
      type: options.type || "text",
      defaultValue,
      description: options.description,
      pattern: options.pattern
    };
    const scope = options.scope || "global";
    if (scope === "command" && options.command) {
      if (!this.config.command) {
        this.config.command = {};
      }
      if (!this.config.command[options.command]) {
        this.config.command[options.command] = [];
      }
      this.config.command[options.command].push(defaultEntry);
    } else if (scope === "environment") {
      const currentEnv = "development";
      if (!this.config.environment) {
        this.config.environment = {};
      }
      if (!this.config.environment[currentEnv]) {
        this.config.environment[currentEnv] = [];
      }
      this.config.environment[currentEnv].push(defaultEntry);
    } else {
      if (!this.config.global) {
        this.config.global = [];
      }
      this.config.global.push(defaultEntry);
    }
    this.saveConfig();
  }
  /**
   * Get common defaults for non-interactive mode
   */
  getNonInteractiveDefaults() {
    return {
      // Confirmation prompts
      "confirm:continue": true,
      "confirm:overwrite": true,
      "confirm:delete": false,
      // Safety: don't auto-confirm deletes
      "confirm:deploy": false,
      // Safety: don't auto-confirm deploys
      // Selection prompts
      "select:model": "claude-3-opus-20240229",
      "select:region": "us-east-1",
      "select:topology": "hierarchical",
      "select:strategy": "auto",
      // Text prompts
      "text:projectName": "claude-flow-project",
      "text:description": "Claude Flow AI Project",
      // Number prompts
      "number:maxAgents": 4,
      "number:timeout": 3e4,
      "number:port": 3e3
    };
  }
  /**
   * Apply non-interactive defaults if needed
   */
  applyNonInteractiveDefaults(isNonInteractive) {
    if (!isNonInteractive)
      return;
    const defaults = this.getNonInteractiveDefaults();
    Object.entries(defaults).forEach(([key, value]) => {
      if (!this.environmentDefaults.has(key)) {
        this.environmentDefaults.set(key, value);
      }
    });
  }
  /**
   * Match a pattern against a prompt ID
   */
  matchPattern(promptId, pattern) {
    if (typeof pattern === "string") {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(promptId);
    } else {
      return pattern.test(promptId);
    }
  }
  /**
   * Export current configuration
   */
  exportConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }
  /**
   * Import configuration
   */
  importConfig(config) {
    this.config = JSON.parse(JSON.stringify(config));
    this.saveConfig();
  }
  /**
   * Clear all defaults
   */
  clearDefaults(scope, target) {
    if (scope === "command" && target && this.config.command) {
      delete this.config.command[target];
    } else if (scope === "environment" && target && this.config.environment) {
      delete this.config.environment[target];
    } else if (scope === "global" || !scope) {
      this.config.global = [];
    }
    this.saveConfig();
  }
}
let instance = null;
function getPromptDefaultsManager(configPath) {
  if (!instance) {
    instance = new PromptDefaultsManager(configPath);
  }
  return instance;
}
__name(getPromptDefaultsManager, "getPromptDefaultsManager");
function getPromptDefault(promptId, command, promptType) {
  return getPromptDefaultsManager().getDefault(promptId, command, promptType);
}
__name(getPromptDefault, "getPromptDefault");
function applyNonInteractiveDefaults(flags) {
  const manager = getPromptDefaultsManager();
  const isNonInteractive = flags.nonInteractive || flags["non-interactive"] || flags.ci || !process.stdout.isTTY;
  manager.applyNonInteractiveDefaults(isNonInteractive);
}
__name(applyNonInteractiveDefaults, "applyNonInteractiveDefaults");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PromptDefaultsManager,
  applyNonInteractiveDefaults,
  getPromptDefault,
  getPromptDefaultsManager
});
//# sourceMappingURL=prompt-defaults.js.map
