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
var migration_analyzer_exports = {};
__export(migration_analyzer_exports, {
  MigrationAnalyzer: () => MigrationAnalyzer
});
module.exports = __toCommonJS(migration_analyzer_exports);
var fs = __toESM(require("fs-extra"));
var path = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
var import_logger = require("./logger.js");
var chalk = __toESM(require("chalk"));
var import_glob = require("glob");
class MigrationAnalyzer {
  static {
    __name(this, "MigrationAnalyzer");
  }
  optimizedCommands = [
    "sparc",
    "sparc-architect",
    "sparc-code",
    "sparc-tdd",
    "claude-flow-help",
    "claude-flow-memory",
    "claude-flow-swarm"
  ];
  async analyze(projectPath) {
    import_logger.logger.info(`Analyzing project at ${projectPath}...`);
    const analysis = {
      projectPath,
      hasClaudeFolder: false,
      hasOptimizedPrompts: false,
      customCommands: [],
      customConfigurations: {},
      conflictingFiles: [],
      migrationRisks: [],
      recommendations: [],
      timestamp: /* @__PURE__ */ new Date()
    };
    const claudePath = path.join(projectPath, ".claude");
    if (await fs.pathExists(claudePath)) {
      analysis.hasClaudeFolder = true;
      await this.analyzeCommands(claudePath, analysis);
      await this.checkOptimizedPrompts(claudePath, analysis);
      await this.analyzeConfigurations(projectPath, analysis);
      await this.detectConflicts(projectPath, analysis);
    }
    this.assessRisks(analysis);
    this.generateRecommendations(analysis);
    return analysis;
  }
  async analyzeCommands(claudePath, analysis) {
    const commandsPath = path.join(claudePath, "commands");
    if (await fs.pathExists(commandsPath)) {
      const files = await (0, import_glob.glob)("**/*.md", { cwd: commandsPath });
      for (const file of files) {
        const commandName = path.basename(file, ".md");
        if (!this.optimizedCommands.includes(commandName)) {
          analysis.customCommands.push(commandName);
        }
      }
    }
  }
  async checkOptimizedPrompts(claudePath, analysis) {
    const optimizedFiles = [
      "BATCHTOOLS_GUIDE.md",
      "BATCHTOOLS_BEST_PRACTICES.md",
      "MIGRATION_GUIDE.md",
      "PERFORMANCE_BENCHMARKS.md"
    ];
    let hasOptimized = 0;
    for (const file of optimizedFiles) {
      if (await fs.pathExists(path.join(claudePath, file))) {
        hasOptimized++;
      }
    }
    analysis.hasOptimizedPrompts = hasOptimized >= 2;
  }
  async analyzeConfigurations(projectPath, analysis) {
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");
    if (await fs.pathExists(claudeMdPath)) {
      const content = await fs.readFile(claudeMdPath, "utf-8");
      analysis.customConfigurations["CLAUDE.md"] = {
        exists: true,
        size: content.length,
        hasCustomContent: !content.includes("SPARC Development Environment")
      };
    }
    const roomodesPath = path.join(projectPath, ".roomodes");
    if (await fs.pathExists(roomodesPath)) {
      try {
        const roomodes = await fs.readJson(roomodesPath);
        analysis.customConfigurations[".roomodes"] = {
          exists: true,
          modeCount: Object.keys(roomodes).length,
          customModes: Object.keys(roomodes).filter(
            (mode) => !["architect", "code", "tdd", "debug", "docs-writer"].includes(mode)
          )
        };
      } catch (error) {
        analysis.migrationRisks.push({
          level: "medium",
          description: "Invalid .roomodes file",
          file: roomodesPath,
          mitigation: "File will be backed up and replaced"
        });
      }
    }
  }
  async detectConflicts(projectPath, analysis) {
    const potentialConflicts = [
      ".claude/commands/sparc.md",
      ".claude/BATCHTOOLS_GUIDE.md",
      "memory/memory-store.json",
      "coordination/config.json"
    ];
    for (const file of potentialConflicts) {
      const filePath = path.join(projectPath, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, "utf-8");
        const checksum = crypto.createHash("md5").update(content).digest("hex");
        if (!this.isStandardFile(file, checksum)) {
          analysis.conflictingFiles.push(file);
        }
      }
    }
  }
  isStandardFile(file, checksum) {
    return false;
  }
  assessRisks(analysis) {
    if (analysis.customCommands.length > 0) {
      analysis.migrationRisks.push({
        level: "high",
        description: `Found ${analysis.customCommands.length} custom commands that may be affected`,
        mitigation: "Use --preserve-custom flag or selective migration"
      });
    }
    if (analysis.hasOptimizedPrompts) {
      analysis.migrationRisks.push({
        level: "medium",
        description: "Project already has some optimized prompts",
        mitigation: "Consider using merge strategy to preserve customizations"
      });
    }
    if (!analysis.hasClaudeFolder) {
      analysis.migrationRisks.push({
        level: "low",
        description: "No existing .claude folder found",
        mitigation: "Fresh installation will be performed"
      });
    }
    if (analysis.conflictingFiles.length > 0) {
      analysis.migrationRisks.push({
        level: "high",
        description: `${analysis.conflictingFiles.length} files may have custom modifications`,
        mitigation: "Files will be backed up before migration"
      });
    }
  }
  generateRecommendations(analysis) {
    if (analysis.customCommands.length > 0 || analysis.conflictingFiles.length > 0) {
      analysis.recommendations.push(
        'Use "selective" or "merge" strategy to preserve customizations'
      );
    } else if (!analysis.hasClaudeFolder) {
      analysis.recommendations.push('Use "full" strategy for clean installation');
    }
    if (analysis.hasClaudeFolder) {
      analysis.recommendations.push(
        "Create a backup before migration (automatic with default settings)"
      );
    }
    if (analysis.customCommands.length > 0) {
      analysis.recommendations.push(
        `Review custom commands: ${analysis.customCommands.join(", ")}`
      );
    }
    if (analysis.migrationRisks.some((r) => r.level === "high")) {
      analysis.recommendations.push("Run with --dry-run first to preview changes");
    }
  }
  printAnalysis(analysis, detailed = false) {
    console.log(chalk.bold("\n\u{1F4CA} Migration Analysis Report"));
    console.log(chalk.gray("\u2500".repeat(50)));
    console.log(`
${chalk.bold("Project:")} ${analysis.projectPath}`);
    console.log(`${chalk.bold("Timestamp:")} ${analysis.timestamp.toISOString()}`);
    console.log(chalk.bold("\n\u{1F4CB} Current Status:"));
    console.log(
      `  \u2022 .claude folder: ${analysis.hasClaudeFolder ? chalk.green("\u2713") : chalk.red("\u2717")}`
    );
    console.log(
      `  \u2022 Optimized prompts: ${analysis.hasOptimizedPrompts ? chalk.green("\u2713") : chalk.red("\u2717")}`
    );
    console.log(
      `  \u2022 Custom commands: ${analysis.customCommands.length > 0 ? chalk.yellow(analysis.customCommands.length) : chalk.green("0")}`
    );
    console.log(
      `  \u2022 Conflicts: ${analysis.conflictingFiles.length > 0 ? chalk.yellow(analysis.conflictingFiles.length) : chalk.green("0")}`
    );
    if (analysis.migrationRisks.length > 0) {
      console.log(chalk.bold("\n\u26A0\uFE0F  Migration Risks:"));
      analysis.migrationRisks.forEach((risk) => {
        const icon = risk.level === "high" ? "\u{1F534}" : risk.level === "medium" ? "\u{1F7E1}" : "\u{1F7E2}";
        console.log(`  ${icon} ${chalk.bold(risk.level.toUpperCase())}: ${risk.description}`);
        if (risk.mitigation) {
          console.log(`     ${chalk.gray("\u2192")} ${chalk.italic(risk.mitigation)}`);
        }
      });
    }
    if (analysis.recommendations.length > 0) {
      console.log(chalk.bold("\n\u{1F4A1} Recommendations:"));
      analysis.recommendations.forEach((rec) => {
        console.log(`  \u2022 ${rec}`);
      });
    }
    if (detailed) {
      if (analysis.customCommands.length > 0) {
        console.log(chalk.bold("\n\u{1F527} Custom Commands:"));
        analysis.customCommands.forEach((cmd) => {
          console.log(`  \u2022 ${cmd}`);
        });
      }
      if (analysis.conflictingFiles.length > 0) {
        console.log(chalk.bold("\n\u{1F4C1} Conflicting Files:"));
        analysis.conflictingFiles.forEach((file) => {
          console.log(`  \u2022 ${file}`);
        });
      }
      if (Object.keys(analysis.customConfigurations).length > 0) {
        console.log(chalk.bold("\n\u2699\uFE0F  Configurations:"));
        Object.entries(analysis.customConfigurations).forEach(([file, config]) => {
          console.log(`  \u2022 ${file}: ${JSON.stringify(config, null, 2)}`);
        });
      }
    }
    console.log(chalk.gray("\n" + "\u2500".repeat(50)));
  }
  async saveAnalysis(analysis, outputPath) {
    await fs.writeJson(outputPath, analysis, { spaces: 2 });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MigrationAnalyzer
});
//# sourceMappingURL=migration-analyzer.js.map
