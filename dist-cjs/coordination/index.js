"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var coordination_exports = {};
__export(coordination_exports, {
  AdvancedTaskScheduler: () => import_advanced_scheduler.AdvancedTaskScheduler,
  AffinitySchedulingStrategy: () => import_advanced_scheduler.AffinitySchedulingStrategy,
  CapabilitySchedulingStrategy: () => import_advanced_scheduler.CapabilitySchedulingStrategy,
  CircuitBreaker: () => import_circuit_breaker.CircuitBreaker,
  CircuitBreakerManager: () => import_circuit_breaker.CircuitBreakerManager,
  CircuitState: () => import_circuit_breaker.CircuitState,
  ConflictResolver: () => import_conflict_resolution.ConflictResolver,
  CoordinationManager: () => import_manager.CoordinationManager,
  CoordinationMetricsCollector: () => import_metrics.CoordinationMetricsCollector,
  DependencyGraph: () => import_dependency_graph.DependencyGraph,
  LeastLoadedSchedulingStrategy: () => import_advanced_scheduler.LeastLoadedSchedulingStrategy,
  MessageRouter: () => import_messaging.MessageRouter,
  OptimisticLockManager: () => import_conflict_resolution.OptimisticLockManager,
  PriorityResolutionStrategy: () => import_conflict_resolution.PriorityResolutionStrategy,
  ResourceManager: () => import_resources.ResourceManager,
  RoundRobinSchedulingStrategy: () => import_advanced_scheduler.RoundRobinSchedulingStrategy,
  TaskScheduler: () => import_scheduler.TaskScheduler,
  TimestampResolutionStrategy: () => import_conflict_resolution.TimestampResolutionStrategy,
  VotingResolutionStrategy: () => import_conflict_resolution.VotingResolutionStrategy,
  WorkStealingCoordinator: () => import_work_stealing.WorkStealingCoordinator
});
module.exports = __toCommonJS(coordination_exports);
var import_manager = require("./manager.js");
var import_scheduler = require("./scheduler.js");
var import_resources = require("./resources.js");
var import_messaging = require("./messaging.js");
var import_advanced_scheduler = require("./advanced-scheduler.js");
var import_work_stealing = require("./work-stealing.js");
var import_dependency_graph = require("./dependency-graph.js");
var import_circuit_breaker = require("./circuit-breaker.js");
var import_conflict_resolution = require("./conflict-resolution.js");
var import_metrics = require("./metrics.js");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AdvancedTaskScheduler,
  AffinitySchedulingStrategy,
  CapabilitySchedulingStrategy,
  CircuitBreaker,
  CircuitBreakerManager,
  CircuitState,
  ConflictResolver,
  CoordinationManager,
  CoordinationMetricsCollector,
  DependencyGraph,
  LeastLoadedSchedulingStrategy,
  MessageRouter,
  OptimisticLockManager,
  PriorityResolutionStrategy,
  ResourceManager,
  RoundRobinSchedulingStrategy,
  TaskScheduler,
  TimestampResolutionStrategy,
  VotingResolutionStrategy,
  WorkStealingCoordinator
});
//# sourceMappingURL=index.js.map
