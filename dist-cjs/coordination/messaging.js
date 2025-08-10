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
var messaging_exports = {};
__export(messaging_exports, {
  MessageRouter: () => MessageRouter
});
module.exports = __toCommonJS(messaging_exports);
var import_types = require("../utils/types.js");
var import_helpers = require("../utils/helpers.js");
class MessageRouter {
  constructor(config, eventBus, logger) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
  }
  static {
    __name(this, "MessageRouter");
  }
  queues = /* @__PURE__ */ new Map();
  // agentId -> queue
  pendingResponses = /* @__PURE__ */ new Map();
  messageCount = 0;
  async initialize() {
    this.logger.info("Initializing message router");
    setInterval(() => this.cleanup(), 6e4);
  }
  async shutdown() {
    this.logger.info("Shutting down message router");
    for (const [id, pending] of this.pendingResponses) {
      pending.reject(new Error("Message router shutdown"));
      clearTimeout(pending.timeout);
    }
    this.queues.clear();
    this.pendingResponses.clear();
  }
  async send(from, to, payload) {
    const message = {
      id: (0, import_helpers.generateId)("msg"),
      type: "agent-message",
      payload,
      timestamp: /* @__PURE__ */ new Date(),
      priority: 0
    };
    await this.sendMessage(from, to, message);
  }
  async sendWithResponse(from, to, payload, timeoutMs) {
    const message = {
      id: (0, import_helpers.generateId)("msg"),
      type: "agent-request",
      payload,
      timestamp: /* @__PURE__ */ new Date(),
      priority: 1
    };
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        reject(new Error(`Message response timeout: ${message.id}`));
      }, timeoutMs || this.config.messageTimeout);
      this.pendingResponses.set(message.id, {
        resolve,
        reject,
        timeout
      });
    });
    await this.sendMessage(from, to, message);
    return await responsePromise;
  }
  async broadcast(from, payload) {
    const message = {
      id: (0, import_helpers.generateId)("broadcast"),
      type: "broadcast",
      payload,
      timestamp: /* @__PURE__ */ new Date(),
      priority: 0
    };
    const agents = Array.from(this.queues.keys()).filter((id) => id !== from);
    await Promise.all(agents.map((to) => this.sendMessage(from, to, message)));
  }
  subscribe(agentId, handler) {
    const queue = this.ensureQueue(agentId);
    queue.handlers.set((0, import_helpers.generateId)("handler"), handler);
  }
  unsubscribe(agentId, handlerId) {
    const queue = this.queues.get(agentId);
    if (queue) {
      queue.handlers.delete(handlerId);
    }
  }
  async sendResponse(originalMessageId, response) {
    const pending = this.pendingResponses.get(originalMessageId);
    if (!pending) {
      this.logger.warn("No pending response found", { messageId: originalMessageId });
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingResponses.delete(originalMessageId);
    pending.resolve(response);
  }
  async getHealthStatus() {
    const totalQueues = this.queues.size;
    let totalMessages = 0;
    let totalHandlers = 0;
    for (const queue of this.queues.values()) {
      totalMessages += queue.messages.length;
      totalHandlers += queue.handlers.size;
    }
    return {
      healthy: true,
      metrics: {
        activeQueues: totalQueues,
        pendingMessages: totalMessages,
        registeredHandlers: totalHandlers,
        pendingResponses: this.pendingResponses.size,
        totalMessagesSent: this.messageCount
      }
    };
  }
  async sendMessage(from, to, message) {
    this.logger.debug("Sending message", {
      from,
      to,
      messageId: message.id,
      type: message.type
    });
    const queue = this.ensureQueue(to);
    queue.messages.push(message);
    this.messageCount++;
    this.eventBus.emit(import_types.SystemEvents.MESSAGE_SENT, { from, to, message });
    if (queue.handlers.size > 0) {
      await this.processMessage(to, message);
    }
  }
  async processMessage(agentId, message) {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return;
    }
    const index = queue.messages.indexOf(message);
    if (index !== -1) {
      queue.messages.splice(index, 1);
    }
    const handlers = Array.from(queue.handlers.values());
    await Promise.all(
      handlers.map((handler) => {
        try {
          handler(message);
        } catch (error) {
          this.logger.error("Message handler error", {
            agentId,
            messageId: message.id,
            error
          });
        }
      })
    );
    this.eventBus.emit(import_types.SystemEvents.MESSAGE_RECEIVED, {
      from: "",
      // Would need to track this
      to: agentId,
      message
    });
  }
  ensureQueue(agentId) {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, {
        messages: [],
        handlers: /* @__PURE__ */ new Map()
      });
    }
    return this.queues.get(agentId);
  }
  async performMaintenance() {
    this.logger.debug("Performing message router maintenance");
    this.cleanup();
  }
  cleanup() {
    const now = Date.now();
    for (const [agentId, queue] of this.queues) {
      const filtered = queue.messages.filter((msg) => {
        const age = now - msg.timestamp.getTime();
        const maxAge = msg.expiry ? msg.expiry.getTime() - msg.timestamp.getTime() : this.config.messageTimeout;
        if (age > maxAge) {
          this.logger.warn("Dropping expired message", {
            agentId,
            messageId: msg.id,
            age
          });
          return false;
        }
        return true;
      });
      queue.messages = filtered;
      if (queue.messages.length === 0 && queue.handlers.size === 0) {
        this.queues.delete(agentId);
      }
    }
    for (const [id, pending] of this.pendingResponses) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Response timeout during cleanup"));
    }
    this.pendingResponses.clear();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MessageRouter
});
//# sourceMappingURL=messaging.js.map
