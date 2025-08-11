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
var config_integration_exports = {};
__export(config_integration_exports, {
  configIntegrationAction: () => configIntegrationAction,
  default: () => config_integration_default
});
module.exports = __toCommonJS(config_integration_exports);
var import_cli_core = require("../cli-core.js");
var import_config_manager = require("../../config/config-manager.js");
var import_ruv_swarm_integration = require("../../config/ruv-swarm-integration.js");
async function configIntegrationAction(ctx) {
  if (ctx.flags.help || ctx.flags.h || ctx.args.length === 0) {
    showConfigIntegrationHelp();
    return;
  }
  const subcommand = ctx.args[0];
  const subArgs = ctx.args.slice(1);
  try {
    switch (subcommand) {
      case "setup":
        await handleSetup(ctx);
        break;
      case "sync":
        await handleSync(ctx);
        break;
      case "status":
        await handleStatus(ctx);
        break;
      case "validate":
        await handleValidate(ctx);
        break;
      case "preset":
        await handlePreset(ctx);
        break;
      case "export":
        await handleExport(ctx);
        break;
      case "import":
        await handleImport(ctx);
        break;
      default:
        (0, import_cli_core.error)(`Unknown config-integration subcommand: ${subcommand}`);
        showConfigIntegrationHelp();
        break;
    }
  } catch (err) {
    (0, import_cli_core.error)(`Configuration integration command failed: ${err.message}`);
  }
}
__name(configIntegrationAction, "configIntegrationAction");
function showConfigIntegrationHelp() {
  console.log("config-integration - Enhanced configuration management with ruv-swarm\\n");
  console.log("Usage:");
  console.log("  claude-flow config-integration <command> [options]\\n");
  console.log("Commands:");
  console.log("  setup                      Initialize ruv-swarm integration");
  console.log("  sync                       Synchronize configurations");
  console.log("  status                     Show integration status");
  console.log("  validate                   Validate all configurations");
  console.log("  preset <type>              Apply configuration preset");
  console.log("  export <file>              Export unified configuration");
  console.log("  import <file>              Import and apply configuration\\n");
  console.log("Presets:");
  console.log("  development                Optimized for development workflows");
  console.log("  research                   Optimized for research and analysis");
  console.log("  production                 Optimized for production environments\\n");
  console.log("Examples:");
  console.log("  claude-flow config-integration setup --enable-ruv-swarm");
  console.log("  claude-flow config-integration preset development");
  console.log("  claude-flow config-integration sync --force");
  console.log("  claude-flow config-integration export my-config.json");
  console.log("  claude-flow config-integration status --verbose");
}
__name(showConfigIntegrationHelp, "showConfigIntegrationHelp");
async function handleSetup(ctx) {
  const enableRuvSwarm = ctx.flags.enableRuvSwarm || ctx.flags["enable-ruv-swarm"] || true;
  const force = ctx.flags.force || ctx.flags.f;
  (0, import_cli_core.info)("Setting up ruv-swarm integration...");
  try {
    if (enableRuvSwarm) {
      import_config_manager.configManager.setRuvSwarmConfig({ enabled: true });
      await import_config_manager.configManager.save();
      (0, import_cli_core.success)("ruv-swarm enabled in main configuration");
    }
    const result = await (0, import_ruv_swarm_integration.initializeRuvSwarmIntegration)();
    if (result.success) {
      (0, import_cli_core.success)("ruv-swarm integration setup completed successfully!");
      console.log(`\u2705 ${result.message}`);
      const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
      const status = integration.getStatus();
      console.log("\\n\u{1F4CB} Integration Status:");
      console.log(`  Enabled: ${status.enabled ? "\u2705" : "\u274C"}`);
      console.log(`  Synchronized: ${status.synchronized ? "\u2705" : "\u26A0\uFE0F"}`);
      console.log(`  Topology: ${status.mainConfig.defaultTopology}`);
      console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
      console.log(`  Strategy: ${status.mainConfig.defaultStrategy}`);
    } else {
      (0, import_cli_core.error)("ruv-swarm integration setup failed");
      console.log(`\u274C ${result.message}`);
      if (force) {
        (0, import_cli_core.warning)("Continuing despite errors due to --force flag");
      }
    }
  } catch (err) {
    (0, import_cli_core.error)(`Setup failed: ${err.message}`);
  }
}
__name(handleSetup, "handleSetup");
async function handleSync(ctx) {
  const force = ctx.flags.force || ctx.flags.f;
  (0, import_cli_core.info)("Synchronizing configurations...");
  try {
    const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
    const statusBefore = integration.getStatus();
    if (statusBefore.synchronized && !force) {
      (0, import_cli_core.success)("Configurations are already synchronized");
      return;
    }
    integration.syncConfiguration();
    const statusAfter = integration.getStatus();
    if (statusAfter.synchronized) {
      (0, import_cli_core.success)("Configuration synchronization completed");
      console.log("\u2705 Main config and ruv-swarm config are now synchronized");
    } else {
      (0, import_cli_core.warning)("Synchronization completed but configurations may still differ");
      console.log("\u26A0\uFE0F  Manual review recommended");
    }
  } catch (err) {
    (0, import_cli_core.error)(`Synchronization failed: ${err.message}`);
  }
}
__name(handleSync, "handleSync");
async function handleStatus(ctx) {
  const verbose = ctx.flags.verbose || ctx.flags.v;
  const json = ctx.flags.json;
  try {
    const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
    const status = integration.getStatus();
    if (json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log("\u{1F527} Configuration Integration Status\\n");
    console.log("\u{1F4CA} Overview:");
    console.log(`  ruv-swarm Enabled: ${status.enabled ? "\u2705 Yes" : "\u274C No"}`);
    console.log(`  Configurations Synchronized: ${status.synchronized ? "\u2705 Yes" : "\u26A0\uFE0F  No"}`);
    console.log("\\n\u2699\uFE0F  Main Configuration:");
    console.log(`  Default Topology: ${status.mainConfig.defaultTopology}`);
    console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
    console.log(`  Default Strategy: ${status.mainConfig.defaultStrategy}`);
    console.log(`  Auto Init: ${status.mainConfig.autoInit ? "\u2705" : "\u274C"}`);
    console.log(`  Hooks Enabled: ${status.mainConfig.enableHooks ? "\u2705" : "\u274C"}`);
    console.log(`  Persistence Enabled: ${status.mainConfig.enablePersistence ? "\u2705" : "\u274C"}`);
    console.log(`  Neural Training: ${status.mainConfig.enableNeuralTraining ? "\u2705" : "\u274C"}`);
    if (verbose) {
      console.log("\\n\u{1F9E0} ruv-swarm Configuration:");
      console.log(`  Swarm Max Agents: ${status.ruvSwarmConfig.swarm.maxAgents}`);
      console.log(
        `  Memory Persistence: ${status.ruvSwarmConfig.memory.enablePersistence ? "\u2705" : "\u274C"}`
      );
      console.log(
        `  Neural Training: ${status.ruvSwarmConfig.neural.enableTraining ? "\u2705" : "\u274C"}`
      );
      console.log(`  MCP Tools: ${status.ruvSwarmConfig.integration.enableMCPTools ? "\u2705" : "\u274C"}`);
      console.log(
        `  CLI Commands: ${status.ruvSwarmConfig.integration.enableCLICommands ? "\u2705" : "\u274C"}`
      );
      console.log("\\n\u{1F4C8} Monitoring:");
      console.log(
        `  Metrics Enabled: ${status.ruvSwarmConfig.monitoring.enableMetrics ? "\u2705" : "\u274C"}`
      );
      console.log(
        `  Alerts Enabled: ${status.ruvSwarmConfig.monitoring.enableAlerts ? "\u2705" : "\u274C"}`
      );
      console.log(`  CPU Threshold: ${status.ruvSwarmConfig.monitoring.alertThresholds.cpu}%`);
      console.log(
        `  Memory Threshold: ${status.ruvSwarmConfig.monitoring.alertThresholds.memory}%`
      );
    }
  } catch (err) {
    (0, import_cli_core.error)(`Failed to get status: ${err.message}`);
  }
}
__name(handleStatus, "handleStatus");
async function handleValidate(ctx) {
  const fix = ctx.flags.fix || ctx.flags.f;
  (0, import_cli_core.info)("Validating configurations...");
  try {
    const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
    console.log("\u{1F50D} Validating main configuration...");
    try {
      const mainConfig = import_config_manager.configManager.show();
      import_config_manager.configManager.validate(mainConfig);
      (0, import_cli_core.success)("Main configuration is valid");
    } catch (err) {
      (0, import_cli_core.error)(`Main configuration validation failed: ${err.message}`);
      if (fix) {
        (0, import_cli_core.warning)("Auto-fix for main configuration not implemented");
      }
      return;
    }
    console.log("\u{1F50D} Validating ruv-swarm configuration...");
    const ruvSwarmManager = integration["ruvSwarmManager"];
    const ruvSwarmValidation = ruvSwarmManager.validateConfig();
    if (ruvSwarmValidation.valid) {
      (0, import_cli_core.success)("ruv-swarm configuration is valid");
    } else {
      (0, import_cli_core.error)("ruv-swarm configuration validation failed:");
      ruvSwarmValidation.errors.forEach((err) => console.log(`  - ${err}`));
      if (fix) {
        (0, import_cli_core.warning)("Auto-fix for ruv-swarm configuration not implemented");
      }
      return;
    }
    console.log("\u{1F50D} Checking synchronization...");
    const status = integration.getStatus();
    if (status.synchronized) {
      (0, import_cli_core.success)("Configurations are synchronized");
    } else {
      (0, import_cli_core.warning)("Configurations are not synchronized");
      if (fix) {
        (0, import_cli_core.info)("Attempting to synchronize...");
        integration.syncConfiguration();
        (0, import_cli_core.success)("Synchronization completed");
      }
    }
    (0, import_cli_core.success)("All validations passed");
  } catch (err) {
    (0, import_cli_core.error)(`Validation failed: ${err.message}`);
  }
}
__name(handleValidate, "handleValidate");
async function handlePreset(ctx) {
  if (ctx.args.length < 2) {
    (0, import_cli_core.error)("Preset type is required");
    console.log("Available presets: development, research, production");
    return;
  }
  const presetType = ctx.args[1];
  const dryRun = ctx.flags.dryRun || ctx.flags["dry-run"];
  if (!["development", "research", "production"].includes(presetType)) {
    (0, import_cli_core.error)("Invalid preset type");
    console.log("Available presets: development, research, production");
    return;
  }
  try {
    if (dryRun) {
      (0, import_cli_core.info)(`Showing ${presetType} preset configuration (dry run):`);
      const config = import_ruv_swarm_integration.RuvSwarmConfigHelpers.getConfigForUseCase(presetType);
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    (0, import_cli_core.info)(`Applying ${presetType} preset...`);
    switch (presetType) {
      case "development":
        import_ruv_swarm_integration.RuvSwarmConfigHelpers.setupDevelopmentConfig();
        break;
      case "research":
        import_ruv_swarm_integration.RuvSwarmConfigHelpers.setupResearchConfig();
        break;
      case "production":
        import_ruv_swarm_integration.RuvSwarmConfigHelpers.setupProductionConfig();
        break;
    }
    await import_config_manager.configManager.save();
    (0, import_cli_core.success)(`${presetType} preset applied successfully`);
    const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
    const status = integration.getStatus();
    console.log("\\n\u{1F4CB} Applied Configuration:");
    console.log(`  Topology: ${status.mainConfig.defaultTopology}`);
    console.log(`  Max Agents: ${status.mainConfig.maxAgents}`);
    console.log(`  Strategy: ${status.mainConfig.defaultStrategy}`);
    console.log(
      `  Features: ${Object.entries(status.mainConfig).filter(([key, value]) => key.startsWith("enable") && value).map(([key]) => key.replace("enable", "").toLowerCase()).join(", ")}`
    );
  } catch (err) {
    (0, import_cli_core.error)(`Failed to apply preset: ${err.message}`);
  }
}
__name(handlePreset, "handlePreset");
async function handleExport(ctx) {
  if (ctx.args.length < 2) {
    (0, import_cli_core.error)("Export file path is required");
    console.log("Usage: config-integration export <file>");
    return;
  }
  const filePath = ctx.args[1];
  const format = ctx.flags.format || "json";
  try {
    const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
    const status = integration.getStatus();
    const exportData = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: "1.0.0",
      main: status.mainConfig,
      ruvSwarm: status.ruvSwarmConfig,
      unified: integration.getUnifiedCommandArgs()
    };
    const { writeFile } = await import("fs/promises");
    if (format === "yaml") {
      const yamlContent = `# Claude-Flow Configuration Export
# Generated: ${exportData.timestamp}

main:
${JSON.stringify(exportData.main, null, 2).split("\\n").map((line) => "  " + line).join("\\n")}

ruvSwarm:
${JSON.stringify(exportData.ruvSwarm, null, 2).split("\\n").map((line) => "  " + line).join("\\n")}

unified:
${JSON.stringify(exportData.unified, null, 2).split("\\n").map((line) => "  " + line).join("\\n")}
`;
      await writeFile(filePath, yamlContent, "utf8");
    } else {
      await writeFile(filePath, JSON.stringify(exportData, null, 2), "utf8");
    }
    (0, import_cli_core.success)(`Configuration exported to: ${filePath}`);
    console.log(`\u{1F4C4} Format: ${format}`);
    console.log(`\u{1F4CA} Size: ${JSON.stringify(exportData).length} bytes`);
  } catch (err) {
    (0, import_cli_core.error)(`Export failed: ${err.message}`);
  }
}
__name(handleExport, "handleExport");
async function handleImport(ctx) {
  if (ctx.args.length < 2) {
    (0, import_cli_core.error)("Import file path is required");
    console.log("Usage: config-integration import <file>");
    return;
  }
  const filePath = ctx.args[1];
  const dryRun = ctx.flags.dryRun || ctx.flags["dry-run"];
  const force = ctx.flags.force || ctx.flags.f;
  try {
    const { readFile } = await import("fs/promises");
    const content = await readFile(filePath, "utf8");
    let importData;
    try {
      importData = JSON.parse(content);
    } catch {
      (0, import_cli_core.error)("Invalid JSON format in import file");
      return;
    }
    if (!importData.main || !importData.ruvSwarm) {
      (0, import_cli_core.error)("Import file does not contain required configuration sections");
      return;
    }
    if (dryRun) {
      (0, import_cli_core.info)("Import preview (dry run):");
      console.log("\\n\u{1F4CB} Main Configuration Changes:");
      console.log(JSON.stringify(importData.main, null, 2));
      console.log("\\n\u{1F9E0} ruv-swarm Configuration Changes:");
      console.log(JSON.stringify(importData.ruvSwarm, null, 2));
      return;
    }
    if (!force) {
      (0, import_cli_core.warning)("This will overwrite current configuration");
      console.log("Use --force to proceed or --dry-run to preview changes");
      return;
    }
    (0, import_cli_core.info)("Importing configuration...");
    const integration = (0, import_ruv_swarm_integration.getRuvSwarmIntegration)();
    integration.updateConfiguration({
      main: importData.main,
      ruvSwarm: importData.ruvSwarm
    });
    await import_config_manager.configManager.save();
    (0, import_cli_core.success)("Configuration imported successfully");
    console.log(`\u{1F4C4} Source: ${filePath}`);
    console.log(`\u{1F4C5} Imported: ${importData.timestamp || "Unknown timestamp"}`);
  } catch (err) {
    (0, import_cli_core.error)(`Import failed: ${err.message}`);
  }
}
__name(handleImport, "handleImport");
var config_integration_default = {
  configIntegrationAction
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  configIntegrationAction
});
//# sourceMappingURL=config-integration.js.map
