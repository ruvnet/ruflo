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
var migrate_exports = {};
__export(migrate_exports, {
  createMigrateCommand: () => createMigrateCommand
});
module.exports = __toCommonJS(migrate_exports);
var import_commander = require("commander");
var import_logger = require("../../migration/logger.js");
var path = __toESM(require("path"), 1);
var import_chalk = __toESM(require("chalk"), 1);
function createMigrateCommand() {
  const command = new import_commander.Command("migrate");
  command.description("Migrate existing claude-flow projects to optimized prompts").option("-p, --path <path>", "Project path", ".").option("-s, --strategy <type>", "Migration strategy: full, selective, merge", "selective").option("-b, --backup <dir>", "Backup directory", ".claude-backup").option("-f, --force", "Force migration without prompts").option("--dry-run", "Simulate migration without making changes").option("--preserve-custom", "Preserve custom commands and configurations").option("--skip-validation", "Skip post-migration validation").option("--analyze-only", "Only analyze project without migrating").option("--verbose", "Show detailed output").action(async (options) => {
    try {
      const projectPath = path.resolve(options.path);
      if (options.analyzeOnly) {
        await analyzeProject(projectPath, options);
      } else {
        await runMigration(projectPath, options);
      }
    } catch (error) {
      import_logger.logger.error("Migration command failed:", error);
      process.exit(1);
    }
  });
  command.command("analyze [path]").description("Analyze project for migration readiness").option("-d, --detailed", "Show detailed analysis").option("-o, --output <file>", "Output analysis to file").action(async (projectPath = ".", options) => {
    await analyzeProject(path.resolve(projectPath), options);
  });
  command.command("rollback [path]").description("Rollback to previous configuration").option("-b, --backup <dir>", "Backup directory", ".claude-backup").option("-t, --timestamp <time>", "Restore from specific timestamp").option("-f, --force", "Force rollback without prompts").option("--list", "List available backups").action(async (projectPath = ".", options) => {
    const { RollbackManager: RollbackManager2 } = await import("../../migration/rollback-manager.js");
    const rollbackManager = new RollbackManager2(path.resolve(projectPath), options.backup);
    if (options.list) {
      const backups = await rollbackManager.listBackups();
      rollbackManager.printBackupSummary(backups);
      return;
    }
    await rollbackManager.rollback(options.timestamp, !options.force);
  });
  command.command("validate [path]").description("Validate migration was successful").option("-v, --verbose", "Show detailed validation results").action(async (projectPath = ".", options) => {
    const { MigrationRunner: MigrationRunner2 } = await import("../../migration/migration-runner.js");
    const runner = new MigrationRunner2({
      projectPath: path.resolve(projectPath),
      strategy: "full"
    });
    const isValid = await runner.validate(options.verbose);
    process.exit(isValid ? 0 : 1);
  });
  command.command("status [path]").description("Show migration status and available backups").action(async (projectPath = ".") => {
    await showMigrationStatus(path.resolve(projectPath));
  });
  return command;
}
__name(createMigrateCommand, "createMigrateCommand");
async function analyzeProject(projectPath, options) {
  import_logger.logger.info(`Analyzing project at ${projectPath}...`);
  const { MigrationAnalyzer: MigrationAnalyzer2 } = await import("../../migration/migration-analyzer.js");
  const analyzer = new MigrationAnalyzer2();
  const analysis = await analyzer.analyze(projectPath);
  if (options.output) {
    await analyzer.saveAnalysis(analysis, options.output);
    import_logger.logger.success(`Analysis saved to ${options.output}`);
  }
  analyzer.printAnalysis(analysis, options.detailed || options.verbose);
}
__name(analyzeProject, "analyzeProject");
async function runMigration(projectPath, options) {
  const { MigrationRunner: MigrationRunner2 } = await import("../../migration/migration-runner.js");
  const runner = new MigrationRunner2({
    projectPath,
    strategy: options.strategy,
    backupDir: options.backup,
    force: options.force,
    dryRun: options.dryRun,
    preserveCustom: options.preserveCustom,
    skipValidation: options.skipValidation
  });
  const result = await runner.run();
  if (!result.success) {
    process.exit(1);
  }
}
__name(runMigration, "runMigration");
async function showMigrationStatus(projectPath) {
  console.log(import_chalk.default.bold("\n\u{1F4CA} Migration Status"));
  console.log(import_chalk.default.gray("\u2500".repeat(50)));
  const { MigrationAnalyzer: MigrationAnalyzer2 } = await import("../../migration/migration-analyzer.js");
  const analyzer = new MigrationAnalyzer2();
  const analysis = await analyzer.analyze(projectPath);
  console.log(`
${import_chalk.default.bold("Project:")} ${projectPath}`);
  console.log(
    `${import_chalk.default.bold("Status:")} ${analysis.hasOptimizedPrompts ? import_chalk.default.green("Migrated") : import_chalk.default.yellow("Not Migrated")}`
  );
  console.log(`${import_chalk.default.bold("Custom Commands:")} ${analysis.customCommands.length}`);
  console.log(`${import_chalk.default.bold("Conflicts:")} ${analysis.conflictingFiles.length}`);
  const { RollbackManager: RollbackManager2 } = await import("../../migration/rollback-manager.js");
  const rollbackManager = new RollbackManager2(projectPath);
  const backups = await rollbackManager.listBackups();
  console.log(`
${import_chalk.default.bold("Backups Available:")} ${backups.length}`);
  if (backups.length > 0) {
    const latestBackup = backups[0];
    console.log(`${import_chalk.default.bold("Latest Backup:")} ${latestBackup.timestamp.toLocaleString()}`);
  }
  if (!analysis.hasOptimizedPrompts) {
    console.log(import_chalk.default.bold("\n\u{1F4A1} Recommendations:"));
    console.log("  \u2022 Run migration analysis: claude-flow migrate analyze");
    console.log("  \u2022 Start with dry run: claude-flow migrate --dry-run");
    console.log("  \u2022 Use selective strategy: claude-flow migrate --strategy selective");
  }
  console.log(import_chalk.default.gray("\n" + "\u2500".repeat(50)));
}
__name(showMigrationStatus, "showMigrationStatus");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createMigrateCommand
});
//# sourceMappingURL=migrate.js.map
