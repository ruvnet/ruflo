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
var recovery_exports = {};
__export(recovery_exports, {
  ConnectionEvent: () => import_connection_state_manager.ConnectionEvent,
  ConnectionHealthMonitor: () => import_connection_health_monitor.ConnectionHealthMonitor,
  ConnectionMetrics: () => import_connection_state_manager.ConnectionMetrics,
  ConnectionState: () => import_connection_state_manager.ConnectionState,
  ConnectionStateManager: () => import_connection_state_manager.ConnectionStateManager,
  FallbackConfig: () => import_fallback_coordinator.FallbackConfig,
  FallbackCoordinator: () => import_fallback_coordinator.FallbackCoordinator,
  FallbackOperation: () => import_fallback_coordinator.FallbackOperation,
  FallbackState: () => import_fallback_coordinator.FallbackState,
  HealthMonitorConfig: () => import_connection_health_monitor.HealthMonitorConfig,
  HealthStatus: () => import_connection_health_monitor.HealthStatus,
  ReconnectionConfig: () => import_reconnection_manager.ReconnectionConfig,
  ReconnectionManager: () => import_reconnection_manager.ReconnectionManager,
  ReconnectionState: () => import_reconnection_manager.ReconnectionState,
  RecoveryConfig: () => import_recovery_manager.RecoveryConfig,
  RecoveryManager: () => import_recovery_manager.RecoveryManager,
  RecoveryStatus: () => import_recovery_manager.RecoveryStatus,
  StateManagerConfig: () => import_connection_state_manager.StateManagerConfig
});
module.exports = __toCommonJS(recovery_exports);
var import_recovery_manager = require("./recovery-manager.js");
var import_connection_health_monitor = require("./connection-health-monitor.js");
var import_reconnection_manager = require("./reconnection-manager.js");
var import_fallback_coordinator = require("./fallback-coordinator.js");
var import_connection_state_manager = require("./connection-state-manager.js");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConnectionEvent,
  ConnectionHealthMonitor,
  ConnectionMetrics,
  ConnectionState,
  ConnectionStateManager,
  FallbackConfig,
  FallbackCoordinator,
  FallbackOperation,
  FallbackState,
  HealthMonitorConfig,
  HealthStatus,
  ReconnectionConfig,
  ReconnectionManager,
  ReconnectionState,
  RecoveryConfig,
  RecoveryManager,
  RecoveryStatus,
  StateManagerConfig
});
//# sourceMappingURL=index.js.map
