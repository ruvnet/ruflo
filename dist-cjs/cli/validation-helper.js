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
var validation_helper_exports = {};
__export(validation_helper_exports, {
  ValidationHelper: () => ValidationHelper
});
module.exports = __toCommonJS(validation_helper_exports);
var import_help_formatter = require("./help-formatter.js");
class ValidationHelper {
  static {
    __name(this, "ValidationHelper");
  }
  /**
   * Validate enum parameter
   */
  static validateEnum(value, paramName, validOptions, commandPath) {
    if (!validOptions.includes(value)) {
      console.error(
        import_help_formatter.HelpFormatter.formatValidationError(value, paramName, validOptions, commandPath)
      );
      process.exit(1);
    }
  }
  /**
   * Validate numeric parameter
   */
  static validateNumber(value, paramName, min, max, commandPath) {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      console.error(
        import_help_formatter.HelpFormatter.formatError(
          `'${value}' is not a valid number for ${paramName}.`,
          commandPath || "claude-flow"
        )
      );
      process.exit(1);
    }
    if (min !== void 0 && num < min) {
      console.error(
        import_help_formatter.HelpFormatter.formatError(
          `${paramName} must be at least ${min}. Got: ${num}`,
          commandPath || "claude-flow"
        )
      );
      process.exit(1);
    }
    if (max !== void 0 && num > max) {
      console.error(
        import_help_formatter.HelpFormatter.formatError(
          `${paramName} must be at most ${max}. Got: ${num}`,
          commandPath || "claude-flow"
        )
      );
      process.exit(1);
    }
    return num;
  }
  /**
   * Validate required parameter
   */
  static validateRequired(value, paramName, commandPath) {
    if (!value || typeof value === "string" && value.trim() === "") {
      console.error(
        import_help_formatter.HelpFormatter.formatError(
          `Missing required parameter: ${paramName}`,
          commandPath || "claude-flow"
        )
      );
      process.exit(1);
    }
  }
  /**
   * Validate file path exists
   */
  static async validateFilePath(path, paramName, commandPath) {
    try {
      const fs = await import("fs/promises");
      await fs.access(path);
    } catch (error) {
      console.error(
        import_help_formatter.HelpFormatter.formatError(
          `File not found for ${paramName}: ${path}`,
          commandPath || "claude-flow"
        )
      );
      process.exit(1);
    }
  }
  /**
   * Validate boolean flag
   */
  static validateBoolean(value, paramName, commandPath) {
    const lowerValue = value.toLowerCase();
    if (lowerValue === "true" || lowerValue === "1" || lowerValue === "yes") {
      return true;
    }
    if (lowerValue === "false" || lowerValue === "0" || lowerValue === "no") {
      return false;
    }
    console.error(
      import_help_formatter.HelpFormatter.formatError(
        `'${value}' is not a valid boolean for ${paramName}. Use: true, false, yes, no, 1, or 0.`,
        commandPath || "claude-flow"
      )
    );
    process.exit(1);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ValidationHelper
});
//# sourceMappingURL=validation-helper.js.map
