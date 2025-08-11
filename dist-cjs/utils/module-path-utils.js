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
var module_path_utils_exports = {};
__export(module_path_utils_exports, {
  getCurrentDirPath: () => getCurrentDirPath,
  getCurrentFilePath: () => getCurrentFilePath,
  isMainModule: () => isMainModule
});
module.exports = __toCommonJS(module_path_utils_exports);
const import_meta = {};
var import_url = require("url");
var import_path = require("path");
function getCurrentFilePath() {
  try {
    if (typeof import_meta !== "undefined" && import_meta.url) {
      return (0, import_url.fileURLToPath)(import_meta.url);
    }
  } catch (error) {
  }
  return __filename || process.argv[1] || "";
}
__name(getCurrentFilePath, "getCurrentFilePath");
function getCurrentDirPath() {
  try {
    if (typeof import_meta !== "undefined" && import_meta.url) {
      return (0, import_path.dirname)((0, import_url.fileURLToPath)(import_meta.url));
    }
  } catch (error) {
  }
  return __dirname || (0, import_path.dirname)(process.argv[1] || "");
}
__name(getCurrentDirPath, "getCurrentDirPath");
function isMainModule() {
  try {
    if (typeof import_meta !== "undefined" && import_meta.url) {
      return import_meta.url === `file://${process.argv[1]}`;
    }
  } catch (error) {
  }
  return require.main === module;
}
__name(isMainModule, "isMainModule");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getCurrentDirPath,
  getCurrentFilePath,
  isMainModule
});
//# sourceMappingURL=module-path-utils.js.map
