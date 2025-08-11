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
var ui_exports = {};
__export(ui_exports, {
  CompatibleUI: () => import_compatible_ui.CompatibleUI,
  checkUISupport: () => import_fallback_handler.checkUISupport,
  createCompatibleUI: () => import_compatible_ui.createCompatibleUI,
  handleRawModeError: () => import_fallback_handler.handleRawModeError,
  isRawModeSupported: () => import_compatible_ui.isRawModeSupported,
  launchBestUI: () => launchBestUI,
  launchUI: () => import_compatible_ui.launchUI,
  showUISupport: () => import_fallback_handler.showUISupport,
  withRawModeFallback: () => import_fallback_handler.withRawModeFallback
});
module.exports = __toCommonJS(ui_exports);
var import_compatible_ui = require("./compatible-ui.js");
var import_fallback_handler = require("./fallback-handler.js");
async function launchBestUI() {
  const fallbackHandler = await import("./fallback-handler.js");
  const { checkUISupport: checkUISupport2, handleRawModeError: handleRawModeError2 } = fallbackHandler;
  const launchUI2 = fallbackHandler.launchUI;
  const support = checkUISupport2();
  if (support.supported) {
    try {
      await launchUI2();
    } catch (error) {
      if (error instanceof Error) {
        await handleRawModeError2(error, {
          enableUI: true,
          fallbackMessage: "Falling back to compatible UI mode",
          showHelp: true
        });
      }
    }
  } else {
    const { launchUI: launchCompatibleUI } = await import("./compatible-ui.js");
    console.log("\u{1F504} Using compatible UI mode for this environment");
    await launchCompatibleUI();
  }
}
__name(launchBestUI, "launchBestUI");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CompatibleUI,
  checkUISupport,
  createCompatibleUI,
  handleRawModeError,
  isRawModeSupported,
  launchBestUI,
  launchUI,
  showUISupport,
  withRawModeFallback
});
//# sourceMappingURL=index.js.map
