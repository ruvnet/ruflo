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
var deployment_manager_exports = {};
__export(deployment_manager_exports, {
  DeploymentManager: () => DeploymentManager
});
module.exports = __toCommonJS(deployment_manager_exports);
var import_events = require("events");
var import_promises = require("fs/promises");
var import_path = require("path");
var import_child_process = require("child_process");
var import_logger = require("../core/logger.js");
var import_config = require("../core/config.js");
class DeploymentManager extends import_events.EventEmitter {
  static {
    __name(this, "DeploymentManager");
  }
  deployments = /* @__PURE__ */ new Map();
  environments = /* @__PURE__ */ new Map();
  strategies = /* @__PURE__ */ new Map();
  pipelines = /* @__PURE__ */ new Map();
  activeProcesses = /* @__PURE__ */ new Map();
  deploymentsPath;
  logger;
  config;
  constructor(deploymentsPath = "./deployments", logger, config) {
    super();
    this.deploymentsPath = deploymentsPath;
    this.logger = logger || new import_logger.Logger({ level: "info", format: "text", destination: "console" });
    this.config = config || import_config.ConfigManager.getInstance();
  }
  async initialize() {
    try {
      await (0, import_promises.mkdir)(this.deploymentsPath, { recursive: true });
      await (0, import_promises.mkdir)((0, import_path.join)(this.deploymentsPath, "environments"), { recursive: true });
      await (0, import_promises.mkdir)((0, import_path.join)(this.deploymentsPath, "strategies"), { recursive: true });
      await (0, import_promises.mkdir)((0, import_path.join)(this.deploymentsPath, "pipelines"), { recursive: true });
      await this.loadConfigurations();
      await this.initializeDefaultStrategies();
      this.logger.info("Deployment Manager initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Deployment Manager", { error });
      throw error;
    }
  }
  async createEnvironment(environmentData) {
    const environment = {
      id: environmentData.id || `env-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: environmentData.name || "Unnamed Environment",
      type: environmentData.type || "development",
      status: "inactive",
      configuration: {
        region: "us-east-1",
        provider: "aws",
        endpoints: [],
        secrets: {},
        environment_variables: {},
        resources: {
          cpu: "1",
          memory: "1Gi",
          storage: "10Gi",
          replicas: 1
        },
        ...environmentData.configuration
      },
      healthCheck: {
        url: "/health",
        method: "GET",
        expectedStatus: 200,
        timeout: 3e4,
        interval: 6e4,
        retries: 3,
        ...environmentData.healthCheck
      },
      monitoring: {
        enabled: true,
        alerts: [],
        metrics: ["cpu", "memory", "requests", "errors"],
        logs: {
          level: "info",
          retention: "30d",
          aggregation: true
        },
        ...environmentData.monitoring
      },
      security: {
        tls: true,
        authentication: true,
        authorization: ["admin", "deploy"],
        compliance: [],
        scanning: {
          vulnerabilities: true,
          secrets: true,
          licenses: true
        },
        ...environmentData.security
      },
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    this.environments.set(environment.id, environment);
    await this.saveEnvironment(environment);
    this.emit("environment:created", environment);
    this.logger.info(`Environment created: ${environment.name} (${environment.id})`);
    return environment;
  }
  async createDeployment(deploymentData) {
    const environment = this.environments.get(deploymentData.environmentId);
    if (!environment) {
      throw new Error(`Environment not found: ${deploymentData.environmentId}`);
    }
    const strategy = this.strategies.get(deploymentData.strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${deploymentData.strategyId}`);
    }
    const deployment = {
      id: `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: deploymentData.name,
      version: deploymentData.version,
      projectId: deploymentData.projectId,
      environmentId: deploymentData.environmentId,
      strategyId: deploymentData.strategyId,
      status: "pending",
      initiatedBy: deploymentData.initiatedBy,
      source: deploymentData.source,
      artifacts: {
        files: [],
        ...deploymentData.artifacts
      },
      metrics: {
        startTime: /* @__PURE__ */ new Date(),
        deploymentSize: 0,
        successRate: 0,
        errorRate: 0,
        performanceMetrics: {}
      },
      stages: strategy.stages.map((stage) => ({
        ...stage,
        status: "pending",
        logs: []
      })),
      approvals: [],
      notifications: [],
      auditLog: [],
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    this.addAuditEntry(deployment, deploymentData.initiatedBy, "deployment_created", "deployment", {
      deploymentId: deployment.id,
      environment: environment.name,
      strategy: strategy.name
    });
    this.deployments.set(deployment.id, deployment);
    await this.saveDeployment(deployment);
    this.emit("deployment:created", deployment);
    this.logger.info(`Deployment created: ${deployment.name} (${deployment.id})`);
    return deployment;
  }
  async executeDeployment(deploymentId) {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    if (deployment.status !== "pending") {
      throw new Error(`Deployment ${deploymentId} is not in pending status`);
    }
    deployment.status = "running";
    deployment.metrics.startTime = /* @__PURE__ */ new Date();
    deployment.updatedAt = /* @__PURE__ */ new Date();
    this.addAuditEntry(deployment, "system", "deployment_started", "deployment", {
      deploymentId
    });
    await this.saveDeployment(deployment);
    this.emit("deployment:started", deployment);
    try {
      for (const stage of deployment.stages) {
        await this.executeStage(deployment, stage);
        if (stage.status === "failed") {
          await this.handleDeploymentFailure(deployment, stage);
          return;
        }
      }
      await this.completeDeployment(deployment);
    } catch (error) {
      await this.handleDeploymentError(deployment, error);
    }
  }
  async executeStage(deployment, stage) {
    stage.status = "running";
    stage.startTime = /* @__PURE__ */ new Date();
    this.addLog(stage, "info", `Starting stage: ${stage.name}`, "system");
    try {
      if (!this.evaluateStageConditions(deployment, stage)) {
        stage.status = "skipped";
        this.addLog(stage, "info", "Stage skipped due to conditions", "system");
        return;
      }
      if (stage.type === "deploy" && await this.requiresApproval(deployment, stage)) {
        await this.requestApproval(deployment, stage);
        while (await this.isPendingApproval(deployment, stage)) {
          await new Promise((resolve) => setTimeout(resolve, 1e4));
        }
        if (!await this.isApproved(deployment, stage)) {
          stage.status = "failed";
          this.addLog(stage, "error", "Stage rejected by approver", "system");
          return;
        }
      }
      for (const command of stage.commands) {
        await this.executeCommand(deployment, stage, command);
      }
      stage.status = "success";
      stage.endTime = /* @__PURE__ */ new Date();
      stage.duration = stage.endTime.getTime() - stage.startTime.getTime();
      this.addLog(stage, "info", `Stage completed successfully in ${stage.duration}ms`, "system");
    } catch (error) {
      stage.status = "failed";
      stage.endTime = /* @__PURE__ */ new Date();
      this.addLog(
        stage,
        "error",
        `Stage failed: ${error instanceof Error ? error.message : String(error)}`,
        "system"
      );
      if (stage.retryPolicy.maxRetries > 0) {
        await this.retryStage(deployment, stage);
      }
    }
    await this.saveDeployment(deployment);
    this.emit("stage:completed", { deployment, stage });
  }
  async executeCommand(deployment, stage, command) {
    return new Promise((resolve, reject) => {
      const environment = this.environments.get(deployment.environmentId);
      const processEnv = {
        ...process.env,
        ...environment?.configuration.environment_variables,
        ...command.environment,
        DEPLOYMENT_ID: deployment.id,
        DEPLOYMENT_VERSION: deployment.version,
        ENVIRONMENT_ID: deployment.environmentId
      };
      this.addLog(
        stage,
        "info",
        `Executing: ${command.command} ${command.args.join(" ")}`,
        "command"
      );
      const childProcess = (0, import_child_process.spawn)(command.command, command.args, {
        cwd: command.workingDirectory || process.cwd(),
        env: processEnv,
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.activeProcesses.set(`${deployment.id}-${stage.id}-${command.id}`, childProcess);
      let stdout = "";
      let stderr = "";
      childProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        stdout += output;
        this.addLog(stage, "info", output.trim(), "stdout");
      });
      childProcess.stderr?.on("data", (data) => {
        const output = data.toString();
        stderr += output;
        this.addLog(stage, "error", output.trim(), "stderr");
      });
      const timeout = setTimeout(() => {
        childProcess.kill("SIGTERM");
        reject(new Error(`Command timed out after ${command.timeout}ms`));
      }, command.timeout);
      childProcess.on("close", (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(`${deployment.id}-${stage.id}-${command.id}`);
        const success = this.evaluateCommandSuccess(command, code, stdout, stderr);
        if (success) {
          this.addLog(
            stage,
            "info",
            `Command completed successfully (exit code: ${code})`,
            "command"
          );
          resolve();
        } else {
          this.addLog(stage, "error", `Command failed (exit code: ${code})`, "command");
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
      childProcess.on("error", (error) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(`${deployment.id}-${stage.id}-${command.id}`);
        this.addLog(
          stage,
          "error",
          `Command error: ${error instanceof Error ? error.message : String(error)}`,
          "command"
        );
        reject(error);
      });
    });
  }
  async rollbackDeployment(deploymentId, reason, userId = "system") {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    const previousDeployment = await this.getPreviousSuccessfulDeployment(
      deployment.projectId,
      deployment.environmentId,
      deploymentId
    );
    if (!previousDeployment) {
      throw new Error("No previous successful deployment found for rollback");
    }
    const rollbackStartTime = /* @__PURE__ */ new Date();
    deployment.rollback = {
      triggered: true,
      reason,
      timestamp: rollbackStartTime,
      previousDeploymentId: previousDeployment.id,
      rollbackDuration: 0
    };
    deployment.status = "rolled-back";
    deployment.updatedAt = /* @__PURE__ */ new Date();
    this.addAuditEntry(deployment, userId, "rollback_initiated", "deployment", {
      deploymentId,
      previousDeploymentId: previousDeployment.id,
      reason
    });
    try {
      await this.executeRollbackStrategy(deployment, previousDeployment);
      deployment.rollback.rollbackDuration = Date.now() - rollbackStartTime.getTime();
      this.addAuditEntry(deployment, userId, "rollback_completed", "deployment", {
        deploymentId,
        rollbackDuration: deployment.rollback.rollbackDuration
      });
      this.emit("deployment:rolled-back", deployment);
      this.logger.info(`Deployment rolled back: ${deploymentId}`);
    } catch (error) {
      this.addAuditEntry(deployment, userId, "rollback_failed", "deployment", {
        deploymentId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.logger.error(`Rollback failed for deployment ${deploymentId}`, { error });
      throw error;
    }
    await this.saveDeployment(deployment);
  }
  async getDeploymentMetrics(filters) {
    let deployments = Array.from(this.deployments.values());
    if (filters) {
      if (filters.projectId) {
        deployments = deployments.filter((d) => d.projectId === filters.projectId);
      }
      if (filters.environmentId) {
        deployments = deployments.filter((d) => d.environmentId === filters.environmentId);
      }
      if (filters.strategyId) {
        deployments = deployments.filter((d) => d.strategyId === filters.strategyId);
      }
      if (filters.timeRange) {
        deployments = deployments.filter(
          (d) => d.createdAt >= filters.timeRange.start && d.createdAt <= filters.timeRange.end
        );
      }
    }
    const totalDeployments = deployments.length;
    const successfulDeployments = deployments.filter((d) => d.status === "success").length;
    const failedDeployments = deployments.filter((d) => d.status === "failed").length;
    const rolledBackDeployments = deployments.filter((d) => d.status === "rolled-back").length;
    const completedDeployments = deployments.filter(
      (d) => d.metrics.endTime && d.metrics.startTime
    );
    const averageDeploymentTime = completedDeployments.length > 0 ? completedDeployments.reduce(
      (sum, d) => sum + (d.metrics.endTime.getTime() - d.metrics.startTime.getTime()),
      0
    ) / completedDeployments.length : 0;
    const environmentMetrics = {};
    for (const env of this.environments.values()) {
      const envDeployments = deployments.filter((d) => d.environmentId === env.id);
      const envSuccessful = envDeployments.filter((d) => d.status === "success").length;
      environmentMetrics[env.id] = {
        deployments: envDeployments.length,
        successRate: envDeployments.length > 0 ? envSuccessful / envDeployments.length * 100 : 0,
        averageTime: envDeployments.length > 0 ? envDeployments.reduce((sum, d) => sum + (d.metrics.duration || 0), 0) / envDeployments.length : 0
      };
    }
    const strategyMetrics = {};
    for (const strategy of this.strategies.values()) {
      const strategyDeployments = deployments.filter((d) => d.strategyId === strategy.id);
      const strategySuccessful = strategyDeployments.filter((d) => d.status === "success").length;
      const strategyRolledBack = strategyDeployments.filter(
        (d) => d.status === "rolled-back"
      ).length;
      strategyMetrics[strategy.id] = {
        deployments: strategyDeployments.length,
        successRate: strategyDeployments.length > 0 ? strategySuccessful / strategyDeployments.length * 100 : 0,
        rollbackRate: strategyDeployments.length > 0 ? strategyRolledBack / strategyDeployments.length * 100 : 0
      };
    }
    return {
      totalDeployments,
      successfulDeployments,
      failedDeployments,
      rolledBackDeployments,
      averageDeploymentTime,
      deploymentFrequency: this.calculateDeploymentFrequency(deployments),
      meanTimeToRecovery: this.calculateMTTR(deployments),
      changeFailureRate: (failedDeployments + rolledBackDeployments) / Math.max(totalDeployments, 1) * 100,
      leadTime: this.calculateLeadTime(deployments),
      environmentMetrics,
      strategyMetrics
    };
  }
  // Private helper methods
  async loadConfigurations() {
    try {
      const envFiles = await (0, import_promises.readdir)((0, import_path.join)(this.deploymentsPath, "environments"));
      for (const file of envFiles.filter((f) => f.endsWith(".json"))) {
        const content = await (0, import_promises.readFile)((0, import_path.join)(this.deploymentsPath, "environments", file), "utf-8");
        const env = JSON.parse(content);
        this.environments.set(env.id, env);
      }
      const strategyFiles = await (0, import_promises.readdir)((0, import_path.join)(this.deploymentsPath, "strategies"));
      for (const file of strategyFiles.filter((f) => f.endsWith(".json"))) {
        const content = await (0, import_promises.readFile)((0, import_path.join)(this.deploymentsPath, "strategies", file), "utf-8");
        const strategy = JSON.parse(content);
        this.strategies.set(strategy.id, strategy);
      }
      const pipelineFiles = await (0, import_promises.readdir)((0, import_path.join)(this.deploymentsPath, "pipelines"));
      for (const file of pipelineFiles.filter((f) => f.endsWith(".json"))) {
        const content = await (0, import_promises.readFile)((0, import_path.join)(this.deploymentsPath, "pipelines", file), "utf-8");
        const pipeline = JSON.parse(content);
        this.pipelines.set(pipeline.id, pipeline);
      }
      this.logger.info(
        `Loaded ${this.environments.size} environments, ${this.strategies.size} strategies, ${this.pipelines.size} pipelines`
      );
    } catch (error) {
      this.logger.warn("Failed to load some configurations", { error });
    }
  }
  async initializeDefaultStrategies() {
    const defaultStrategies = [
      {
        name: "Blue-Green Deployment",
        type: "blue-green",
        configuration: {
          monitoringDuration: 3e5,
          // 5 minutes
          automatedRollback: true,
          rollbackThreshold: 5
        },
        stages: [
          {
            id: "build",
            name: "Build",
            order: 1,
            type: "build",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 6e5,
            retryPolicy: { maxRetries: 2, backoffMultiplier: 2, initialDelay: 1e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "deploy-green",
            name: "Deploy to Green",
            order: 2,
            type: "deploy",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 9e5,
            retryPolicy: { maxRetries: 1, backoffMultiplier: 2, initialDelay: 5e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "verify",
            name: "Verify Green",
            order: 3,
            type: "verify",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 3e5,
            retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, initialDelay: 2e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "switch-traffic",
            name: "Switch Traffic",
            order: 4,
            type: "promote",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 6e4,
            retryPolicy: { maxRetries: 1, backoffMultiplier: 1, initialDelay: 1e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          }
        ],
        rollbackStrategy: {
          automatic: true,
          conditions: [
            {
              metric: "error_rate",
              threshold: 5,
              operator: ">",
              duration: 6e4,
              description: "Error rate exceeds 5%"
            }
          ],
          timeout: 3e5
        }
      },
      {
        name: "Canary Deployment",
        type: "canary",
        configuration: {
          trafficSplitPercentage: 10,
          monitoringDuration: 6e5,
          // 10 minutes
          automatedRollback: true,
          rollbackThreshold: 2
        },
        stages: [
          {
            id: "build",
            name: "Build",
            order: 1,
            type: "build",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 6e5,
            retryPolicy: { maxRetries: 2, backoffMultiplier: 2, initialDelay: 1e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "deploy-canary",
            name: "Deploy Canary (10%)",
            order: 2,
            type: "deploy",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 9e5,
            retryPolicy: { maxRetries: 1, backoffMultiplier: 2, initialDelay: 5e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "monitor-canary",
            name: "Monitor Canary",
            order: 3,
            type: "verify",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 6e5,
            retryPolicy: { maxRetries: 1, backoffMultiplier: 1, initialDelay: 1e4 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "promote-full",
            name: "Promote to 100%",
            order: 4,
            type: "promote",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 3e5,
            retryPolicy: { maxRetries: 1, backoffMultiplier: 1, initialDelay: 1e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          }
        ],
        rollbackStrategy: {
          automatic: true,
          conditions: [
            {
              metric: "error_rate",
              threshold: 2,
              operator: ">",
              duration: 12e4,
              description: "Canary error rate exceeds 2%"
            },
            {
              metric: "response_time",
              threshold: 500,
              operator: ">",
              duration: 18e4,
              description: "Response time exceeds 500ms"
            }
          ],
          timeout: 18e4
        }
      },
      {
        name: "Rolling Deployment",
        type: "rolling",
        configuration: {
          maxUnavailable: 1,
          maxSurge: 1,
          monitoringDuration: 12e4,
          automatedRollback: false
        },
        stages: [
          {
            id: "build",
            name: "Build",
            order: 1,
            type: "build",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 6e5,
            retryPolicy: { maxRetries: 2, backoffMultiplier: 2, initialDelay: 1e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "rolling-update",
            name: "Rolling Update",
            order: 2,
            type: "deploy",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 12e5,
            retryPolicy: { maxRetries: 1, backoffMultiplier: 2, initialDelay: 5e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          },
          {
            id: "health-check",
            name: "Health Check",
            order: 3,
            type: "verify",
            status: "pending",
            commands: [],
            conditions: { runIf: [], skipIf: [] },
            timeout: 3e5,
            retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, initialDelay: 5e3 },
            artifacts: { inputs: [], outputs: [] },
            logs: []
          }
        ],
        rollbackStrategy: {
          automatic: false,
          conditions: [],
          timeout: 6e5
        }
      }
    ];
    for (const strategyData of defaultStrategies) {
      if (!Array.from(this.strategies.values()).some((s) => s.name === strategyData.name)) {
        const strategy = {
          id: `strategy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          notifications: {
            channels: [],
            events: ["deployment:started", "deployment:completed", "deployment:failed"]
          },
          ...strategyData
        };
        this.strategies.set(strategy.id, strategy);
        await this.saveStrategy(strategy);
      }
    }
  }
  async saveEnvironment(environment) {
    const filePath = (0, import_path.join)(this.deploymentsPath, "environments", `${environment.id}.json`);
    await (0, import_promises.writeFile)(filePath, JSON.stringify(environment, null, 2));
  }
  async saveStrategy(strategy) {
    const filePath = (0, import_path.join)(this.deploymentsPath, "strategies", `${strategy.id}.json`);
    await (0, import_promises.writeFile)(filePath, JSON.stringify(strategy, null, 2));
  }
  async saveDeployment(deployment) {
    const filePath = (0, import_path.join)(this.deploymentsPath, `${deployment.id}.json`);
    await (0, import_promises.writeFile)(filePath, JSON.stringify(deployment, null, 2));
  }
  addAuditEntry(deployment, userId, action, target, details) {
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: /* @__PURE__ */ new Date(),
      userId,
      action,
      target,
      details
    };
    deployment.auditLog.push(entry);
  }
  addLog(stage, level, message, source, metadata) {
    const log = {
      timestamp: /* @__PURE__ */ new Date(),
      level,
      message,
      source,
      metadata
    };
    stage.logs.push(log);
  }
  evaluateStageConditions(deployment, stage) {
    return true;
  }
  async requiresApproval(deployment, stage) {
    const strategy = this.strategies.get(deployment.strategyId);
    return strategy?.configuration.approvalRequired || false;
  }
  async requestApproval(deployment, stage) {
    this.emit("approval:requested", { deployment, stage });
  }
  async isPendingApproval(deployment, stage) {
    return false;
  }
  async isApproved(deployment, stage) {
    return true;
  }
  evaluateCommandSuccess(command, exitCode, stdout, stderr) {
    if (command.successCriteria.exitCode !== void 0 && exitCode !== command.successCriteria.exitCode) {
      return false;
    }
    if (command.successCriteria.outputContains) {
      for (const pattern of command.successCriteria.outputContains) {
        if (!stdout.includes(pattern)) {
          return false;
        }
      }
    }
    if (command.successCriteria.outputNotContains) {
      for (const pattern of command.successCriteria.outputNotContains) {
        if (stdout.includes(pattern) || stderr.includes(pattern)) {
          return false;
        }
      }
    }
    return true;
  }
  async retryStage(deployment, stage) {
    this.logger.info(`Retrying stage: ${stage.name}`);
  }
  async handleDeploymentFailure(deployment, failedStage) {
    deployment.status = "failed";
    deployment.metrics.endTime = /* @__PURE__ */ new Date();
    deployment.updatedAt = /* @__PURE__ */ new Date();
    this.addAuditEntry(deployment, "system", "deployment_failed", "deployment", {
      deploymentId: deployment.id,
      failedStage: failedStage.name,
      reason: "Stage execution failed"
    });
    await this.saveDeployment(deployment);
    this.emit("deployment:failed", { deployment, failedStage });
    const strategy = this.strategies.get(deployment.strategyId);
    if (strategy?.rollbackStrategy.automatic) {
      await this.rollbackDeployment(deployment.id, "Automatic rollback due to deployment failure");
    }
  }
  async handleDeploymentError(deployment, error) {
    deployment.status = "failed";
    deployment.metrics.endTime = /* @__PURE__ */ new Date();
    deployment.updatedAt = /* @__PURE__ */ new Date();
    this.addAuditEntry(deployment, "system", "deployment_error", "deployment", {
      deploymentId: deployment.id,
      error: error instanceof Error ? error.message : String(error)
    });
    await this.saveDeployment(deployment);
    this.emit("deployment:error", { deployment, error });
    this.logger.error(`Deployment error: ${deployment.id}`, { error });
  }
  async completeDeployment(deployment) {
    deployment.status = "success";
    deployment.metrics.endTime = /* @__PURE__ */ new Date();
    deployment.metrics.duration = deployment.metrics.endTime.getTime() - deployment.metrics.startTime.getTime();
    deployment.updatedAt = /* @__PURE__ */ new Date();
    this.addAuditEntry(deployment, "system", "deployment_completed", "deployment", {
      deploymentId: deployment.id,
      duration: deployment.metrics.duration
    });
    await this.saveDeployment(deployment);
    this.emit("deployment:completed", deployment);
    this.logger.info(`Deployment completed: ${deployment.id} in ${deployment.metrics.duration}ms`);
  }
  async getPreviousSuccessfulDeployment(projectId, environmentId, currentDeploymentId) {
    const deployments = Array.from(this.deployments.values()).filter(
      (d) => d.projectId === projectId && d.environmentId === environmentId && d.status === "success" && d.id !== currentDeploymentId
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return deployments[0] || null;
  }
  async executeRollbackStrategy(deployment, previousDeployment) {
    this.logger.info(`Executing rollback from ${deployment.id} to ${previousDeployment.id}`);
    this.emit("rollback:executed", { deployment, previousDeployment });
  }
  calculateDeploymentFrequency(deployments) {
    if (deployments.length === 0)
      return 0;
    const sortedDeployments = deployments.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const firstDeployment = sortedDeployments[0];
    const lastDeployment = sortedDeployments[sortedDeployments.length - 1];
    const timeSpan = lastDeployment.createdAt.getTime() - firstDeployment.createdAt.getTime();
    const days = timeSpan / (1e3 * 60 * 60 * 24);
    return deployments.length / Math.max(days, 1);
  }
  calculateMTTR(deployments) {
    const failedDeployments = deployments.filter(
      (d) => d.status === "failed" || d.status === "rolled-back"
    );
    if (failedDeployments.length === 0)
      return 0;
    const recoveryTimes = failedDeployments.map((d) => d.rollback?.rollbackDuration || 0).filter((time) => time > 0);
    if (recoveryTimes.length === 0)
      return 0;
    return recoveryTimes.reduce((sum, time) => sum + time, 0) / recoveryTimes.length;
  }
  calculateLeadTime(deployments) {
    const completedDeployments = deployments.filter((d) => d.metrics.duration);
    if (completedDeployments.length === 0)
      return 0;
    return completedDeployments.reduce((sum, d) => sum + (d.metrics.duration || 0), 0) / completedDeployments.length;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeploymentManager
});
//# sourceMappingURL=deployment-manager.js.map
