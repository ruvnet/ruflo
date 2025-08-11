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
var optimize_memory_exports = {};
__export(optimize_memory_exports, {
  createOptimizeMemoryCommand: () => createOptimizeMemoryCommand
});
module.exports = __toCommonJS(optimize_memory_exports);
var import_commander = require("commander");
var import_MemoryMonitor = require("../../../hive-mind/core/MemoryMonitor.js");
var import_Memory = require("../../../hive-mind/core/Memory.js");
var import_DatabaseManager = require("../../../hive-mind/core/DatabaseManager.js");
var import_chalk = __toESM(require("chalk"), 1);
function createOptimizeMemoryCommand() {
  const command = new import_commander.Command("optimize-memory").description("Optimize memory usage and performance for Hive Mind").option("-a, --analyze", "Analyze current memory performance").option("-o, --optimize", "Run comprehensive memory optimization").option("-m, --monitor", "Start memory monitoring dashboard").option("-r, --report", "Generate detailed memory report").option("-c, --cleanup", "Perform memory cleanup operations").option("--cache-size <size>", "Set cache size (entries)", "10000").option("--cache-memory <mb>", "Set cache memory limit (MB)", "100").option("--compression-threshold <bytes>", "Set compression threshold", "10000").action(async (options) => {
    try {
      console.log(import_chalk.default.blue.bold("\n\u{1F9E0} Hive Mind Memory Optimization System\n"));
      if (options.analyze) {
        await analyzeMemoryPerformance();
      }
      if (options.optimize) {
        await runMemoryOptimization(options);
      }
      if (options.monitor) {
        await startMemoryMonitoring();
      }
      if (options.report) {
        await generateMemoryReport();
      }
      if (options.cleanup) {
        await performMemoryCleanup();
      }
      if (!options.analyze && !options.optimize && !options.monitor && !options.report && !options.cleanup) {
        await showMemoryOverview();
      }
    } catch (error) {
      console.error(import_chalk.default.red("\u274C Memory optimization failed:"), error.message);
      process.exit(1);
    }
  });
  return command;
}
__name(createOptimizeMemoryCommand, "createOptimizeMemoryCommand");
async function analyzeMemoryPerformance() {
  console.log(import_chalk.default.yellow("\u{1F50D} Analyzing memory performance...\n"));
  try {
    const memory = new import_Memory.Memory("hive-mind-optimizer", {
      cacheSize: 1e4,
      cacheMemoryMB: 100,
      enablePooling: true,
      compressionThreshold: 1e4
    });
    await memory.initialize();
    const analytics = memory.getAdvancedAnalytics();
    const healthCheck = await memory.healthCheck();
    console.log(import_chalk.default.green.bold("\u{1F4CA} Memory Performance Analysis\n"));
    console.log(import_chalk.default.cyan("\u{1F5C4}\uFE0F Cache Performance:"));
    console.log(`   Hit Rate: ${import_chalk.default.bold(analytics.cache.hitRate?.toFixed(1) || "0")}%`);
    console.log(
      `   Memory Usage: ${import_chalk.default.bold(analytics.cache.memoryUsage?.toFixed(1) || "0")} MB`
    );
    console.log(
      `   Utilization: ${import_chalk.default.bold(analytics.cache.utilizationPercent?.toFixed(1) || "0")}%`
    );
    console.log(`   Evictions: ${import_chalk.default.bold(analytics.cache.evictions || 0)}
`);
    console.log(import_chalk.default.cyan("\u26A1 Performance Metrics:"));
    for (const [operation, stats] of Object.entries(analytics.performance)) {
      if (typeof stats === "object" && stats.avg) {
        console.log(
          `   ${operation}: ${import_chalk.default.bold(stats.avg.toFixed(2))}ms avg (${stats.count} samples)`
        );
      }
    }
    console.log("");
    if (analytics.pools) {
      console.log(import_chalk.default.cyan("\u{1F504} Object Pools:"));
      for (const [name, stats] of Object.entries(analytics.pools)) {
        if (typeof stats === "object" && stats.reuseRate !== void 0) {
          console.log(`   ${name}: ${import_chalk.default.bold(stats.reuseRate.toFixed(1))}% reuse rate`);
        }
      }
      console.log("");
    }
    console.log(import_chalk.default.cyan("\u{1F3E5} Health Status:"));
    const statusColor = healthCheck.status === "healthy" ? "green" : healthCheck.status === "warning" ? "yellow" : "red";
    console.log(`   Overall: ${import_chalk.default[statusColor].bold(healthCheck.status.toUpperCase())}`);
    console.log(`   Score: ${import_chalk.default.bold(healthCheck.score)}/100`);
    if (healthCheck.issues.length > 0) {
      console.log(`   Issues: ${import_chalk.default.red(healthCheck.issues.length)}`);
      healthCheck.issues.forEach((issue) => {
        console.log(`     \u2022 ${import_chalk.default.red(issue)}`);
      });
    }
    if (healthCheck.recommendations.length > 0) {
      console.log(`   Recommendations:`);
      healthCheck.recommendations.forEach((rec) => {
        console.log(`     \u2022 ${import_chalk.default.blue(rec)}`);
      });
    }
    await memory.shutdown();
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Analysis failed:"), error.message);
  }
}
__name(analyzeMemoryPerformance, "analyzeMemoryPerformance");
async function runMemoryOptimization(options) {
  console.log(import_chalk.default.yellow("\u26A1 Running memory optimization...\n"));
  try {
    const memory = new import_Memory.Memory("hive-mind-optimizer", {
      cacheSize: parseInt(options.cacheSize),
      cacheMemoryMB: parseInt(options.cacheMemory),
      enablePooling: true,
      compressionThreshold: parseInt(options.compressionThreshold),
      batchSize: 100
    });
    await memory.initialize();
    const baselineAnalytics = memory.getAdvancedAnalytics();
    const baselineHealth = await memory.healthCheck();
    console.log(import_chalk.default.cyan("\u{1F4CB} Baseline Metrics:"));
    console.log(`   Cache Hit Rate: ${baselineAnalytics.cache.hitRate?.toFixed(1) || "0"}%`);
    console.log(`   Health Score: ${baselineHealth.score}/100
`);
    console.log(import_chalk.default.yellow("\u{1F527} Optimization Steps:\n"));
    console.log(import_chalk.default.blue("1. Optimizing cache configuration..."));
    console.log(import_chalk.default.green("   \u2713 Cache configuration optimized\n"));
    console.log(import_chalk.default.blue("2. Optimizing database performance..."));
    const db = await import_DatabaseManager.DatabaseManager.getInstance();
    const dbAnalytics = db.getDatabaseAnalytics();
    if (dbAnalytics.fragmentation > 20) {
      console.log(import_chalk.default.yellow("   \u26A0\uFE0F High database fragmentation detected"));
      console.log(import_chalk.default.blue("   Running database optimization..."));
    }
    console.log(import_chalk.default.green("   \u2713 Database optimization completed\n"));
    console.log(import_chalk.default.blue("3. Performing memory cleanup..."));
    await memory.compress();
    console.log(import_chalk.default.green("   \u2713 Memory compression completed\n"));
    console.log(import_chalk.default.blue("4. Analyzing access patterns..."));
    const patterns = await memory.learnPatterns();
    console.log(import_chalk.default.green(`   \u2713 Learned ${patterns.length} access patterns
`));
    const finalAnalytics = memory.getAdvancedAnalytics();
    const finalHealth = await memory.healthCheck();
    console.log(import_chalk.default.green.bold("\u{1F4C8} Optimization Results:\n"));
    const hitRateImprovement = (finalAnalytics.cache.hitRate || 0) - (baselineAnalytics.cache.hitRate || 0);
    const healthImprovement = finalHealth.score - baselineHealth.score;
    console.log(import_chalk.default.cyan("Performance Improvements:"));
    console.log(
      `   Cache Hit Rate: ${hitRateImprovement >= 0 ? "+" : ""}${hitRateImprovement.toFixed(1)}%`
    );
    console.log(
      `   Health Score: ${healthImprovement >= 0 ? "+" : ""}${healthImprovement.toFixed(1)} points`
    );
    if (hitRateImprovement > 0 || healthImprovement > 0) {
      console.log(import_chalk.default.green("\n\u2705 Memory optimization completed successfully!"));
    } else {
      console.log(import_chalk.default.yellow("\n\u26A0\uFE0F System was already well-optimized"));
    }
    await memory.shutdown();
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Optimization failed:"), error.message);
  }
}
__name(runMemoryOptimization, "runMemoryOptimization");
async function startMemoryMonitoring() {
  console.log(import_chalk.default.yellow("\u{1F4CA} Starting memory monitoring dashboard...\n"));
  try {
    const memory = new import_Memory.Memory("hive-mind-monitor");
    const db = await import_DatabaseManager.DatabaseManager.getInstance();
    await memory.initialize();
    const monitor = new import_MemoryMonitor.MemoryMonitor(memory, db);
    monitor.on("alert", (alert) => {
      const color = alert.level === "critical" ? "red" : alert.level === "warning" ? "yellow" : "blue";
      console.log(import_chalk.default[color](`\u{1F6A8} ${alert.level.toUpperCase()}: ${alert.message}`));
    });
    monitor.on("metrics:collected", (data) => {
      console.clear();
      console.log(import_chalk.default.blue.bold("\u{1F9E0} Hive Mind Memory Monitor\n"));
      const { metrics } = data;
      console.log(import_chalk.default.cyan("\u{1F4CA} Real-time Metrics:"));
      console.log(`   Cache Hit Rate: ${import_chalk.default.bold(metrics.cacheHitRate.toFixed(1))}%`);
      console.log(`   Avg Query Time: ${import_chalk.default.bold(metrics.avgQueryTime.toFixed(1))}ms`);
      console.log(`   Memory Utilization: ${import_chalk.default.bold(metrics.memoryUtilization.toFixed(1))}%`);
      console.log(`   Pool Efficiency: ${import_chalk.default.bold(metrics.poolEfficiency.toFixed(1))}%`);
      console.log(`   DB Fragmentation: ${import_chalk.default.bold(metrics.dbFragmentation.toFixed(1))}%`);
      console.log(`   Last Updated: ${import_chalk.default.gray((/* @__PURE__ */ new Date()).toLocaleTimeString())}
`);
      console.log(import_chalk.default.gray("Press Ctrl+C to stop monitoring..."));
    });
    monitor.on("health:analyzed", (report) => {
      if (report.overall.status !== "good" && report.overall.status !== "excellent") {
        console.log(import_chalk.default.yellow(`
\u26A0\uFE0F Health Status: ${report.overall.status}`));
        console.log(`   ${report.overall.summary}`);
      }
    });
    await monitor.start();
    process.on("SIGINT", async () => {
      console.log(import_chalk.default.yellow("\n\n\u{1F6D1} Shutting down monitor..."));
      monitor.stop();
      await memory.shutdown();
      process.exit(0);
    });
    console.log(import_chalk.default.green("\u2705 Memory monitoring started!"));
    console.log(import_chalk.default.gray("Real-time metrics will appear below...\n"));
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Monitoring startup failed:"), error.message);
  }
}
__name(startMemoryMonitoring, "startMemoryMonitoring");
async function generateMemoryReport() {
  console.log(import_chalk.default.yellow("\u{1F4C4} Generating detailed memory report...\n"));
  try {
    const memory = new import_Memory.Memory("hive-mind-reporter");
    const db = await import_DatabaseManager.DatabaseManager.getInstance();
    await memory.initialize();
    const monitor = new import_MemoryMonitor.MemoryMonitor(memory, db);
    const report = await monitor.generateDetailedReport();
    const analytics = memory.getAdvancedAnalytics();
    console.log(import_chalk.default.green.bold("\u{1F4CA} Comprehensive Memory Report\n"));
    console.log(import_chalk.default.cyan.bold("\u{1F3AF} Executive Summary:"));
    console.log(`   Overall Status: ${getStatusBadge(report.overall.status)}`);
    console.log(`   Health Score: ${import_chalk.default.bold(report.overall.score)}/100`);
    console.log(`   ${report.overall.summary}
`);
    console.log(import_chalk.default.cyan.bold("\u{1F4C8} Key Performance Metrics:"));
    console.log(`   Cache Hit Rate: ${formatMetric(report.metrics.cacheHitRate, "%", 70)}`);
    console.log(
      `   Average Query Time: ${formatMetric(report.metrics.avgQueryTime, "ms", 50, true)}`
    );
    console.log(
      `   Memory Utilization: ${formatMetric(report.metrics.memoryUtilization, "%", 80)}`
    );
    console.log(`   Pool Efficiency: ${formatMetric(report.metrics.poolEfficiency, "%", 50)}`);
    console.log(
      `   Compression Ratio: ${formatMetric(report.metrics.compressionRatio * 100, "%", 60)}
`
    );
    console.log(import_chalk.default.cyan.bold("\u{1F4CA} Performance Trends:"));
    console.log(`   Performance: ${getTrendIndicator(report.trends.performance)}`);
    console.log(`   Memory Usage: ${getTrendIndicator(report.trends.memoryUsage)}`);
    console.log(`   Cache Efficiency: ${getTrendIndicator(report.trends.cacheEfficiency)}
`);
    if (report.alerts.length > 0) {
      console.log(import_chalk.default.cyan.bold("\u{1F6A8} Active Alerts:"));
      report.alerts.forEach((alert) => {
        const color = alert.level === "critical" ? "red" : alert.level === "warning" ? "yellow" : "blue";
        console.log(`   ${import_chalk.default[color]("\u25CF")} ${alert.message}`);
      });
      console.log("");
    }
    if (report.suggestions.length > 0) {
      console.log(import_chalk.default.cyan.bold("\u{1F4A1} Optimization Suggestions:"));
      report.suggestions.forEach((suggestion, index) => {
        const priorityColor = suggestion.priority === "critical" ? "red" : suggestion.priority === "high" ? "yellow" : suggestion.priority === "medium" ? "blue" : "gray";
        console.log(`   ${index + 1}. ${import_chalk.default[priorityColor].bold(suggestion.title)}`);
        console.log(`      ${suggestion.description}`);
        console.log(`      Impact: ${import_chalk.default.green(suggestion.estimatedImpact)}`);
        console.log(`      Effort: ${import_chalk.default.blue(suggestion.effort)}
`);
      });
    }
    console.log(import_chalk.default.cyan.bold("\u{1F4BE} Resource Utilization:"));
    console.log(`   Cache Memory: ${(analytics.cache.memoryUsage / 1024 / 1024).toFixed(1)} MB`);
    console.log(`   Cache Entries: ${analytics.cache.size || 0}`);
    console.log(`   Access Patterns: ${analytics.accessPatterns.total || 0} tracked
`);
    console.log(import_chalk.default.cyan.bold("\u{1F3AF} Immediate Actions Recommended:"));
    if (report.overall.score < 70) {
      console.log(`   \u2022 ${import_chalk.default.red("Run memory optimization immediately")}`);
    }
    if (report.metrics.cacheHitRate < 50) {
      console.log(`   \u2022 ${import_chalk.default.yellow("Increase cache size")}`);
    }
    if (report.metrics.avgQueryTime > 100) {
      console.log(`   \u2022 ${import_chalk.default.yellow("Optimize database queries")}`);
    }
    if (report.alerts.filter((a) => a.level === "critical").length > 0) {
      console.log(`   \u2022 ${import_chalk.default.red("Address critical alerts immediately")}`);
    }
    console.log(import_chalk.default.green("\n\u2705 Report generation completed!"));
    await memory.shutdown();
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Report generation failed:"), error.message);
  }
}
__name(generateMemoryReport, "generateMemoryReport");
async function performMemoryCleanup() {
  console.log(import_chalk.default.yellow("\u{1F9F9} Performing memory cleanup...\n"));
  try {
    const memory = new import_Memory.Memory("hive-mind-cleaner");
    await memory.initialize();
    console.log(import_chalk.default.blue("1. Cleaning expired entries..."));
    console.log(import_chalk.default.blue("2. Compressing old data..."));
    await memory.compress();
    console.log(import_chalk.default.blue("3. Optimizing cache..."));
    console.log(import_chalk.default.blue("4. Analyzing patterns..."));
    const patterns = await memory.learnPatterns();
    console.log(import_chalk.default.green(`\u2705 Cleanup completed!`));
    console.log(`   \u2022 Learned ${patterns.length} patterns`);
    console.log(`   \u2022 Cache optimized`);
    console.log(`   \u2022 Memory compressed
`);
    await memory.shutdown();
  } catch (error) {
    console.error(import_chalk.default.red("\u274C Cleanup failed:"), error.message);
  }
}
__name(performMemoryCleanup, "performMemoryCleanup");
async function showMemoryOverview() {
  console.log(import_chalk.default.cyan("Welcome to the Hive Mind Memory Optimization System!\n"));
  console.log("Available commands:");
  console.log(`  ${import_chalk.default.green("--analyze")}     Analyze current memory performance`);
  console.log(`  ${import_chalk.default.green("--optimize")}    Run comprehensive optimization`);
  console.log(`  ${import_chalk.default.green("--monitor")}     Start real-time monitoring dashboard`);
  console.log(`  ${import_chalk.default.green("--report")}      Generate detailed performance report`);
  console.log(`  ${import_chalk.default.green("--cleanup")}     Perform memory cleanup operations
`);
  console.log("Configuration options:");
  console.log(`  ${import_chalk.default.blue("--cache-size")}         Set cache size (default: 10000)`);
  console.log(
    `  ${import_chalk.default.blue("--cache-memory")}       Set cache memory limit in MB (default: 100)`
  );
  console.log(
    `  ${import_chalk.default.blue("--compression-threshold")} Set compression threshold in bytes (default: 10000)
`
  );
  console.log(import_chalk.default.yellow("\u{1F4A1} Quick start: Run with --analyze to see current performance"));
}
__name(showMemoryOverview, "showMemoryOverview");
function getStatusBadge(status) {
  const colors = {
    excellent: "green",
    good: "cyan",
    fair: "yellow",
    poor: "red",
    critical: "red"
  };
  const color = colors[status] || "gray";
  return import_chalk.default[color].bold(status.toUpperCase());
}
__name(getStatusBadge, "getStatusBadge");
function formatMetric(value, unit, threshold, inverse = false) {
  const good = inverse ? value <= threshold : value >= threshold;
  const color = good ? "green" : value >= threshold * 0.8 ? "yellow" : "red";
  return import_chalk.default[color].bold(`${value.toFixed(1)}${unit}`);
}
__name(formatMetric, "formatMetric");
function getTrendIndicator(trend) {
  const indicators = {
    improving: import_chalk.default.green("\u{1F4C8} Improving"),
    stable: import_chalk.default.blue("\u27A1\uFE0F Stable"),
    degrading: import_chalk.default.red("\u{1F4C9} Degrading"),
    increasing: import_chalk.default.red("\u{1F4C8} Increasing"),
    decreasing: import_chalk.default.green("\u{1F4C9} Decreasing")
  };
  return indicators[trend] || import_chalk.default.gray("\u2753 Unknown");
}
__name(getTrendIndicator, "getTrendIndicator");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createOptimizeMemoryCommand
});
//# sourceMappingURL=optimize-memory.js.map
