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
var performance_hooks_exports = {};
__export(performance_hooks_exports, {
  performanceBottleneckHook: () => performanceBottleneckHook,
  performanceMetricHook: () => performanceMetricHook,
  performanceOptimizationHook: () => performanceOptimizationHook,
  performanceThresholdHook: () => performanceThresholdHook,
  registerPerformanceHooks: () => registerPerformanceHooks
});
module.exports = __toCommonJS(performance_hooks_exports);
var import_hook_manager = require("./hook-manager.js");
const performanceMetricHook = {
  id: "agentic-performance-metric",
  type: "performance-metric",
  priority: 100,
  handler: async (payload, context) => {
    const { metric, value, unit, threshold } = payload;
    const sideEffects = [];
    const metricData = {
      name: metric,
      value,
      unit,
      timestamp: Date.now(),
      tags: extractTags(payload.context)
    };
    context.performance.metrics.set(metric, metricData);
    if (threshold !== void 0) {
      const violated = checkThreshold(value, threshold, payload.context);
      if (violated) {
        sideEffects.push({
          type: "notification",
          action: "emit",
          data: {
            event: "performance:threshold:violated",
            data: {
              metric,
              value,
              threshold,
              unit
            }
          }
        });
        const suggestion = await generateOptimizationSuggestion(
          metric,
          value,
          threshold,
          context
        );
        if (suggestion) {
          context.performance.optimizations.push(suggestion);
          sideEffects.push({
            type: "log",
            action: "write",
            data: {
              level: "info",
              message: "Optimization suggestion generated",
              data: suggestion
            }
          });
        }
      }
    }
    await updateRollingAverages(metric, value, context);
    const anomaly = await detectAnomaly(metric, value, context);
    if (anomaly) {
      sideEffects.push({
        type: "notification",
        action: "emit",
        data: {
          event: "performance:anomaly:detected",
          data: { metric, value, anomaly }
        }
      });
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
const performanceBottleneckHook = {
  id: "agentic-performance-bottleneck",
  type: "performance-bottleneck",
  priority: 90,
  handler: async (payload, context) => {
    const { bottleneck } = payload;
    if (!bottleneck) {
      return { continue: true };
    }
    const sideEffects = [];
    const analysis = {
      component: bottleneck.location,
      severity: mapSeverity(bottleneck.severity),
      impact: bottleneck.severity / 10,
      // Normalize to 0-1
      suggestions: bottleneck.suggestions
    };
    context.performance.bottlenecks.push(analysis);
    sideEffects.push({
      type: "memory",
      action: "store",
      data: {
        key: `bottleneck:${analysis.component}:${Date.now()}`,
        value: analysis,
        ttl: 86400
        // 24 hours
      }
    });
    const recurrence = await checkBottleneckRecurrence(
      analysis.component,
      context
    );
    if (recurrence.count > 3) {
      sideEffects.push({
        type: "notification",
        action: "emit",
        data: {
          event: "performance:bottleneck:recurring",
          data: {
            component: analysis.component,
            occurrences: recurrence.count,
            timespan: recurrence.timespan
          }
        }
      });
      const optimization = await generateAdvancedOptimization(
        analysis,
        recurrence,
        context
      );
      if (optimization) {
        context.performance.optimizations.push(optimization);
      }
    }
    const correlations = await findMetricCorrelations(
      analysis.component,
      context
    );
    if (correlations.length > 0) {
      sideEffects.push({
        type: "log",
        action: "write",
        data: {
          level: "info",
          message: "Bottleneck correlations found",
          data: { bottleneck: analysis, correlations }
        }
      });
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
const performanceOptimizationHook = {
  id: "agentic-performance-optimization",
  type: "performance-optimization",
  priority: 80,
  handler: async (payload, context) => {
    const { optimization } = payload;
    if (!optimization) {
      return { continue: true };
    }
    const sideEffects = [];
    const validation = await validateOptimization(optimization, context);
    if (!validation.valid) {
      sideEffects.push({
        type: "log",
        action: "write",
        data: {
          level: "warning",
          message: "Optimization validation failed",
          data: { optimization, validation }
        }
      });
      return { continue: true, sideEffects };
    }
    const simulation = await simulateOptimization(optimization, context);
    if (simulation.expectedImprovement < 0.1) {
      return { continue: true };
    }
    const recommendation = {
      optimization,
      simulation,
      timestamp: Date.now(),
      autoApply: optimization.applied && simulation.risk === "low"
    };
    sideEffects.push({
      type: "memory",
      action: "store",
      data: {
        key: `optimization:${optimization.type}:${Date.now()}`,
        value: recommendation,
        ttl: 604800
        // 7 days
      }
    });
    if (recommendation.autoApply) {
      await applyOptimization(optimization, context);
      sideEffects.push({
        type: "notification",
        action: "emit",
        data: {
          event: "performance:optimization:applied",
          data: { optimization, automatic: true }
        }
      });
    } else {
      sideEffects.push({
        type: "notification",
        action: "emit",
        data: {
          event: "performance:optimization:suggested",
          data: { optimization, simulation }
        }
      });
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
const performanceThresholdHook = {
  id: "agentic-performance-threshold",
  type: "performance-threshold",
  priority: 95,
  handler: async (payload, context) => {
    const { metric, value, threshold } = payload;
    if (threshold === void 0) {
      return { continue: true };
    }
    const sideEffects = [];
    const historicalData = await getMetricHistory(metric, context);
    const adjustedThreshold = calculateDynamicThreshold(
      threshold,
      historicalData
    );
    if (adjustedThreshold !== threshold) {
      sideEffects.push({
        type: "log",
        action: "write",
        data: {
          level: "info",
          message: "Threshold dynamically adjusted",
          data: {
            metric,
            original: threshold,
            adjusted: adjustedThreshold
          }
        }
      });
    }
    const prediction = await predictThresholdViolation(
      metric,
      value,
      adjustedThreshold,
      historicalData
    );
    if (prediction.willViolate && prediction.confidence > 0.7) {
      sideEffects.push({
        type: "notification",
        action: "emit",
        data: {
          event: "performance:threshold:predicted",
          data: {
            metric,
            currentValue: value,
            threshold: adjustedThreshold,
            predictedTime: prediction.timeToViolation,
            confidence: prediction.confidence
          }
        }
      });
      const proactiveOpt = await generateProactiveOptimization(
        metric,
        prediction,
        context
      );
      if (proactiveOpt) {
        context.performance.optimizations.push(proactiveOpt);
      }
    }
    return {
      continue: true,
      sideEffects
    };
  }
};
function extractTags(context) {
  const tags = [];
  if (context.provider)
    tags.push(`provider:${context.provider}`);
  if (context.model)
    tags.push(`model:${context.model}`);
  if (context.operation)
    tags.push(`op:${context.operation}`);
  if (context.component)
    tags.push(`component:${context.component}`);
  return tags;
}
__name(extractTags, "extractTags");
function checkThreshold(value, threshold, context) {
  const operator = context.thresholdOperator || "gt";
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "ne":
      return value !== threshold;
    default:
      return value > threshold;
  }
}
__name(checkThreshold, "checkThreshold");
async function generateOptimizationSuggestion(metric, value, threshold, context) {
  const metricType = getMetricType(metric);
  switch (metricType) {
    case "latency":
      if (value > threshold * 2) {
        return {
          type: "cache",
          target: metric,
          expectedImprovement: 50,
          implementation: "Enable response caching for frequently accessed data",
          risk: "low"
        };
      } else if (value > threshold * 1.5) {
        return {
          type: "parallel",
          target: metric,
          expectedImprovement: 30,
          implementation: "Parallelize independent operations",
          risk: "medium"
        };
      }
      break;
    case "throughput":
      if (value < threshold * 0.5) {
        return {
          type: "batch",
          target: metric,
          expectedImprovement: 40,
          implementation: "Batch similar requests together",
          risk: "low"
        };
      }
      break;
    case "memory":
      if (value > threshold * 0.9) {
        return {
          type: "resource",
          target: metric,
          expectedImprovement: 20,
          implementation: "Implement memory pooling and recycling",
          risk: "medium"
        };
      }
      break;
  }
  return null;
}
__name(generateOptimizationSuggestion, "generateOptimizationSuggestion");
async function updateRollingAverages(metric, value, context) {
  const avgKey = `avg:${metric}`;
  const history = await context.memory.cache.get(avgKey) || [];
  history.push({ value, timestamp: Date.now() });
  if (history.length > 1e3) {
    history.shift();
  }
  await context.memory.cache.set(avgKey, history);
}
__name(updateRollingAverages, "updateRollingAverages");
async function detectAnomaly(metric, value, context) {
  const avgKey = `avg:${metric}`;
  const history = await context.memory.cache.get(avgKey) || [];
  if (history.length < 100) {
    return null;
  }
  const values = history.map((h) => h.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce(
    (a, b) => a + Math.pow(b - mean, 2),
    0
  ) / values.length;
  const stdDev = Math.sqrt(variance);
  const zScore = Math.abs((value - mean) / stdDev);
  if (zScore > 3) {
    return {
      type: "statistical",
      zScore,
      mean,
      stdDev,
      severity: zScore > 5 ? "high" : "medium"
    };
  }
  return null;
}
__name(detectAnomaly, "detectAnomaly");
function mapSeverity(severity) {
  if (severity >= 8)
    return "critical";
  if (severity >= 6)
    return "high";
  if (severity >= 4)
    return "medium";
  return "low";
}
__name(mapSeverity, "mapSeverity");
async function checkBottleneckRecurrence(component, context) {
  const historyKey = `bottleneck:history:${component}`;
  const history = await context.memory.cache.get(historyKey) || [];
  const now = Date.now();
  const dayAgo = now - 864e5;
  const recentOccurrences = history.filter(
    (h) => h.timestamp > dayAgo
  );
  return {
    count: recentOccurrences.length,
    timespan: 864e5
    // 24 hours in ms
  };
}
__name(checkBottleneckRecurrence, "checkBottleneckRecurrence");
async function generateAdvancedOptimization(bottleneck, recurrence, context) {
  if (bottleneck.severity === "critical" && recurrence.count > 5) {
    return {
      type: "algorithm",
      target: bottleneck.component,
      expectedImprovement: 60,
      implementation: `Redesign ${bottleneck.component} algorithm for better scalability`,
      risk: "high"
    };
  }
  if (bottleneck.severity === "high" && recurrence.count > 3) {
    return {
      type: "cache",
      target: bottleneck.component,
      expectedImprovement: 40,
      implementation: `Implement distributed caching for ${bottleneck.component}`,
      risk: "medium"
    };
  }
  return null;
}
__name(generateAdvancedOptimization, "generateAdvancedOptimization");
async function findMetricCorrelations(component, context) {
  const correlations = [];
  for (const [metric, data] of context.performance.metrics) {
    if (data.tags.includes(`component:${component}`)) {
      correlations.push({
        metric: data.name,
        correlation: 0.7
        // Placeholder
      });
    }
  }
  return correlations;
}
__name(findMetricCorrelations, "findMetricCorrelations");
async function validateOptimization(optimization, context) {
  if (!optimization.type || !optimization.details) {
    return {
      valid: false,
      reason: "Missing required optimization fields"
    };
  }
  if (optimization.details === "high" && !context.metadata.allowHighRisk) {
    return {
      valid: false,
      reason: "High-risk optimizations not allowed"
    };
  }
  return { valid: true };
}
__name(validateOptimization, "validateOptimization");
async function simulateOptimization(optimization, context) {
  const baseline = await getBaselineMetrics(optimization.type, context);
  const simulation = {
    expectedImprovement: optimization.improvement || 0.2,
    risk: calculateRisk(optimization),
    affectedMetrics: identifyAffectedMetrics(optimization),
    rollbackPlan: generateRollbackPlan(optimization)
  };
  return simulation;
}
__name(simulateOptimization, "simulateOptimization");
async function applyOptimization(optimization, context) {
  const timestamp = Date.now();
  await context.memory.cache.set(
    `applied:${optimization.type}:${timestamp}`,
    {
      optimization,
      appliedAt: timestamp,
      appliedBy: "automatic"
    }
  );
}
__name(applyOptimization, "applyOptimization");
async function getMetricHistory(metric, context) {
  const historyKey = `history:${metric}`;
  return await context.memory.cache.get(historyKey) || [];
}
__name(getMetricHistory, "getMetricHistory");
function calculateDynamicThreshold(baseThreshold, historicalData) {
  if (historicalData.length < 50) {
    return baseThreshold;
  }
  const values = historicalData.map((d) => d.value).sort((a, b) => a - b);
  const p95 = values[Math.floor(values.length * 0.95)];
  return Math.max(baseThreshold, p95 * 1.1);
}
__name(calculateDynamicThreshold, "calculateDynamicThreshold");
async function predictThresholdViolation(metric, currentValue, threshold, historicalData) {
  if (historicalData.length < 10) {
    return {
      willViolate: false,
      confidence: 0
    };
  }
  const recentValues = historicalData.slice(-10).map((d) => d.value);
  const trend = calculateTrend(recentValues);
  if (trend > 0 && currentValue > threshold * 0.8) {
    const timeToViolation = (threshold - currentValue) / trend;
    return {
      willViolate: true,
      timeToViolation,
      confidence: Math.min(trend * 10, 0.9)
    };
  }
  return {
    willViolate: false,
    confidence: 0
  };
}
__name(predictThresholdViolation, "predictThresholdViolation");
async function generateProactiveOptimization(metric, prediction, context) {
  const metricType = getMetricType(metric);
  if (metricType === "latency" && prediction.timeToViolation < 3e5) {
    return {
      type: "cache",
      target: metric,
      expectedImprovement: 30,
      implementation: "Preemptively cache high-latency operations",
      risk: "low"
    };
  }
  return null;
}
__name(generateProactiveOptimization, "generateProactiveOptimization");
function getMetricType(metric) {
  if (metric.includes("latency"))
    return "latency";
  if (metric.includes("throughput"))
    return "throughput";
  if (metric.includes("memory"))
    return "memory";
  if (metric.includes("cpu"))
    return "cpu";
  return "unknown";
}
__name(getMetricType, "getMetricType");
async function getBaselineMetrics(type, context) {
  return {};
}
__name(getBaselineMetrics, "getBaselineMetrics");
function calculateRisk(optimization) {
  if (optimization.type === "algorithm")
    return "high";
  if (optimization.type === "architecture")
    return "high";
  if (optimization.type === "cache")
    return "low";
  if (optimization.type === "batch")
    return "low";
  return "medium";
}
__name(calculateRisk, "calculateRisk");
function identifyAffectedMetrics(optimization) {
  const affected = [];
  switch (optimization.type) {
    case "cache":
      affected.push("latency", "memory_usage");
      break;
    case "parallel":
      affected.push("latency", "cpu_usage", "throughput");
      break;
    case "batch":
      affected.push("throughput", "latency");
      break;
    case "algorithm":
      affected.push("latency", "cpu_usage", "memory_usage");
      break;
  }
  return affected;
}
__name(identifyAffectedMetrics, "identifyAffectedMetrics");
function generateRollbackPlan(optimization) {
  return {
    steps: [
      "Capture current metrics",
      "Apply optimization",
      "Monitor for 5 minutes",
      "Rollback if metrics degrade"
    ],
    triggers: {
      errorRate: 0.05,
      latencyIncrease: 1.5
    }
  };
}
__name(generateRollbackPlan, "generateRollbackPlan");
function calculateTrend(values) {
  if (values.length < 2)
    return 0;
  const n = values.length;
  const sumX = values.reduce((a, _, i) => a + i, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((a, b, i) => a + i * b, 0);
  const sumX2 = values.reduce((a, _, i) => a + i * i, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope;
}
__name(calculateTrend, "calculateTrend");
function registerPerformanceHooks() {
  import_hook_manager.agenticHookManager.register(performanceMetricHook);
  import_hook_manager.agenticHookManager.register(performanceBottleneckHook);
  import_hook_manager.agenticHookManager.register(performanceOptimizationHook);
  import_hook_manager.agenticHookManager.register(performanceThresholdHook);
}
__name(registerPerformanceHooks, "registerPerformanceHooks");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  performanceBottleneckHook,
  performanceMetricHook,
  performanceOptimizationHook,
  performanceThresholdHook,
  registerPerformanceHooks
});
//# sourceMappingURL=performance-hooks.js.map
