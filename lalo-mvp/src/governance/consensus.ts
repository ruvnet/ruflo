import { EventEmitter } from 'events';
import {
  Proposal,
  Vote,
  ConsensusRule,
  ConsensusError,
  GovernanceConfig
} from '../types/index.js';

export interface ConsensusEvents {
  'consensus:reached': [string, ConsensusResult];
  'consensus:failed': [string, string]; // proposalId, reason
  'rule:applied': [string, ConsensusRule];
  'threshold:changed': [string, number, number]; // ruleId, oldThreshold, newThreshold
}

export interface ConsensusResult {
  proposalId: string;
  ruleApplied: ConsensusRule;
  result: 'passed' | 'rejected';
  votingResults: VotingResults;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface VotingResults {
  total: number;
  for: number;
  against: number;
  abstain: number;
  quorum: number;
  participation: number;
  weightedFor: number;
  weightedAgainst: number;
  weightedAbstain: number;
}

export class ConsensusEngine extends EventEmitter {
  private rules = new Map<string, ConsensusRule>();
  private config: GovernanceConfig;

  constructor(config: GovernanceConfig) {
    super();
    this.config = config;
    this.initializeDefaultRules();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('consensus:reached', (proposalId, result) => {
      console.log(`Consensus reached for proposal ${proposalId}: ${result.result}`);
    });

    this.on('consensus:failed', (proposalId, reason) => {
      console.log(`Consensus failed for proposal ${proposalId}: ${reason}`);
    });
  }

  /**
   * Initialize default consensus rules
   */
  private initializeDefaultRules(): void {
    // Standard majority rule
    this.addRule({
      id: 'standard-majority',
      name: 'Standard Majority',
      type: 'majority',
      threshold: 0.5,
      applicableTypes: ['workflow', 'config'],
      applicableCategories: ['standard']
    });

    // Supermajority for critical proposals
    this.addRule({
      id: 'critical-supermajority',
      name: 'Critical Supermajority',
      type: 'supermajority',
      threshold: this.config.supermajorityThreshold,
      applicableTypes: ['governance', 'emergency', 'upgrade'],
      applicableCategories: ['critical', 'constitutional']
    });

    // Quorum-based rule
    this.addRule({
      id: 'quorum-based',
      name: 'Quorum-Based Decision',
      type: 'quorum',
      threshold: this.config.quorumThreshold,
      applicableTypes: ['workflow', 'config', 'governance'],
      applicableCategories: ['standard', 'critical']
    });

    // Weighted voting rule
    this.addRule({
      id: 'weighted-consensus',
      name: 'Weighted Consensus',
      type: 'weighted',
      threshold: 0.6,
      applicableTypes: ['governance'],
      applicableCategories: ['constitutional'],
      conditions: { requireStakeholderApproval: true }
    });

    // Unanimous rule for emergency proposals
    this.addRule({
      id: 'emergency-unanimous',
      name: 'Emergency Unanimous',
      type: 'unanimous',
      threshold: 1.0,
      applicableTypes: ['emergency'],
      applicableCategories: ['critical'],
      requiredRoles: ['admin', 'security']
    });
  }

  /**
   * Add a new consensus rule
   */
  addRule(rule: ConsensusRule): void {
    if (this.rules.has(rule.id)) {
      throw new ConsensusError(`Rule with ID ${rule.id} already exists`);
    }

    this.validateRule(rule);
    this.rules.set(rule.id, rule);
  }

  /**
   * Update an existing consensus rule
   */
  updateRule(ruleId: string, updates: Partial<ConsensusRule>): void {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new ConsensusError(`Rule with ID ${ruleId} not found`);
    }

    const updatedRule = { ...rule, ...updates };
    this.validateRule(updatedRule);

    if (updates.threshold !== undefined && updates.threshold !== rule.threshold) {
      this.emit('threshold:changed', ruleId, rule.threshold, updates.threshold);
    }

    this.rules.set(ruleId, updatedRule);
  }

  /**
   * Remove a consensus rule
   */
  removeRule(ruleId: string): void {
    if (!this.rules.has(ruleId)) {
      throw new ConsensusError(`Rule with ID ${ruleId} not found`);
    }

    this.rules.delete(ruleId);
  }

