#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var import_command = require("@cliffy/command");
var import_migration_runner = require("./migration-runner.js");
var import_migration_analyzer = require("./migration-analyzer.js");
var import_logger = require("./logger.js");
var path = __toESM(require("path"));
const program = new import_command.Command();
program.name("claude-flow-migrate").description("Migrate existing claude-flow projects to optimized prompts").version("1.0.0");
program.command("analyze [path]").description("Analyze existing project for migration readiness").option("-d, --detailed", "Show detailed analysis").option("-o, --output <file>", "Output analysis to file").action(async (projectPath = ".", options) => {
  try {
    const analyzer = new import_migration_analyzer.MigrationAnalyzer();
    const analysis = await analyzer.analyze(path.resolve(projectPath));
    if (options.output) {
      await analyzer.saveAnalysis(analysis, options.output);
      import_logger.logger.success(`Analysis saved to ${options.output}`);
    }
    analyzer.printAnalysis(analysis, options.detailed);
  } catch (error) {
    import_logger.logger.error("Analysis failed:", error);
    process.exit(1);
  }
});
program.command("migrate [path]").description("Migrate project to optimized prompts").option("-s, --strategy <type>", "Migration strategy: full, selective, merge", "selective").option("-b, --backup <dir>", "Backup directory", ".claude-backup").option("-f, --force", "Force migration without prompts").option("--dry-run", "Simulate migration without making changes").option("--preserve-custom", "Preserve custom commands and configurations").option("--skip-validation", "Skip post-migration validation").action(async (projectPath = ".", options) => {
  try {
    const runner = new import_migration_runner.MigrationRunner({
      projectPath: path.resolve(projectPath),
      strategy: options.strategy,
      backupDir: options.backup,
      force: options.force,
      dryRun: options.dryRun,
      preserveCustom: options.preserveCustom,
      skipValidation: options.skipValidation
    });
    await runner.run();
  } catch (error) {
    import_logger.logger.error("Migration failed:", error);
    process.exit(1);
  }
});
program.command("rollback [path]").description("Rollback to previous configuration").option("-b, --backup <dir>", "Backup directory to restore from", ".claude-backup").option("-t, --timestamp <time>", "Restore from specific timestamp").option("-f, --force", "Force rollback without prompts").action(async (projectPath = ".", options) => {
  try {
    const runner = new import_migration_runner.MigrationRunner({
      projectPath: path.resolve(projectPath),
      strategy: "full",
      backupDir: options.backup,
      force: options.force
    });
    await runner.rollback(options.timestamp);
  } catch (error) {
    import_logger.logger.error("Rollback failed:", error);
    process.exit(1);
  }
});
program.command("validate [path]").description("Validate migration was successful").option("-v, --verbose", "Show detailed validation results").action(async (projectPath = ".", options) => {
  try {
    const runner = new import_migration_runner.MigrationRunner({
      projectPath: path.resolve(projectPath),
      strategy: "full"
    });
    const isValid = await runner.validate(options.verbose);
    if (isValid) {
      import_logger.logger.success("Migration validated successfully!");
    } else {
      import_logger.logger.error("Migration validation failed");
      process.exit(1);
    }
  } catch (error) {
    import_logger.logger.error("Validation failed:", error);
    process.exit(1);
  }
});
program.command("list-backups [path]").description("List available backups").option("-b, --backup <dir>", "Backup directory", ".claude-backup").action(async (projectPath = ".", options) => {
  try {
    const runner = new import_migration_runner.MigrationRunner({
      projectPath: path.resolve(projectPath),
      strategy: "full",
      backupDir: options.backup
    });
    await runner.listBackups();
  } catch (error) {
    import_logger.logger.error("Failed to list backups:", error);
    process.exit(1);
  }
});
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
program.parse(process.argv);
//# sourceMappingURL=index.js.map
