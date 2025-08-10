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
var version_exports = {};
__export(version_exports, {
  BUILD_DATE: () => BUILD_DATE,
  VERSION: () => VERSION,
  displayVersion: () => displayVersion,
  getVersionString: () => getVersionString
});
module.exports = __toCommonJS(version_exports);
const import_meta = {};
var import_fs = require("fs");
var import_path = require("path");
var import_url = require("url");
const __filename = (0, import_url.fileURLToPath)(import_meta.url);
const __dirname = (0, import_path.dirname)(__filename);
let VERSION;
let BUILD_DATE;
try {
  const packageJsonPath = (0, import_path.join)(__dirname, "../../package.json");
  const packageJson = JSON.parse((0, import_fs.readFileSync)(packageJsonPath, "utf-8"));
  VERSION = packageJson.version;
  BUILD_DATE = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
} catch (error) {
  console.warn("Warning: Could not read version from package.json, using fallback");
  VERSION = "2.0.0-alpha.87";
  BUILD_DATE = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
}
function getVersionString(includeV = true) {
  return includeV ? `v${VERSION}` : VERSION;
}
__name(getVersionString, "getVersionString");
function displayVersion() {
  console.log(getVersionString());
}
__name(displayVersion, "displayVersion");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUILD_DATE,
  VERSION,
  displayVersion,
  getVersionString
});
//# sourceMappingURL=version.js.map
