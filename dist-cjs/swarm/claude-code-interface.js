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
var claude_code_interface_exports = {};
__export(claude_code_interface_exports, {
  ClaudeCodeInterface: () => ClaudeCodeInterface,
  default: () => claude_code_interface_default
});
module.exports = __toCommonJS(claude_code_interface_exports);
var import_node_events = require("node:events");
var import_node_child_process = require("node:child_process");
var import_node_perf_hooks = require("node:perf_hooks");
var path = __toESM(require("node:path"), 1);
var import_logger = require("../core/logger.js");
var import_helpers = require("../utils/helpers.js");
var import_executor = __toESM(require("./executor.js"), 1);
class ClaudeCodeInterface extends import_node_events.EventEmitter {
  static {
    __name(this, "ClaudeCodeInterface");
  }
  logger;
  config;
  memoryManager;
  processPool;
  activeExecutions = /* @__PURE__ */ new Map();
  agents = /* @__PURE__ */ new Map();
  taskExecutor;
  healthCheckInterval;
  isInitialized = false;
  constructor(config = {}, memoryManager) {
    super();
    this.logger = new import_logger.Logger("ClaudeCodeInterface");
    this.config = this.createDefaultConfig(config);
    this.memoryManager = memoryManager;
    this.processPool = this.initializeProcessPool();
    this.taskExecutor = new import_executor.default({
      timeoutMs: this.config.timeout,
      enableMetrics: true,
      captureOutput: true,
      streamOutput: this.config.enableStreaming
    });
    this.setupEventHandlers();
  }
  /**
   * Initialize the Claude Code interface
   */
  async initialize() {
    if (this.isInitialized) {
      this.logger.warn("Claude Code interface already initialized");
      return;
    }
    this.logger.info("Initializing Claude Code interface...");
    try {
      await this.verifyClaudeExecutable();
      await this.taskExecutor.initialize();
      if (this.config.agentPoolSize > 0) {
        await this.prewarmAgentPool();
      }
      this.startHealthChecks();
      this.isInitialized = true;
      this.logger.info("Claude Code interface initialized successfully", {
        poolSize: this.processPool.idle.length,
        maxConcurrent: this.config.maxConcurrentAgents
      });
      this.emit("initialized");
    } catch (error) {
      this.logger.error("Failed to initialize Claude Code interface", error);
      throw error;
    }
  }
  /**
   * Shutdown the interface gracefully
   */
  async shutdown() {
    if (!this.isInitialized)
      return;
    this.logger.info("Shutting down Claude Code interface...");
    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      const cancellationPromises = Array.from(this.activeExecutions.keys()).map((executionId) => this.cancelExecution(executionId, "Interface shutdown"));
      await Promise.allSettled(cancellationPromises);
      await this.terminateAllAgents();
      await this.taskExecutor.shutdown();
      this.isInitialized = false;
      this.logger.info("Claude Code interface shut down successfully");
      this.emit("shutdown");
    } catch (error) {
      this.logger.error("Error during Claude Code interface shutdown", error);
      throw error;
    }
  }
  /**
   * Spawn a new Claude agent with specified configuration
   */
  async spawnAgent(options) {
    this.logger.info("Spawning Claude agent", {
      type: options.type,
      name: options.name,
      capabilities: options.capabilities
    });
    try {
      if (this.getTotalActiveAgents() >= this.config.maxConcurrentAgents) {
        throw new Error("Maximum concurrent agents limit reached");
      }
      const command = this.buildClaudeCommand(options);
      const process2 = (0, import_node_child_process.spawn)(command.executable, command.args, {
        cwd: options.workingDirectory || this.config.workingDirectory,
        env: {
          ...process2.env,
          ...this.config.environmentVariables,
          ...options.environment
        },
        stdio: ["pipe", "pipe", "pipe"],
        detached: false
      });
      if (!process2.pid) {
        throw new Error("Failed to spawn Claude process");
      }
      const agentId = (0, import_helpers.generateId)("claude-agent");
      const agent = {
        id: agentId,
        processId: process2.pid,
        process: process2,
        type: options.type,
        capabilities: options.capabilities || [],
        status: "initializing",
        spawnedAt: /* @__PURE__ */ new Date(),
        lastActivity: /* @__PURE__ */ new Date(),
        totalTasks: 0,
        totalDuration: 0,
        metrics: this.initializeAgentMetrics()
      };
      this.agents.set(agentId, agent);
      this.processPool.idle.push(agent);
      this.processPool.totalSpawned++;
      this.setupProcessEventHandlers(agent);
      await this.waitForAgentReady(agent);
      agent.status = "idle";
      agent.lastActivity = /* @__PURE__ */ new Date();
      this.logger.info("Claude agent spawned successfully", {
        agentId,
        processId: process2.pid,
        type: options.type
      });
      this.emit("agent:spawned", {
        agentId,
        type: options.type,
        processId: process2.pid
      });
      return agentId;
    } catch (error) {
      this.logger.error("Failed to spawn Claude agent", {
        type: options.type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  /**
   * Execute a task using a Claude agent
   */
  async executeTask(taskDefinition, agentId, options = {}) {
    const executionId = (0, import_helpers.generateId)("claude-execution");
    this.logger.info("Executing task with Claude agent", {
      executionId,
      taskId: taskDefinition.id.id,
      agentId
    });
    try {
      const agent = agentId ? this.agents.get(agentId) : await this.selectOptimalAgent(taskDefinition);
      if (!agent) {
        throw new Error(agentId ? `Agent not found: ${agentId}` : "No suitable agent available");
      }
      if (agent.status !== "idle") {
        throw new Error(`Agent ${agent.id} is not available (status: ${agent.status})`);
      }
      const execution = {
        id: executionId,
        taskId: taskDefinition.id.id,
        agentId: agent.id,
        startTime: /* @__PURE__ */ new Date(),
        status: "queued",
        input: {
          task: taskDefinition,
          options
        },
        retryCount: 0,
        maxRetries: options.maxRetries || 3
      };
      this.activeExecutions.set(executionId, execution);
      agent.status = "busy";
      agent.currentTask = executionId;
      agent.lastActivity = /* @__PURE__ */ new Date();
      this.moveAgentToBusyPool(agent);
      execution.status = "running";
      const result = await this.executeTaskWithAgent(agent, taskDefinition, options);
      execution.endTime = /* @__PURE__ */ new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      execution.output = result.result;
      execution.tokensUsed = result.metadata?.tokensUsed;
      if (result.success) {
        execution.status = "completed";
        agent.metrics.tasksCompleted++;
      } else {
        execution.status = "failed";
        execution.error = result.error;
        agent.metrics.tasksFailed++;
      }
      this.updateAgentMetrics(agent, execution);
      this.returnAgentToIdlePool(agent);
      this.logger.info("Task execution completed", {
        executionId,
        success: result.success,
        duration: execution.duration,
        tokensUsed: execution.tokensUsed
      });
      this.emit("task:completed", {
        executionId,
        taskId: taskDefinition.id.id,
        agentId: agent.id,
        success: result.success,
        duration: execution.duration
      });
      return execution;
    } catch (error) {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.status = "failed";
        execution.error = error instanceof Error ? error.message : String(error);
        execution.endTime = /* @__PURE__ */ new Date();
        execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
        const agent = this.agents.get(execution.agentId);
        if (agent) {
          this.returnAgentToIdlePool(agent);
        }
      }
      this.logger.error("Task execution failed", {
        executionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }
  /**
   * Cancel a running task execution
   */
  async cancelExecution(executionId, reason) {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    this.logger.info("Cancelling task execution", {
      executionId,
      reason,
      taskId: execution.taskId,
      agentId: execution.agentId
    });
    try {
      execution.status = "cancelled";
      execution.error = reason;
      execution.endTime = /* @__PURE__ */ new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      const agent = this.agents.get(execution.agentId);
      if (agent && agent.currentTask === executionId) {
        await this.cancelAgentTask(agent);
        this.returnAgentToIdlePool(agent);
      }
      this.emit("task:cancelled", {
        executionId,
        reason,
        taskId: execution.taskId,
        agentId: execution.agentId
      });
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }
  /**
   * Terminate a specific agent
   */
  async terminateAgent(agentId, reason = "Manual termination") {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    this.logger.info("Terminating Claude agent", {
      agentId,
      processId: agent.processId,
      reason
    });
    try {
      if (agent.currentTask) {
        await this.cancelExecution(agent.currentTask, "Agent termination");
      }
      agent.status = "terminated";
      await this.terminateProcess(agent.process);
      this.removeAgentFromPools(agent);
      this.agents.delete(agentId);
      this.processPool.totalTerminated++;
      this.logger.info("Claude agent terminated successfully", {
        agentId,
        reason,
        totalTasks: agent.totalTasks,
        totalDuration: agent.totalDuration
      });
      this.emit("agent:terminated", {
        agentId,
        reason,
        metrics: agent.metrics
      });
    } catch (error) {
      this.logger.error("Error terminating agent", {
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  /**
   * Get agent status and metrics
   */
  getAgentStatus(agentId) {
    return this.agents.get(agentId) || null;
  }
  /**
   * Get all active agents
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }
  /**
   * Get execution status
   */
  getExecutionStatus(executionId) {
    return this.activeExecutions.get(executionId) || null;
  }
  /**
   * Get comprehensive interface metrics
   */
  getInterfaceMetrics() {
    const agents = Array.from(this.agents.values());
    const executions = Array.from(this.activeExecutions.values());
    const totalCompleted = agents.reduce((sum, a) => sum + a.metrics.tasksCompleted, 0);
    const totalFailed = agents.reduce((sum, a) => sum + a.metrics.tasksFailed, 0);
    const totalTokens = agents.reduce((sum, a) => sum + a.metrics.totalTokensUsed, 0);
    const avgResponseTime = agents.length > 0 ? agents.reduce((sum, a) => sum + a.metrics.averageResponseTime, 0) / agents.length : 0;
    return {
      agents: {
        total: agents.length,
        idle: this.processPool.idle.length,
        busy: this.processPool.busy.length,
        failed: this.processPool.failed.length,
        terminated: this.processPool.totalTerminated
      },
      executions: {
        active: executions.filter((e) => e.status === "running").length,
        completed: totalCompleted,
        failed: totalFailed,
        cancelled: executions.filter((e) => e.status === "cancelled").length
      },
      performance: {
        averageResponseTime: avgResponseTime,
        totalTokensUsed: totalTokens,
        successRate: totalCompleted + totalFailed > 0 ? totalCompleted / (totalCompleted + totalFailed) : 0,
        throughput: this.calculateThroughput()
      },
      pool: {
        totalSpawned: this.processPool.totalSpawned,
        totalTerminated: this.processPool.totalTerminated,
        recyclingEnabled: this.processPool.recyclingEnabled,
        poolUtilization: this.calculatePoolUtilization()
      }
    };
  }
  // Private methods
  async verifyClaudeExecutable() {
    try {
      const { spawn: spawn2 } = await import("node:child_process");
      const process2 = spawn2(this.config.claudeExecutablePath, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      return new Promise((resolve, reject) => {
        let output = "";
        process2.stdout?.on("data", (data) => {
          output += data.toString();
        });
        process2.on("close", (code) => {
          if (code === 0) {
            this.logger.info("Claude executable verified", {
              path: this.config.claudeExecutablePath,
              version: output.trim()
            });
            resolve();
          } else {
            reject(new Error(`Claude executable verification failed with code ${code}`));
          }
        });
        process2.on("error", reject);
      });
    } catch (error) {
      throw new Error(`Claude executable not found: ${this.config.claudeExecutablePath}`);
    }
  }
  async prewarmAgentPool() {
    this.logger.info("Pre-warming agent pool", {
      targetSize: this.config.agentPoolSize
    });
    const promises = [];
    for (let i = 0; i < this.config.agentPoolSize; i++) {
      promises.push(this.spawnAgent({
        type: "general",
        name: `pool-agent-${i}`,
        capabilities: ["general"]
      }));
    }
    const results = await Promise.allSettled(promises);
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    this.logger.info("Agent pool pre-warming completed", {
      successful,
      failed,
      targetSize: this.config.agentPoolSize
    });
  }
  buildClaudeCommand(options) {
    const args = [];
    args.push("--model", options.model || this.config.defaultModel);
    args.push("--max-tokens", String(options.maxTokens || this.config.maxTokens));
    args.push("--temperature", String(options.temperature || this.config.temperature));
    if (options.systemPrompt) {
      args.push("--system", options.systemPrompt);
    }
    if (options.tools && options.tools.length > 0) {
      args.push("--allowedTools", options.tools.join(","));
    }
    if (this.config.enableStreaming) {
      args.push("--stream");
    }
    args.push("--dangerously-skip-permissions");
    return {
      executable: this.config.claudeExecutablePath,
      args
    };
  }
  setupProcessEventHandlers(agent) {
    const { process: process2 } = agent;
    process2.on("exit", (code, signal) => {
      this.logger.info("Claude agent process exited", {
        agentId: agent.id,
        processId: agent.processId,
        code,
        signal
      });
      if (agent.status !== "terminated") {
        agent.status = "error";
        this.moveAgentToFailedPool(agent);
      }
      this.emit("agent:exited", {
        agentId: agent.id,
        code,
        signal
      });
    });
    process2.on("error", (error) => {
      this.logger.error("Claude agent process error", {
        agentId: agent.id,
        processId: agent.processId,
        error: error.message
      });
      agent.status = "error";
      this.moveAgentToFailedPool(agent);
      this.emit("agent:error", {
        agentId: agent.id,
        error: error.message
      });
    });
    if (this.config.enableLogging) {
      process2.stdout?.on("data", (data) => {
        this.logger.debug("Agent stdout", {
          agentId: agent.id,
          data: data.toString().trim()
        });
      });
      process2.stderr?.on("data", (data) => {
        this.logger.debug("Agent stderr", {
          agentId: agent.id,
          data: data.toString().trim()
        });
      });
    }
  }
  async waitForAgentReady(agent, timeout = 3e4) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 1e3;
      const checkReady = /* @__PURE__ */ __name(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeout) {
          reject(new Error(`Agent ${agent.id} failed to become ready within ${timeout}ms`));
          return;
        }
        if (agent.process.killed || agent.process.exitCode !== null) {
          reject(new Error(`Agent ${agent.id} process terminated during initialization`));
          return;
        }
        if (elapsed > 2e3) {
          resolve();
        } else {
          setTimeout(checkReady, checkInterval);
        }
      }, "checkReady");
      checkReady();
    });
  }
  async selectOptimalAgent(taskDefinition) {
    const availableAgents = this.processPool.idle.filter((agent) => agent.status === "idle");
    if (availableAgents.length === 0) {
      if (this.getTotalActiveAgents() < this.config.maxConcurrentAgents) {
        const agentId = await this.spawnAgent({
          type: "task-specific",
          capabilities: taskDefinition.requirements.capabilities
        });
        return this.agents.get(agentId) || null;
      }
      return null;
    }
    const scoredAgents = availableAgents.map((agent) => ({
      agent,
      score: this.calculateAgentScore(agent, taskDefinition)
    }));
    scoredAgents.sort((a, b) => b.score - a.score);
    return scoredAgents[0].agent;
  }
  calculateAgentScore(agent, taskDefinition) {
    let score = 0;
    const requiredCapabilities = taskDefinition.requirements.capabilities;
    const matchingCapabilities = agent.capabilities.filter(
      (cap) => requiredCapabilities.includes(cap)
    );
    score += matchingCapabilities.length / requiredCapabilities.length * 100;
    score += agent.metrics.successRate * 50;
    score += Math.max(0, 50 - agent.metrics.averageResponseTime / 1e3) * 10;
    const maxTasks = Math.max(...this.processPool.idle.map((a) => a.totalTasks), 1);
    score += (1 - agent.totalTasks / maxTasks) * 20;
    return score;
  }
  async executeTaskWithAgent(agent, taskDefinition, options) {
    const startTime = import_node_perf_hooks.performance.now();
    try {
      const context = {
        task: taskDefinition,
        agent: this.convertToAgentState(agent),
        workingDirectory: options.workingDirectory || this.config.workingDirectory,
        tempDirectory: path.join(this.config.workingDirectory, "temp", agent.id),
        logDirectory: path.join(this.config.workingDirectory, "logs", agent.id),
        environment: {
          ...this.config.environmentVariables,
          CLAUDE_AGENT_ID: agent.id,
          CLAUDE_TASK_ID: taskDefinition.id.id
        },
        resources: {
          maxMemory: taskDefinition.requirements.memoryRequired || 512 * 1024 * 1024,
          maxCpuTime: taskDefinition.requirements.maxDuration || 3e5,
          maxDiskSpace: 1024 * 1024 * 1024,
          maxNetworkConnections: 10,
          maxFileHandles: 100,
          priority: 1
        }
      };
      const result = await this.taskExecutor.executeClaudeTask(
        taskDefinition,
        context.agent,
        {
          model: options.model || this.config.defaultModel,
          maxTokens: options.maxTokens || this.config.maxTokens,
          temperature: options.temperature || this.config.temperature,
          timeout: options.timeout || this.config.timeout,
          claudePath: this.config.claudeExecutablePath,
          ...options
        }
      );
      const duration = import_node_perf_hooks.performance.now() - startTime;
      agent.lastActivity = /* @__PURE__ */ new Date();
      agent.totalTasks++;
      agent.totalDuration += duration;
      return result;
    } catch (error) {
      const duration = import_node_perf_hooks.performance.now() - startTime;
      agent.totalDuration += duration;
      throw error;
    }
  }
  convertToAgentState(agent) {
    return {
      id: {
        id: agent.id,
        swarmId: "claude-interface",
        type: agent.type,
        instance: 1
      },
      name: `Claude-${agent.id}`,
      type: agent.type,
      status: agent.status,
      capabilities: this.createAgentCapabilities(agent.capabilities),
      metrics: {
        tasksCompleted: agent.metrics.tasksCompleted,
        tasksFailed: agent.metrics.tasksFailed,
        averageExecutionTime: agent.metrics.averageResponseTime,
        successRate: agent.metrics.successRate,
        cpuUsage: agent.metrics.cpuUsage,
        memoryUsage: agent.metrics.memoryUsage,
        diskUsage: 0,
        networkUsage: 0,
        codeQuality: 0.8,
        testCoverage: 0.7,
        bugRate: 0.1,
        userSatisfaction: 0.9,
        totalUptime: Date.now() - agent.spawnedAt.getTime(),
        lastActivity: agent.lastActivity,
        responseTime: agent.metrics.averageResponseTime
      },
      currentTask: agent.currentTask ? {
        id: agent.currentTask,
        swarmId: "claude-interface",
        sequence: 0,
        priority: 1
      } : void 0,
      workload: agent.status === "busy" ? 1 : 0,
      health: agent.status === "error" ? 0 : 1,
      config: {
        autonomyLevel: 0.8,
        learningEnabled: false,
        adaptationEnabled: false,
        maxTasksPerHour: 60,
        maxConcurrentTasks: 1,
        timeoutThreshold: this.config.timeout,
        reportingInterval: 1e4,
        heartbeatInterval: 5e3,
        permissions: ["read", "write", "execute"],
        trustedAgents: [],
        expertise: {},
        preferences: {}
      },
      environment: {
        runtime: "claude",
        version: "1.0.0",
        workingDirectory: this.config.workingDirectory,
        tempDirectory: path.join(this.config.workingDirectory, "temp", agent.id),
        logDirectory: path.join(this.config.workingDirectory, "logs", agent.id),
        apiEndpoints: {},
        credentials: {},
        availableTools: agent.capabilities,
        toolConfigs: {}
      },
      endpoints: [],
      lastHeartbeat: agent.lastActivity,
      taskHistory: [],
      errorHistory: [],
      parentAgent: void 0,
      childAgents: [],
      collaborators: []
    };
  }
  createAgentCapabilities(capabilities) {
    return {
      codeGeneration: capabilities.includes("coding") || capabilities.includes("codeGeneration"),
      codeReview: capabilities.includes("review") || capabilities.includes("codeReview"),
      testing: capabilities.includes("testing"),
      documentation: capabilities.includes("documentation"),
      research: capabilities.includes("research"),
      analysis: capabilities.includes("analysis"),
      webSearch: capabilities.includes("webSearch"),
      apiIntegration: capabilities.includes("apiIntegration"),
      fileSystem: capabilities.includes("fileSystem"),
      terminalAccess: capabilities.includes("terminal"),
      languages: capabilities.filter((c) => ["javascript", "typescript", "python", "java"].includes(c)),
      frameworks: capabilities.filter((c) => ["react", "node", "express"].includes(c)),
      domains: capabilities.filter((c) => ["web", "api", "database"].includes(c)),
      tools: capabilities.filter((c) => ["bash", "git", "npm"].includes(c)),
      maxConcurrentTasks: 1,
      maxMemoryUsage: 512 * 1024 * 1024,
      maxExecutionTime: this.config.timeout,
      reliability: 0.9,
      speed: 1,
      quality: 0.8
    };
  }
  async cancelAgentTask(agent) {
    if (agent.process && !agent.process.killed) {
      agent.process.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      if (!agent.process.killed) {
        agent.process.kill("SIGKILL");
      }
    }
    agent.currentTask = void 0;
    agent.status = "idle";
    agent.lastActivity = /* @__PURE__ */ new Date();
  }
  async terminateProcess(process2) {
    if (process2.killed || process2.exitCode !== null) {
      return;
    }
    process2.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 2e3));
    if (!process2.killed && process2.exitCode === null) {
      process2.kill("SIGKILL");
    }
  }
  async terminateAllAgents() {
    const terminationPromises = Array.from(this.agents.keys()).map((agentId) => this.terminateAgent(agentId, "Interface shutdown"));
    await Promise.allSettled(terminationPromises);
  }
  moveAgentToBusyPool(agent) {
    const idleIndex = this.processPool.idle.indexOf(agent);
    if (idleIndex !== -1) {
      this.processPool.idle.splice(idleIndex, 1);
      this.processPool.busy.push(agent);
    }
  }
  returnAgentToIdlePool(agent) {
    agent.status = "idle";
    agent.currentTask = void 0;
    agent.lastActivity = /* @__PURE__ */ new Date();
    const busyIndex = this.processPool.busy.indexOf(agent);
    if (busyIndex !== -1) {
      this.processPool.busy.splice(busyIndex, 1);
      this.processPool.idle.push(agent);
    }
  }
  moveAgentToFailedPool(agent) {
    this.removeAgentFromPools(agent);
    this.processPool.failed.push(agent);
  }
  removeAgentFromPools(agent) {
    const idleIndex = this.processPool.idle.indexOf(agent);
    if (idleIndex !== -1) {
      this.processPool.idle.splice(idleIndex, 1);
    }
    const busyIndex = this.processPool.busy.indexOf(agent);
    if (busyIndex !== -1) {
      this.processPool.busy.splice(busyIndex, 1);
    }
    const failedIndex = this.processPool.failed.indexOf(agent);
    if (failedIndex !== -1) {
      this.processPool.failed.splice(failedIndex, 1);
    }
  }
  updateAgentMetrics(agent, execution) {
    const metrics = agent.metrics;
    const totalTasks = metrics.tasksCompleted + metrics.tasksFailed;
    if (execution.duration) {
      metrics.averageResponseTime = totalTasks > 0 ? (metrics.averageResponseTime * (totalTasks - 1) + execution.duration) / totalTasks : execution.duration;
    }
    metrics.successRate = totalTasks > 0 ? metrics.tasksCompleted / totalTasks : 0;
    metrics.errorRate = 1 - metrics.successRate;
    if (execution.tokensUsed) {
      metrics.totalTokensUsed += execution.tokensUsed;
    }
  }
  getTotalActiveAgents() {
    return this.processPool.idle.length + this.processPool.busy.length;
  }
  calculateThroughput() {
    const agents = Array.from(this.agents.values());
    const totalTasks = agents.reduce((sum, a) => sum + a.totalTasks, 0);
    const totalTime = agents.reduce((sum, a) => sum + a.totalDuration, 0);
    return totalTime > 0 ? totalTasks / totalTime * 6e4 : 0;
  }
  calculatePoolUtilization() {
    const total = this.getTotalActiveAgents();
    const busy = this.processPool.busy.length;
    return total > 0 ? busy / total : 0;
  }
  startHealthChecks() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }
  performHealthCheck() {
    const now = Date.now();
    for (const agent of this.agents.values()) {
      const inactiveTime = now - agent.lastActivity.getTime();
      if (agent.status === "busy" && inactiveTime > this.config.timeout * 2) {
        this.logger.warn("Agent appears stalled", {
          agentId: agent.id,
          inactiveTime,
          currentTask: agent.currentTask
        });
        this.recoverStalledAgent(agent);
      }
      if (agent.process.killed || agent.process.exitCode !== null) {
        if (agent.status !== "terminated") {
          this.logger.warn("Agent process died unexpectedly", {
            agentId: agent.id,
            exitCode: agent.process.exitCode
          });
          agent.status = "error";
          this.moveAgentToFailedPool(agent);
        }
      }
    }
  }
  async recoverStalledAgent(agent) {
    try {
      if (agent.currentTask) {
        await this.cancelExecution(agent.currentTask, "Agent recovery");
      }
      this.returnAgentToIdlePool(agent);
      this.logger.info("Agent recovered from stalled state", {
        agentId: agent.id
      });
    } catch (error) {
      this.logger.error("Failed to recover stalled agent", {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.terminateAgent(agent.id, "Recovery failed");
    }
  }
  initializeProcessPool() {
    return {
      idle: [],
      busy: [],
      failed: [],
      totalSpawned: 0,
      totalTerminated: 0,
      recyclingEnabled: this.config.processRecycling,
      maxAge: 36e5,
      // 1 hour
      maxTasks: 100
    };
  }
  initializeAgentMetrics() {
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      averageResponseTime: 0,
      totalTokensUsed: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      errorRate: 0,
      successRate: 0
    };
  }
  createDefaultConfig(config) {
    return {
      claudeExecutablePath: "claude",
      defaultModel: "claude-3-5-sonnet-20241022",
      maxTokens: 4096,
      temperature: 0.7,
      timeout: 3e5,
      // 5 minutes
      maxConcurrentAgents: 10,
      enableStreaming: false,
      enableLogging: true,
      workingDirectory: process.cwd(),
      environmentVariables: {},
      agentPoolSize: 0,
      processRecycling: true,
      healthCheckInterval: 3e4,
      // 30 seconds
      ...config
    };
  }
  setupEventHandlers() {
    this.on("agent:spawned", (data) => {
      this.logger.info("Agent spawned event", data);
    });
    this.on("agent:terminated", (data) => {
      this.logger.info("Agent terminated event", data);
    });
    this.on("task:completed", (data) => {
      this.logger.info("Task completed event", data);
    });
    this.on("task:cancelled", (data) => {
      this.logger.warn("Task cancelled event", data);
    });
  }
}
var claude_code_interface_default = ClaudeCodeInterface;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ClaudeCodeInterface
});
//# sourceMappingURL=claude-code-interface.js.map
