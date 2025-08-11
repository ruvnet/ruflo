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
var errors_exports = {};
__export(errors_exports, {
  ClaudeFlowError: () => ClaudeFlowError,
  ConfigError: () => ConfigError,
  CoordinationError: () => CoordinationError,
  DeadlockError: () => DeadlockError,
  InitializationError: () => InitializationError,
  MCPError: () => MCPError,
  MCPMethodNotFoundError: () => MCPMethodNotFoundError,
  MCPTransportError: () => MCPTransportError,
  MemoryBackendError: () => MemoryBackendError,
  MemoryConflictError: () => MemoryConflictError,
  MemoryError: () => MemoryError,
  ResourceLockError: () => ResourceLockError,
  ShutdownError: () => ShutdownError,
  SystemError: () => SystemError,
  TaskDependencyError: () => TaskDependencyError,
  TaskError: () => TaskError,
  TaskTimeoutError: () => TaskTimeoutError,
  TerminalCommandError: () => TerminalCommandError,
  TerminalError: () => TerminalError,
  TerminalSpawnError: () => TerminalSpawnError,
  ValidationError: () => ValidationError,
  formatError: () => formatError,
  getErrorDetails: () => getErrorDetails,
  isClaudeFlowError: () => isClaudeFlowError
});
module.exports = __toCommonJS(errors_exports);
class ClaudeFlowError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "ClaudeFlowError";
    Error.captureStackTrace(this, this.constructor);
  }
  static {
    __name(this, "ClaudeFlowError");
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack
    };
  }
}
class TerminalError extends ClaudeFlowError {
  static {
    __name(this, "TerminalError");
  }
  constructor(message, details) {
    super(message, "TERMINAL_ERROR", details);
    this.name = "TerminalError";
  }
}
class TerminalSpawnError extends TerminalError {
  static {
    __name(this, "TerminalSpawnError");
  }
  code = "TERMINAL_SPAWN_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class TerminalCommandError extends TerminalError {
  static {
    __name(this, "TerminalCommandError");
  }
  code = "TERMINAL_COMMAND_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class MemoryError extends ClaudeFlowError {
  static {
    __name(this, "MemoryError");
  }
  constructor(message, details) {
    super(message, "MEMORY_ERROR", details);
    this.name = "MemoryError";
  }
}
class MemoryBackendError extends MemoryError {
  static {
    __name(this, "MemoryBackendError");
  }
  code = "MEMORY_BACKEND_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class MemoryConflictError extends MemoryError {
  static {
    __name(this, "MemoryConflictError");
  }
  code = "MEMORY_CONFLICT_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class CoordinationError extends ClaudeFlowError {
  static {
    __name(this, "CoordinationError");
  }
  constructor(message, details) {
    super(message, "COORDINATION_ERROR", details);
    this.name = "CoordinationError";
  }
}
class DeadlockError extends CoordinationError {
  constructor(message, agents, resources) {
    super(message, { agents, resources });
    this.agents = agents;
    this.resources = resources;
  }
  static {
    __name(this, "DeadlockError");
  }
  code = "DEADLOCK_ERROR";
}
class ResourceLockError extends CoordinationError {
  static {
    __name(this, "ResourceLockError");
  }
  code = "RESOURCE_LOCK_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class MCPError extends ClaudeFlowError {
  static {
    __name(this, "MCPError");
  }
  constructor(message, details) {
    super(message, "MCP_ERROR", details);
    this.name = "MCPError";
  }
}
class MCPTransportError extends MCPError {
  static {
    __name(this, "MCPTransportError");
  }
  code = "MCP_TRANSPORT_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class MCPMethodNotFoundError extends MCPError {
  static {
    __name(this, "MCPMethodNotFoundError");
  }
  code = "MCP_METHOD_NOT_FOUND";
  constructor(method) {
    super(`Method not found: ${method}`, { method });
  }
}
class ConfigError extends ClaudeFlowError {
  static {
    __name(this, "ConfigError");
  }
  constructor(message, details) {
    super(message, "CONFIG_ERROR", details);
    this.name = "ConfigError";
  }
}
class ValidationError extends ConfigError {
  static {
    __name(this, "ValidationError");
  }
  code = "VALIDATION_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
class TaskError extends ClaudeFlowError {
  static {
    __name(this, "TaskError");
  }
  constructor(message, details) {
    super(message, "TASK_ERROR", details);
    this.name = "TaskError";
  }
}
class TaskTimeoutError extends TaskError {
  static {
    __name(this, "TaskTimeoutError");
  }
  code = "TASK_TIMEOUT_ERROR";
  constructor(taskId, timeout) {
    super(`Task ${taskId} timed out after ${timeout}ms`, { taskId, timeout });
  }
}
class TaskDependencyError extends TaskError {
  static {
    __name(this, "TaskDependencyError");
  }
  code = "TASK_DEPENDENCY_ERROR";
  constructor(taskId, dependencies) {
    super(`Task ${taskId} has unmet dependencies`, { taskId, dependencies });
  }
}
class SystemError extends ClaudeFlowError {
  static {
    __name(this, "SystemError");
  }
  constructor(message, details) {
    super(message, "SYSTEM_ERROR", details);
    this.name = "SystemError";
  }
}
class InitializationError extends SystemError {
  static {
    __name(this, "InitializationError");
  }
  code = "INITIALIZATION_ERROR";
  constructor(componentOrMessage, details) {
    const message = componentOrMessage.includes("initialize") ? componentOrMessage : `Failed to initialize ${componentOrMessage}`;
    super(
      message,
      details ? { component: componentOrMessage, ...details } : { component: componentOrMessage }
    );
  }
}
class ShutdownError extends SystemError {
  static {
    __name(this, "ShutdownError");
  }
  code = "SHUTDOWN_ERROR";
  constructor(message, details) {
    super(message, details);
  }
}
function isClaudeFlowError(error) {
  return error instanceof ClaudeFlowError;
}
__name(isClaudeFlowError, "isClaudeFlowError");
function formatError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
__name(formatError, "formatError");
function getErrorDetails(error) {
  if (isClaudeFlowError(error)) {
    return error.details;
  }
  return void 0;
}
__name(getErrorDetails, "getErrorDetails");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ClaudeFlowError,
  ConfigError,
  CoordinationError,
  DeadlockError,
  InitializationError,
  MCPError,
  MCPMethodNotFoundError,
  MCPTransportError,
  MemoryBackendError,
  MemoryConflictError,
  MemoryError,
  ResourceLockError,
  ShutdownError,
  SystemError,
  TaskDependencyError,
  TaskError,
  TaskTimeoutError,
  TerminalCommandError,
  TerminalError,
  TerminalSpawnError,
  ValidationError,
  formatError,
  getErrorDetails,
  isClaudeFlowError
});
//# sourceMappingURL=errors.js.map
