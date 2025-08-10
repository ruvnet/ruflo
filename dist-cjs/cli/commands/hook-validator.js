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
var hook_validator_exports = {};
__export(hook_validator_exports, {
  sanitizeHookParams: () => sanitizeHookParams,
  validateHookParams: () => validateHookParams
});
module.exports = __toCommonJS(hook_validator_exports);
function validateHookParams(hookType, params) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };
  if (params.metadata && typeof params.metadata === "string") {
    try {
      JSON.parse(params.metadata);
    } catch {
      result.errors.push("Invalid JSON in --metadata parameter");
      result.valid = false;
    }
  }
  switch (hookType) {
    case "pre-task":
      if (params.complexity && !["low", "medium", "high"].includes(params.complexity)) {
        result.errors.push("--complexity must be one of: low, medium, high");
        result.valid = false;
      }
      if (params.estimatedMinutes && isNaN(Number(params.estimatedMinutes))) {
        result.errors.push("--estimated-minutes must be a number");
        result.valid = false;
      }
      break;
    case "post-task":
      if (!params.taskId) {
        result.errors.push("--task-id is required for post-task hook");
        result.valid = false;
      }
      break;
    case "pre-edit":
    case "post-edit":
      if (!params.file) {
        result.errors.push(`--file is required for ${hookType} hook`);
        result.valid = false;
      }
      if (hookType === "pre-edit" && params.operation) {
        if (!["read", "write", "edit", "delete"].includes(params.operation)) {
          result.errors.push("--operation must be one of: read, write, edit, delete");
          result.valid = false;
        }
      }
      break;
    case "pre-command":
    case "post-command":
      if (!params.command) {
        result.errors.push(`--command is required for ${hookType} hook`);
        result.valid = false;
      }
      if (hookType === "post-command" && params.exitCode) {
        if (isNaN(Number(params.exitCode))) {
          result.errors.push("--exit-code must be a number");
          result.valid = false;
        }
      }
      break;
    case "session-restore":
      if (!params.sessionId) {
        result.errors.push("--session-id is required for session-restore hook");
        result.valid = false;
      }
      break;
    case "pre-search":
      if (!params.query) {
        result.errors.push("--query is required for pre-search hook");
        result.valid = false;
      }
      if (params.maxResults && isNaN(Number(params.maxResults))) {
        result.errors.push("--max-results must be a number");
        result.valid = false;
      }
      break;
    case "notification":
      if (!params.message) {
        result.errors.push("--message is required for notification hook");
        result.valid = false;
      }
      if (params.level && !["info", "warning", "error"].includes(params.level)) {
        result.errors.push("--level must be one of: info, warning, error");
        result.valid = false;
      }
      break;
    case "performance":
      if (params.duration && isNaN(Number(params.duration))) {
        result.errors.push("--duration must be a number");
        result.valid = false;
      }
      if (params.metrics && typeof params.metrics === "string") {
        try {
          JSON.parse(params.metrics);
        } catch {
          result.errors.push("Invalid JSON in --metrics parameter");
          result.valid = false;
        }
      }
      break;
    case "memory-sync":
      if (params.direction && !["push", "pull", "sync"].includes(params.direction)) {
        result.errors.push("--direction must be one of: push, pull, sync");
        result.valid = false;
      }
      break;
    case "telemetry":
      if (!params.event) {
        result.errors.push("--event is required for telemetry hook");
        result.valid = false;
      }
      if (params.data && typeof params.data === "string") {
        try {
          JSON.parse(params.data);
        } catch {
          result.errors.push("Invalid JSON in --data parameter");
          result.valid = false;
        }
      }
      break;
  }
  if (hookType === "session-start" && params.loadPrevious && !params.sessionId) {
    result.warnings.push("--load-previous without --session-id may load unexpected data");
  }
  if (hookType === "post-edit" && params.format && !params.file?.match(/\.(js|ts|jsx|tsx|py|java|cpp|cs)$/)) {
    result.warnings.push("--format may not work correctly for this file type");
  }
  return result;
}
__name(validateHookParams, "validateHookParams");
function sanitizeHookParams(params) {
  const sanitized = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null) {
      continue;
    }
    if (["file", "saveTo", "target"].includes(key) && typeof value === "string") {
      sanitized[key] = value.replace(/[<>"|?*]/g, "");
    } else if (key === "command" && typeof value === "string") {
      sanitized[key] = value.replace(/[;&|`$()]/g, "");
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
__name(sanitizeHookParams, "sanitizeHookParams");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  sanitizeHookParams,
  validateHookParams
});
//# sourceMappingURL=hook-validator.js.map
