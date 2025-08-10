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
var protocol_manager_exports = {};
__export(protocol_manager_exports, {
  MCPProtocolManager: () => MCPProtocolManager
});
module.exports = __toCommonJS(protocol_manager_exports);
var import_errors = require("../utils/errors.js");
class MCPProtocolManager {
  constructor(logger, preferredVersion, serverCapabilities) {
    this.logger = logger;
    for (const versionInfo of this.knownVersions) {
      const key = this.versionToString(versionInfo.version);
      this.supportedVersions.set(key, versionInfo);
    }
    this.currentVersion = preferredVersion || this.getLatestSupportedVersion();
    this.serverCapabilities = serverCapabilities || this.getDefaultCapabilities();
    this.logger.info("Protocol manager initialized", {
      currentVersion: this.versionToString(this.currentVersion),
      supportedVersions: this.getSupportedVersionStrings()
    });
  }
  static {
    __name(this, "MCPProtocolManager");
  }
  supportedVersions = /* @__PURE__ */ new Map();
  currentVersion;
  serverCapabilities;
  knownVersions = [
    {
      version: { major: 2024, minor: 11, patch: 5 },
      name: "MCP 2024.11.5",
      releaseDate: /* @__PURE__ */ new Date("2024-11-01"),
      supportedFeatures: [
        "tools",
        "prompts",
        "resources",
        "logging",
        "sampling",
        "notifications",
        "tool_list_changed",
        "resource_list_changed",
        "prompt_list_changed"
      ]
    },
    {
      version: { major: 2024, minor: 11, patch: 4 },
      name: "MCP 2024.11.4",
      releaseDate: /* @__PURE__ */ new Date("2024-10-15"),
      supportedFeatures: [
        "tools",
        "prompts",
        "resources",
        "logging",
        "notifications",
        "tool_list_changed",
        "resource_list_changed"
      ]
    },
    {
      version: { major: 2024, minor: 11, patch: 3 },
      name: "MCP 2024.11.3",
      releaseDate: /* @__PURE__ */ new Date("2024-10-01"),
      supportedFeatures: ["tools", "prompts", "resources", "logging", "notifications"]
    },
    {
      version: { major: 2024, minor: 10, patch: 0 },
      name: "MCP 2024.10.0",
      releaseDate: /* @__PURE__ */ new Date("2024-09-01"),
      deprecated: true,
      deprecationDate: /* @__PURE__ */ new Date("2024-11-01"),
      supportedFeatures: ["tools", "prompts", "resources", "logging"],
      breakingChanges: ["Changed tool response format", "Modified error codes"],
      migrationGuide: "https://docs.mcp.io/migration/2024.10-to-2024.11"
    }
  ];
  /**
   * Negotiate protocol version and capabilities with client
   */
  async negotiateProtocol(clientParams) {
    this.logger.debug("Starting protocol negotiation", {
      clientVersion: this.versionToString(clientParams.protocolVersion),
      clientCapabilities: clientParams.capabilities,
      clientInfo: clientParams.clientInfo
    });
    const result = {
      agreedVersion: this.currentVersion,
      agreedCapabilities: { ...this.serverCapabilities },
      clientCapabilities: clientParams.capabilities,
      serverCapabilities: this.serverCapabilities,
      warnings: [],
      limitations: []
    };
    try {
      const compatibility = this.checkCompatibility(clientParams.protocolVersion);
      if (!compatibility.compatible) {
        throw new import_errors.MCPError(
          `Protocol version ${this.versionToString(clientParams.protocolVersion)} is not compatible. ${compatibility.errors.join(", ")}`
        );
      }
      if (this.isVersionSupported(clientParams.protocolVersion)) {
        const clientVersionInfo = this.getVersionInfo(clientParams.protocolVersion);
        const currentVersionInfo = this.getVersionInfo(this.currentVersion);
        if (clientVersionInfo && currentVersionInfo) {
          if (this.compareVersions(clientParams.protocolVersion, this.currentVersion) <= 0) {
            result.agreedVersion = clientParams.protocolVersion;
          }
        }
      }
      result.agreedCapabilities = this.negotiateCapabilities(
        clientParams.capabilities,
        this.serverCapabilities,
        result.agreedVersion
      );
      result.warnings.push(...compatibility.warnings);
      const versionInfo = this.getVersionInfo(result.agreedVersion);
      if (versionInfo?.deprecated) {
        result.warnings.push(
          `Protocol version ${this.versionToString(result.agreedVersion)} is deprecated. Please upgrade to a newer version.`
        );
      }
      const missingFeatures = this.getMissingFeatures(
        result.agreedVersion,
        result.agreedCapabilities
      );
      if (missingFeatures.length > 0) {
        result.limitations.push(
          `Some features may not be available: ${missingFeatures.join(", ")}`
        );
      }
      this.logger.info("Protocol negotiation completed", {
        agreedVersion: this.versionToString(result.agreedVersion),
        warnings: result.warnings.length,
        limitations: result.limitations.length
      });
      return result;
    } catch (error) {
      this.logger.error("Protocol negotiation failed", {
        clientVersion: this.versionToString(clientParams.protocolVersion),
        error
      });
      throw error;
    }
  }
  /**
   * Check compatibility between client and server versions
   */
  checkCompatibility(clientVersion) {
    const result = {
      compatible: false,
      warnings: [],
      errors: []
    };
    const clientVersionInfo = this.getVersionInfo(clientVersion);
    const serverVersionInfo = this.getVersionInfo(this.currentVersion);
    if (!clientVersionInfo) {
      result.errors.push(`Unknown protocol version: ${this.versionToString(clientVersion)}`);
      result.recommendedVersion = this.getLatestSupportedVersion();
      return result;
    }
    if (clientVersion.major !== this.currentVersion.major) {
      result.errors.push(
        `Major version mismatch: client ${clientVersion.major}, server ${this.currentVersion.major}`
      );
      return result;
    }
    if (this.compareVersions(clientVersion, this.currentVersion) > 0) {
      result.errors.push(
        `Client version ${this.versionToString(clientVersion)} is newer than supported server version ${this.versionToString(this.currentVersion)}`
      );
      result.recommendedVersion = this.currentVersion;
      return result;
    }
    if (clientVersionInfo.deprecated) {
      result.warnings.push(
        `Client is using deprecated version ${this.versionToString(clientVersion)}. Support will be removed after ${clientVersionInfo.deprecationDate?.toISOString().split("T")[0]}`
      );
      result.recommendedVersion = this.getLatestSupportedVersion();
    }
    const serverFeatures = serverVersionInfo?.supportedFeatures || [];
    const clientFeatures = clientVersionInfo.supportedFeatures;
    const missingFeatures = serverFeatures.filter((feature) => !clientFeatures.includes(feature));
    if (missingFeatures.length > 0) {
      result.missingFeatures = missingFeatures;
      result.warnings.push(
        `Client version lacks some server features: ${missingFeatures.join(", ")}`
      );
    }
    const deprecatedFeatures = this.getDeprecatedFeatures(clientVersion);
    if (deprecatedFeatures.length > 0) {
      result.deprecatedFeatures = deprecatedFeatures;
      result.warnings.push(
        `Client version uses deprecated features: ${deprecatedFeatures.join(", ")}`
      );
    }
    result.compatible = true;
    return result;
  }
  /**
   * Get information about a specific protocol version
   */
  getVersionInfo(version) {
    return this.supportedVersions.get(this.versionToString(version));
  }
  /**
   * Check if a version is supported
   */
  isVersionSupported(version) {
    return this.supportedVersions.has(this.versionToString(version));
  }
  /**
   * Get the latest supported version
   */
  getLatestSupportedVersion() {
    const versions = Array.from(this.supportedVersions.values()).filter((v) => !v.deprecated).sort((a, b) => this.compareVersions(b.version, a.version));
    return versions[0]?.version || { major: 2024, minor: 11, patch: 5 };
  }
  /**
   * Get all supported version strings
   */
  getSupportedVersionStrings() {
    return Array.from(this.supportedVersions.keys());
  }
  /**
   * Get current server capabilities
   */
  getServerCapabilities() {
    return { ...this.serverCapabilities };
  }
  /**
   * Update server capabilities
   */
  updateServerCapabilities(capabilities) {
    this.serverCapabilities = { ...this.serverCapabilities, ...capabilities };
    this.logger.info("Server capabilities updated", { capabilities: this.serverCapabilities });
  }
  /**
   * Check if a feature is supported in a specific version
   */
  isFeatureSupported(version, feature) {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.supportedFeatures.includes(feature) || false;
  }
  versionToString(version) {
    return `${version.major}.${version.minor}.${version.patch}`;
  }
  compareVersions(a, b) {
    if (a.major !== b.major)
      return a.major - b.major;
    if (a.minor !== b.minor)
      return a.minor - b.minor;
    return a.patch - b.patch;
  }
  getDefaultCapabilities() {
    return {
      logging: {
        level: "info"
      },
      tools: {
        listChanged: true
      },
      resources: {
        listChanged: true,
        subscribe: false
      },
      prompts: {
        listChanged: true
      }
    };
  }
  negotiateCapabilities(clientCapabilities, serverCapabilities, agreedVersion) {
    const result = {};
    if (clientCapabilities.logging && serverCapabilities.logging) {
      result.logging = {
        level: this.negotiateLogLevel(
          clientCapabilities.logging.level,
          serverCapabilities.logging.level
        )
      };
    }
    if (clientCapabilities.tools && serverCapabilities.tools) {
      result.tools = {
        listChanged: clientCapabilities.tools.listChanged && serverCapabilities.tools.listChanged
      };
    }
    if (clientCapabilities.resources && serverCapabilities.resources) {
      result.resources = {
        listChanged: clientCapabilities.resources.listChanged && serverCapabilities.resources.listChanged,
        subscribe: clientCapabilities.resources.subscribe && serverCapabilities.resources.subscribe
      };
    }
    if (clientCapabilities.prompts && serverCapabilities.prompts) {
      result.prompts = {
        listChanged: clientCapabilities.prompts.listChanged && serverCapabilities.prompts.listChanged
      };
    }
    return this.filterCapabilitiesByVersion(result, agreedVersion);
  }
  negotiateLogLevel(clientLevel, serverLevel) {
    const levels = ["debug", "info", "warn", "error"];
    const clientIndex = clientLevel ? levels.indexOf(clientLevel) : 1;
    const serverIndex = serverLevel ? levels.indexOf(serverLevel) : 1;
    const chosenIndex = Math.max(clientIndex, serverIndex);
    return levels[chosenIndex];
  }
  filterCapabilitiesByVersion(capabilities, version) {
    const versionInfo = this.getVersionInfo(version);
    if (!versionInfo)
      return capabilities;
    const result = {};
    if (versionInfo.supportedFeatures.includes("logging") && capabilities.logging) {
      result.logging = capabilities.logging;
    }
    if (versionInfo.supportedFeatures.includes("tools") && capabilities.tools) {
      result.tools = capabilities.tools;
    }
    if (versionInfo.supportedFeatures.includes("resources") && capabilities.resources) {
      result.resources = capabilities.resources;
    }
    if (versionInfo.supportedFeatures.includes("prompts") && capabilities.prompts) {
      result.prompts = capabilities.prompts;
    }
    return result;
  }
  getMissingFeatures(version, capabilities) {
    const versionInfo = this.getVersionInfo(version);
    if (!versionInfo)
      return [];
    const missing = [];
    const availableFeatures = versionInfo.supportedFeatures;
    const latestVersion = this.getLatestSupportedVersion();
    const latestVersionInfo = this.getVersionInfo(latestVersion);
    if (latestVersionInfo) {
      for (const feature of latestVersionInfo.supportedFeatures) {
        if (!availableFeatures.includes(feature)) {
          missing.push(feature);
        }
      }
    }
    return missing;
  }
  getDeprecatedFeatures(version) {
    const versionInfo = this.getVersionInfo(version);
    return versionInfo?.breakingChanges || [];
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MCPProtocolManager
});
//# sourceMappingURL=protocol-manager.js.map
