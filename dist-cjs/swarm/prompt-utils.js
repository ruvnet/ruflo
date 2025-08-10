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
var prompt_utils_exports = {};
__export(prompt_utils_exports, {
  DEFAULT_CONFIG: () => DEFAULT_CONFIG,
  PromptConfigManager: () => PromptConfigManager,
  PromptPathResolver: () => PromptPathResolver,
  PromptValidator: () => PromptValidator,
  createProgressBar: () => createProgressBar,
  formatDuration: () => formatDuration,
  formatFileSize: () => formatFileSize
});
module.exports = __toCommonJS(prompt_utils_exports);
var fs = __toESM(require("fs/promises"), 1);
var path = __toESM(require("path"), 1);
var import_logger = require("../core/logger.js");
const DEFAULT_CONFIG = {
  sourceDirectories: [".roo", ".claude/commands", "src/templates", "templates"],
  destinationDirectory: "./project-prompts",
  defaultOptions: {
    backup: true,
    verify: true,
    parallel: true,
    maxWorkers: 4,
    conflictResolution: "backup",
    includePatterns: ["*.md", "*.txt", "*.prompt", "*.prompts", "*.json"],
    excludePatterns: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"]
  },
  profiles: {
    sparc: {
      includePatterns: ["*.md", "rules.md", "sparc-*.md"],
      excludePatterns: ["**/README.md", "**/CHANGELOG.md"]
    },
    templates: {
      includePatterns: ["*.template", "*.tmpl", "*.hbs", "*.mustache"],
      conflictResolution: "merge"
    },
    safe: {
      backup: true,
      verify: true,
      conflictResolution: "skip",
      parallel: false
    },
    fast: {
      backup: false,
      verify: false,
      parallel: true,
      maxWorkers: 8,
      conflictResolution: "overwrite"
    }
  }
};
class PromptConfigManager {
  static {
    __name(this, "PromptConfigManager");
  }
  configPath;
  config;
  constructor(configPath) {
    this.configPath = configPath || path.join(process.cwd(), ".prompt-config.json");
    this.config = { ...DEFAULT_CONFIG };
  }
  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, "utf-8");
      const userConfig = JSON.parse(configData);
      this.config = this.mergeConfig(DEFAULT_CONFIG, userConfig);
      import_logger.logger.info(`Loaded config from ${this.configPath}`);
    } catch (error) {
      import_logger.logger.info("Using default configuration");
    }
    return this.config;
  }
  async saveConfig(config) {
    if (config) {
      this.config = this.mergeConfig(this.config, config);
    }
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    import_logger.logger.info(`Saved config to ${this.configPath}`);
  }
  getConfig() {
    return this.config;
  }
  getProfile(profileName) {
    const profile = this.config.profiles[profileName];
    if (!profile) {
      throw new Error(`Profile '${profileName}' not found`);
    }
    return { ...this.config.defaultOptions, ...profile };
  }
  listProfiles() {
    return Object.keys(this.config.profiles);
  }
  mergeConfig(base, override) {
    return {
      ...base,
      ...override,
      defaultOptions: {
        ...base.defaultOptions,
        ...override.defaultOptions
      },
      profiles: {
        ...base.profiles,
        ...override.profiles
      }
    };
  }
}
class PromptPathResolver {
  static {
    __name(this, "PromptPathResolver");
  }
  basePath;
  constructor(basePath = process.cwd()) {
    this.basePath = basePath;
  }
  resolvePaths(sourceDirectories, destinationDirectory) {
    const sources = sourceDirectories.map((dir) => path.resolve(this.basePath, dir)).filter((dir) => this.directoryExists(dir));
    const destination = path.resolve(this.basePath, destinationDirectory);
    return { sources, destination };
  }
  directoryExists(dirPath) {
    try {
      const fs2 = require("fs");
      const stats = fs2.statSync(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
  // Discover prompt directories automatically
  async discoverPromptDirectories() {
    const candidates = [
      ".roo",
      ".claude",
      "prompts",
      "templates",
      "src/prompts",
      "src/templates",
      "docs/prompts",
      "scripts/prompts"
    ];
    const discovered = [];
    for (const candidate of candidates) {
      const fullPath = path.resolve(this.basePath, candidate);
      if (await this.containsPromptFiles(fullPath)) {
        discovered.push(fullPath);
      }
    }
    return discovered;
  }
  async containsPromptFiles(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const fileName = entry.name.toLowerCase();
          if (fileName.endsWith(".md") || fileName.endsWith(".txt") || fileName.endsWith(".prompt") || fileName.includes("prompt") || fileName.includes("template")) {
            return true;
          }
        } else if (entry.isDirectory()) {
          const subPath = path.join(dirPath, entry.name);
          if (await this.containsPromptFiles(subPath)) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}
class PromptValidator {
  static {
    __name(this, "PromptValidator");
  }
  static async validatePromptFile(filePath) {
    const issues = [];
    let metadata = {};
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (content.trim().length === 0) {
        issues.push("File is empty");
      }
      const hasPromptMarkers = [
        "# ",
        "## ",
        "### ",
        // Markdown headers
        "You are",
        "Your task",
        "Please",
        // Common prompt starters
        "```",
        "`",
        // Code blocks
        "{{",
        "}}"
        // Template variables
      ].some((marker) => content.includes(marker));
      if (!hasPromptMarkers) {
        issues.push("File may not contain valid prompt content");
      }
      const frontMatterMatch = content.match(/^---\n([\s\S]*?\n)---/);
      if (frontMatterMatch) {
        try {
          metadata = this.parseFrontMatter(frontMatterMatch[1]);
        } catch (error) {
          issues.push("Invalid front matter format");
        }
      }
      const stats = await fs.stat(filePath);
      if (stats.size > 100 * 1024) {
        issues.push("File is unusually large for a prompt");
      }
      return {
        valid: issues.length === 0,
        issues,
        metadata
      };
    } catch (error) {
      return {
        valid: false,
        issues: [`Failed to read file: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }
  static parseFrontMatter(frontMatter) {
    const metadata = {};
    const lines = frontMatter.split("\n");
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        metadata[key] = value.trim();
      }
    }
    return metadata;
  }
}
function createProgressBar(total) {
  const barLength = 40;
  return {
    update: (current) => {
      const percentage = Math.round(current / total * 100);
      const filledLength = Math.round(current / total * barLength);
      const bar = "\u2588".repeat(filledLength) + "\u2591".repeat(barLength - filledLength);
      process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total})`);
    },
    complete: () => {
      process.stdout.write("\n");
    }
  };
}
__name(createProgressBar, "createProgressBar");
function formatFileSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
__name(formatFileSize, "formatFileSize");
function formatDuration(ms) {
  if (ms < 1e3)
    return `${ms}ms`;
  if (ms < 6e4)
    return `${(ms / 1e3).toFixed(1)}s`;
  return `${Math.floor(ms / 6e4)}m ${Math.floor(ms % 6e4 / 1e3)}s`;
}
__name(formatDuration, "formatDuration");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_CONFIG,
  PromptConfigManager,
  PromptPathResolver,
  PromptValidator,
  createProgressBar,
  formatDuration,
  formatFileSize
});
//# sourceMappingURL=prompt-utils.js.map