  /**
   * Evaluate consensus for a proposal
   */
  evaluateConsensus(
    proposal: Proposal,
    totalVotingPower: number,
    userRoles: Map<string, string[]> = new Map()
  ): ConsensusResult {
    // Find applicable rules
    const applicableRules = this.getApplicableRules(proposal);

    if (applicableRules.length === 0) {
      throw new ConsensusError(`No applicable consensus rules found for proposal ${proposal.id}`);
    }

    // Calculate voting results
    const votingResults = this.calculateVotingResults(proposal, totalVotingPower);

    // Evaluate each applicable rule
    for (const rule of applicableRules) {
      const result = this.evaluateRule(rule, votingResults, proposal, userRoles);

      if (result) {
        const consensusResult: ConsensusResult = {
          proposalId: proposal.id,
          ruleApplied: rule,
          result: result.passed ? 'passed' : 'rejected',
          votingResults,
          timestamp: new Date(),
          metadata: result.metadata
        };

        this.emit('consensus:reached', proposal.id, consensusResult);
        this.emit('rule:applied', proposal.id, rule);

        return consensusResult;
      }
    }

    // No rule passed
    this.emit('consensus:failed', proposal.id, 'No consensus rule satisfied');
    throw new ConsensusError(`No consensus achieved for proposal ${proposal.id}`);
  }

  /**
   * Get applicable rules for a proposal
   */
  private getApplicableRules(proposal: Proposal): ConsensusRule[] {
    return Array.from(this.rules.values())
      .filter(rule =>
        rule.applicableTypes.includes(proposal.type) &&
        rule.applicableCategories.includes(proposal.category)
      )
      .sort((a, b) => b.threshold - a.threshold); // Higher thresholds first
  }

  /**
   * Calculate detailed voting results
   */
  private calculateVotingResults(proposal: Proposal, totalVotingPower: number): VotingResults {
    const votes = proposal.votes;

    const for_ = votes.filter(v => v.choice === 'for').reduce((sum, v) => sum + v.weight, 0);
    const against = votes.filter(v => v.choice === 'against').reduce((sum, v) => sum + v.weight, 0);
    const abstain = votes.filter(v => v.choice === 'abstain').reduce((sum, v) => sum + v.weight, 0);

    const total = for_ + against + abstain;
    const participation = totalVotingPower > 0 ? total / totalVotingPower : 0;
    const quorum = participation;

    return {
      total,
      for: votes.filter(v => v.choice === 'for').length,
      against: votes.filter(v => v.choice === 'against').length,
      abstain: votes.filter(v => v.choice === 'abstain').length,
      quorum,
      participation,
      weightedFor: for_,
      weightedAgainst: against,
      weightedAbstain: abstain
    };
  }

  /**
   * Evaluate a specific consensus rule
   */
  private evaluateRule(
    rule: ConsensusRule,
    results: VotingResults,
    proposal: Proposal,
    userRoles: Map<string, string[]>
  ): { passed: boolean; metadata?: Record<string, any> } | null {
    // Check required roles if specified
    if (rule.requiredRoles && rule.requiredRoles.length > 0) {
      const hasRequiredRole = proposal.votes.some(vote => {
        const roles = userRoles.get(vote.voter) || [];
        return rule.requiredRoles!.some(role => roles.includes(role));
      });

      if (!hasRequiredRole) {
        return { passed: false, metadata: { reason: 'Missing required role approval' } };
      }
    }

    // Check conditions
    if (rule.conditions) {
      const conditionsMetadata = this.evaluateConditions(rule.conditions, proposal, results);
      if (!conditionsMetadata.passed) {
        return { passed: false, metadata: conditionsMetadata };
      }
    }

    // Evaluate based on rule type
    switch (rule.type) {
      case 'majority':
        return this.evaluateMajority(rule, results);

      case 'supermajority':
        return this.evaluateSupermajority(rule, results);

      case 'unanimous':
        return this.evaluateUnanimous(rule, results);

      case 'quorum':
        return this.evaluateQuorum(rule, results);

      case 'weighted':
        return this.evaluateWeighted(rule, results);

      default:
        throw new ConsensusError(`Unknown consensus rule type: ${rule.type}`);
    }
  }

  /**
   * Evaluate majority rule
   */
  private evaluateMajority(rule: ConsensusRule, results: VotingResults): { passed: boolean; metadata?: Record<string, any> } {
    const totalDecisiveVotes = results.weightedFor + results.weightedAgainst;
    const forRatio = totalDecisiveVotes > 0 ? results.weightedFor / totalDecisiveVotes : 0;

    const passed = forRatio > rule.threshold && results.quorum >= this.config.quorumThreshold;

    return {
      passed,
      metadata: {
        forRatio,
        requiredThreshold: rule.threshold,
        quorumMet: results.quorum >= this.config.quorumThreshold
      }
    };
  }

  /**
   * Evaluate supermajority rule
   */
  private evaluateSupermajority(rule: ConsensusRule, results: VotingResults): { passed: boolean; metadata?: Record<string, any> } {
    const totalVotes = results.total;
    const forRatio = totalVotes > 0 ? results.weightedFor / results.total : 0;

    const passed = forRatio >= rule.threshold && results.quorum >= this.config.quorumThreshold;

    return {
      passed,
      metadata: {
        forRatio,
        requiredThreshold: rule.threshold,
        supermajorityMet: forRatio >= rule.threshold,
        quorumMet: results.quorum >= this.config.quorumThreshold
      }
    };
  }

