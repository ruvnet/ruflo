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
var type_guards_exports = {};
__export(type_guards_exports, {
  getErrorMessage: () => getErrorMessage,
  getErrorStack: () => getErrorStack,
  hasAgentId: () => hasAgentId,
  hasAgentLoad: () => hasAgentLoad,
  hasAgentTask: () => hasAgentTask,
  hasCode: () => hasCode,
  hasMessage: () => hasMessage,
  hasPid: () => hasPid,
  hasStack: () => hasStack,
  hasWorkStealingData: () => hasWorkStealingData,
  isArray: () => isArray,
  isBoolean: () => isBoolean,
  isDefined: () => isDefined,
  isError: () => isError,
  isErrorLike: () => isErrorLike,
  isFunction: () => isFunction,
  isNullOrUndefined: () => isNullOrUndefined,
  isNumber: () => isNumber,
  isObject: () => isObject,
  isString: () => isString
});
module.exports = __toCommonJS(type_guards_exports);
function isObject(value) {
  return typeof value === "object" && value !== null;
}
__name(isObject, "isObject");
function isError(value) {
  return value instanceof Error;
}
__name(isError, "isError");
function hasMessage(value) {
  return isObject(value) && "message" in value && typeof value.message === "string";
}
__name(hasMessage, "hasMessage");
function hasStack(value) {
  return isObject(value) && "stack" in value && typeof value.stack === "string";
}
__name(hasStack, "hasStack");
function isErrorLike(value) {
  return hasMessage(value);
}
__name(isErrorLike, "isErrorLike");
function hasCode(value) {
  return isObject(value) && "code" in value && (typeof value.code === "string" || typeof value.code === "number");
}
__name(hasCode, "hasCode");
function hasAgentId(value) {
  return isObject(value) && "agentId" in value && isObject(value.agentId) && "id" in value.agentId && typeof value.agentId.id === "string";
}
__name(hasAgentId, "hasAgentId");
function hasPid(value) {
  return isObject(value) && "pid" in value && typeof value.pid === "number";
}
__name(hasPid, "hasPid");
function getErrorMessage(error) {
  if (typeof error === "string") {
    return error;
  }
  if (isError(error)) {
    return error.message;
  }
  if (hasMessage(error)) {
    return error.message;
  }
  return String(error);
}
__name(getErrorMessage, "getErrorMessage");
function getErrorStack(error) {
  if (isError(error)) {
    return error.stack;
  }
  if (hasStack(error)) {
    return error.stack;
  }
  return void 0;
}
__name(getErrorStack, "getErrorStack");
function isString(value) {
  return typeof value === "string";
}
__name(isString, "isString");
function isNumber(value) {
  return typeof value === "number" && !isNaN(value);
}
__name(isNumber, "isNumber");
function isBoolean(value) {
  return typeof value === "boolean";
}
__name(isBoolean, "isBoolean");
function isArray(value) {
  return Array.isArray(value);
}
__name(isArray, "isArray");
function isFunction(value) {
  return typeof value === "function";
}
__name(isFunction, "isFunction");
function isNullOrUndefined(value) {
  return value === null || value === void 0;
}
__name(isNullOrUndefined, "isNullOrUndefined");
function isDefined(value) {
  return value !== null && value !== void 0;
}
__name(isDefined, "isDefined");
function hasAgentLoad(value) {
  return isObject(value) && "agentId" in value && isObject(value.agentId) && "id" in value.agentId && typeof value.agentId.id === "string" && "load" in value && typeof value.load === "number";
}
__name(hasAgentLoad, "hasAgentLoad");
function hasAgentTask(value) {
  return isObject(value) && "agentId" in value && isObject(value.agentId) && "id" in value.agentId && typeof value.agentId.id === "string" && "task" in value;
}
__name(hasAgentTask, "hasAgentTask");
function hasWorkStealingData(value) {
  return isObject(value) && "sourceAgent" in value && isObject(value.sourceAgent) && "id" in value.sourceAgent && typeof value.sourceAgent.id === "string" && "targetAgent" in value && isObject(value.targetAgent) && "id" in value.targetAgent && typeof value.targetAgent.id === "string" && "taskCount" in value && typeof value.taskCount === "number";
}
__name(hasWorkStealingData, "hasWorkStealingData");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getErrorMessage,
  getErrorStack,
  hasAgentId,
  hasAgentLoad,
  hasAgentTask,
  hasCode,
  hasMessage,
  hasPid,
  hasStack,
  hasWorkStealingData,
  isArray,
  isBoolean,
  isDefined,
  isError,
  isErrorLike,
  isFunction,
  isNullOrUndefined,
  isNumber,
  isObject,
  isString
});
//# sourceMappingURL=type-guards.js.map
