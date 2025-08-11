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
var executor_v2_exports = {};
__export(executor_v2_exports, {
  TaskExecutorV2: () => TaskExecutorV2,
  default: () => executor_v2_default
});
module.exports = __toCommonJS(executor_v2_exports);
var import_node_child_process = require("node:child_process");
var import_helpers = require("../utils/helpers.js");
var import_environment_detector = require("../cli/utils/environment-detector.js");
class TaskExecutorV2 extends TaskExecutor {
  static {
    __name(this, "TaskExecutorV2");
  }
  environment = (0, import_environment_detector.detectExecutionEnvironment)();
  constructor(config = {}) {
    super(config);
    this.logger.info("Task Executor v2.0 initialized", {
      environment: this.environment.terminalType,
      interactive: this.environment.isInteractive,
      recommendations: this.environment.recommendedFlags
    });
  }
  async executeClaudeTask(task, agent, claudeOptions = {}) {
    const enhancedOptions = (0, import_environment_detector.applySmartDefaults)(claudeOptions, this.environment);
    if (enhancedOptions.appliedDefaults.length > 0) {
      this.logger.info("Applied environment-based defaults", {
        defaults: enhancedOptions.appliedDefaults,
        environment: this.environment.terminalType
      });
    }
    try {
      return await this.executeClaudeWithTimeoutV2(
        (0, import_helpers.generateId)("claude-execution"),
        task,
        agent,
        await this.createExecutionContext(task, agent),
        enhancedOptions
      );
    } catch (error) {
      if (this.isInteractiveError(error) && enhancedOptions.retryOnInteractiveError) {
        this.logger.warn("Interactive error detected, retrying with non-interactive mode", {
          error: error.message
        });
        enhancedOptions.nonInteractive = true;
        enhancedOptions.dangerouslySkipPermissions = true;
        return await this.executeClaudeWithTimeoutV2(
          (0, import_helpers.generateId)("claude-execution-retry"),
          task,
          agent,
          await this.createExecutionContext(task, agent),
          enhancedOptions
        );
      }
      throw error;
    }
  }
  async executeClaudeWithTimeoutV2(sessionId, task, agent, context, options) {
    const startTime = Date.now();
    const timeout = options.timeout || this.config.timeoutMs;
    const command = this.buildClaudeCommandV2(task, agent, options);
    const env = {
      ...process.env,
      ...context.environment,
      ...options.environmentOverride,
      CLAUDE_TASK_ID: task.id.id,
      CLAUDE_AGENT_ID: agent.id.id,
      CLAUDE_SESSION_ID: sessionId,
      CLAUDE_WORKING_DIR: context.workingDirectory,
      CLAUDE_NON_INTERACTIVE: options.nonInteractive ? "1" : "0",
      CLAUDE_AUTO_APPROVE: options.autoApprove ? "1" : "0"
    };
    if (options.promptDefaults) {
      env.CLAUDE_PROMPT_DEFAULTS = JSON.stringify(options.promptDefaults);
    }
    this.logger.debug("Executing Claude command v2", {
      sessionId,
      command: command.command,
      args: command.args,
      workingDir: context.workingDirectory,
      nonInteractive: options.nonInteractive,
      environment: this.environment.terminalType
    });
    return new Promise((resolve, reject) => {
      let outputBuffer = "";
      let errorBuffer = "";
      let isTimeout = false;
      let process2 = null;
      const timeoutHandle = setTimeout(() => {
        isTimeout = true;
        if (process2) {
          this.logger.warn("Claude execution timeout, killing process", {
            sessionId,
            pid: process2.pid,
            timeout
          });
          process2.kill("SIGTERM");
          setTimeout(() => {
            if (process2 && !process2.killed) {
              process2.kill("SIGKILL");
            }
          }, this.config.killTimeout);
        }
      }, timeout);
      try {
        process2 = (0, import_node_child_process.spawn)(command.command, command.args, {
          cwd: context.workingDirectory,
          env,
          stdio: options.nonInteractive ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
          detached: options.detached || false,
          // Disable shell to avoid shell-specific issues
          shell: false
        });
        if (!process2.pid) {
          clearTimeout(timeoutHandle);
          reject(new Error("Failed to spawn Claude process"));
          return;
        }
        this.logger.info("Claude process started (v2)", {
          sessionId,
          pid: process2.pid,
          command: command.command,
          mode: options.nonInteractive ? "non-interactive" : "interactive"
        });
        if (process2.stdout) {
          process2.stdout.on("data", (data) => {
            const chunk = data.toString();
            outputBuffer += chunk;
            if (this.config.streamOutput) {
              this.emit("output", {
                sessionId,
                type: "stdout",
                data: chunk
              });
            }
          });
        }
        if (process2.stderr) {
          process2.stderr.on("data", (data) => {
            const chunk = data.toString();
            errorBuffer += chunk;
            if (this.isInteractiveErrorMessage(chunk)) {
              this.logger.warn("Interactive mode error detected in stderr", {
                sessionId,
                error: chunk.trim()
              });
            }
            if (this.config.streamOutput) {
              this.emit("output", {
                sessionId,
                type: "stderr",
                data: chunk
              });
            }
          });
        }
        process2.on("error", (error) => {
          clearTimeout(timeoutHandle);
          this.logger.error("Process error", {
            sessionId,
            error: error.message,
            code: error.code
          });
          reject(error);
        });
        process2.on("close", async (code, signal) => {
          clearTimeout(timeoutHandle);
          const duration = Date.now() - startTime;
          const exitCode = code || 0;
          this.logger.info("Claude process completed (v2)", {
            sessionId,
            exitCode,
            signal,
            duration,
            isTimeout,
            hasErrors: errorBuffer.length > 0
          });
          try {
            const resourceUsage = await this.collectResourceUsage(sessionId);
            const artifacts = await this.collectArtifacts(context);
            const result = {
              success: !isTimeout && exitCode === 0,
              output: outputBuffer,
              error: errorBuffer,
              exitCode,
              duration,
              resourcesUsed: resourceUsage,
              artifacts,
              metadata: {
                environment: this.environment.terminalType,
                nonInteractive: options.nonInteractive || false,
                appliedDefaults: options.appliedDefaults || []
              }
            };
            if (isTimeout) {
              reject(new Error(`Execution timed out after ${timeout}ms`));
            } else if (exitCode !== 0 && this.isInteractiveErrorMessage(errorBuffer)) {
              reject(new Error(`Interactive mode error: ${errorBuffer.trim()}`));
            } else {
              resolve(result);
            }
          } catch (collectionError) {
            this.logger.error("Error collecting execution results", {
              sessionId,
              error: collectionError.message
            });
            resolve({
              success: !isTimeout && exitCode === 0,
              output: outputBuffer,
              error: errorBuffer,
              exitCode,
              duration,
              resourcesUsed: this.getDefaultResourceUsage(),
              artifacts: {},
              metadata: {}
            });
          }
        });
      } catch (spawnError) {
        clearTimeout(timeoutHandle);
        this.logger.error("Failed to spawn process", {
          sessionId,
          error: spawnError.message
        });
        reject(spawnError);
      }
    });
  }
  buildClaudeCommandV2(task, agent, options) {
    const args = [];
    let input = "";
    const prompt = this.buildClaudePrompt(task, agent);
    if (options.useStdin) {
      input = prompt;
    } else {
      args.push("-p", prompt);
    }
    if (task.requirements.tools.length > 0) {
      args.push("--allowedTools", task.requirements.tools.join(","));
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.maxTokens) {
      args.push("--max-tokens", options.maxTokens.toString());
    }
    if (options.temperature !== void 0) {
      args.push("--temperature", options.temperature.toString());
    }
    if (options.nonInteractive || options.dangerouslySkipPermissions || this.environment.recommendedFlags.includes("--dangerously-skip-permissions")) {
      args.push("--dangerously-skip-permissions");
    }
    if (options.nonInteractive) {
      args.push("--non-interactive");
    }
    if (options.autoApprove) {
      args.push("--auto-approve");
    }
    if (options.outputFormat) {
      args.push("--output-format", options.outputFormat);
    } else if (options.nonInteractive) {
      args.push("--output-format", "json");
    }
    args.push(
      "--metadata",
      JSON.stringify({
        environment: this.environment.terminalType,
        interactive: this.environment.isInteractive,
        executor: "v2"
      })
    );
    return {
      command: options.claudePath || "claude",
      args,
      input
    };
  }
  isInteractiveError(error) {
    if (!(error instanceof Error))
      return false;
    const errorMessage = error.message.toLowerCase();
    return errorMessage.includes("raw mode") || errorMessage.includes("stdin") || errorMessage.includes("interactive") || errorMessage.includes("tty") || errorMessage.includes("terminal");
  }
  isInteractiveErrorMessage(message) {
    const lowerMessage = message.toLowerCase();
    return lowerMessage.includes("raw mode is not supported") || lowerMessage.includes("stdin is not a tty") || lowerMessage.includes("requires interactive terminal") || lowerMessage.includes("manual ui agreement needed");
  }
  getDefaultResourceUsage() {
    return {
      cpuTime: 0,
      maxMemory: 0,
      diskIO: 0,
      networkIO: 0,
      fileHandles: 0
    };
  }
}
var executor_v2_default = TaskExecutorV2;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TaskExecutorV2
});
//# sourceMappingURL=executor-v2.js.map