  /**
   * Evaluate unanimous rule
   */
  private evaluateUnanimous(rule: ConsensusRule, results: VotingResults): { passed: boolean; metadata?: Record<string, any> } {
    const passed = results.weightedAgainst === 0 && results.weightedFor > 0 && results.quorum >= this.config.quorumThreshold;

    return {
      passed,
      metadata: {
        unanimousFor: results.weightedAgainst === 0,
        hasForVotes: results.weightedFor > 0,
        quorumMet: results.quorum >= this.config.quorumThreshold
      }
    };
  }

  /**
   * Evaluate quorum rule
   */
  private evaluateQuorum(rule: ConsensusRule, results: VotingResults): { passed: boolean; metadata?: Record<string, any> } {
    const quorumMet = results.quorum >= rule.threshold;
    const majorityFor = results.weightedFor > results.weightedAgainst;

    const passed = quorumMet && majorityFor;

    return {
      passed,
      metadata: {
        quorumMet,
        majorityFor,
        quorumRatio: results.quorum,
        requiredQuorum: rule.threshold
      }
    };
  }

  /**
   * Evaluate weighted rule
   */
  private evaluateWeighted(rule: ConsensusRule, results: VotingResults): { passed: boolean; metadata?: Record<string, any> } {
    const weightedScore = (results.weightedFor * 1.0) + (results.weightedAbstain * 0.5) + (results.weightedAgainst * 0.0);
    const maxPossibleScore = results.total;
    const weightedRatio = maxPossibleScore > 0 ? weightedScore / maxPossibleScore : 0;

    const passed = weightedRatio >= rule.threshold && results.quorum >= this.config.quorumThreshold;

    return {
      passed,
      metadata: {
        weightedRatio,
        requiredThreshold: rule.threshold,
        weightedScore,
        maxPossibleScore,
        quorumMet: results.quorum >= this.config.quorumThreshold
      }
    };
  }

  /**
   * Evaluate additional conditions
   */
  private evaluateConditions(
    conditions: Record<string, any>,
    proposal: Proposal,
    results: VotingResults
  ): { passed: boolean; [key: string]: any } {
    const metadata: Record<string, any> = { passed: true };

    if (conditions.requireStakeholderApproval) {
      // Check if stakeholders have voted
      const stakeholderVotes = proposal.votes.filter(vote =>
        proposal.requiredApprovals.includes(vote.voter) && vote.choice === 'for'
      );

      const stakeholderApproval = stakeholderVotes.length >= (proposal.requiredApprovals.length * 0.5);
      metadata.stakeholderApproval = stakeholderApproval;

      if (!stakeholderApproval) {
        metadata.passed = false;
        metadata.reason = 'Insufficient stakeholder approval';
      }
    }

    if (conditions.minimumParticipation) {
      const participationMet = results.participation >= conditions.minimumParticipation;
      metadata.participationMet = participationMet;

      if (!participationMet) {
        metadata.passed = false;
        metadata.reason = 'Minimum participation not met';
      }
    }

    return metadata;
  }

  /**
   * Validate a consensus rule
   */
  private validateRule(rule: ConsensusRule): void {
    if (rule.threshold < 0 || rule.threshold > 1) {
      throw new ConsensusError(`Invalid threshold: ${rule.threshold}. Must be between 0 and 1`);
    }

    if (rule.applicableTypes.length === 0) {
      throw new ConsensusError('Rule must apply to at least one proposal type');
    }

    if (rule.applicableCategories.length === 0) {
      throw new ConsensusError('Rule must apply to at least one proposal category');
    }

    const validTypes = ['majority', 'supermajority', 'unanimous', 'quorum', 'weighted'];
    if (!validTypes.includes(rule.type)) {
      throw new ConsensusError(`Invalid rule type: ${rule.type}`);
    }
  }

  /**
   * Get all consensus rules
   */
  getRules(): ConsensusRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule by ID
   */
  getRule(ruleId: string): ConsensusRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * Get consensus statistics
   */
  getConsensusStats(): {
    totalRules: number;
    rulesByType: Record<string, number>;
    avgThreshold: number;
  } {
    const rules = Array.from(this.rules.values());
    const rulesByType: Record<string, number> = {};
    let totalThreshold = 0;

    for (const rule of rules) {
      rulesByType[rule.type] = (rulesByType[rule.type] || 0) + 1;
      totalThreshold += rule.threshold;
    }

    return {
      totalRules: rules.length,
      rulesByType,
      avgThreshold: rules.length > 0 ? totalThreshold / rules.length : 0
    };
  }
}

export default ConsensusEngine;