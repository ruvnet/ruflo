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
var cliffy_node_exports = {};
__export(cliffy_node_exports, {
  Confirm: () => Confirm,
  Input: () => Input,
  Select: () => Select,
  Table: () => import_cli_table3.default,
  colors: () => colors
});
module.exports = __toCommonJS(cliffy_node_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_inquirer = __toESM(require("inquirer"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
const colors = {
  green: import_chalk.default.green,
  red: import_chalk.default.red,
  yellow: import_chalk.default.yellow,
  blue: import_chalk.default.blue,
  gray: import_chalk.default.gray,
  cyan: import_chalk.default.cyan,
  magenta: import_chalk.default.magenta,
  white: import_chalk.default.white,
  black: import_chalk.default.black,
  bold: import_chalk.default.bold,
  dim: import_chalk.default.dim,
  italic: import_chalk.default.italic,
  underline: import_chalk.default.underline,
  bgRed: import_chalk.default.bgRed,
  bgGreen: import_chalk.default.bgGreen,
  bgYellow: import_chalk.default.bgYellow,
  bgBlue: import_chalk.default.bgBlue
};
const Input = /* @__PURE__ */ __name(async (options) => {
  const answers = await import_inquirer.default.prompt([
    {
      type: "input",
      name: "value",
      message: options.message,
      default: options.default
    }
  ]);
  return answers.value;
}, "Input");
const Confirm = /* @__PURE__ */ __name(async (options) => {
  const answers = await import_inquirer.default.prompt([
    {
      type: "confirm",
      name: "value",
      message: options.message,
      default: options.default
    }
  ]);
  return answers.value;
}, "Confirm");
const Select = /* @__PURE__ */ __name(async (options) => {
  const answers = await import_inquirer.default.prompt([
    {
      type: "list",
      name: "value",
      message: options.message,
      choices: options.options.map((opt) => ({ name: opt.name, value: opt.value })),
      default: options.default
    }
  ]);
  return answers.value;
}, "Select");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Confirm,
  Input,
  Select,
  Table,
  colors
});
//# sourceMappingURL=cliffy-node.js.map
