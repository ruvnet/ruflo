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
var paths_exports = {};
__export(paths_exports, {
  getClaudeFlowBin: () => getClaudeFlowBin,
  getClaudeFlowRoot: () => getClaudeFlowRoot,
  resolveProjectPath: () => resolveProjectPath
});
module.exports = __toCommonJS(paths_exports);
const import_meta = {};
var import_path = require("path");
var import_url = require("url");
var import_fs = require("fs");
const __filename = (0, import_url.fileURLToPath)(import_meta.url);
const __dirname = (0, import_path.dirname)(__filename);
function getClaudeFlowRoot() {
  const strategies = [
    // Strategy 1: From current file location
    (0, import_path.resolve)(__dirname, "../.."),
    // Strategy 2: From process.cwd()
    process.cwd(),
    // Strategy 3: From npm global location
    (0, import_path.resolve)(process.execPath, "../../lib/node_modules/claude-flow"),
    // Strategy 4: From environment variable
    process.env.CLAUDE_FLOW_ROOT || ""
  ];
  for (const path of strategies) {
    if (path && (0, import_fs.existsSync)((0, import_path.join)(path, "package.json"))) {
      try {
        const pkgPath = (0, import_path.join)(path, "package.json");
        const pkgContent = (0, import_fs.readFileSync)(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);
        if (pkg.name === "claude-flow") {
          return path;
        }
      } catch {
      }
    }
  }
  return process.cwd();
}
__name(getClaudeFlowRoot, "getClaudeFlowRoot");
function getClaudeFlowBin() {
  return (0, import_path.join)(getClaudeFlowRoot(), "bin", "claude-flow");
}
__name(getClaudeFlowBin, "getClaudeFlowBin");
function resolveProjectPath(relativePath) {
  const root = getClaudeFlowRoot();
  return (0, import_path.resolve)(root, relativePath);
}
__name(resolveProjectPath, "resolveProjectPath");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getClaudeFlowBin,
  getClaudeFlowRoot,
  resolveProjectPath
});
//# sourceMappingURL=paths.js.map
