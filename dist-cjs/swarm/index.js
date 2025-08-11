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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var swarm_exports = {};
__export(swarm_exports, {
  getSwarmComponents: () => getSwarmComponents
});
module.exports = __toCommonJS(swarm_exports);
__reExport(swarm_exports, require("./coordinator.js"), module.exports);
__reExport(swarm_exports, require("./executor.js"), module.exports);
__reExport(swarm_exports, require("./types.js"), module.exports);
__reExport(swarm_exports, require("./strategies/base.js"), module.exports);
__reExport(swarm_exports, require("./strategies/auto.js"), module.exports);
__reExport(swarm_exports, require("./strategies/research.js"), module.exports);
__reExport(swarm_exports, require("./memory.js"), module.exports);
__reExport(swarm_exports, require("./prompt-copier.js"), module.exports);
__reExport(swarm_exports, require("./prompt-copier-enhanced.js"), module.exports);
__reExport(swarm_exports, require("./prompt-utils.js"), module.exports);
__reExport(swarm_exports, require("./prompt-manager.js"), module.exports);
__reExport(swarm_exports, require("./prompt-cli.js"), module.exports);
__reExport(swarm_exports, require("./optimizations/index.js"), module.exports);
function getSwarmComponents() {
  return {
    // Core components
    coordinator: () => import("./coordinator.js"),
    executor: () => import("./executor.js"),
    types: () => import("./types.js"),
    // Strategies
    strategies: {
      base: () => import("./strategies/base.js"),
      auto: () => import("./strategies/auto.js"),
      research: () => import("./strategies/research.js")
    },
    // Memory
    memory: () => import("./memory.js"),
    // Prompt system
    promptCopier: () => import("./prompt-copier.js"),
    promptCopierEnhanced: () => import("./prompt-copier-enhanced.js"),
    promptUtils: () => import("./prompt-utils.js"),
    promptManager: () => import("./prompt-manager.js"),
    promptCli: () => import("./prompt-cli.js"),
    // Optimizations
    optimizations: () => import("./optimizations/index.js")
  };
}
__name(getSwarmComponents, "getSwarmComponents");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getSwarmComponents,
  ...require("./coordinator.js"),
  ...require("./executor.js"),
  ...require("./types.js"),
  ...require("./strategies/base.js"),
  ...require("./strategies/auto.js"),
  ...require("./strategies/research.js"),
  ...require("./memory.js"),
  ...require("./prompt-copier.js"),
  ...require("./prompt-copier-enhanced.js"),
  ...require("./prompt-utils.js"),
  ...require("./prompt-manager.js"),
  ...require("./prompt-cli.js"),
  ...require("./optimizations/index.js")
});
//# sourceMappingURL=index.js.map
