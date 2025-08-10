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
var progress_reporter_exports = {};
__export(progress_reporter_exports, {
  ProgressReporter: () => ProgressReporter
});
module.exports = __toCommonJS(progress_reporter_exports);
var chalk = __toESM(require("chalk"));
class ProgressReporter {
  static {
    __name(this, "ProgressReporter");
  }
  progress;
  startTime;
  spinner = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  spinnerIndex = 0;
  intervalId = null;
  constructor() {
    this.progress = {
      total: 0,
      completed: 0,
      current: "",
      phase: "analyzing",
      errors: 0,
      warnings: 0
    };
    this.startTime = /* @__PURE__ */ new Date();
  }
  start(phase, message) {
    this.progress.phase = phase;
    this.progress.current = message;
    this.startTime = /* @__PURE__ */ new Date();
    console.log(chalk.bold(`
\u{1F680} Starting ${phase}...`));
    this.startSpinner();
  }
  update(phase, message, completed, total) {
    this.progress.phase = phase;
    this.progress.current = message;
    if (completed !== void 0) {
      this.progress.completed = completed;
    }
    if (total !== void 0) {
      this.progress.total = total;
    }
    this.updateDisplay();
  }
  complete(message) {
    this.stopSpinner();
    const duration = (/* @__PURE__ */ new Date()).getTime() - this.startTime.getTime();
    const seconds = (duration / 1e3).toFixed(2);
    console.log(chalk.green(`
\u2705 ${message}`));
    console.log(chalk.gray(`   Completed in ${seconds}s`));
    if (this.progress.warnings > 0) {
      console.log(chalk.yellow(`   ${this.progress.warnings} warnings`));
    }
    if (this.progress.errors > 0) {
      console.log(chalk.red(`   ${this.progress.errors} errors`));
    }
  }
  error(message) {
    this.stopSpinner();
    console.log(chalk.red(`
\u274C ${message}`));
    this.progress.errors++;
  }
  warning(message) {
    console.log(chalk.yellow(`\u26A0\uFE0F  ${message}`));
    this.progress.warnings++;
  }
  info(message) {
    console.log(chalk.blue(`\u2139\uFE0F  ${message}`));
  }
  startSpinner() {
    this.intervalId = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinner.length;
      this.updateDisplay();
    }, 100);
  }
  stopSpinner() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    process.stdout.write("\r\x1B[K");
  }
  updateDisplay() {
    const spinner = this.spinner[this.spinnerIndex];
    const phase = this.getPhaseDisplay();
    const progress = this.getProgressDisplay();
    const message = `${spinner} ${phase} ${progress} ${this.progress.current}`;
    process.stdout.write("\r\x1B[K" + message);
  }
  getPhaseDisplay() {
    const phases = {
      analyzing: chalk.blue("\u{1F4CA} Analyzing"),
      "backing-up": chalk.yellow("\u{1F4BE} Backing up"),
      migrating: chalk.green("\u{1F504} Migrating"),
      validating: chalk.cyan("\u2705 Validating"),
      complete: chalk.green("\u2705 Complete")
    };
    return phases[this.progress.phase] || chalk.gray("\u23F3 Processing");
  }
  getProgressDisplay() {
    if (this.progress.total > 0) {
      const percentage = Math.round(this.progress.completed / this.progress.total * 100);
      const progressBar = this.createProgressBar(percentage);
      return `${progressBar} ${this.progress.completed}/${this.progress.total} (${percentage}%)`;
    }
    return "";
  }
  createProgressBar(percentage, width = 20) {
    const filled = Math.round(percentage / 100 * width);
    const empty = width - filled;
    const filledBar = "\u2588".repeat(filled);
    const emptyBar = "\u2591".repeat(empty);
    return chalk.green(filledBar) + chalk.gray(emptyBar);
  }
  setTotal(total) {
    this.progress.total = total;
  }
  increment(message) {
    this.progress.completed++;
    if (message) {
      this.progress.current = message;
    }
    this.updateDisplay();
  }
  getProgress() {
    return { ...this.progress };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProgressReporter
});
//# sourceMappingURL=progress-reporter.js.map
