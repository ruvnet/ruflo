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
var resources_exports = {};
__export(resources_exports, {
  ResourceManager: () => ResourceManager
});
module.exports = __toCommonJS(resources_exports);
var import_types = require("../utils/types.js");
var import_errors = require("../utils/errors.js");
var import_helpers = require("../utils/helpers.js");
class ResourceManager {
  // agentId -> resourceIds
  constructor(config, eventBus, logger) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
  }
  static {
    __name(this, "ResourceManager");
  }
  resources = /* @__PURE__ */ new Map();
  locks = /* @__PURE__ */ new Map();
  // resourceId -> agentId
  waitQueue = /* @__PURE__ */ new Map();
  // resourceId -> queue
  agentResources = /* @__PURE__ */ new Map();
  async initialize() {
    this.logger.info("Initializing resource manager");
    setInterval(() => this.cleanup(), 3e4);
  }
  async shutdown() {
    this.logger.info("Shutting down resource manager");
    for (const [resourceId, agentId] of this.locks) {
      await this.release(resourceId, agentId);
    }
    this.resources.clear();
    this.locks.clear();
    this.waitQueue.clear();
    this.agentResources.clear();
  }
  async acquire(resourceId, agentId, priority = 0) {
    this.logger.debug("Resource acquisition requested", { resourceId, agentId });
    if (!this.resources.has(resourceId)) {
      this.resources.set(resourceId, {
        id: resourceId,
        type: "generic",
        locked: false
      });
    }
    const resource = this.resources.get(resourceId);
    if (this.locks.get(resourceId) === agentId) {
      this.logger.debug("Resource already locked by agent", { resourceId, agentId });
      return;
    }
    if (!resource.locked) {
      await this.lockResource(resourceId, agentId);
      return;
    }
    const request = {
      agentId,
      resourceId,
      timestamp: /* @__PURE__ */ new Date(),
      priority
    };
    if (!this.waitQueue.has(resourceId)) {
      this.waitQueue.set(resourceId, []);
    }
    const queue = this.waitQueue.get(resourceId);
    queue.push(request);
    queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
    this.logger.info("Agent added to resource wait queue", {
      resourceId,
      agentId,
      queueLength: queue.length
    });
    const startTime = Date.now();
    while (Date.now() - startTime < this.config.resourceTimeout) {
      const nextRequest = queue[0];
      if (nextRequest?.agentId === agentId && !resource.locked) {
        queue.shift();
        await this.lockResource(resourceId, agentId);
        return;
      }
      const ourRequest = queue.find((req) => req.agentId === agentId);
      if (!ourRequest) {
        throw new import_errors.ResourceLockError("Resource request cancelled");
      }
      await (0, import_helpers.delay)(100);
    }
    const index = queue.findIndex((req) => req.agentId === agentId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
    throw new import_errors.ResourceLockError(`Resource acquisition timeout for ${resourceId}`, {
      resourceId,
      agentId,
      timeout: this.config.resourceTimeout
    });
  }
  async release(resourceId, agentId) {
    this.logger.debug("Resource release requested", { resourceId, agentId });
    const currentLock = this.locks.get(resourceId);
    if (currentLock !== agentId) {
      this.logger.warn("Attempted to release unowned resource", {
        resourceId,
        agentId,
        currentLock
      });
      return;
    }
    this.unlockResource(resourceId, agentId);
    const queue = this.waitQueue.get(resourceId);
    if (queue && queue.length > 0) {
      const nextRequest = queue.shift();
      await this.lockResource(resourceId, nextRequest.agentId);
    }
  }
  async releaseAllForAgent(agentId) {
    const resources = this.agentResources.get(agentId);
    if (!resources) {
      return;
    }
    this.logger.info("Releasing all resources for agent", {
      agentId,
      resourceCount: resources.size
    });
    const promises = Array.from(resources).map((resourceId) => this.release(resourceId, agentId));
    await Promise.all(promises);
    this.agentResources.delete(agentId);
  }
  getAllocations() {
    return new Map(this.locks);
  }
  getWaitingRequests() {
    const waiting = /* @__PURE__ */ new Map();
    for (const [resourceId, queue] of this.waitQueue) {
      if (queue.length > 0) {
        waiting.set(queue[0].agentId, [...waiting.get(queue[0].agentId) || [], resourceId]);
      }
    }
    return waiting;
  }
  async getHealthStatus() {
    const totalResources = this.resources.size;
    const lockedResources = this.locks.size;
    const waitingAgents = /* @__PURE__ */ new Set();
    let totalWaiting = 0;
    for (const queue of this.waitQueue.values()) {
      totalWaiting += queue.length;
      queue.forEach((req) => waitingAgents.add(req.agentId));
    }
    return {
      healthy: true,
      metrics: {
        totalResources,
        lockedResources,
        freeResources: totalResources - lockedResources,
        waitingAgents: waitingAgents.size,
        totalWaitingRequests: totalWaiting
      }
    };
  }
  async lockResource(resourceId, agentId) {
    const resource = this.resources.get(resourceId);
    resource.locked = true;
    resource.lockedBy = agentId;
    resource.lockedAt = /* @__PURE__ */ new Date();
    this.locks.set(resourceId, agentId);
    if (!this.agentResources.has(agentId)) {
      this.agentResources.set(agentId, /* @__PURE__ */ new Set());
    }
    this.agentResources.get(agentId).add(resourceId);
    this.logger.info("Resource locked", { resourceId, agentId });
    this.eventBus.emit(import_types.SystemEvents.RESOURCE_ACQUIRED, { resourceId, agentId });
  }
  unlockResource(resourceId, agentId) {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return;
    }
    resource.locked = false;
    delete resource.lockedBy;
    delete resource.lockedAt;
    this.locks.delete(resourceId);
    this.agentResources.get(agentId)?.delete(resourceId);
    this.logger.info("Resource unlocked", { resourceId, agentId });
    this.eventBus.emit(import_types.SystemEvents.RESOURCE_RELEASED, { resourceId, agentId });
  }
  async performMaintenance() {
    this.logger.debug("Performing resource manager maintenance");
    this.cleanup();
  }
  cleanup() {
    const now = Date.now();
    for (const [resourceId, queue] of this.waitQueue) {
      const filtered = queue.filter((req) => {
        const age = now - req.timestamp.getTime();
        if (age > this.config.resourceTimeout) {
          this.logger.warn("Removing stale resource request", {
            resourceId,
            agentId: req.agentId,
            age
          });
          return false;
        }
        return true;
      });
      if (filtered.length === 0) {
        this.waitQueue.delete(resourceId);
      } else {
        this.waitQueue.set(resourceId, filtered);
      }
    }
    for (const [resourceId, agentId] of this.locks) {
      const resource = this.resources.get(resourceId);
      if (resource?.lockedAt) {
        const lockAge = now - resource.lockedAt.getTime();
        if (lockAge > this.config.resourceTimeout * 2) {
          this.logger.warn("Force releasing stale lock", {
            resourceId,
            agentId,
            lockAge
          });
          this.unlockResource(resourceId, agentId);
        }
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ResourceManager
});
//# sourceMappingURL=resources.js.map
