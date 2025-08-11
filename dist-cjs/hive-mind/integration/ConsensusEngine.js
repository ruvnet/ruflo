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
var ConsensusEngine_exports = {};
__export(ConsensusEngine_exports, {
  ConsensusEngine: () => ConsensusEngine
});
module.exports = __toCommonJS(ConsensusEngine_exports);
var import_events = require("events");
var import_DatabaseManager = require("../core/DatabaseManager.js");
var import_MCPToolWrapper = require("./MCPToolWrapper.js");
class ConsensusEngine extends import_events.EventEmitter {
  static {
    __name(this, "ConsensusEngine");
  }
  threshold;
  db;
  mcpWrapper;
  activeProposals;
  votingStrategies;
  metrics;
  isActive = false;
  constructor(threshold = 0.66) {
    super();
    this.threshold = threshold;
    this.activeProposals = /* @__PURE__ */ new Map();
    this.votingStrategies = /* @__PURE__ */ new Map();
    this.metrics = {
      totalProposals: 0,
      achievedConsensus: 0,
      failedConsensus: 0,
      avgVotingTime: 0,
      avgParticipation: 0
    };
    this.initializeVotingStrategies();
  }
  /**
   * Initialize consensus engine
   */
  async initialize() {
    this.db = await import_DatabaseManager.DatabaseManager.getInstance();
    this.mcpWrapper = new import_MCPToolWrapper.MCPToolWrapper();
    this.startProposalMonitor();
    this.startTimeoutChecker();
    this.startMetricsCollector();
    this.isActive = true;
    this.emit("initialized");
  }
  /**
   * Create a new consensus proposal
   */
  async createProposal(proposal) {
    await this.db.createConsensusProposal(proposal);
    this.activeProposals.set(proposal.id, proposal);
    this.metrics.totalProposals++;
    await this.initiateVoting(proposal);
    this.emit("proposalCreated", proposal);
    return proposal.id;
  }
  /**
   * Submit a vote for a proposal
   */
  async submitVote(vote) {
    const proposal = this.activeProposals.get(vote.proposalId);
    if (!proposal) {
      throw new Error("Proposal not found or no longer active");
    }
    if (!this.validateVote(vote, proposal)) {
      throw new Error("Invalid vote");
    }
    await this.db.submitConsensusVote(vote.proposalId, vote.agentId, vote.vote, vote.reason);
    await this.checkConsensus(proposal);
    this.emit("voteSubmitted", vote);
  }
  /**
   * Get proposal status
   */
  async getProposalStatus(proposalId) {
    const dbProposal = await this.db.getConsensusProposal(proposalId);
    if (!dbProposal) {
      throw new Error("Proposal not found");
    }
    const votes = JSON.parse(dbProposal.votes || "{}");
    const voteCount = Object.keys(votes).length;
    const positiveVotes = Object.values(votes).filter((v) => v.vote).length;
    return {
      id: proposalId,
      status: dbProposal.status,
      proposal: JSON.parse(dbProposal.proposal),
      requiredThreshold: dbProposal.required_threshold,
      currentVotes: dbProposal.current_votes,
      totalVoters: dbProposal.total_voters,
      currentRatio: voteCount > 0 ? positiveVotes / voteCount : 0,
      votes,
      deadline: dbProposal.deadline_at,
      timeRemaining: new Date(dbProposal.deadline_at).getTime() - Date.now()
    };
  }
  /**
   * Get voting recommendation for an agent
   */
  async getVotingRecommendation(proposalId, agentId, agentType) {
    const proposal = this.activeProposals.get(proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    const analysis = await this.mcpWrapper.analyzePattern({
      action: "analyze",
      operation: "consensus_proposal",
      metadata: {
        proposal: proposal.proposal,
        agentType,
        requiredThreshold: proposal.requiredThreshold
      }
    });
    const strategy = this.selectVotingStrategy(proposal, agentType);
    const recommendation = strategy.recommend(proposal, analysis);
    return {
      proposalId,
      recommendation: recommendation.vote,
      confidence: recommendation.confidence,
      reasoning: recommendation.reasoning,
      factors: recommendation.factors
    };
  }
  /**
   * Force consensus check (for testing or manual intervention)
   */
  async forceConsensusCheck(proposalId) {
    const proposal = this.activeProposals.get(proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    return this.checkConsensus(proposal);
  }
  /**
   * Get consensus metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }
  /**
   * Initialize voting strategies
   */
  initializeVotingStrategies() {
    this.votingStrategies.set("simple_majority", {
      name: "Simple Majority",
      description: "Requires more than 50% positive votes",
      threshold: 0.5,
      recommend: (proposal, analysis) => ({
        vote: analysis.data?.recommendation || true,
        confidence: 0.7,
        reasoning: "Based on simple majority principle",
        factors: ["proposal_quality", "impact_assessment"]
      })
    });
    this.votingStrategies.set("supermajority", {
      name: "Supermajority",
      description: "Requires 2/3 or more positive votes",
      threshold: 0.66,
      recommend: (proposal, analysis) => ({
        vote: analysis.data?.strongRecommendation || false,
        confidence: 0.8,
        reasoning: "Requires strong consensus for critical decisions",
        factors: ["criticality", "risk_assessment", "broad_support"]
      })
    });
    this.votingStrategies.set("unanimous", {
      name: "Unanimous",
      description: "Requires 100% agreement",
      threshold: 1,
      recommend: (proposal, analysis) => ({
        vote: analysis.data?.perfectAlignment || false,
        confidence: 0.9,
        reasoning: "All agents must agree for this decision",
        factors: ["absolute_necessity", "zero_dissent"]
      })
    });
    this.votingStrategies.set("qualified_majority", {
      name: "Qualified Majority",
      description: "Weighted voting based on agent expertise",
      threshold: 0.6,
      recommend: (proposal, analysis) => {
        const expertise = analysis.data?.expertiseAlignment || 0.5;
        return {
          vote: expertise > 0.6,
          confidence: expertise,
          reasoning: "Based on agent expertise and proposal alignment",
          factors: ["expertise_level", "domain_knowledge", "past_performance"]
        };
      }
    });
  }
  /**
   * Initiate voting process
   */
  async initiateVoting(proposal) {
    await this.db.createCommunication({
      from_agent_id: "consensus-engine",
      to_agent_id: null,
      // broadcast
      swarm_id: proposal.swarmId,
      message_type: "consensus",
      content: JSON.stringify({
        type: "voting_request",
        proposal
      }),
      priority: "high",
      requires_response: true
    });
    if (proposal.deadline) {
      const timeUntilDeadline = proposal.deadline.getTime() - Date.now();
      setTimeout(async () => {
        await this.handleVotingDeadline(proposal.id);
      }, timeUntilDeadline);
    }
  }
  /**
   * Validate a vote
   */
  validateVote(vote, proposal) {
    if (proposal.deadline && /* @__PURE__ */ new Date() > proposal.deadline) {
      return false;
    }
    if (typeof vote.vote !== "boolean") {
      return false;
    }
    return true;
  }
  /**
   * Check if consensus has been achieved
   */
  async checkConsensus(proposal) {
    const status = await this.getProposalStatus(proposal.id);
    const result = {
      proposalId: proposal.id,
      achieved: false,
      finalRatio: status.currentRatio,
      totalVotes: status.currentVotes,
      positiveVotes: Math.round(status.currentVotes * status.currentRatio),
      negativeVotes: status.currentVotes - Math.round(status.currentVotes * status.currentRatio),
      participationRate: status.totalVoters > 0 ? status.currentVotes / status.totalVoters : 0
    };
    if (status.currentRatio >= proposal.requiredThreshold) {
      result.achieved = true;
      await this.handleConsensusAchieved(proposal, result);
    } else if (status.currentVotes === status.totalVoters) {
      await this.handleConsensusFailed(proposal, result);
    }
    return result;
  }
  /**
   * Handle consensus achieved
   */
  async handleConsensusAchieved(proposal, result) {
    await this.db.updateConsensusStatus(proposal.id, "achieved");
    this.activeProposals.delete(proposal.id);
    this.metrics.achievedConsensus++;
    this.updateAverageMetrics(result);
    await this.broadcastConsensusResult(proposal, result, true);
    if (proposal.taskId) {
      await this.executeConsensusDecision(proposal, result);
    }
    this.emit("consensusAchieved", { proposal, result });
  }
  /**
   * Handle consensus failed
   */
  async handleConsensusFailed(proposal, result) {
    await this.db.updateConsensusStatus(proposal.id, "failed");
    this.activeProposals.delete(proposal.id);
    this.metrics.failedConsensus++;
    this.updateAverageMetrics(result);
    await this.broadcastConsensusResult(proposal, result, false);
    this.emit("consensusFailed", { proposal, result });
  }
  /**
   * Handle voting deadline
   */
  async handleVotingDeadline(proposalId) {
    const proposal = this.activeProposals.get(proposalId);
    if (!proposal)
      return;
    const result = await this.checkConsensus(proposal);
    if (!result.achieved) {
      await this.handleConsensusFailed(proposal, result);
    }
  }
  /**
   * Select voting strategy
   */
  selectVotingStrategy(proposal, agentType) {
    if (proposal.requiredThreshold >= 1) {
      return this.votingStrategies.get("unanimous");
    } else if (proposal.requiredThreshold >= 0.66) {
      return this.votingStrategies.get("supermajority");
    } else {
      return this.votingStrategies.get("simple_majority");
    }
  }
  /**
   * Update average metrics
   */
  updateAverageMetrics(result) {
    const totalDecisions = this.metrics.achievedConsensus + this.metrics.failedConsensus;
    this.metrics.avgParticipation = (this.metrics.avgParticipation * (totalDecisions - 1) + result.participationRate) / totalDecisions;
  }
  /**
   * Broadcast consensus result
   */
  async broadcastConsensusResult(proposal, result, achieved) {
    await this.db.createCommunication({
      from_agent_id: "consensus-engine",
      to_agent_id: null,
      // broadcast
      swarm_id: proposal.swarmId,
      message_type: "consensus",
      content: JSON.stringify({
        type: "consensus_result",
        proposal,
        result,
        achieved
      }),
      priority: "high"
    });
  }
  /**
   * Execute consensus decision
   */
  async executeConsensusDecision(proposal, result) {
    if (!proposal.taskId)
      return;
    const decision = proposal.proposal;
    if (decision.action === "approve_task") {
      await this.db.updateTaskStatus(proposal.taskId, "approved");
    } else if (decision.action === "modify_task") {
      await this.db.updateTask(proposal.taskId, decision.modifications);
    } else if (decision.action === "cancel_task") {
      await this.db.updateTaskStatus(proposal.taskId, "cancelled");
    }
    this.emit("consensusExecuted", { proposal, result, taskId: proposal.taskId });
  }
  /**
   * Start proposal monitor
   */
  startProposalMonitor() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      try {
        for (const proposal of this.activeProposals.values()) {
          await this.checkConsensus(proposal);
        }
      } catch (error) {
        this.emit("error", error);
      }
    }, 5e3);
  }
  /**
   * Start timeout checker
   */
  startTimeoutChecker() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      try {
        const now = Date.now();
        for (const proposal of this.activeProposals.values()) {
          if (proposal.deadline && proposal.deadline.getTime() < now) {
            await this.handleVotingDeadline(proposal.id);
          }
        }
      } catch (error) {
        this.emit("error", error);
      }
    }, 1e3);
  }
  /**
   * Start metrics collector
   */
  startMetricsCollector() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      try {
        const recentProposals = await this.db.getRecentConsensusProposals(10);
        if (recentProposals.length > 0) {
          const votingTimes = recentProposals.filter((p) => p.completed_at).map((p) => new Date(p.completed_at).getTime() - new Date(p.created_at).getTime());
          if (votingTimes.length > 0) {
            this.metrics.avgVotingTime = votingTimes.reduce((a, b) => a + b, 0) / votingTimes.length;
          }
        }
        await this.storeMetrics();
      } catch (error) {
        this.emit("error", error);
      }
    }, 6e4);
  }
  /**
   * Store consensus metrics
   */
  async storeMetrics() {
    await this.mcpWrapper.storeMemory({
      action: "store",
      key: "consensus-metrics",
      value: JSON.stringify(this.metrics),
      namespace: "performance-metrics",
      ttl: 86400 * 30
      // 30 days
    });
  }
  /**
   * Database helper methods (to be implemented in DatabaseManager)
   */
  async getConsensusProposal(id) {
    return this.db.prepare("SELECT * FROM consensus WHERE id = ?").get(id);
  }
  async updateConsensusStatus(id, status) {
    this.db.prepare("UPDATE consensus SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  }
  async getRecentConsensusProposals(limit) {
    return this.db.prepare("SELECT * FROM consensus ORDER BY created_at DESC LIMIT ?").all(limit);
  }
  /**
   * Shutdown consensus engine
   */
  async shutdown() {
    this.isActive = false;
    this.activeProposals.clear();
    this.emit("shutdown");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConsensusEngine
});
//# sourceMappingURL=ConsensusEngine.js.map
