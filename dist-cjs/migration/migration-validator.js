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
var migration_validator_exports = {};
__export(migration_validator_exports, {
  MigrationValidator: () => MigrationValidator
});
module.exports = __toCommonJS(migration_validator_exports);
var fs = __toESM(require("fs-extra"));
var path = __toESM(require("path"));
var chalk = __toESM(require("chalk"));
var import_glob = require("glob");
class MigrationValidator {
  static {
    __name(this, "MigrationValidator");
  }
  requiredFiles = [
    ".claude/commands/sparc.md",
    ".claude/commands/claude-flow-help.md",
    ".claude/commands/claude-flow-memory.md",
    ".claude/BATCHTOOLS_GUIDE.md",
    ".claude/BATCHTOOLS_BEST_PRACTICES.md"
  ];
  requiredCommands = [
    "sparc",
    "sparc-architect",
    "sparc-code",
    "sparc-tdd",
    "claude-flow-help",
    "claude-flow-memory",
    "claude-flow-swarm"
  ];
  async validate(projectPath) {
    const result = {
      valid: true,
      checks: [],
      errors: [],
      warnings: []
    };
    await this.validateFileStructure(projectPath, result);
    await this.validateCommandFiles(projectPath, result);
    await this.validateConfiguration(projectPath, result);
    await this.validateFileIntegrity(projectPath, result);
    await this.validateFunctionality(projectPath, result);
    result.valid = result.errors.length === 0;
    return result;
  }
  async validateFileStructure(projectPath, result) {
    const check = {
      name: "File Structure",
      passed: true
    };
    const claudePath = path.join(projectPath, ".claude");
    if (!await fs.pathExists(claudePath)) {
      check.passed = false;
      result.errors.push(".claude directory not found");
    }
    const commandsPath = path.join(claudePath, "commands");
    if (!await fs.pathExists(commandsPath)) {
      check.passed = false;
      result.errors.push(".claude/commands directory not found");
    }
    for (const file of this.requiredFiles) {
      const filePath = path.join(projectPath, file);
      if (!await fs.pathExists(filePath)) {
        check.passed = false;
        result.errors.push(`Required file missing: ${file}`);
      }
    }
    result.checks.push(check);
  }
  async validateCommandFiles(projectPath, result) {
    const check = {
      name: "Command Files",
      passed: true
    };
    const commandsPath = path.join(projectPath, ".claude/commands");
    if (await fs.pathExists(commandsPath)) {
      for (const command of this.requiredCommands) {
        const commandFile = path.join(commandsPath, `${command}.md`);
        const sparcCommandFile = path.join(
          commandsPath,
          "sparc",
          `${command.replace("sparc-", "")}.md`
        );
        const hasMainFile = await fs.pathExists(commandFile);
        const hasSparcFile = await fs.pathExists(sparcCommandFile);
        if (!hasMainFile && !hasSparcFile) {
          check.passed = false;
          result.errors.push(`Command file missing: ${command}.md`);
        } else {
          const filePath = hasMainFile ? commandFile : sparcCommandFile;
          await this.validateCommandFileContent(filePath, command, result);
        }
      }
    } else {
      check.passed = false;
      result.errors.push("Commands directory not found");
    }
    result.checks.push(check);
  }
  async validateCommandFileContent(filePath, command, result) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const hasDescription = content.includes("description") || content.includes("Description");
      const hasInstructions = content.length > 100;
      if (!hasDescription) {
        result.warnings.push(`Command ${command} may be missing description`);
      }
      if (!hasInstructions) {
        result.warnings.push(`Command ${command} may have insufficient content`);
      }
      const hasOptimizedContent = content.includes("optimization") || content.includes("performance") || content.includes("efficient");
      if (!hasOptimizedContent && command.includes("sparc")) {
        result.warnings.push(`SPARC command ${command} may not be optimized`);
      }
    } catch (error) {
      result.errors.push(
        `Failed to validate ${command}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async validateConfiguration(projectPath, result) {
    const check = {
      name: "Configuration Files",
      passed: true
    };
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");
    if (await fs.pathExists(claudeMdPath)) {
      const content = await fs.readFile(claudeMdPath, "utf-8");
      if (!content.includes("SPARC")) {
        result.warnings.push("CLAUDE.md may not include SPARC configuration");
      }
      const requiredSections = ["Project Overview", "SPARC Development", "Memory Integration"];
      for (const section of requiredSections) {
        if (!content.includes(section)) {
          result.warnings.push(`CLAUDE.md missing section: ${section}`);
        }
      }
    } else {
      result.warnings.push("CLAUDE.md not found");
    }
    const roomodesPath = path.join(projectPath, ".roomodes");
    if (await fs.pathExists(roomodesPath)) {
      try {
        const roomodes = await fs.readJson(roomodesPath);
        const requiredModes = ["architect", "code", "tdd", "debug"];
        for (const mode of requiredModes) {
          if (!roomodes[mode]) {
            result.warnings.push(`Missing SPARC mode: ${mode}`);
          }
        }
      } catch (error) {
        result.errors.push(
          `Invalid .roomodes file: ${error instanceof Error ? error.message : String(error)}`
        );
        check.passed = false;
      }
    }
    result.checks.push(check);
  }
  async validateFileIntegrity(projectPath, result) {
    const check = {
      name: "File Integrity",
      passed: true
    };
    const claudePath = path.join(projectPath, ".claude");
    if (await fs.pathExists(claudePath)) {
      const files = await (0, import_glob.glob)("**/*.md", { cwd: claudePath });
      for (const file of files) {
        try {
          const content = await fs.readFile(path.join(claudePath, file), "utf-8");
          if (content.length === 0) {
            result.errors.push(`Empty file: ${file}`);
            check.passed = false;
          }
          if (content.includes("\0")) {
            result.errors.push(`Corrupted text file: ${file}`);
            check.passed = false;
          }
        } catch (error) {
          result.errors.push(
            `Cannot read file ${file}: ${error instanceof Error ? error.message : String(error)}`
          );
          check.passed = false;
        }
      }
    }
    result.checks.push(check);
  }
  async validateFunctionality(projectPath, result) {
    const check = {
      name: "Functionality",
      passed: true
    };
    const claudePath = path.join(projectPath, ".claude");
    if (await fs.pathExists(claudePath)) {
      try {
        const testFile = path.join(claudePath, ".test-write");
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
      } catch (error) {
        result.warnings.push(".claude directory may not be writable");
      }
    }
    const packageJsonPath = path.join(projectPath, "package.json");
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const packageJson = await fs.readJson(packageJsonPath);
        const scripts = packageJson.scripts || {};
        const conflictingScripts = Object.keys(scripts).filter(
          (script) => script.startsWith("claude-flow") || script.startsWith("sparc")
        );
        if (conflictingScripts.length > 0) {
          result.warnings.push(`Potential script conflicts: ${conflictingScripts.join(", ")}`);
        }
      } catch (error) {
        result.warnings.push("Could not validate package.json");
      }
    }
    result.checks.push(check);
  }
  printValidation(validation) {
    console.log(chalk.bold("\n\u2705 Migration Validation Report"));
    console.log(chalk.gray("\u2500".repeat(50)));
    console.log(
      `
${chalk.bold("Overall Status:")} ${validation.valid ? chalk.green("\u2713 Valid") : chalk.red("\u2717 Invalid")}`
    );
    console.log(chalk.bold("\n\u{1F4CB} Validation Checks:"));
    validation.checks.forEach((check) => {
      const status = check.passed ? chalk.green("\u2713") : chalk.red("\u2717");
      console.log(`  ${status} ${check.name}`);
      if (check.message) {
        console.log(`     ${chalk.gray(check.message)}`);
      }
    });
    if (validation.errors.length > 0) {
      console.log(chalk.bold("\n\u274C Errors:"));
      validation.errors.forEach((error) => {
        console.log(`  \u2022 ${chalk.red(error)}`);
      });
    }
    if (validation.warnings.length > 0) {
      console.log(chalk.bold("\n\u26A0\uFE0F  Warnings:"));
      validation.warnings.forEach((warning) => {
        console.log(`  \u2022 ${chalk.yellow(warning)}`);
      });
    }
    console.log(chalk.gray("\n" + "\u2500".repeat(50)));
    if (validation.valid) {
      console.log(
        chalk.green(
          "\n\u{1F389} Migration validation passed! Your project is ready to use optimized prompts."
        )
      );
    } else {
      console.log(chalk.red("\n\u26A0\uFE0F  Migration validation failed. Please address the errors above."));
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MigrationValidator
});
//# sourceMappingURL=migration-validator.js.map
