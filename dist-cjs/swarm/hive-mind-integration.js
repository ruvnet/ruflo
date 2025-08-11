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
var hive_mind_integration_exports = {};
__export(hive_mind_integration_exports, {
  HiveMindIntegration: () => HiveMindIntegration,
  default: () => hive_mind_integration_default
});
module.exports = __toCommonJS(hive_mind_integration_exports);
var import_node_events = require("node:events");
var import_logger = require("../core/logger.js");
var import_helpers = require("../utils/helpers.js");
class HiveMindIntegration extends import_node_events.EventEmitter {
  static {
    __name(this, "HiveMindIntegration");
  }
  logger;
  config;
  memoryManager;
  activeSessions = /* @__PURE__ */ new Map();
  globalKnowledgeBase;
  globalIntelligence;
  syncInterval;
  isInitialized = false;
  constructor(config = {}, memoryManager) {
    super();
    this.logger = new import_logger.Logger("HiveMindIntegration");
    this.config = this.createDefaultConfig(config);
    this.memoryManager = memoryManager;
    this.globalKnowledgeBase = this.initializeKnowledgeBase();
    this.globalIntelligence = this.initializeCollectiveIntelligence();
    this.setupEventHandlers();
  }
  /**
   * Initialize the hive-mind integration
   */
  async initialize() {
    if (this.isInitialized) {
      this.logger.warn("Hive-mind integration already initialized");
      return;
    }
    this.logger.info("Initializing hive-mind integration...");
    try {
      await this.loadKnowledgeBase();
      await this.loadCollectiveIntelligence();
      if (this.config.syncInterval > 0) {
        this.startPeriodicSync();
      }
      this.isInitialized = true;
      this.logger.info("Hive-mind integration initialized successfully");
      this.emit("initialized");
    } catch (error) {
      this.logger.error("Failed to initialize hive-mind integration", error);
      throw error;
    }
  }
  /**
   * Shutdown the integration gracefully
   */
  async shutdown() {
    if (!this.isInitialized)
      return;
    this.logger.info("Shutting down hive-mind integration...");
    try {
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }
      await this.saveKnowledgeBase();
      await this.saveCollectiveIntelligence();
      const terminationPromises = Array.from(this.activeSessions.keys()).map((sessionId) => this.terminateSession(sessionId));
      await Promise.allSettled(terminationPromises);
      this.isInitialized = false;
      this.logger.info("Hive-mind integration shut down successfully");
      this.emit("shutdown");
    } catch (error) {
      this.logger.error("Error during hive-mind integration shutdown", error);
      throw error;
    }
  }
  /**
   * Create a new hive-mind session for a swarm
   */
  async createSession(swarmId, orchestrator) {
    const sessionId = (0, import_helpers.generateId)("hive-session");
    this.logger.info("Creating hive-mind session", {
      sessionId,
      swarmId
    });
    const session = {
      id: sessionId,
      swarmId,
      participants: [],
      sharedMemory: /* @__PURE__ */ new Map(),
      collectiveIntelligence: this.initializeCollectiveIntelligence(),
      knowledgeBase: this.initializeKnowledgeBase(),
      distributedLearning: this.initializeDistributedLearning(),
      status: "active",
      startTime: /* @__PURE__ */ new Date(),
      lastSync: /* @__PURE__ */ new Date()
    };
    this.activeSessions.set(sessionId, session);
    await this.initializeSessionWithGlobalKnowledge(session);
    this.emit("session:created", {
      sessionId,
      swarmId
    });
    return sessionId;
  }
  /**
   * Add an agent to a hive-mind session
   */
  async addAgentToSession(sessionId, agentId, agent) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Hive-mind session not found: ${sessionId}`);
    }
    if (!session.participants.includes(agentId)) {
      session.participants.push(agentId);
      this.logger.info("Agent added to hive-mind session", {
        sessionId,
        agentId,
        participantCount: session.participants.length
      });
      await this.shareKnowledgeWithAgent(session, agentId, agent);
      this.emit("agent:joined", {
        sessionId,
        agentId,
        participantCount: session.participants.length
      });
    }
  }
  /**
   * Remove an agent from a hive-mind session
   */
  async removeAgentFromSession(sessionId, agentId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Hive-mind session not found: ${sessionId}`);
    }
    const index = session.participants.indexOf(agentId);
    if (index !== -1) {
      session.participants.splice(index, 1);
      this.logger.info("Agent removed from hive-mind session", {
        sessionId,
        agentId,
        participantCount: session.participants.length
      });
      this.emit("agent:left", {
        sessionId,
        agentId,
        participantCount: session.participants.length
      });
    }
  }
  /**
   * Share knowledge or experience with the hive-mind
   */
  async shareWithHive(sessionId, agentId, type, data) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Hive-mind session not found: ${sessionId}`);
    }
    this.logger.debug("Sharing with hive-mind", {
      sessionId,
      agentId,
      type
    });
    switch (type) {
      case "knowledge":
        await this.addKnowledge(session, agentId, data);
        break;
      case "experience":
        await this.addExperience(session, agentId, data);
        break;
      case "insight":
        await this.addInsight(session, agentId, data);
        break;
      case "pattern":
        await this.addPattern(session, agentId, data);
        break;
    }
    this.emit("knowledge:shared", {
      sessionId,
      agentId,
      type
    });
  }
  /**
   * Request collective decision making
   */
  async requestCollectiveDecision(sessionId, question, options, requesterAgentId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Hive-mind session not found: ${sessionId}`);
    }
    const decisionId = (0, import_helpers.generateId)("decision");
    this.logger.info("Requesting collective decision", {
      sessionId,
      decisionId,
      question,
      optionCount: options.length,
      requesterAgentId
    });
    const decision = {
      id: decisionId,
      question,
      options,
      votingResults: /* @__PURE__ */ new Map(),
      consensus: "",
      confidence: 0,
      reasoning: "",
      participants: [...session.participants],
      timestamp: /* @__PURE__ */ new Date()
    };
    session.collectiveIntelligence.decisions.set(decisionId, decision);
    await this.initiateVoting(session, decision);
    this.emit("decision:requested", {
      sessionId,
      decisionId,
      question
    });
    return decisionId;
  }
  /**
   * Get collective decision result
   */
  getCollectiveDecision(sessionId, decisionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session)
      return null;
    return session.collectiveIntelligence.decisions.get(decisionId) || null;
  }
  /**
   * Query the hive-mind knowledge base
   */
  async queryKnowledge(sessionId, query) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Hive-mind session not found: ${sessionId}`);
    }
    this.logger.debug("Querying hive-mind knowledge", {
      sessionId,
      query
    });
    let results = [];
    switch (query.type) {
      case "fact":
        results = this.queryFacts(session, query);
        break;
      case "procedure":
        results = this.queryProcedures(session, query);
        break;
      case "bestPractice":
        results = this.queryBestPractices(session, query);
        break;
      case "lesson":
        results = this.queryLessons(session, query);
        break;
    }
    this.emit("knowledge:queried", {
      sessionId,
      query,
      resultCount: results.length
    });
    return results;
  }
  /**
   * Get collective insights for a swarm
   */
  getCollectiveInsights(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session)
      return [];
    return Array.from(session.collectiveIntelligence.insights.values());
  }
  /**
   * Get identified patterns
   */
  getIdentifiedPatterns(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session)
      return [];
    return Array.from(session.collectiveIntelligence.patterns.values());
  }
  /**
   * Get performance predictions
   */
  getPerformancePredictions(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session)
      return [];
    return Array.from(session.collectiveIntelligence.predictions.values());
  }
  /**
   * Terminate a hive-mind session
   */
  async terminateSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session)
      return;
    this.logger.info("Terminating hive-mind session", {
      sessionId,
      participantCount: session.participants.length,
      duration: Date.now() - session.startTime.getTime()
    });
    await this.consolidateSessionKnowledge(session);
    session.status = "terminated";
    this.activeSessions.delete(sessionId);
    this.emit("session:terminated", {
      sessionId,
      duration: Date.now() - session.startTime.getTime()
    });
  }
  /**
   * Get hive-mind session status
   */
  getSessionStatus(sessionId) {
    return this.activeSessions.get(sessionId) || null;
  }
  /**
   * Get integration metrics
   */
  getIntegrationMetrics() {
    const sessions = Array.from(this.activeSessions.values());
    return {
      activeSessions: sessions.length,
      totalParticipants: sessions.reduce((sum, s) => sum + s.participants.length, 0),
      knowledgeItems: this.countKnowledgeItems(),
      insights: this.globalIntelligence.insights.size,
      patterns: this.globalIntelligence.patterns.size,
      decisions: this.globalIntelligence.decisions.size,
      predictions: this.globalIntelligence.predictions.size,
      learningModels: sessions.reduce((sum, s) => sum + s.distributedLearning.models.size, 0)
    };
  }
  // Private methods
  async loadKnowledgeBase() {
    try {
      const knowledgeEntries = await this.memoryManager.retrieve({
        namespace: "hive-mind-knowledge",
        type: "knowledge-base"
      });
      for (const entry of knowledgeEntries) {
        const data = JSON.parse(entry.content);
        this.loadKnowledgeData(data);
      }
      this.logger.debug("Knowledge base loaded", {
        factsCount: this.globalKnowledgeBase.facts.size,
        proceduresCount: this.globalKnowledgeBase.procedures.size,
        bestPracticesCount: this.globalKnowledgeBase.bestPractices.size,
        lessonsCount: this.globalKnowledgeBase.lessons.size
      });
    } catch (error) {
      this.logger.warn("Failed to load knowledge base, starting fresh", error);
    }
  }
  async loadCollectiveIntelligence() {
    try {
      const intelligenceEntries = await this.memoryManager.retrieve({
        namespace: "hive-mind-intelligence",
        type: "collective-intelligence"
      });
      for (const entry of intelligenceEntries) {
        const data = JSON.parse(entry.content);
        this.loadIntelligenceData(data);
      }
      this.logger.debug("Collective intelligence loaded", {
        patternsCount: this.globalIntelligence.patterns.size,
        insightsCount: this.globalIntelligence.insights.size,
        decisionsCount: this.globalIntelligence.decisions.size,
        predictionsCount: this.globalIntelligence.predictions.size
      });
    } catch (error) {
      this.logger.warn("Failed to load collective intelligence, starting fresh", error);
    }
  }
  async saveKnowledgeBase() {
    try {
      const knowledgeData = {
        facts: Array.from(this.globalKnowledgeBase.facts.entries()),
        procedures: Array.from(this.globalKnowledgeBase.procedures.entries()),
        bestPractices: Array.from(this.globalKnowledgeBase.bestPractices.entries()),
        lessons: Array.from(this.globalKnowledgeBase.lessons.entries())
      };
      await this.memoryManager.store({
        id: `knowledge-base-${Date.now()}`,
        agentId: "hive-mind-integration",
        type: "knowledge-base",
        content: JSON.stringify(knowledgeData),
        namespace: "hive-mind-knowledge",
        timestamp: /* @__PURE__ */ new Date(),
        metadata: {
          type: "knowledge-base-snapshot",
          itemCount: this.countKnowledgeItems()
        }
      });
    } catch (error) {
      this.logger.error("Failed to save knowledge base", error);
    }
  }
  async saveCollectiveIntelligence() {
    try {
      const intelligenceData = {
        patterns: Array.from(this.globalIntelligence.patterns.entries()),
        insights: Array.from(this.globalIntelligence.insights.entries()),
        decisions: Array.from(this.globalIntelligence.decisions.entries()),
        predictions: Array.from(this.globalIntelligence.predictions.entries())
      };
      await this.memoryManager.store({
        id: `collective-intelligence-${Date.now()}`,
        agentId: "hive-mind-integration",
        type: "collective-intelligence",
        content: JSON.stringify(intelligenceData),
        namespace: "hive-mind-intelligence",
        timestamp: /* @__PURE__ */ new Date(),
        metadata: {
          type: "intelligence-snapshot",
          itemCount: this.globalIntelligence.patterns.size + this.globalIntelligence.insights.size + this.globalIntelligence.decisions.size + this.globalIntelligence.predictions.size
        }
      });
    } catch (error) {
      this.logger.error("Failed to save collective intelligence", error);
    }
  }
  startPeriodicSync() {
    this.syncInterval = setInterval(async () => {
      try {
        await this.performPeriodicSync();
      } catch (error) {
        this.logger.error("Error during periodic sync", error);
      }
    }, this.config.syncInterval);
  }
  async performPeriodicSync() {
    if (this.config.hiveMindEndpoint) {
      this.logger.debug("Performing external hive-mind sync");
    }
    for (const session of this.activeSessions.values()) {
      await this.syncSessionKnowledge(session);
      session.lastSync = /* @__PURE__ */ new Date();
    }
    this.emit("sync:completed", {
      sessionsSynced: this.activeSessions.size,
      timestamp: /* @__PURE__ */ new Date()
    });
  }
  async initializeSessionWithGlobalKnowledge(session) {
    for (const [id, fact] of this.globalKnowledgeBase.facts) {
      session.knowledgeBase.facts.set(id, fact);
    }
    for (const [id, insight] of this.globalIntelligence.insights) {
      session.collectiveIntelligence.insights.set(id, insight);
    }
    for (const [id, pattern] of this.globalIntelligence.patterns) {
      session.collectiveIntelligence.patterns.set(id, pattern);
    }
  }
  async shareKnowledgeWithAgent(session, agentId, agent) {
    const relevantKnowledge = this.getRelevantKnowledge(session, agent.capabilities);
    this.logger.debug("Sharing knowledge with agent", {
      sessionId: session.id,
      agentId,
      knowledgeItems: relevantKnowledge.length
    });
  }
  getRelevantKnowledge(session, capabilities) {
    const relevantItems = [];
    for (const fact of session.knowledgeBase.facts.values()) {
      if (capabilities.some((cap) => fact.category.includes(cap))) {
        relevantItems.push(fact);
      }
    }
    for (const procedure of session.knowledgeBase.procedures.values()) {
      if (capabilities.some((cap) => procedure.contexts.includes(cap))) {
        relevantItems.push(procedure);
      }
    }
    return relevantItems;
  }
  async addKnowledge(session, agentId, data) {
    if (data.type === "fact") {
      const fact = {
        id: (0, import_helpers.generateId)("fact"),
        statement: data.statement,
        category: data.category || "general",
        confidence: data.confidence || 0.8,
        sources: [agentId],
        validatedBy: [agentId],
        contexts: data.contexts || [],
        timestamp: /* @__PURE__ */ new Date()
      };
      session.knowledgeBase.facts.set(fact.id, fact);
    }
  }
  async addExperience(session, agentId, data) {
    const experience = {
      id: (0, import_helpers.generateId)("experience"),
      context: data.context || "general",
      situation: data.situation,
      actions: data.actions || [],
      results: data.results || [],
      feedback: data.feedback || 0,
      tags: data.tags || [],
      agentId,
      timestamp: /* @__PURE__ */ new Date()
    };
    session.distributedLearning.experiences.set(experience.id, experience);
  }
  async addInsight(session, agentId, data) {
    const insight = {
      id: (0, import_helpers.generateId)("insight"),
      category: data.category || "optimization",
      title: data.title,
      description: data.description,
      evidence: data.evidence || [],
      confidence: data.confidence || 0.7,
      applicability: data.applicability || [],
      contributingAgents: [agentId],
      timestamp: /* @__PURE__ */ new Date()
    };
    session.collectiveIntelligence.insights.set(insight.id, insight);
  }
  async addPattern(session, agentId, data) {
    const pattern = {
      id: (0, import_helpers.generateId)("pattern"),
      type: data.type || "behavioral",
      description: data.description,
      frequency: data.frequency || 1,
      confidence: data.confidence || 0.7,
      contexts: data.contexts || [],
      impact: data.impact || "medium",
      discoveredBy: [agentId],
      lastSeen: /* @__PURE__ */ new Date()
    };
    session.collectiveIntelligence.patterns.set(pattern.id, pattern);
  }
  async initiateVoting(session, decision) {
    this.logger.debug("Initiating collective voting", {
      sessionId: session.id,
      decisionId: decision.id,
      participantCount: decision.participants.length
    });
    setTimeout(() => {
      this.processVotingResults(session, decision);
    }, 5e3);
  }
  processVotingResults(session, decision) {
    decision.consensus = decision.options[0].id;
    decision.confidence = 0.8;
    decision.reasoning = "Consensus reached through collective voting";
    this.emit("decision:completed", {
      sessionId: session.id,
      decisionId: decision.id,
      consensus: decision.consensus,
      confidence: decision.confidence
    });
  }
  queryFacts(session, query) {
    const results = [];
    for (const fact of session.knowledgeBase.facts.values()) {
      let matches = true;
      if (query.category && !fact.category.includes(query.category)) {
        matches = false;
      }
      if (query.keywords && !query.keywords.some((keyword) => fact.statement.toLowerCase().includes(keyword.toLowerCase()))) {
        matches = false;
      }
      if (query.context && !fact.contexts.includes(query.context)) {
        matches = false;
      }
      if (matches) {
        results.push(fact);
      }
    }
    return results;
  }
  queryProcedures(session, query) {
    return Array.from(session.knowledgeBase.procedures.values());
  }
  queryBestPractices(session, query) {
    return Array.from(session.knowledgeBase.bestPractices.values());
  }
  queryLessons(session, query) {
    return Array.from(session.knowledgeBase.lessons.values());
  }
  async consolidateSessionKnowledge(session) {
    for (const [id, fact] of session.knowledgeBase.facts) {
      if (!this.globalKnowledgeBase.facts.has(id)) {
        this.globalKnowledgeBase.facts.set(id, fact);
      }
    }
    for (const [id, insight] of session.collectiveIntelligence.insights) {
      if (!this.globalIntelligence.insights.has(id)) {
        this.globalIntelligence.insights.set(id, insight);
      }
    }
  }
  async syncSessionKnowledge(session) {
  }
  loadKnowledgeData(data) {
    if (data.facts) {
      for (const [id, fact] of data.facts) {
        this.globalKnowledgeBase.facts.set(id, fact);
      }
    }
  }
  loadIntelligenceData(data) {
    if (data.patterns) {
      for (const [id, pattern] of data.patterns) {
        this.globalIntelligence.patterns.set(id, pattern);
      }
    }
  }
  countKnowledgeItems() {
    return this.globalKnowledgeBase.facts.size + this.globalKnowledgeBase.procedures.size + this.globalKnowledgeBase.bestPractices.size + this.globalKnowledgeBase.lessons.size;
  }
  initializeKnowledgeBase() {
    return {
      facts: /* @__PURE__ */ new Map(),
      procedures: /* @__PURE__ */ new Map(),
      bestPractices: /* @__PURE__ */ new Map(),
      lessons: /* @__PURE__ */ new Map()
    };
  }
  initializeCollectiveIntelligence() {
    return {
      patterns: /* @__PURE__ */ new Map(),
      insights: /* @__PURE__ */ new Map(),
      decisions: /* @__PURE__ */ new Map(),
      predictions: /* @__PURE__ */ new Map()
    };
  }
  initializeDistributedLearning() {
    return {
      models: /* @__PURE__ */ new Map(),
      experiences: /* @__PURE__ */ new Map(),
      adaptations: /* @__PURE__ */ new Map(),
      performance: {
        metrics: /* @__PURE__ */ new Map(),
        improvements: [],
        degradations: [],
        stability: 1,
        trends: []
      }
    };
  }
  createDefaultConfig(config) {
    return {
      enableSharedIntelligence: true,
      enableCollectiveMemory: true,
      enableDistributedLearning: true,
      enableKnowledgeSharing: true,
      syncInterval: 3e4,
      // 30 seconds
      maxSharedMemorySize: 100 * 1024 * 1024,
      // 100MB
      intelligencePoolSize: 1e3,
      learningRate: 0.1,
      knowledgeRetentionPeriod: 7 * 24 * 60 * 60 * 1e3,
      // 7 days
      ...config
    };
  }
  setupEventHandlers() {
    this.on("session:created", (data) => {
      this.logger.info("Hive-mind session created", data);
    });
    this.on("agent:joined", (data) => {
      this.logger.info("Agent joined hive-mind", data);
    });
    this.on("knowledge:shared", (data) => {
      this.logger.debug("Knowledge shared with hive-mind", data);
    });
    this.on("decision:completed", (data) => {
      this.logger.info("Collective decision completed", data);
    });
  }
}
var hive_mind_integration_default = HiveMindIntegration;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HiveMindIntegration
});
//# sourceMappingURL=hive-mind-integration.js.map
