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
var error_handler_exports = {};
__export(error_handler_exports, {
  AppError: () => AppError,
  getErrorMessage: () => getErrorMessage,
  getErrorStack: () => getErrorStack,
  handleError: () => handleError,
  isError: () => isError
});
module.exports = __toCommonJS(error_handler_exports);
var import_type_guards = require("./type-guards.js");
class AppError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
  static {
    __name(this, "AppError");
  }
}
const isError = import_type_guards.isError;
const getErrorMessage = import_type_guards.getErrorMessage;
const getErrorStack = import_type_guards.getErrorStack;
function handleError(error, context) {
  const message = getErrorMessage(error);
  const stack = getErrorStack(error);
  console.error(`Error${context ? ` in ${context}` : ""}: ${message}`);
  if (stack && true) {
    console.error("Stack trace:", stack);
  }
  process.exit(1);
}
__name(handleError, "handleError");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AppError,
  getErrorMessage,
  getErrorStack,
  handleError,
  isError
});
//# sourceMappingURL=error-handler.js.map
