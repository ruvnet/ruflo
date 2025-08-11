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
var providers_exports = {};
__export(providers_exports, {
  AnthropicProvider: () => import_anthropic_provider.AnthropicProvider,
  BaseProvider: () => import_base_provider.BaseProvider,
  CohereProvider: () => import_cohere_provider.CohereProvider,
  GoogleProvider: () => import_google_provider.GoogleProvider,
  OllamaProvider: () => import_ollama_provider.OllamaProvider,
  OpenAIProvider: () => import_openai_provider.OpenAIProvider,
  ProviderManager: () => import_provider_manager.ProviderManager,
  ProviderManagerConfig: () => import_provider_manager.ProviderManagerConfig,
  createProviderManager: () => import_utils.createProviderManager,
  getDefaultProviderConfig: () => import_utils.getDefaultProviderConfig
});
module.exports = __toCommonJS(providers_exports);
__reExport(providers_exports, require("./types.js"), module.exports);
var import_base_provider = require("./base-provider.js");
var import_anthropic_provider = require("./anthropic-provider.js");
var import_openai_provider = require("./openai-provider.js");
var import_google_provider = require("./google-provider.js");
var import_cohere_provider = require("./cohere-provider.js");
var import_ollama_provider = require("./ollama-provider.js");
var import_provider_manager = require("./provider-manager.js");
var import_utils = require("./utils.js");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AnthropicProvider,
  BaseProvider,
  CohereProvider,
  GoogleProvider,
  OllamaProvider,
  OpenAIProvider,
  ProviderManager,
  ProviderManagerConfig,
  createProviderManager,
  getDefaultProviderConfig,
  ...require("./types.js")
});
//# sourceMappingURL=index.js.map
