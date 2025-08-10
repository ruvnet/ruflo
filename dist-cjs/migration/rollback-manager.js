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
var rollback_manager_exports = {};
__export(rollback_manager_exports, {
  RollbackManager: () => RollbackManager
});
module.exports = __toCommonJS(rollback_manager_exports);
var fs = __toESM(require("fs-extra"));
var path = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
var import_logger = require("./logger.js");
var chalk = __toESM(require("chalk"));
var inquirer = __toESM(require("inquirer"));
class RollbackManager {
  static {
    __name(this, "RollbackManager");
  }
  projectPath;
  backupDir;
  constructor(projectPath, backupDir = ".claude-backup") {
    this.projectPath = projectPath;
    this.backupDir = path.join(projectPath, backupDir);
  }
  async createBackup(metadata = {}) {
    const timestamp = /* @__PURE__ */ new Date();
    const backupId = timestamp.toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(this.backupDir, backupId);
    import_logger.logger.info(`Creating backup at ${backupPath}...`);
    await fs.ensureDir(backupPath);
    const backup = {
      timestamp,
      version: "1.0.0",
      files: [],
      metadata: {
        projectPath: this.projectPath,
        backupId,
        ...metadata
      }
    };
    const backupTargets = [
      ".claude",
      "CLAUDE.md",
      ".roomodes",
      "package.json",
      "memory/memory-store.json",
      "coordination/config.json"
    ];
    for (const target of backupTargets) {
      const sourcePath = path.join(this.projectPath, target);
      const targetPath = path.join(backupPath, target);
      if (await fs.pathExists(sourcePath)) {
        const stats = await fs.stat(sourcePath);
        if (stats.isDirectory()) {
          await this.backupDirectory(sourcePath, targetPath, backup);
        } else {
          await this.backupFile(sourcePath, targetPath, backup, target);
        }
      }
    }
    const manifestPath = path.join(backupPath, "backup-manifest.json");
    await fs.writeJson(manifestPath, backup, { spaces: 2 });
    await this.updateBackupIndex(backup);
    import_logger.logger.success(`Backup created with ${backup.files.length} files`);
    return backup;
  }
  async backupDirectory(sourcePath, targetPath, backup) {
    await fs.ensureDir(targetPath);
    const entries = await fs.readdir(sourcePath);
    for (const entry of entries) {
      const entrySource = path.join(sourcePath, entry);
      const entryTarget = path.join(targetPath, entry);
      const stats = await fs.stat(entrySource);
      if (stats.isDirectory()) {
        await this.backupDirectory(entrySource, entryTarget, backup);
      } else {
        const relativePath = path.relative(this.projectPath, entrySource);
        await this.backupFile(entrySource, entryTarget, backup, relativePath);
      }
    }
  }
  async backupFile(sourcePath, targetPath, backup, relativePath) {
    const content = await fs.readFile(sourcePath, "utf-8");
    const checksum = crypto.createHash("sha256").update(content).digest("hex");
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
    const backupFile = {
      path: relativePath,
      content,
      checksum,
      permissions: (await fs.stat(sourcePath)).mode.toString(8)
    };
    backup.files.push(backupFile);
  }
  async listBackups() {
    if (!await fs.pathExists(this.backupDir)) {
      return [];
    }
    const backupFolders = await fs.readdir(this.backupDir);
    const backups = [];
    for (const folder of backupFolders.sort().reverse()) {
      const manifestPath = path.join(this.backupDir, folder, "backup-manifest.json");
      if (await fs.pathExists(manifestPath)) {
        try {
          const backup = await fs.readJson(manifestPath);
          backups.push(backup);
        } catch (error) {
          import_logger.logger.warn(
            `Invalid backup manifest in ${folder}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    return backups;
  }
  async rollback(backupId, interactive = true) {
    const backups = await this.listBackups();
    if (backups.length === 0) {
      throw new Error("No backups found");
    }
    let selectedBackup;
    if (backupId) {
      selectedBackup = backups.find((b) => b.metadata.backupId === backupId);
      if (!selectedBackup) {
        throw new Error(`Backup not found: ${backupId}`);
      }
    } else if (interactive) {
      selectedBackup = await this.selectBackupInteractively(backups);
    } else {
      selectedBackup = backups[0];
    }
    import_logger.logger.info(`Rolling back to backup from ${selectedBackup.timestamp.toISOString()}...`);
    if (interactive) {
      const confirm = await inquirer.prompt([
        {
          type: "confirm",
          name: "proceed",
          message: `Are you sure you want to rollback? This will overwrite current files.`,
          default: false
        }
      ]);
      if (!confirm.proceed) {
        import_logger.logger.info("Rollback cancelled");
        return;
      }
    }
    const preRollbackBackup = await this.createBackup({
      type: "pre-rollback",
      rollingBackTo: selectedBackup.metadata.backupId
    });
    try {
      await this.restoreFiles(selectedBackup);
      await this.validateRestore(selectedBackup);
      import_logger.logger.success("Rollback completed successfully");
    } catch (error) {
      import_logger.logger.error("Rollback failed, attempting to restore pre-rollback state...");
      try {
        await this.restoreFiles(preRollbackBackup);
        import_logger.logger.success("Pre-rollback state restored");
      } catch (restoreError) {
        import_logger.logger.error("Failed to restore pre-rollback state:", restoreError);
        throw new Error("Rollback failed and unable to restore previous state");
      }
      throw error;
    }
  }
  async selectBackupInteractively(backups) {
    const choices = backups.map((backup) => ({
      name: `${backup.timestamp.toLocaleString()} - ${backup.files.length} files (${backup.metadata.type || "migration"})`,
      value: backup,
      short: backup.metadata.backupId
    }));
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "backup",
        message: "Select backup to rollback to:",
        choices,
        pageSize: 10
      }
    ]);
    return answer.backup;
  }
  async restoreFiles(backup) {
    import_logger.logger.info(`Restoring ${backup.files.length} files...`);
    for (const file of backup.files) {
      const targetPath = path.join(this.projectPath, file.path);
      import_logger.logger.debug(`Restoring ${file.path}`);
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, file.content);
      if (file.permissions) {
        try {
          await fs.chmod(targetPath, parseInt(file.permissions, 8));
        } catch (error) {
          import_logger.logger.warn(
            `Could not restore permissions for ${file.path}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
  async validateRestore(backup) {
    import_logger.logger.info("Validating restored files...");
    const errors = [];
    for (const file of backup.files) {
      const filePath = path.join(this.projectPath, file.path);
      if (!await fs.pathExists(filePath)) {
        errors.push(`Missing file: ${file.path}`);
        continue;
      }
      const content = await fs.readFile(filePath, "utf-8");
      const checksum = crypto.createHash("sha256").update(content).digest("hex");
      if (checksum !== file.checksum) {
        errors.push(`Checksum mismatch: ${file.path}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`Validation failed:
${errors.join("\n")}`);
    }
    import_logger.logger.success("Validation passed");
  }
  async cleanupOldBackups(retentionDays = 30, maxBackups = 10) {
    const backups = await this.listBackups();
    if (backups.length <= maxBackups) {
      return;
    }
    const cutoffDate = /* @__PURE__ */ new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const backupsToDelete = backups.filter((backup, index) => {
      if (index < maxBackups) {
        return false;
      }
      return backup.timestamp < cutoffDate;
    });
    if (backupsToDelete.length === 0) {
      return;
    }
    import_logger.logger.info(`Cleaning up ${backupsToDelete.length} old backups...`);
    for (const backup of backupsToDelete) {
      const backupPath = path.join(this.backupDir, backup.metadata.backupId);
      await fs.remove(backupPath);
      import_logger.logger.debug(`Removed backup: ${backup.metadata.backupId}`);
    }
    import_logger.logger.success(`Cleanup completed, removed ${backupsToDelete.length} backups`);
  }
  async getBackupInfo(backupId) {
    const backups = await this.listBackups();
    return backups.find((b) => b.metadata.backupId === backupId) || null;
  }
  async exportBackup(backupId, exportPath) {
    const backup = await this.getBackupInfo(backupId);
    if (!backup) {
      throw new Error(`Backup not found: ${backupId}`);
    }
    const backupPath = path.join(this.backupDir, backup.metadata.backupId);
    await fs.copy(backupPath, exportPath);
    import_logger.logger.success(`Backup exported to ${exportPath}`);
  }
  async importBackup(importPath) {
    const manifestPath = path.join(importPath, "backup-manifest.json");
    if (!await fs.pathExists(manifestPath)) {
      throw new Error("Invalid backup: missing manifest");
    }
    const backup = await fs.readJson(manifestPath);
    const backupPath = path.join(this.backupDir, backup.metadata.backupId);
    await fs.copy(importPath, backupPath);
    await this.updateBackupIndex(backup);
    import_logger.logger.success(`Backup imported: ${backup.metadata.backupId}`);
    return backup;
  }
  async updateBackupIndex(backup) {
    const indexPath = path.join(this.backupDir, "backup-index.json");
    let index = {};
    if (await fs.pathExists(indexPath)) {
      index = await fs.readJson(indexPath);
    }
    index[backup.metadata.backupId] = {
      timestamp: backup.timestamp,
      version: backup.version,
      fileCount: backup.files.length,
      metadata: backup.metadata
    };
    await fs.writeJson(indexPath, index, { spaces: 2 });
  }
  printBackupSummary(backups) {
    if (backups.length === 0) {
      console.log(chalk.yellow("No backups found"));
      return;
    }
    console.log(chalk.bold("\n\u{1F4BE} Available Backups"));
    console.log(chalk.gray("\u2500".repeat(70)));
    backups.forEach((backup, index) => {
      const isRecent = index === 0;
      const date = backup.timestamp.toLocaleString();
      const type = backup.metadata.type || "migration";
      const fileCount = backup.files.length;
      console.log(
        `
${isRecent ? chalk.green("\u25CF") : chalk.gray("\u25CB")} ${chalk.bold(backup.metadata.backupId)}`
      );
      console.log(`  ${chalk.gray("Date:")} ${date}`);
      console.log(`  ${chalk.gray("Type:")} ${type}`);
      console.log(`  ${chalk.gray("Files:")} ${fileCount}`);
      if (backup.metadata.strategy) {
        console.log(`  ${chalk.gray("Strategy:")} ${backup.metadata.strategy}`);
      }
    });
    console.log(chalk.gray("\n" + "\u2500".repeat(70)));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RollbackManager
});
//# sourceMappingURL=rollback-manager.js.map
