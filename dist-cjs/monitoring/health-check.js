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
var health_check_exports = {};
__export(health_check_exports, {
  HealthCheckManager: () => HealthCheckManager
});
module.exports = __toCommonJS(health_check_exports);
var import_system_integration = require("../integration/system-integration.js");
var import_error_handler = require("../utils/error-handler.js");
class HealthCheckManager {
  static {
    __name(this, "HealthCheckManager");
  }
  eventBus;
  logger;
  systemIntegration;
  config;
  intervalId = null;
  healthHistory = /* @__PURE__ */ new Map();
  isRunning = false;
  lastMetrics = null;
  constructor(eventBus, logger, config = {}) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.systemIntegration = import_system_integration.SystemIntegration.getInstance();
    this.config = {
      interval: config.interval || 3e4,
      // 30 seconds
      timeout: config.timeout || 5e3,
      // 5 seconds
      retries: config.retries || 3,
      enableMetrics: config.enableMetrics !== false,
      enableAlerts: config.enableAlerts !== false
    };
    this.setupEventHandlers();
  }
  /**
   * Start health monitoring
   */
  start() {
    if (this.isRunning) {
      this.logger.warn("Health check manager already running");
      return;
    }
    this.logger.info("Starting health check monitoring");
    this.isRunning = true;
    this.performHealthCheck();
    this.intervalId = setInterval(() => {
      this.performHealthCheck();
    }, this.config.interval);
    this.eventBus.emit("health:monitor:started", {
      interval: this.config.interval,
      timestamp: Date.now()
    });
  }
  /**
   * Stop health monitoring
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    this.logger.info("Stopping health check monitoring");
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.eventBus.emit("health:monitor:stopped", {
      timestamp: Date.now()
    });
  }
  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const startTime = Date.now();
    try {
      this.logger.debug("Performing system health check");
      const systemHealth = await this.systemIntegration.getSystemHealth();
      const componentChecks = await this.checkAllComponents();
      if (this.config.enableMetrics) {
        this.lastMetrics = await this.collectSystemMetrics();
      }
      this.storeHealthHistory(componentChecks);
      if (this.config.enableAlerts) {
        await this.checkForAlerts(systemHealth);
      }
      const duration = Date.now() - startTime;
      this.logger.debug(`Health check completed in ${duration}ms`);
      this.eventBus.emit("health:check:completed", {
        health: systemHealth,
        metrics: this.lastMetrics,
        duration,
        timestamp: Date.now()
      });
      return systemHealth;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Health check failed:", (0, import_error_handler.getErrorMessage)(error));
      this.eventBus.emit("health:check:failed", {
        error: (0, import_error_handler.getErrorMessage)(error),
        duration,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  /**
   * Check all system components
   */
  async checkAllComponents() {
    const components = [
      "orchestrator",
      "configManager",
      "memoryManager",
      "agentManager",
      "swarmCoordinator",
      "taskEngine",
      "monitor",
      "mcpServer"
    ];
    const checks = await Promise.allSettled(
      components.map((component) => this.checkComponent(component))
    );
    return checks.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          component: components[index],
          healthy: false,
          message: (0, import_error_handler.getErrorMessage)(result.reason),
          timestamp: Date.now()
        };
      }
    });
  }
  /**
   * Check individual component health
   */
  async checkComponent(componentName) {
    const startTime = Date.now();
    try {
      const component = this.systemIntegration.getComponent(componentName);
      if (!component) {
        return {
          component: componentName,
          healthy: false,
          message: "Component not found",
          timestamp: Date.now()
        };
      }
      if (typeof component.healthCheck === "function") {
        const result = await Promise.race([
          component.healthCheck(),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Health check timeout")), this.config.timeout)
          )
        ]);
        return result;
      }
      const duration = Date.now() - startTime;
      return {
        component: componentName,
        healthy: true,
        message: "Component available",
        metrics: { responseTime: duration },
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        component: componentName,
        healthy: false,
        message: (0, import_error_handler.getErrorMessage)(error),
        timestamp: Date.now()
      };
    }
  }
  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    const startTime = Date.now();
    try {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const agentManager = this.systemIntegration.getComponent("agentManager");
      const taskEngine = this.systemIntegration.getComponent("taskEngine");
      let activeAgents = 0;
      let activeTasks = 0;
      let queuedTasks = 0;
      let completedTasks = 0;
      if (agentManager && typeof agentManager.getMetrics === "function") {
        const agentMetrics = await agentManager.getMetrics();
        activeAgents = agentMetrics.activeAgents || 0;
      }
      if (taskEngine && typeof taskEngine.getMetrics === "function") {
        const taskMetrics = await taskEngine.getMetrics();
        activeTasks = taskMetrics.activeTasks || 0;
        queuedTasks = taskMetrics.queuedTasks || 0;
        completedTasks = taskMetrics.completedTasks || 0;
      }
      return {
        cpu: (cpuUsage.user + cpuUsage.system) / 1e6,
        // Convert to percentage
        memory: memoryUsage.heapUsed / memoryUsage.heapTotal * 100,
        network: 0,
        // Placeholder - would need additional monitoring
        disk: 0,
        // Placeholder - would need additional monitoring
        activeAgents,
        activeTasks,
        queuedTasks,
        completedTasks,
        errorCount: this.getErrorCount(),
        uptime: process.uptime() * 1e3,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error("Failed to collect system metrics:", (0, import_error_handler.getErrorMessage)(error));
      return {
        cpu: 0,
        memory: 0,
        network: 0,
        disk: 0,
        activeAgents: 0,
        activeTasks: 0,
        queuedTasks: 0,
        completedTasks: 0,
        errorCount: 0,
        uptime: process.uptime() * 1e3,
        timestamp: Date.now()
      };
    }
  }
  /**
   * Store health check history
   */
  storeHealthHistory(results) {
    const maxHistorySize = 100;
    results.forEach((result) => {
      if (!this.healthHistory.has(result.component)) {
        this.healthHistory.set(result.component, []);
      }
      const history = this.healthHistory.get(result.component);
      history.push(result);
      if (history.length > maxHistorySize) {
        history.splice(0, history.length - maxHistorySize);
      }
    });
  }
  /**
   * Check for alerts and send notifications
   */
  async checkForAlerts(health) {
    const unhealthyComponents = Object.values(health.components).filter(
      (component) => component.status === "unhealthy"
    );
    if (unhealthyComponents.length > 0) {
      const alert = {
        type: "component_failure",
        severity: "high",
        message: `${unhealthyComponents.length} component(s) are unhealthy`,
        components: unhealthyComponents.map((c) => c.component),
        timestamp: Date.now()
      };
      this.eventBus.emit("health:alert", alert);
      this.logger.warn("Health alert triggered:", alert.message);
    }
    if (this.lastMetrics) {
      const alerts = [];
      if (this.lastMetrics.cpu > 90) {
        alerts.push({
          type: "high_cpu",
          severity: "medium",
          message: `High CPU usage: ${this.lastMetrics.cpu.toFixed(1)}%`,
          value: this.lastMetrics.cpu
        });
      }
      if (this.lastMetrics.memory > 90) {
        alerts.push({
          type: "high_memory",
          severity: "medium",
          message: `High memory usage: ${this.lastMetrics.memory.toFixed(1)}%`,
          value: this.lastMetrics.memory
        });
      }
      if (this.lastMetrics.errorCount > 10) {
        alerts.push({
          type: "high_errors",
          severity: "high",
          message: `High error count: ${this.lastMetrics.errorCount}`,
          value: this.lastMetrics.errorCount
        });
      }
      alerts.forEach((alert) => {
        this.eventBus.emit("health:alert", {
          ...alert,
          timestamp: Date.now()
        });
      });
    }
  }
  /**
   * Get component health history
   */
  getHealthHistory(component) {
    if (component) {
      return this.healthHistory.get(component) || [];
    }
    const allHistory = [];
    for (const history of this.healthHistory.values()) {
      allHistory.push(...history);
    }
    return allHistory.sort((a, b) => b.timestamp - a.timestamp);
  }
  /**
   * Get current system metrics
   */
  getCurrentMetrics() {
    return this.lastMetrics;
  }
  /**
   * Get system health status
   */
  async getSystemHealth() {
    return await this.systemIntegration.getSystemHealth();
  }
  /**
   * Get error count from recent history
   */
  getErrorCount() {
    const recentTime = Date.now() - 3e5;
    let errorCount = 0;
    for (const history of this.healthHistory.values()) {
      errorCount += history.filter(
        (check) => check.timestamp > recentTime && !check.healthy
      ).length;
    }
    return errorCount;
  }
  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    this.eventBus.on("component:status:updated", (status) => {
      if (status.status === "unhealthy") {
        this.logger.warn(`Component ${status.component} became unhealthy: ${status.message}`);
      }
    });
    this.eventBus.on("system:error", (error) => {
      this.logger.error("System error detected:", error);
    });
  }
  /**
   * Check if monitoring is running
   */
  isMonitoring() {
    return this.isRunning;
  }
  /**
   * Get monitoring configuration
   */
  getConfig() {
    return { ...this.config };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HealthCheckManager
});
//# sourceMappingURL=health-check.js.map
