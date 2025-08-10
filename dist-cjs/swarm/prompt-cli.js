#!/usr/bin/env node
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
var prompt_cli_exports = {};
__export(prompt_cli_exports, {
  program: () => program
});
module.exports = __toCommonJS(prompt_cli_exports);
var import_commander = require("commander");
var path = __toESM(require("path"), 1);
var import_prompt_copier_enhanced = require("./prompt-copier-enhanced.js");
var import_prompt_utils = require("./prompt-utils.js");
const program = new import_commander.Command();
program.name("prompt-copier").description("Robust prompt copying mechanism for Claude-Flow").version("1.0.0");
program.command("copy").description("Copy prompts from source to destination").option("-s, --source <path>", "Source directory").option("-d, --destination <path>", "Destination directory").option("-p, --profile <name>", "Configuration profile to use").option("--no-backup", "Disable backup creation").option("--no-verify", "Disable file verification").option("--no-parallel", "Disable parallel processing").option("--workers <number>", "Number of worker threads", parseInt).option(
  "--conflict <strategy>",
  "Conflict resolution strategy",
  /^(skip|overwrite|backup|merge)$/
).option("--include <patterns>", "Include patterns (comma-separated)").option("--exclude <patterns>", "Exclude patterns (comma-separated)").option("--dry-run", "Show what would be copied without actually copying").option("--enhanced", "Use enhanced copier with worker threads").action(async (options) => {
  try {
    const configManager = new import_prompt_utils.PromptConfigManager();
    const config = await configManager.loadConfig();
    let copyOptions;
    if (options.profile) {
      const profileOptions = configManager.getProfile(options.profile);
      copyOptions = {
        source: options.source || config.sourceDirectories[0],
        destination: options.destination || config.destinationDirectory,
        ...profileOptions
      };
    } else {
      copyOptions = {
        source: options.source || config.sourceDirectories[0],
        destination: options.destination || config.destinationDirectory,
        backup: options.backup,
        verify: options.verify,
        parallel: options.parallel,
        maxWorkers: options.workers || config.defaultOptions.maxWorkers,
        conflictResolution: options.conflict || config.defaultOptions.conflictResolution,
        includePatterns: options.include ? options.include.split(",") : config.defaultOptions.includePatterns,
        excludePatterns: options.exclude ? options.exclude.split(",") : config.defaultOptions.excludePatterns,
        dryRun: options.dryRun
      };
    }
    let progressBar = null;
    copyOptions.progressCallback = (progress) => {
      if (!progressBar) {
        progressBar = (0, import_prompt_utils.createProgressBar)(progress.total);
      }
      progressBar.update(progress.completed);
      if (progress.completed === progress.total) {
        progressBar.complete();
      }
    };
    console.log("Starting prompt copy operation...");
    console.log(`Source: ${copyOptions.source}`);
    console.log(`Destination: ${copyOptions.destination}`);
    console.log(`Options: ${JSON.stringify(copyOptions, null, 2)}`);
    const copyFunction = options.enhanced ? import_prompt_copier_enhanced.copyPromptsEnhanced : import_prompt_copier_enhanced.copyPrompts;
    const result = await copyFunction(copyOptions);
    console.log("\n=== Copy Results ===");
    console.log(`Success: ${result.success ? "\u2705" : "\u274C"}`);
    console.log(`Total files: ${result.totalFiles}`);
    console.log(`Copied: ${result.copiedFiles}`);
    console.log(`Failed: ${result.failedFiles}`);
    console.log(`Skipped: ${result.skippedFiles}`);
    console.log(`Duration: ${(0, import_prompt_utils.formatDuration)(result.duration)}`);
    if (result.backupLocation) {
      console.log(`Backup manifest: ${result.backupLocation}`);
    }
    if (result.errors.length > 0) {
      console.log("\n=== Errors ===");
      result.errors.forEach((error) => {
        console.log(`\u274C ${error.file}: ${error.error} (${error.phase})`);
      });
    }
  } catch (error) {
    console.error("Copy operation failed:", error);
    process.exit(1);
  }
});
program.command("discover").description("Discover prompt directories in the current project").option("-b, --base <path>", "Base path to search from", process.cwd()).action(async (options) => {
  try {
    const resolver = new import_prompt_utils.PromptPathResolver(options.base);
    const directories = await resolver.discoverPromptDirectories();
    console.log("Discovered prompt directories:");
    directories.forEach((dir) => {
      console.log(`  \u{1F4C1} ${dir}`);
    });
    if (directories.length === 0) {
      console.log("  No prompt directories found");
    }
  } catch (error) {
    console.error("Discovery failed:", error);
    process.exit(1);
  }
});
program.command("validate <path>").description("Validate prompt files").option("--recursive", "Validate recursively").action(async (filePath, options) => {
  try {
    const stats = await (await import("fs")).promises.stat(filePath);
    const files = [];
    if (stats.isFile()) {
      files.push(filePath);
    } else if (stats.isDirectory()) {
      const scanDir = /* @__PURE__ */ __name(async (dir) => {
        const entries = await (await import("fs")).promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".txt") || entry.name.endsWith(".prompt"))) {
            files.push(fullPath);
          } else if (entry.isDirectory() && options.recursive) {
            await scanDir(fullPath);
          }
        }
      }, "scanDir");
      await scanDir(filePath);
    }
    console.log(`Validating ${files.length} files...`);
    let validFiles = 0;
    let invalidFiles = 0;
    for (const file of files) {
      const result = await import_prompt_utils.PromptValidator.validatePromptFile(file);
      if (result.valid) {
        validFiles++;
        console.log(`\u2705 ${file}`);
      } else {
        invalidFiles++;
        console.log(`\u274C ${file}`);
        result.issues.forEach((issue) => {
          console.log(`   - ${issue}`);
        });
      }
      if (result.metadata && Object.keys(result.metadata).length > 0) {
        console.log(`   Metadata: ${JSON.stringify(result.metadata)}`);
      }
    }
    console.log(`
Validation complete: ${validFiles} valid, ${invalidFiles} invalid`);
  } catch (error) {
    console.error("Validation failed:", error);
    process.exit(1);
  }
});
program.command("config").description("Manage configuration").option("--init", "Initialize default configuration").option("--show", "Show current configuration").option("--profiles", "List available profiles").action(async (options) => {
  try {
    const configManager = new import_prompt_utils.PromptConfigManager();
    if (options.init) {
      await configManager.saveConfig();
      console.log("\u2705 Configuration initialized");
    } else if (options.show) {
      const config = await configManager.loadConfig();
      console.log(JSON.stringify(config, null, 2));
    } else if (options.profiles) {
      const config = await configManager.loadConfig();
      const profiles = configManager.listProfiles();
      console.log("Available profiles:");
      profiles.forEach((profile) => {
        console.log(`  \u{1F4CB} ${profile}`);
        const profileOptions = configManager.getProfile(profile);
        Object.entries(profileOptions).forEach(([key, value]) => {
          console.log(`     ${key}: ${JSON.stringify(value)}`);
        });
      });
    } else {
      console.log("Use --init, --show, or --profiles");
    }
  } catch (error) {
    console.error("Configuration operation failed:", error);
    process.exit(1);
  }
});
program.command("rollback <manifest>").description("Rollback from backup").action(async (manifestPath) => {
  try {
    const { PromptCopier } = await import("./prompt-copier.js");
    const copier = new PromptCopier({
      source: "",
      destination: ""
    });
    await copier.restoreFromBackup(manifestPath);
    console.log("\u2705 Rollback completed");
  } catch (error) {
    console.error("Rollback failed:", error);
    process.exit(1);
  }
});
program.command("sync").description("Synchronize prompts between directories").option("-s, --source <path>", "Source directory").option("-d, --destination <path>", "Destination directory").option("--bidirectional", "Enable bidirectional sync").option("--delete", "Delete files not present in source").action(async (options) => {
  try {
    console.log("Sync functionality not yet implemented");
    console.log("Options:", options);
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});
if (require.main === module) {
  program.parse();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  program
});
//# sourceMappingURL=prompt-cli.js.map
