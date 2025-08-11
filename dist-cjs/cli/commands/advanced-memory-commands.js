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
var advanced_memory_commands_exports = {};
__export(advanced_memory_commands_exports, {
  advancedMemoryCommand: () => advancedMemoryCommand
});
module.exports = __toCommonJS(advanced_memory_commands_exports);
var import_error_handler = require("../../utils/error-handler.js");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_advanced_memory_manager = require("../../memory/advanced-memory-manager.js");
var import_logger = require("../../core/logger.js");
const logger = import_logger.Logger.getInstance();
let memoryManager = null;
function printSuccess(message) {
  console.log(`\u2705 ${message}`);
}
__name(printSuccess, "printSuccess");
function printError(message) {
  console.error(`\u274C ${message}`);
}
__name(printError, "printError");
function printWarning(message) {
  console.warn(`\u26A0\uFE0F  ${message}`);
}
__name(printWarning, "printWarning");
function printInfo(message) {
  console.log(`\u2139\uFE0F  ${message}`);
}
__name(printInfo, "printInfo");
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
__name(formatBytes, "formatBytes");
function formatDuration(ms) {
  if (ms < 1e3)
    return `${ms}ms`;
  if (ms < 6e4)
    return `${(ms / 1e3).toFixed(1)}s`;
  return `${(ms / 6e4).toFixed(1)}m`;
}
__name(formatDuration, "formatDuration");
async function ensureMemoryManager() {
  if (!memoryManager) {
    memoryManager = new import_advanced_memory_manager.AdvancedMemoryManager(
      {
        maxMemorySize: 1024 * 1024 * 1024,
        // 1GB
        autoCompress: true,
        autoCleanup: true,
        indexingEnabled: true,
        persistenceEnabled: true
      },
      logger
    );
    await memoryManager.initialize();
  }
  return memoryManager;
}
__name(ensureMemoryManager, "ensureMemoryManager");
async function advancedMemoryCommand(subArgs, flags) {
  const subcommand = subArgs[0];
  if (!subcommand) {
    showAdvancedMemoryHelp();
    return;
  }
  try {
    switch (subcommand) {
      case "query":
        await queryCommand(subArgs.slice(1), flags);
        break;
      case "export":
        await exportCommand(subArgs.slice(1), flags);
        break;
      case "import":
        await importCommand(subArgs.slice(1), flags);
        break;
      case "stats":
        await statsCommand(subArgs.slice(1), flags);
        break;
      case "cleanup":
        await cleanupCommand(subArgs.slice(1), flags);
        break;
      case "store":
        await storeCommand(subArgs.slice(1), flags);
        break;
      case "get":
        await getCommand(subArgs.slice(1), flags);
        break;
      case "delete":
        await deleteCommand(subArgs.slice(1), flags);
        break;
      case "list":
        await listCommand(subArgs.slice(1), flags);
        break;
      case "namespaces":
        await namespacesCommand(subArgs.slice(1), flags);
        break;
      case "types":
        await typesCommand(subArgs.slice(1), flags);
        break;
      case "tags":
        await tagsCommand(subArgs.slice(1), flags);
        break;
      case "config":
        await configCommand(subArgs.slice(1), flags);
        break;
      default:
        printError(`Unknown command: ${subcommand}`);
        showAdvancedMemoryHelp();
    }
  } catch (error) {
    const message = (0, import_error_handler.getErrorMessage)(error);
    printError(`Command failed: ${message}`);
    logger.error("Advanced memory command error", { error: message, subcommand, subArgs, flags });
  }
}
__name(advancedMemoryCommand, "advancedMemoryCommand");
function showAdvancedMemoryHelp() {
  console.log("\u{1F9E0} Advanced Memory Management System\n");
  console.log("Available commands:");
  console.log(
    "  memory query <search> [options]     - Flexible searching with filters and aggregation"
  );
  console.log("  memory export <file> [options]      - Export memory data in multiple formats");
  console.log(
    "  memory import <file> [options]      - Import data with validation and transformation"
  );
  console.log(
    "  memory stats [options]              - Comprehensive statistics and optimization suggestions"
  );
  console.log(
    "  memory cleanup [options]            - Intelligent cleanup with archiving and retention"
  );
  console.log("  memory store <key> <value> [opts]   - Store data with advanced options");
  console.log("  memory get <key> [options]          - Retrieve data with caching");
  console.log("  memory delete <key> [options]       - Delete specific entries");
  console.log("  memory list [options]               - List entries with filtering");
  console.log("  memory namespaces                   - List all namespaces");
  console.log("  memory types                        - List all data types");
  console.log("  memory tags                         - List all tags");
  console.log("  memory config [options]             - View/update configuration");
  console.log("\nFeatures:");
  console.log("  \u2022 Advanced querying with indexing and full-text search");
  console.log("  \u2022 Multiple export/import formats (JSON, CSV, XML, YAML)");
  console.log("  \u2022 Intelligent cleanup with retention policies");
  console.log("  \u2022 Compression and encryption support");
  console.log("  \u2022 Cross-agent sharing and synchronization");
  console.log("  \u2022 Performance analytics and optimization suggestions");
}
__name(showAdvancedMemoryHelp, "showAdvancedMemoryHelp");
async function queryCommand(args, flags) {
  const search = args[0];
  if (!search) {
    printError("Usage: memory query <search> [options]");
    console.log("Options:");
    console.log("  --namespace <ns>        Filter by namespace");
    console.log("  --type <type>           Filter by data type");
    console.log("  --tags <tags>           Filter by tags (comma-separated)");
    console.log("  --owner <owner>         Filter by owner");
    console.log("  --access-level <level>  Filter by access level (private|shared|public)");
    console.log("  --key-pattern <pattern> Key pattern (regex)");
    console.log("  --value-search <text>   Search in values");
    console.log("  --full-text <text>      Full-text search");
    console.log("  --created-after <date>  Created after date (ISO format)");
    console.log("  --created-before <date> Created before date (ISO format)");
    console.log("  --updated-after <date>  Updated after date (ISO format)");
    console.log("  --updated-before <date> Updated before date (ISO format)");
    console.log("  --size-gt <bytes>       Size greater than (bytes)");
    console.log("  --size-lt <bytes>       Size less than (bytes)");
    console.log("  --include-expired       Include expired entries");
    console.log("  --limit <num>           Limit results");
    console.log("  --offset <num>          Offset for pagination");
    console.log(
      "  --sort-by <field>       Sort by field (key|createdAt|updatedAt|lastAccessedAt|size|type)"
    );
    console.log("  --sort-order <order>    Sort order (asc|desc)");
    console.log("  --aggregate-by <field>  Generate aggregations (namespace|type|owner|tags)");
    console.log("  --include-metadata      Include full metadata in results");
    console.log("  --format <format>       Output format (table|json|csv)");
    return;
  }
  try {
    const manager = await ensureMemoryManager();
    const startTime = Date.now();
    const queryOptions = {
      fullTextSearch: search,
      namespace: flags.namespace,
      type: flags.type,
      tags: flags.tags ? flags.tags.split(",").map((t) => t.trim()) : void 0,
      owner: flags.owner,
      accessLevel: flags["access-level"],
      keyPattern: flags["key-pattern"],
      valueSearch: flags["value-search"],
      createdAfter: flags["created-after"] ? new Date(flags["created-after"]) : void 0,
      createdBefore: flags["created-before"] ? new Date(flags["created-before"]) : void 0,
      updatedAfter: flags["updated-after"] ? new Date(flags["updated-after"]) : void 0,
      updatedBefore: flags["updated-before"] ? new Date(flags["updated-before"]) : void 0,
      sizeGreaterThan: flags["size-gt"] ? parseInt(flags["size-gt"]) : void 0,
      sizeLessThan: flags["size-lt"] ? parseInt(flags["size-lt"]) : void 0,
      includeExpired: flags["include-expired"],
      limit: flags.limit ? parseInt(flags.limit) : void 0,
      offset: flags.offset ? parseInt(flags.offset) : void 0,
      sortBy: flags["sort-by"],
      sortOrder: flags["sort-order"] || "asc",
      aggregateBy: flags["aggregate-by"],
      includeMetadata: flags["include-metadata"]
    };
    const result = await manager.query(queryOptions);
    const duration = Date.now() - startTime;
    printSuccess(`Found ${result.total} entries in ${formatDuration(duration)}`);
    if (result.entries.length === 0) {
      printInfo("No entries match your query criteria.");
      return;
    }
    const format = flags.format || "table";
    switch (format) {
      case "json":
        console.log(
          JSON.stringify(
            {
              query: queryOptions,
              results: result,
              executionTime: duration
            },
            null,
            2
          )
        );
        break;
      case "csv":
        console.log("key,value,type,namespace,tags,size,created,updated");
        for (const entry of result.entries) {
          console.log(
            [
              entry.key,
              JSON.stringify(entry.value).replace(/"/g, '""'),
              entry.type,
              entry.namespace,
              entry.tags.join(";"),
              entry.size,
              entry.createdAt.toISOString(),
              entry.updatedAt.toISOString()
            ].join(",")
          );
        }
        break;
      default:
        console.log("\n\u{1F4CB} Query Results:\n");
        result.entries.forEach((entry, i) => {
          const value = typeof entry.value === "string" && entry.value.length > 100 ? entry.value.substring(0, 100) + "..." : JSON.stringify(entry.value);
          console.log(`${i + 1}. ${entry.key}`);
          console.log(
            `   Type: ${entry.type} | Namespace: ${entry.namespace} | Size: ${formatBytes(entry.size)}`
          );
          console.log(`   Tags: [${entry.tags.join(", ")}]`);
          console.log(`   Value: ${value}`);
          console.log(
            `   Created: ${entry.createdAt.toLocaleString()} | Updated: ${entry.updatedAt.toLocaleString()}`
          );
          console.log(`   Last Accessed: ${entry.lastAccessedAt.toLocaleString()}`);
          if (flags["include-metadata"] && Object.keys(entry.metadata).length > 0) {
            console.log(`   Metadata: ${JSON.stringify(entry.metadata)}`);
          }
          console.log();
        });
    }
    if (result.aggregations) {
      console.log("\n\u{1F4CA} Aggregations:\n");
      for (const [key, value] of Object.entries(result.aggregations)) {
        console.log(`${key}:`);
        for (const [subKey, stats] of Object.entries(value)) {
          console.log(`  ${subKey}: ${stats.count} entries, ${formatBytes(stats.totalSize)}`);
        }
        console.log();
      }
    }
    if (result.total > result.entries.length) {
      const showing = (flags.offset ? parseInt(flags.offset) : 0) + result.entries.length;
      console.log(`Showing ${showing} of ${result.total} entries`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printError(`Query failed: ${message}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}
__name(queryCommand, "queryCommand");
async function exportCommand(args, flags) {
  const file = args[0];
  if (!file) {
    printError("Usage: memory export <file> [options]");
    console.log("Options:");
    console.log("  --format <format>       Export format (json|csv|xml|yaml)");
    console.log("  --namespace <namespace> Export specific namespace");
    console.log("  --type <type>           Export specific type");
    console.log("  --include-metadata      Include full metadata");
    console.log("  --compression           Enable compression");
    console.log("  --encrypt               Enable encryption");
    console.log("  --encrypt-key <key>     Encryption key");
    console.log("  --filter-query <json>   Advanced filtering (JSON query options)");
    return;
  }
  try {
    const manager = await ensureMemoryManager();
    let format = flags.format;
    if (!format) {
      const ext = (0, import_node_path.extname)(file).toLowerCase();
      switch (ext) {
        case ".json":
          format = "json";
          break;
        case ".csv":
          format = "csv";
          break;
        case ".xml":
          format = "xml";
          break;
        case ".yaml":
        case ".yml":
          format = "yaml";
          break;
        default:
          format = "json";
      }
    }
    let filtering;
    if (flags["filter-query"]) {
      try {
        filtering = JSON.parse(flags["filter-query"]);
      } catch (error) {
        printError("Invalid filter query JSON format");
        return;
      }
    }
    const exportOptions = {
      format,
      namespace: flags.namespace,
      type: flags.type,
      includeMetadata: flags["include-metadata"],
      compression: flags.compression,
      encryption: flags.encrypt ? {
        enabled: true,
        key: flags["encrypt-key"]
      } : void 0,
      filtering
    };
    printInfo(`Starting export to ${file} (format: ${format})`);
    const startTime = Date.now();
    const result = await manager.export(file, exportOptions);
    const duration = Date.now() - startTime;
    printSuccess(`Export completed in ${formatDuration(duration)}`);
    console.log(`\u{1F4CA} Exported: ${result.entriesExported} entries`);
    console.log(`\u{1F4C1} File size: ${formatBytes(result.fileSize)}`);
    console.log(`\u{1F512} Checksum: ${result.checksum}`);
    if (flags.compression) {
      printInfo("Data was compressed during export");
    }
    if (flags.encrypt) {
      printInfo("Data was encrypted during export");
    }
  } catch (error) {
    printError(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}
__name(exportCommand, "exportCommand");
async function importCommand(args, flags) {
  const file = args[0];
  if (!file) {
    printError("Usage: memory import <file> [options]");
    console.log("Options:");
    console.log("  --format <format>           Import format (json|csv|xml|yaml)");
    console.log("  --namespace <namespace>     Target namespace for imported data");
    console.log(
      "  --conflict-resolution <strategy> Conflict resolution (overwrite|skip|merge|rename)"
    );
    console.log("  --validation                Enable data validation");
    console.log("  --dry-run                   Show what would be imported without making changes");
    return;
  }
  try {
    try {
      await import_node_fs.promises.access(file);
    } catch {
      printError(`File not found: ${file}`);
      return;
    }
    const manager = await ensureMemoryManager();
    let format = flags.format;
    if (!format) {
      const ext = (0, import_node_path.extname)(file).toLowerCase();
      switch (ext) {
        case ".json":
          format = "json";
          break;
        case ".csv":
          format = "csv";
          break;
        case ".xml":
          format = "xml";
          break;
        case ".yaml":
        case ".yml":
          format = "yaml";
          break;
        default:
          printError("Cannot determine format from file extension. Please specify --format");
          return;
      }
    }
    const importOptions = {
      format,
      namespace: flags.namespace,
      conflictResolution: flags["conflict-resolution"] || "skip",
      validation: flags.validation,
      dryRun: flags["dry-run"]
    };
    if (flags["dry-run"]) {
      printWarning("DRY RUN MODE - No changes will be made");
    }
    printInfo(`Starting import from ${file} (format: ${format})`);
    const startTime = Date.now();
    const result = await manager.import(file, importOptions);
    const duration = Date.now() - startTime;
    printSuccess(`Import completed in ${formatDuration(duration)}`);
    if (result.entriesImported > 0) {
      console.log(`\u{1F4E5} Imported: ${result.entriesImported} entries`);
    }
    if (result.entriesUpdated > 0) {
      console.log(`\u{1F504} Updated: ${result.entriesUpdated} entries`);
    }
    if (result.entriesSkipped > 0) {
      console.log(`\u23ED\uFE0F  Skipped: ${result.entriesSkipped} entries`);
    }
    if (result.conflicts.length > 0) {
      console.log(`\u26A0\uFE0F  Conflicts: ${result.conflicts.length}`);
      if (result.conflicts.length <= 10) {
        result.conflicts.forEach((conflict) => {
          console.log(`   \u2022 ${conflict}`);
        });
      } else {
        result.conflicts.slice(0, 10).forEach((conflict) => {
          console.log(`   \u2022 ${conflict}`);
        });
        console.log(`   ... and ${result.conflicts.length - 10} more`);
      }
    }
  } catch (error) {
    printError(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}
__name(importCommand, "importCommand");
async function statsCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    const startTime = Date.now();
    const stats = await manager.getStatistics();
    const duration = Date.now() - startTime;
    if (flags.format === "json") {
      const output = {
        statistics: stats,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        generationTime: duration
      };
      if (flags.export) {
        await import_node_fs.promises.writeFile(flags.export, JSON.stringify(output, null, 2));
        printSuccess(`Statistics exported to ${flags.export}`);
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
      return;
    }
    console.log("\u{1F9E0} Memory System Statistics\n");
    console.log("\u{1F4CA} Overview:");
    console.log(`   Total Entries: ${stats.overview.totalEntries.toLocaleString()}`);
    console.log(`   Total Size: ${formatBytes(stats.overview.totalSize)}`);
    console.log(
      `   Compressed Entries: ${stats.overview.compressedEntries.toLocaleString()} (${(stats.overview.compressionRatio * 100).toFixed(1)}% compression)`
    );
    console.log(`   Index Size: ${formatBytes(stats.overview.indexSize)}`);
    console.log(`   Memory Usage: ${formatBytes(stats.overview.memoryUsage)}`);
    console.log(`   Disk Usage: ${formatBytes(stats.overview.diskUsage)}`);
    console.log();
    console.log("\u{1F4C8} Distribution:");
    if (Object.keys(stats.distribution.byNamespace).length > 0) {
      console.log("   By Namespace:");
      for (const [namespace, data] of Object.entries(stats.distribution.byNamespace)) {
        console.log(`     ${namespace}: ${data.count} entries, ${formatBytes(data.size)}`);
      }
    }
    if (Object.keys(stats.distribution.byType).length > 0) {
      console.log("   By Type:");
      for (const [type, data] of Object.entries(stats.distribution.byType)) {
        console.log(`     ${type}: ${data.count} entries, ${formatBytes(data.size)}`);
      }
    }
    console.log();
    console.log("\u26A1 Performance:");
    console.log(`   Average Query Time: ${formatDuration(stats.performance.averageQueryTime)}`);
    console.log(`   Average Write Time: ${formatDuration(stats.performance.averageWriteTime)}`);
    console.log(`   Cache Hit Ratio: ${(stats.performance.cacheHitRatio * 100).toFixed(1)}%`);
    console.log(`   Index Efficiency: ${(stats.performance.indexEfficiency * 100).toFixed(1)}%`);
    console.log();
    console.log("\u{1F3E5} Health:");
    const healthStatus = stats.health.recommendedCleanup ? "Needs Attention" : "Healthy";
    console.log(`   Status: ${healthStatus}`);
    console.log(`   Expired Entries: ${stats.health.expiredEntries}`);
    console.log(`   Orphaned References: ${stats.health.orphanedReferences}`);
    console.log(`   Duplicate Keys: ${stats.health.duplicateKeys}`);
    console.log(`   Corrupted Entries: ${stats.health.corruptedEntries}`);
    console.log();
    if (stats.optimization.suggestions.length > 0) {
      console.log("\u{1F4A1} Optimization Suggestions:");
      stats.optimization.suggestions.forEach((suggestion) => {
        console.log(`   \u2022 ${suggestion}`);
      });
      console.log();
      console.log("\u{1F4B0} Potential Savings:");
      console.log(
        `   Compression: ${formatBytes(stats.optimization.potentialSavings.compression)}`
      );
      console.log(`   Cleanup: ${formatBytes(stats.optimization.potentialSavings.cleanup)}`);
      console.log(
        `   Deduplication: ${formatBytes(stats.optimization.potentialSavings.deduplication)}`
      );
      console.log();
    }
    console.log(`Statistics generated in ${formatDuration(duration)}`);
    if (flags.export) {
      const output = {
        statistics: stats,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        generationTime: duration
      };
      await import_node_fs.promises.writeFile(flags.export, JSON.stringify(output, null, 2));
      printSuccess(`Statistics exported to ${flags.export}`);
    }
  } catch (error) {
    printError(`Stats failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}
__name(statsCommand, "statsCommand");
async function cleanupCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    if (flags["dry-run"]) {
      printWarning("DRY RUN MODE - No changes will be made");
    }
    const cleanupOptions = {
      dryRun: flags["dry-run"],
      removeExpired: flags["remove-expired"] !== false,
      removeOlderThan: flags["remove-older-than"] ? parseInt(flags["remove-older-than"]) : void 0,
      removeUnaccessed: flags["remove-unaccessed"] ? parseInt(flags["remove-unaccessed"]) : void 0,
      removeOrphaned: flags["remove-orphaned"] !== false,
      removeDuplicates: flags["remove-duplicates"],
      compressEligible: flags["compress-eligible"] !== false,
      archiveOld: flags["archive-old"] ? {
        enabled: true,
        olderThan: flags["archive-older-than"] ? parseInt(flags["archive-older-than"]) : 365,
        archivePath: flags["archive-path"] || "./memory/archive"
      } : void 0
    };
    printInfo("Starting memory cleanup...");
    const startTime = Date.now();
    const result = await manager.cleanup(cleanupOptions);
    const duration = Date.now() - startTime;
    printSuccess(`Cleanup completed in ${formatDuration(duration)}`);
    if (result.entriesRemoved > 0) {
      console.log(`\u{1F5D1}\uFE0F  Removed: ${result.entriesRemoved} entries`);
    }
    if (result.entriesArchived > 0) {
      console.log(`\u{1F4E6} Archived: ${result.entriesArchived} entries`);
    }
    if (result.entriesCompressed > 0) {
      console.log(`\u{1F5DC}\uFE0F  Compressed: ${result.entriesCompressed} entries`);
    }
    if (result.spaceSaved > 0) {
      console.log(`\u{1F4BE} Space Saved: ${formatBytes(result.spaceSaved)}`);
    }
    if (result.actions.length > 0) {
      console.log("\n\u{1F4CB} Actions Performed:");
      result.actions.forEach((action) => {
        console.log(`   \u2022 ${action}`);
      });
    }
    if (flags["dry-run"] && (result.entriesRemoved > 0 || result.entriesArchived > 0)) {
      printInfo("Run without --dry-run to perform these actions");
    }
  } catch (error) {
    printError(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    if (flags.debug) {
      console.error(error);
    }
  }
}
__name(cleanupCommand, "cleanupCommand");
async function storeCommand(args, flags) {
  const key = args[0];
  const value = args.slice(1).join(" ");
  if (!key || !value) {
    printError("Usage: memory store <key> <value> [options]");
    console.log("Options:");
    console.log("  --namespace <namespace> Target namespace (default: default)");
    console.log("  --type <type>           Data type");
    console.log("  --tags <tags>           Tags (comma-separated)");
    console.log("  --owner <owner>         Entry owner (default: system)");
    console.log("  --access-level <level>  Access level (private|shared|public, default: shared)");
    console.log("  --ttl <ms>              Time-to-live in milliseconds");
    console.log("  --compress              Force compression");
    return;
  }
  try {
    const manager = await ensureMemoryManager();
    let parsedValue;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }
    const entryId = await manager.store(key, parsedValue, {
      namespace: flags.namespace || "default",
      type: flags.type,
      tags: flags.tags ? flags.tags.split(",").map((t) => t.trim()) : void 0,
      owner: flags.owner || "system",
      accessLevel: flags["access-level"] || "shared",
      ttl: flags.ttl ? parseInt(flags.ttl) : void 0,
      compress: flags.compress
    });
    printSuccess("Entry stored successfully");
    console.log(`\u{1F4DD} Entry ID: ${entryId}`);
    console.log(`\u{1F511} Key: ${key}`);
    console.log(`\u{1F4E6} Namespace: ${flags.namespace || "default"}`);
    console.log(`\u{1F3F7}\uFE0F  Type: ${flags.type || "auto-detected"}`);
    if (flags.tags) {
      console.log(`\u{1F3F7}\uFE0F  Tags: [${flags.tags}]`);
    }
    if (flags.ttl) {
      const expiresAt = new Date(Date.now() + parseInt(flags.ttl));
      console.log(`\u23F0 Expires: ${expiresAt.toLocaleString()}`);
    }
  } catch (error) {
    printError(`Store failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
__name(storeCommand, "storeCommand");
async function getCommand(args, flags) {
  const key = args[0];
  if (!key) {
    printError("Usage: memory get <key> [options]");
    console.log("Options:");
    console.log("  --namespace <namespace> Target namespace");
    console.log("  --format <format>       Output format (json|pretty, default: pretty)");
    return;
  }
  try {
    const manager = await ensureMemoryManager();
    const entry = await manager.retrieve(key, {
      namespace: flags.namespace,
      updateLastAccessed: true
    });
    if (!entry) {
      printWarning(`Entry not found: ${key}`);
      return;
    }
    if (flags.format === "json") {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      printSuccess(`Entry found: ${key}`);
      console.log(`\u{1F4DD} Entry ID: ${entry.id}`);
      console.log(`\u{1F511} Key: ${entry.key}`);
      console.log(`\u{1F4E6} Namespace: ${entry.namespace}`);
      console.log(`\u{1F3F7}\uFE0F  Type: ${entry.type}`);
      console.log(`\u{1F4BE} Size: ${formatBytes(entry.size)}`);
      console.log(`\u{1F4CA} Version: ${entry.version}`);
      console.log(`\u{1F464} Owner: ${entry.owner}`);
      console.log(`\u{1F512} Access: ${entry.accessLevel}`);
      if (entry.tags.length > 0) {
        console.log(`\u{1F3F7}\uFE0F  Tags: [${entry.tags.join(", ")}]`);
      }
      console.log(`\u{1F4C5} Created: ${entry.createdAt.toLocaleString()}`);
      console.log(`\u{1F4C5} Updated: ${entry.updatedAt.toLocaleString()}`);
      console.log(`\u{1F4C5} Last Accessed: ${entry.lastAccessedAt.toLocaleString()}`);
      if (entry.expiresAt) {
        console.log(`\u23F0 Expires: ${entry.expiresAt.toLocaleString()}`);
      }
      if (entry.compressed) {
        console.log(`\u{1F5DC}\uFE0F  Compressed: Yes`);
      }
      console.log(`\u{1F4BE} Value:`);
      if (typeof entry.value === "string" && entry.value.length > 500) {
        console.log(entry.value.substring(0, 500) + "...");
        console.log(`(showing first 500 characters of ${entry.value.length} total)`);
      } else {
        console.log(JSON.stringify(entry.value, null, 2));
      }
    }
  } catch (error) {
    printError(`Retrieve failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
__name(getCommand, "getCommand");
async function deleteCommand(args, flags) {
  const key = args[0];
  if (!key) {
    printError("Usage: memory delete <key> [options]");
    console.log("Options:");
    console.log("  --namespace <namespace> Target namespace");
    console.log("  --confirm               Skip confirmation prompt");
    return;
  }
  try {
    const manager = await ensureMemoryManager();
    const entry = await manager.retrieve(key, { namespace: flags.namespace });
    if (!entry) {
      printWarning(`Entry not found: ${key}`);
      return;
    }
    if (!flags.confirm) {
      console.log(`About to delete entry: ${key} (namespace: ${entry.namespace})`);
      console.log("Add --confirm to proceed without this prompt");
      return;
    }
    const success = await manager.deleteEntry(entry.id);
    if (success) {
      printSuccess(`Entry deleted: ${key}`);
    } else {
      printError(`Failed to delete entry: ${key}`);
    }
  } catch (error) {
    printError(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
__name(deleteCommand, "deleteCommand");
async function listCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    const result = await manager.query({
      namespace: flags.namespace,
      type: flags.type,
      limit: flags.limit ? parseInt(flags.limit) : 20,
      offset: flags.offset ? parseInt(flags.offset) : 0,
      sortBy: flags["sort-by"] || "updatedAt",
      sortOrder: flags["sort-order"] || "desc"
    });
    if (result.entries.length === 0) {
      printInfo("No entries found");
      return;
    }
    console.log(`
\u{1F4CB} Memory Entries (${result.total} total):
`);
    result.entries.forEach((entry, i) => {
      const num = (flags.offset ? parseInt(flags.offset) : 0) + i + 1;
      console.log(`${num}. ${entry.key}`);
      console.log(
        `   Namespace: ${entry.namespace} | Type: ${entry.type} | Size: ${formatBytes(entry.size)}`
      );
      console.log(`   Updated: ${entry.updatedAt.toLocaleString()}`);
      if (entry.tags.length > 0) {
        console.log(`   Tags: [${entry.tags.join(", ")}]`);
      }
      console.log();
    });
    if (result.total > result.entries.length) {
      const showing = (flags.offset ? parseInt(flags.offset) : 0) + result.entries.length;
      console.log(`Showing ${showing} of ${result.total} entries`);
    }
  } catch (error) {
    printError(`List failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
__name(listCommand, "listCommand");
async function namespacesCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    const namespaces = await manager.listNamespaces();
    if (namespaces.length === 0) {
      printInfo("No namespaces found");
      return;
    }
    console.log("\n\u{1F4C1} Namespaces:\n");
    namespaces.forEach((namespace, i) => {
      console.log(`${i + 1}. ${namespace}`);
    });
  } catch (error) {
    printError(
      `Failed to list namespaces: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
__name(namespacesCommand, "namespacesCommand");
async function typesCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    const types = await manager.listTypes();
    if (types.length === 0) {
      printInfo("No types found");
      return;
    }
    console.log("\n\u{1F3F7}\uFE0F  Data Types:\n");
    types.forEach((type, i) => {
      console.log(`${i + 1}. ${type}`);
    });
  } catch (error) {
    printError(`Failed to list types: ${error instanceof Error ? error.message : String(error)}`);
  }
}
__name(typesCommand, "typesCommand");
async function tagsCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    const tags = await manager.listTags();
    if (tags.length === 0) {
      printInfo("No tags found");
      return;
    }
    console.log("\n\u{1F3F7}\uFE0F  Tags:\n");
    tags.forEach((tag, i) => {
      console.log(`${i + 1}. ${tag}`);
    });
  } catch (error) {
    printError(`Failed to list tags: ${error instanceof Error ? error.message : String(error)}`);
  }
}
__name(tagsCommand, "tagsCommand");
async function configCommand(args, flags) {
  try {
    const manager = await ensureMemoryManager();
    if (flags.set) {
      try {
        const updates = JSON.parse(flags.set);
        await manager.updateConfiguration(updates);
        printSuccess("Configuration updated");
      } catch (error) {
        printError("Invalid configuration JSON format");
        return;
      }
    }
    if (flags.show || !flags.set) {
      const config = manager.getConfiguration();
      console.log("\n\u2699\uFE0F  Memory System Configuration:\n");
      console.log(JSON.stringify(config, null, 2));
    }
  } catch (error) {
    printError(
      `Configuration operation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
__name(configCommand, "configCommand");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  advancedMemoryCommand
});
//# sourceMappingURL=advanced-memory-commands.js.map
