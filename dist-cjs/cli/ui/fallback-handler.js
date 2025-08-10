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
var fallback_handler_exports = {};
__export(fallback_handler_exports, {
  checkUISupport: () => checkUISupport,
  handleRawModeError: () => handleRawModeError,
  showUISupport: () => showUISupport,
  withRawModeFallback: () => withRawModeFallback
});
module.exports = __toCommonJS(fallback_handler_exports);
var import_type_guards = require("../../utils/type-guards.js");
var import_chalk = __toESM(require("chalk"), 1);
var import_compatible_ui = require("./compatible-ui.js");
async function handleRawModeError(error, options = {}) {
  const isRawModeError = (error instanceof Error ? error.message : String(error)).includes(
    "Raw mode is not supported"
  ) || (error instanceof Error ? error.message : String(error)).includes("stdin") || (error instanceof Error ? error.message : String(error)).includes("Ink");
  if (!isRawModeError) {
    throw error;
  }
  console.clear();
  console.log(import_chalk.default.yellow.bold("\u26A0\uFE0F  Interactive Mode Not Supported"));
  console.log(import_chalk.default.gray("\u2500".repeat(50)));
  console.log(import_chalk.default.white("The current terminal environment does not support"));
  console.log(import_chalk.default.white("interactive UI features (raw mode)."));
  console.log();
  console.log(import_chalk.default.cyan("Common causes:"));
  console.log(import_chalk.default.gray("\u2022 VS Code integrated terminal"));
  console.log(import_chalk.default.gray("\u2022 WSL (Windows Subsystem for Linux)"));
  console.log(import_chalk.default.gray("\u2022 Native Windows terminals"));
  console.log(import_chalk.default.gray("\u2022 CI/CD environments"));
  console.log(import_chalk.default.gray("\u2022 Docker containers"));
  console.log(import_chalk.default.gray("\u2022 SSH sessions without TTY"));
  console.log();
  if (options.fallbackMessage) {
    console.log(import_chalk.default.blue("\u2139\uFE0F  "), options.fallbackMessage);
    console.log();
  }
  if (options.enableUI) {
    console.log(import_chalk.default.green("\u2705 Launching compatible UI mode..."));
    console.log();
    try {
      const ui = (0, import_compatible_ui.createCompatibleUI)();
      await ui.start();
    } catch (fallbackError) {
      console.log(import_chalk.default.red("\u274C Fallback UI also failed:"), (0, import_type_guards.getErrorMessage)(fallbackError));
      await showBasicInterface(options);
    }
  } else {
    await showBasicInterface(options);
  }
}
__name(handleRawModeError, "handleRawModeError");
async function showBasicInterface(options) {
  console.log(import_chalk.default.green("\u{1F4CB} Available alternatives:"));
  console.log();
  console.log(import_chalk.default.white("1. Use CLI commands directly:"));
  console.log(import_chalk.default.gray("   ./claude-flow status"));
  console.log(import_chalk.default.gray("   ./claude-flow memory list"));
  console.log(import_chalk.default.gray("   ./claude-flow sparc modes"));
  console.log();
  console.log(import_chalk.default.white("2. Use non-interactive modes:"));
  console.log(import_chalk.default.gray("   ./claude-flow start (without --ui)"));
  console.log(import_chalk.default.gray('   ./claude-flow swarm "task" --monitor'));
  console.log();
  console.log(import_chalk.default.white("3. Use external terminal:"));
  console.log(import_chalk.default.gray("   Run in a standalone terminal application"));
  console.log();
  if (options.showHelp) {
    console.log(import_chalk.default.cyan("\u{1F4A1} For help with any command, use:"));
    console.log(import_chalk.default.gray("   ./claude-flow help <command>"));
    console.log(import_chalk.default.gray("   ./claude-flow <command> --help"));
    console.log();
  }
  console.log(import_chalk.default.gray("Press Ctrl+C to exit"));
  await new Promise(() => {
    process.on("SIGINT", () => {
      console.log(import_chalk.default.green("\n\u{1F44B} Goodbye!"));
      process.exit(0);
    });
  });
}
__name(showBasicInterface, "showBasicInterface");
function withRawModeFallback(fn, fallbackOptions = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Error) {
        await handleRawModeError(error, fallbackOptions);
      } else {
        throw error;
      }
    }
  };
}
__name(withRawModeFallback, "withRawModeFallback");
function checkUISupport() {
  if (!process.stdin.isTTY) {
    return {
      supported: false,
      reason: "Not running in a TTY environment",
      recommendation: "Use a proper terminal application"
    };
  }
  if (typeof process.stdin.setRawMode !== "function") {
    return {
      supported: false,
      reason: "Raw mode not available",
      recommendation: "Use --no-ui flag or run in external terminal"
    };
  }
  if (process.env.TERM_PROGRAM === "vscode") {
    return {
      supported: false,
      reason: "Running in VS Code integrated terminal",
      recommendation: "Use VS Code external terminal or standalone terminal"
    };
  }
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    return {
      supported: false,
      reason: "Running in CI/CD environment",
      recommendation: "Use non-interactive mode"
    };
  }
  return { supported: true };
}
__name(checkUISupport, "checkUISupport");
function showUISupport() {
  const support = checkUISupport();
  console.log(import_chalk.default.cyan.bold("\u{1F5A5}\uFE0F  UI Support Information"));
  console.log(import_chalk.default.gray("\u2500".repeat(40)));
  if (support.supported) {
    console.log(import_chalk.default.green("\u2705 Interactive UI supported"));
    console.log(import_chalk.default.gray("Your terminal supports all UI features"));
  } else {
    console.log(import_chalk.default.yellow("\u26A0\uFE0F  Limited UI support"));
    console.log(import_chalk.default.gray(`Reason: ${support.reason}`));
    if (support.recommendation) {
      console.log(import_chalk.default.blue(`Recommendation: ${support.recommendation}`));
    }
  }
  console.log();
  console.log(import_chalk.default.white("Environment details:"));
  console.log(import_chalk.default.gray(`\u2022 Terminal: ${process.env.TERM || "unknown"}`));
  console.log(import_chalk.default.gray(`\u2022 TTY: ${process.stdin.isTTY ? "yes" : "no"}`));
  console.log(import_chalk.default.gray(`\u2022 Program: ${process.env.TERM_PROGRAM || "unknown"}`));
  console.log(import_chalk.default.gray(`\u2022 Platform: ${process.platform}`));
}
__name(showUISupport, "showUISupport");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkUISupport,
  handleRawModeError,
  showUISupport,
  withRawModeFallback
});
//# sourceMappingURL=fallback-handler.js.map
