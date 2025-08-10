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
var hive_protocol_exports = {};
__export(hive_protocol_exports, {
  HiveCommunicationProtocol: () => HiveCommunicationProtocol
});
module.exports = __toCommonJS(hive_protocol_exports);
var import_events = require("events");
var import_helpers = require("../utils/helpers.js");
class HiveCommunicationProtocol extends import_events.EventEmitter {
  static {
    __name(this, "HiveCommunicationProtocol");
  }
  channels = /* @__PURE__ */ new Map();
  messageQueue = /* @__PURE__ */ new Map();
  knowledgeBase = /* @__PURE__ */ new Map();
  consensusThreshold;
  constructor(options = {}) {
    super();
    this.consensusThreshold = options.consensusThreshold || 0.6;
    this.initializeChannels();
  }
  /**
   * Initialize default communication channels
   */
  initializeChannels() {
    this.createChannel("broadcast", "broadcast", "General announcements and updates");
    this.createChannel("consensus", "consensus", "Voting and decision making");
    this.createChannel("coordination", "coordination", "Task assignment and progress");
    this.createChannel("knowledge", "knowledge", "Knowledge sharing and learning");
  }
  /**
   * Create a new communication channel
   */
  createChannel(name, type, description) {
    const channel = {
      id: (0, import_helpers.generateId)("channel"),
      name,
      type,
      members: /* @__PURE__ */ new Set(),
      messages: []
    };
    this.channels.set(channel.id, channel);
    this.emit("channel:created", { channel, description });
    return channel;
  }
  /**
   * Join an agent to a channel
   */
  joinChannel(channelId, agentId) {
    const channel = this.channels.get(channelId);
    if (!channel)
      throw new Error(`Channel ${channelId} not found`);
    channel.members.add(agentId);
    this.emit("channel:joined", { channelId, agentId });
  }
  /**
   * Send a message through the protocol
   */
  sendMessage(message) {
    const fullMessage = {
      ...message,
      id: (0, import_helpers.generateId)("msg"),
      timestamp: Date.now()
    };
    this.routeMessage(fullMessage);
    const channelType = this.getChannelTypeForMessage(fullMessage.type);
    const channel = Array.from(this.channels.values()).find((c) => c.type === channelType);
    if (channel) {
      channel.messages.push(fullMessage);
    }
    if (fullMessage.to === "broadcast") {
      for (const channel2 of this.channels.values()) {
        for (const member of channel2.members) {
          this.queueMessage(member, fullMessage);
        }
      }
    } else {
      this.queueMessage(fullMessage.to, fullMessage);
    }
    this.emit("message:sent", fullMessage);
    return fullMessage;
  }
  /**
   * Route message based on type
   */
  routeMessage(message) {
    switch (message.type) {
      case "vote_request":
        this.handleVoteRequest(message);
        break;
      case "knowledge_share":
        this.handleKnowledgeShare(message);
        break;
      case "consensus_check":
        this.handleConsensusCheck(message);
        break;
      case "quality_report":
        this.handleQualityReport(message);
        break;
    }
  }
  /**
   * Get channel type for message type
   */
  getChannelTypeForMessage(messageType) {
    switch (messageType) {
      case "vote_request":
      case "vote_response":
      case "consensus_check":
        return "consensus";
      case "task_proposal":
      case "status_update":
      case "coordination_sync":
        return "coordination";
      case "knowledge_share":
        return "knowledge";
      default:
        return "broadcast";
    }
  }
  /**
   * Queue message for agent
   */
  queueMessage(agentId, message) {
    if (!this.messageQueue.has(agentId)) {
      this.messageQueue.set(agentId, []);
    }
    this.messageQueue.get(agentId).push(message);
  }
  /**
   * Retrieve messages for agent
   */
  getMessages(agentId) {
    const messages = this.messageQueue.get(agentId) || [];
    this.messageQueue.set(agentId, []);
    return messages;
  }
  /**
   * Handle vote request
   */
  handleVoteRequest(message) {
    const { proposal, deadline } = message.payload;
    this.emit("vote:requested", {
      messageId: message.id,
      proposal,
      deadline,
      from: message.from
    });
    if (deadline) {
      setTimeout(() => {
        this.collectVotes(message.id);
      }, deadline - Date.now());
    }
  }
  /**
   * Submit a vote response
   */
  submitVote(requestId, agentId, vote, confidence = 1) {
    const voteMessage = this.sendMessage({
      from: agentId,
      to: "consensus",
      type: "vote_response",
      payload: {
        requestId,
        vote,
        confidence,
        reasoning: this.generateVoteReasoning(vote, confidence)
      },
      priority: "high"
    });
    this.emit("vote:submitted", {
      requestId,
      agentId,
      vote,
      confidence
    });
    return voteMessage;
  }
  /**
   * Generate reasoning for vote
   */
  generateVoteReasoning(vote, confidence) {
    if (vote && confidence > 0.8) {
      return "Strong alignment with objectives and capabilities";
    } else if (vote && confidence > 0.5) {
      return "Moderate alignment, some concerns but manageable";
    } else if (!vote && confidence > 0.8) {
      return "Significant concerns or misalignment detected";
    } else {
      return "Insufficient information or capability mismatch";
    }
  }
  /**
   * Collect and evaluate votes
   */
  collectVotes(requestId) {
    const votes = /* @__PURE__ */ new Map();
    for (const channel of this.channels.values()) {
      for (const message of channel.messages) {
        if (message.type === "vote_response" && message.payload.requestId === requestId) {
          votes.set(message.from, {
            vote: message.payload.vote,
            confidence: message.payload.confidence
          });
        }
      }
    }
    const consensus = this.calculateConsensus(votes);
    this.emit("consensus:reached", {
      requestId,
      consensus,
      votes: Array.from(votes.entries())
    });
  }
  /**
   * Calculate consensus from votes
   */
  calculateConsensus(votes) {
    if (votes.size === 0) {
      return { approved: false, confidence: 0 };
    }
    let totalWeight = 0;
    let approvalWeight = 0;
    for (const [_, { vote, confidence }] of votes) {
      totalWeight += confidence;
      if (vote) {
        approvalWeight += confidence;
      }
    }
    const approvalRate = approvalWeight / totalWeight;
    const approved = approvalRate >= this.consensusThreshold;
    return { approved, confidence: approvalRate };
  }
  /**
   * Handle knowledge sharing
   */
  handleKnowledgeShare(message) {
    const { key, value, metadata } = message.payload;
    this.knowledgeBase.set(key, {
      value,
      metadata,
      contributor: message.from,
      timestamp: message.timestamp
    });
    this.emit("knowledge:shared", {
      key,
      contributor: message.from,
      timestamp: message.timestamp
    });
  }
  /**
   * Query knowledge base
   */
  queryKnowledge(pattern) {
    const results = [];
    for (const [key, data] of this.knowledgeBase) {
      if (key.includes(pattern)) {
        results.push({ key, ...data });
      }
    }
    return results;
  }
  /**
   * Handle consensus check
   */
  handleConsensusCheck(message) {
    const { topic, options } = message.payload;
    const voteRequest = this.sendMessage({
      from: "consensus-system",
      to: "broadcast",
      type: "vote_request",
      payload: {
        topic,
        options,
        deadline: Date.now() + 3e4
        // 30 second deadline
      },
      priority: "urgent",
      requiresResponse: true
    });
    this.emit("consensus:initiated", {
      topic,
      options,
      requestId: voteRequest.id
    });
  }
  /**
   * Handle quality report
   */
  handleQualityReport(message) {
    const { taskId, metrics, issues } = message.payload;
    this.knowledgeBase.set(`quality/${taskId}`, {
      metrics,
      issues,
      reporter: message.from,
      timestamp: message.timestamp
    });
    if (metrics.score < 0.7) {
      this.emit("quality:alert", {
        taskId,
        score: metrics.score,
        issues,
        reporter: message.from
      });
    }
  }
  /**
   * Get communication statistics
   */
  getStatistics() {
    const stats = {
      totalMessages: 0,
      messagesByType: /* @__PURE__ */ new Map(),
      messagesByPriority: /* @__PURE__ */ new Map(),
      activeChannels: this.channels.size,
      knowledgeEntries: this.knowledgeBase.size,
      avgResponseTime: 0
    };
    for (const channel of this.channels.values()) {
      stats.totalMessages += channel.messages.length;
      for (const message of channel.messages) {
        const typeCount = stats.messagesByType.get(message.type) || 0;
        stats.messagesByType.set(message.type, typeCount + 1);
        const priorityCount = stats.messagesByPriority.get(message.priority) || 0;
        stats.messagesByPriority.set(message.priority, priorityCount + 1);
      }
    }
    return stats;
  }
  /**
   * Export communication log
   */
  exportLog() {
    const log = {
      channels: Array.from(this.channels.values()).map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        memberCount: channel.members.size,
        messageCount: channel.messages.length
      })),
      messages: [],
      knowledge: Array.from(this.knowledgeBase.entries()).map(([key, value]) => ({
        key,
        ...value
      }))
    };
    for (const channel of this.channels.values()) {
      log.messages.push(...channel.messages);
    }
    log.messages.sort((a, b) => a.timestamp - b.timestamp);
    return log;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HiveCommunicationProtocol
});
//# sourceMappingURL=hive-protocol.js.map
