import { EventEmitter } from 'events';
import {
  Proposal,
  Vote,
  VotingPower,
  GovernanceConfig,
  GovernanceError,
  ProposalSchema,
  VoteSchema
} from '../types/index.js';
import { getConfig } from '../config/index.js';

export interface GovernanceEvents {
  'proposal:created': [Proposal];
  'proposal:voted': [string, Vote];
  'proposal:executed': [string];
  'proposal:rejected': [string];
  'voting:started': [string];
  'voting:ended': [string];
}

export class GovernanceSystem extends EventEmitter {
  private config: GovernanceConfig;
  private proposals = new Map<string, Proposal>();
  private votingPowers = new Map<string, VotingPower>();
  private activeVotes = new Map<string, Map<string, Vote>>();

  constructor(config?: Partial<GovernanceConfig>) {
    super();
    this.config = { ...getConfig().governance, ...config };
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('proposal:created', (proposal) => {
      console.log(`Proposal created: ${proposal.title} (${proposal.id})`);
      this.scheduleVotingEnd(proposal.id, proposal.votingEndsAt);
    });

    this.on('voting:ended', (proposalId) => {
      this.processVotingResults(proposalId);
    });
  }

  /**
   * Create a new proposal
   */
  async createProposal(
    title: string,
    description: string,
    proposer: string,
    type: 'workflow' | 'config' | 'governance',
    executionData?: any
  ): Promise<string> {
    // Validate proposer has sufficient voting power
    const proposerPower = this.getVotingPower(proposer);
    if (proposerPower < this.config.proposalThreshold) {
      throw new GovernanceError(
        `Insufficient voting power to create proposal. Required: ${this.config.proposalThreshold}, Current: ${proposerPower}`
      );
    }

    // Validate proposal data
    const proposalData = {
      id: this.generateProposalId(),
      title,
      description,
      proposer,
      type,
      executionData
    };

    try {
      ProposalSchema.parse(proposalData);
    } catch (error) {
      throw new GovernanceError('Invalid proposal data', { validationError: error });
    }

    const proposal: Proposal = {
      ...proposalData,
      status: 'active',
      votes: [],
      createdAt: new Date(),
      votingEndsAt: new Date(Date.now() + this.config.votingPeriod)
    };

    this.proposals.set(proposal.id, proposal);
    this.activeVotes.set(proposal.id, new Map());

    this.emit('proposal:created', proposal);
    this.emit('voting:started', proposal.id);

    return proposal.id;
  }

  /**
   * Cast a vote on a proposal
   */
  async vote(
    proposalId: string,
    voter: string,
    choice: 'for' | 'against' | 'abstain',
    reason?: string
  ): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new GovernanceError(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== 'active') {
      throw new GovernanceError(`Proposal is not active: ${proposalId}`);
    }

    if (new Date() > proposal.votingEndsAt) {
      throw new GovernanceError(`Voting period has ended for proposal: ${proposalId}`);
    }

    const voterPower = this.getVotingPower(voter);
    if (voterPower <= 0) {
      throw new GovernanceError(`Voter has no voting power: ${voter}`);
    }

    // Check if voter has already voted
    const proposalVotes = this.activeVotes.get(proposalId);
    if (proposalVotes?.has(voter)) {
      throw new GovernanceError(`Voter has already voted on this proposal: ${voter}`);
    }

    const vote: Vote = {
      voter,
      choice,
      weight: voterPower,
      timestamp: new Date(),
      reason
    };

    try {
      VoteSchema.parse(vote);
    } catch (error) {
      throw new GovernanceError('Invalid vote data', { validationError: error });
    }

    // Record the vote
    proposalVotes?.set(voter, vote);
    proposal.votes.push(vote);

