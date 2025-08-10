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
var Communication_exports = {};
__export(Communication_exports, {
  Communication: () => Communication
});
module.exports = __toCommonJS(Communication_exports);
var import_events = require("events");
var import_DatabaseManager = require("./DatabaseManager.js");
class Communication extends import_events.EventEmitter {
  static {
    __name(this, "Communication");
  }
  swarmId;
  db;
  agents;
  channels;
  messageQueue;
  stats;
  isActive = false;
  constructor(swarmId) {
    super();
    this.swarmId = swarmId;
    this.agents = /* @__PURE__ */ new Map();
    this.channels = /* @__PURE__ */ new Map();
    this.messageQueue = /* @__PURE__ */ new Map([
      ["urgent", []],
      ["high", []],
      ["normal", []],
      ["low", []]
    ]);
    this.stats = {
      totalMessages: 0,
      avgLatency: 0,
      activeChannels: 0,
      messagesByType: {},
      throughput: 0
    };
  }
  /**
   * Initialize communication system
   */
  async initialize() {
    this.db = await import_DatabaseManager.DatabaseManager.getInstance();
    this.setupDefaultChannels();
    this.startMessageProcessor();
    this.startLatencyMonitor();
    this.startStatsCollector();
    this.isActive = true;
    this.emit("initialized");
  }
  /**
   * Add an agent to the communication network
   */
  addAgent(agent) {
    this.agents.set(agent.id, agent);
    this.createAgentChannels(agent);
    this.subscribeAgentToChannels(agent);
    this.emit("agentAdded", { agentId: agent.id });
  }
  /**
   * Remove an agent from the communication network
   */
  removeAgent(agentId) {
    this.agents.delete(agentId);
    this.channels.forEach((channel) => {
      channel.subscribers = channel.subscribers.filter((id) => id !== agentId);
    });
    this.emit("agentRemoved", { agentId });
  }
  /**
   * Send a message
   */
  async sendMessage(message) {
    await this.db.createCommunication({
      from_agent_id: message.fromAgentId,
      to_agent_id: message.toAgentId,
      swarm_id: this.swarmId,
      message_type: message.type,
      content: JSON.stringify(message.content),
      priority: message.priority || "normal",
      requires_response: message.requiresResponse || false
    });
    const priority = message.priority || "normal";
    this.messageQueue.get(priority).push(message);
    this.stats.totalMessages++;
    this.stats.messagesByType[message.type] = (this.stats.messagesByType[message.type] || 0) + 1;
    this.emit("messageSent", message);
  }
  /**
   * Broadcast a message to all agents
   */
  async broadcast(fromAgentId, type, content, priority = "normal") {
    const message = {
      id: this.generateMessageId(),
      fromAgentId,
      toAgentId: null,
      // null indicates broadcast
      swarmId: this.swarmId,
      type,
      content,
      priority,
      timestamp: /* @__PURE__ */ new Date(),
      requiresResponse: false
    };
    await this.sendMessage(message);
  }
  /**
   * Send a message to a specific channel
   */
  async sendToChannel(channelName, fromAgentId, content, priority = "normal") {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} not found`);
    }
    for (const subscriberId of channel.subscribers) {
      if (subscriberId !== fromAgentId) {
        const message = {
          id: this.generateMessageId(),
          fromAgentId,
          toAgentId: subscriberId,
          swarmId: this.swarmId,
          type: "channel",
          content: {
            channel: channelName,
            data: content
          },
          priority,
          timestamp: /* @__PURE__ */ new Date(),
          requiresResponse: false
        };
        await this.sendMessage(message);
      }
    }
  }
  /**
   * Request response from an agent
   */
  async requestResponse(fromAgentId, toAgentId, query, timeout = 5e3) {
    const message = {
      id: this.generateMessageId(),
      fromAgentId,
      toAgentId,
      swarmId: this.swarmId,
      type: "query",
      content: query,
      priority: "high",
      timestamp: /* @__PURE__ */ new Date(),
      requiresResponse: true
    };
    await this.sendMessage(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Response timeout"));
      }, timeout);
      const responseHandler = /* @__PURE__ */ __name((response) => {
        if (response.content.queryId === message.id) {
          clearTimeout(timer);
          this.off("messageReceived", responseHandler);
          resolve(response.content.response);
        }
      }, "responseHandler");
      this.on("messageReceived", responseHandler);
    });
  }
  /**
   * Create a new communication channel
   */
  createChannel(name, description, type = "public") {
    if (this.channels.has(name)) {
      throw new Error(`Channel ${name} already exists`);
    }
    const channel = {
      name,
      description,
      type,
      subscribers: [],
      createdAt: /* @__PURE__ */ new Date()
    };
    this.channels.set(name, channel);
    this.stats.activeChannels++;
    this.emit("channelCreated", { channel });
  }
  /**
   * Subscribe an agent to a channel
   */
  subscribeToChannel(agentId, channelName) {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} not found`);
    }
    if (!channel.subscribers.includes(agentId)) {
      channel.subscribers.push(agentId);
      this.emit("channelSubscribed", { agentId, channelName });
    }
  }
  /**
   * Unsubscribe an agent from a channel
   */
  unsubscribeFromChannel(agentId, channelName) {
    const channel = this.channels.get(channelName);
    if (!channel) {
      return;
    }
    channel.subscribers = channel.subscribers.filter((id) => id !== agentId);
    this.emit("channelUnsubscribed", { agentId, channelName });
  }
  /**
   * Get communication statistics
   */
  async getStats() {
    const recentMessages = await this.db.getRecentMessages(this.swarmId, 6e4);
    this.stats.throughput = recentMessages.length;
    return { ...this.stats };
  }
  /**
   * Get pending messages for an agent
   */
  async getPendingMessages(agentId) {
    const messages = await this.db.getPendingMessages(agentId);
    return messages.map((msg) => ({
      id: msg.id.toString(),
      fromAgentId: msg.from_agent_id,
      toAgentId: msg.to_agent_id,
      swarmId: msg.swarm_id,
      type: msg.message_type,
      content: JSON.parse(msg.content),
      priority: msg.priority,
      timestamp: new Date(msg.timestamp),
      requiresResponse: msg.requires_response
    }));
  }
  /**
   * Mark message as delivered
   */
  async markDelivered(messageId) {
    await this.db.markMessageDelivered(messageId);
  }
  /**
   * Mark message as read
   */
  async markRead(messageId) {
    await this.db.markMessageRead(messageId);
  }
  /**
   * Setup default communication channels
   */
  setupDefaultChannels() {
    this.createChannel("system", "System-wide notifications and alerts");
    this.createChannel("coordination", "Task coordination messages");
    this.createChannel("consensus", "Consensus voting and decisions");
    this.createChannel("monitoring", "Performance and health monitoring");
    this.createChannel("coordinators", "Coordinator agent communications");
    this.createChannel("researchers", "Researcher agent communications");
    this.createChannel("coders", "Coder agent communications");
    this.createChannel("analysts", "Analyst agent communications");
  }
  /**
   * Create channels for a specific agent
   */
  createAgentChannels(agent) {
    this.createChannel(`agent-${agent.id}`, `Direct messages for ${agent.name}`, "private");
    if (agent.type === "coordinator") {
      this.createChannel(`team-${agent.id}`, `Team channel led by ${agent.name}`);
    }
  }
  /**
   * Subscribe agent to relevant channels
   */
  subscribeAgentToChannels(agent) {
    this.subscribeToChannel(agent.id, "system");
    this.subscribeToChannel(agent.id, "coordination");
    const typeChannel = `${agent.type}s`;
    if (this.channels.has(typeChannel)) {
      this.subscribeToChannel(agent.id, typeChannel);
    }
    this.subscribeToChannel(agent.id, `agent-${agent.id}`);
    if (agent.capabilities.includes("consensus_building")) {
      this.subscribeToChannel(agent.id, "consensus");
    }
    if (agent.capabilities.includes("system_monitoring")) {
      this.subscribeToChannel(agent.id, "monitoring");
    }
  }
  /**
   * Start message processor
   */
  startMessageProcessor() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      for (const [priority, messages] of this.messageQueue) {
        if (messages.length === 0)
          continue;
        const batch = messages.splice(0, 10);
        for (const message of batch) {
          await this.processMessage(message);
        }
      }
    }, 100);
  }
  /**
   * Process a single message
   */
  async processMessage(message) {
    const startTime = Date.now();
    try {
      if (message.toAgentId) {
        const agent = this.agents.get(message.toAgentId);
        if (agent) {
          await agent.receiveMessage(message);
          await this.markDelivered(message.id);
        }
      } else {
        for (const agent of this.agents.values()) {
          if (agent.id !== message.fromAgentId) {
            await agent.receiveMessage(message);
          }
        }
      }
      const latency = Date.now() - startTime;
      this.updateLatencyStats(latency);
      this.emit("messageProcessed", { message, latency });
    } catch (error) {
      this.emit("messageError", { message, error });
    }
  }
  /**
   * Update latency statistics
   */
  updateLatencyStats(latency) {
    this.stats.avgLatency = this.stats.avgLatency * 0.9 + latency * 0.1;
  }
  /**
   * Start latency monitor
   */
  startLatencyMonitor() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      if (this.stats.avgLatency > 1e3) {
        this.emit("highLatency", { avgLatency: this.stats.avgLatency });
      }
    }, 5e3);
  }
  /**
   * Start statistics collector
   */
  startStatsCollector() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      await this.db.storePerformanceMetric({
        swarm_id: this.swarmId,
        metric_type: "communication_throughput",
        metric_value: this.stats.throughput
      });
      await this.db.storePerformanceMetric({
        swarm_id: this.swarmId,
        metric_type: "communication_latency",
        metric_value: this.stats.avgLatency
      });
    }, 6e4);
  }
  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Shutdown communication system
   */
  async shutdown() {
    this.isActive = false;
    this.messageQueue.forEach((queue) => queue.length = 0);
    this.channels.clear();
    this.emit("shutdown");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Communication
});
//# sourceMappingURL=Communication.js.map
