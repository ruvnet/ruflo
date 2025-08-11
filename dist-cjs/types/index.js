"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var types_exports = {};
__export(types_exports, {
  ComponentStatus: () => ComponentStatus
});
module.exports = __toCommonJS(types_exports);
__reExport(types_exports, require("../swarm/types.js"), module.exports);
var ComponentStatus = /* @__PURE__ */ ((ComponentStatus2) => {
  ComponentStatus2["HEALTHY"] = "healthy";
  ComponentStatus2["WARNING"] = "warning";
  ComponentStatus2["ERROR"] = "error";
  ComponentStatus2["UNKNOWN"] = "unknown";
  return ComponentStatus2;
})(ComponentStatus || {});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ComponentStatus,
  ...require("../swarm/types.js")
});
//# sourceMappingURL=index.js.map