    this.emit('proposal:voted', proposalId, vote);
  }

  /**
   * Execute a passed proposal
   */
  async executeProposal(proposalId: string): Promise<any> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new GovernanceError(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== 'passed') {
      throw new GovernanceError(`Proposal is not in passed state: ${proposalId}`);
    }

    // Check execution delay
    const canExecuteAt = new Date(proposal.votingEndsAt.getTime() + this.config.executionDelay);
    if (new Date() < canExecuteAt) {
      throw new GovernanceError(
        `Proposal cannot be executed yet. Available at: ${canExecuteAt.toISOString()}`
      );
    }

    try {
      const result = await this.executeProposalAction(proposal);
      proposal.status = 'executed';

      this.emit('proposal:executed', proposalId);
      return result;
    } catch (error) {
      throw new GovernanceError(`Failed to execute proposal: ${error.message}`, {
        proposalId,
        error: error.message
      });
    }
  }

  /**
   * Set voting power for an address
   */
  setVotingPower(address: string, power: number): void {
    if (power < 0) {
      throw new GovernanceError('Voting power cannot be negative');
    }

    this.votingPowers.set(address, {
      address,
      power,
      lastUpdated: new Date()
    });
  }

  /**
   * Get voting power for an address
   */
  getVotingPower(address: string): number {
    return this.votingPowers.get(address)?.power || 0;
  }

  /**
   * Get proposal by ID
   */
  getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Get all proposals with optional filtering
   */
  getProposals(filter?: {
    status?: Proposal['status'];
    type?: Proposal['type'];
    proposer?: string;
  }): Proposal[] {
    let proposals = Array.from(this.proposals.values());

    if (filter) {
      if (filter.status) {
        proposals = proposals.filter(p => p.status === filter.status);
      }
      if (filter.type) {
        proposals = proposals.filter(p => p.type === filter.type);
      }
      if (filter.proposer) {
        proposals = proposals.filter(p => p.proposer === filter.proposer);
      }
    }

    return proposals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get voting results for a proposal
   */
  getVotingResults(proposalId: string): {
    total: number;
    for: number;
    against: number;
    abstain: number;
    quorum: number;
    passed: boolean;
  } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new GovernanceError(`Proposal not found: ${proposalId}`);
    }

    const total = proposal.votes.reduce((sum, vote) => sum + vote.weight, 0);
    const for_ = proposal.votes
      .filter(vote => vote.choice === 'for')
      .reduce((sum, vote) => sum + vote.weight, 0);
    const against = proposal.votes
      .filter(vote => vote.choice === 'against')
      .reduce((sum, vote) => sum + vote.weight, 0);
    const abstain = proposal.votes
      .filter(vote => vote.choice === 'abstain')
      .reduce((sum, vote) => sum + vote.weight, 0);

    const totalVotingPower = Array.from(this.votingPowers.values())
      .reduce((sum, vp) => sum + vp.power, 0);

    const quorum = totalVotingPower > 0 ? total / totalVotingPower : 0;
    const passed = quorum >= this.config.quorumThreshold && for_ > against;

    return { total, for: for_, against, abstain, quorum, passed };
  }

  /**
   * Process voting results when voting period ends
   */
  private async processVotingResults(proposalId: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'active') {
      return;
    }

    const results = this.getVotingResults(proposalId);

    if (results.passed) {
      proposal.status = 'passed';
      console.log(`Proposal passed: ${proposalId}`);
    } else {
      proposal.status = 'rejected';
      this.emit('proposal:rejected', proposalId);
      console.log(`Proposal rejected: ${proposalId}`);
    }
  }

  /**
   * Execute the actual proposal action
   */
  private async executeProposalAction(proposal: Proposal): Promise<any> {
    switch (proposal.type) {
      case 'workflow':
        return this.executeWorkflowProposal(proposal);
      case 'config':
        return this.executeConfigProposal(proposal);
      case 'governance':
        return this.executeGovernanceProposal(proposal);
      default:
        throw new Error(`Unknown proposal type: ${proposal.type}`);
    }
  }

  private async executeWorkflowProposal(proposal: Proposal): Promise<any> {
    // Implement workflow execution logic
    console.log(`Executing workflow proposal: ${proposal.id}`);
    return { executed: true, type: 'workflow', proposalId: proposal.id };
  }

  private async executeConfigProposal(proposal: Proposal): Promise<any> {
    // Implement configuration change logic
    console.log(`Executing config proposal: ${proposal.id}`);
    return { executed: true, type: 'config', proposalId: proposal.id };
  }

  private async executeGovernanceProposal(proposal: Proposal): Promise<any> {
    // Implement governance change logic
    console.log(`Executing governance proposal: ${proposal.id}`);
    return { executed: true, type: 'governance', proposalId: proposal.id };
  }

  /**
   * Schedule voting end processing
   */
  private scheduleVotingEnd(proposalId: string, endTime: Date): void {
    const delay = endTime.getTime() - Date.now();
    if (delay > 0) {
      setTimeout(() => {
        this.emit('voting:ended', proposalId);
      }, delay);
    } else {
      // Voting period already ended
      this.emit('voting:ended', proposalId);
    }
  }

  /**
   * Generate unique proposal ID
   */
  private generateProposalId(): string {
    return `prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get governance statistics
   */
  getGovernanceStats(): {
    totalProposals: number;
    activeProposals: number;
    passedProposals: number;
    rejectedProposals: number;
    totalVotingPower: number;
    totalVoters: number;
  } {
    const proposals = Array.from(this.proposals.values());
    const totalVotingPower = Array.from(this.votingPowers.values())
      .reduce((sum, vp) => sum + vp.power, 0);

    return {
      totalProposals: proposals.length,
      activeProposals: proposals.filter(p => p.status === 'active').length,
      passedProposals: proposals.filter(p => p.status === 'passed').length,
      rejectedProposals: proposals.filter(p => p.status === 'rejected').length,
      totalVotingPower,
      totalVoters: this.votingPowers.size
    };
  }

  // Enhanced governance methods

  /**
   * Create a delegation
   */
  async createDelegation(
    delegator: string,
    delegate: string,
    power: number,
    scope: 'all' | 'category' | 'specific' = 'all',
    restrictions?: string[],
    expiresAt?: Date
  ): Promise<string> {
    if (!this.config.delegationEnabled) {
      throw new GovernanceError('Delegation is disabled');
    }

    return this.delegationManager.createDelegation(
      delegator,
      delegate,
      power,
      scope,
      restrictions,
      expiresAt
    );
  }

  /**
   * Revoke a delegation
   */
  async revokeDelegation(delegator: string, delegate: string): Promise<void> {
    return this.delegationManager.revokeDelegation(delegator, delegate);
  }

  /**
   * Add a multi-signature for a proposal
   */
  async addMultiSigSignature(
    proposalId: string,
    signer: string,
    signature: string
  ): Promise<void> {
    return this.multiSigManager.addSignature(proposalId, signer, signature);
  }

  /**
   * Add a governance role
   */
  addRole(role: GovernanceRole): void {
    this.roles.set(role.id, role);
  }

  /**
   * Assign a role to a user
   */
  assignRole(address: string, roleId: string): void {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new GovernanceError(`Role not found: ${roleId}`);
    }

    if (!this.userRoles.has(address)) {
      this.userRoles.set(address, []);
    }

    const userRoles = this.userRoles.get(address)!;
    if (!userRoles.includes(roleId)) {
      userRoles.push(roleId);
      this.emit('role:assigned', address, roleId, role);
    }
  }

  /**
   * Get user roles
   */
  getUserRoles(address: string): GovernanceRole[] {
    const roleIds = this.userRoles.get(address) || [];
    return roleIds.map(id => this.roles.get(id)!).filter(Boolean);
  }

  /**
   * Check if user can propose
   */
  private canUserPropose(address: string): boolean {
    const roles = this.getUserRoles(address);
    return roles.some(role => role.canPropose) || roles.length === 0; // Default allow if no roles
  }

  /**
   * Check if user can execute
   */
  private canUserExecute(address: string): boolean {
    const roles = this.getUserRoles(address);
    return roles.some(role => role.canExecute) || roles.length === 0; // Default allow if no roles
  }

  /**
   * Get user role multiplier
   */
  private getUserRoleMultiplier(address: string): number {
    const roles = this.getUserRoles(address);
    if (roles.length === 0) return 1.0;

    // Use the highest multiplier
    return Math.max(...roles.map(role => role.votingPowerMultiplier));
  }

  /**
   * Get MCP integration instance
   */
  getMCPIntegration(): MCPGovernanceIntegration {
    return this.mcpIntegration;
  }

  /**
   * Get delegation manager instance
   */
  getDelegationManager(): DelegationManager {
    return this.delegationManager;
  }

  /**
   * Get consensus engine instance
   */
  getConsensusEngine(): ConsensusEngine {
    return this.consensusEngine;
  }

  /**
   * Get multi-sig manager instance
   */
  getMultiSigManager(): MultiSigManager {
    return this.multiSigManager;
  }

  /**
   * Clean up expired proposals and delegations
   */
  cleanup(): {
    expiredProposals: number;
    expiredDelegations: number;
    expiredSignatures: number;
  } {
    let expiredProposals = 0;
    const now = new Date();

    // Clean up expired proposals
    for (const [id, proposal] of this.proposals.entries()) {
      if (proposal.status === 'active' && now > proposal.votingEndsAt) {
        proposal.status = 'expired';
        expiredProposals++;
        this.emit('proposal:expired', id);
      }
    }

    // Clean up expired delegations
    const expiredDelegations = this.delegationManager.cleanupExpiredDelegations();

    // Clean up expired signatures
    const expiredSignatures = this.multiSigManager.cleanupExpiredSignatures();

    return {
      expiredProposals,
      expiredDelegations,
      expiredSignatures
    };
  }

  /**
   * Get detailed proposal information
   */
  getProposalDetails(proposalId: string): {
    proposal: Proposal;
    votingResults: any;
    delegationChains: Record<string, string[]>;
    multiSigStatus?: any;
    consensusEvaluation?: any;
  } {
    const proposal = this.getProposal(proposalId);
    if (!proposal) {
      throw new GovernanceError(`Proposal not found: ${proposalId}`);
    }

    const votingResults = this.getVotingResults(proposalId);

    // Get delegation chains for all voters
    const delegationChains: Record<string, string[]> = {};
    for (const vote of proposal.votes) {
      delegationChains[vote.voter] = this.delegationManager.getDelegationChain(vote.voter);
    }

    const details: any = {
      proposal,
      votingResults,
      delegationChains
    };

    // Add multi-sig status if applicable
    try {
      details.multiSigStatus = this.multiSigManager.getSignatureStatus(proposalId);
    } catch (error) {
      // Multi-sig not required
    }

    // Add consensus evaluation
    if (votingResults.consensusResult) {
      details.consensusEvaluation = votingResults.consensusResult;
    }

    return details;
  }
}

export default GovernanceSystem;