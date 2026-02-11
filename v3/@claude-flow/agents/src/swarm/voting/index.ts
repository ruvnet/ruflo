/**
 * V3 Voting Engine Factory
 * Unified interface for agent voting algorithms (Raft, Byzantine, Gossip)
 * These are in-process agent agreement mechanisms, not distributed consensus.
 */

import { EventEmitter } from 'events';
import {
  VotingAlgorithm,
  VotingConfig,
  VotingProposal,
  VotingBallot,
  VotingResult,
  IVotingEngine,
  SWARM_CONSTANTS,
} from '../types.js';
import { RaftVoting, createRaftVoting, RaftConfig } from './raft.js';
import { ByzantineVoting, createByzantineVoting, ByzantineConfig } from './byzantine.js';
import { GossipVoting, createGossipVoting, GossipConfig } from './gossip.js';

export { RaftVoting, ByzantineVoting, GossipVoting };
export type { RaftConfig, ByzantineConfig, GossipConfig };

type VotingImplementation = RaftVoting | ByzantineVoting | GossipVoting;

export class VotingEngine extends EventEmitter implements IVotingEngine {
  private config: VotingConfig;
  private nodeId: string;
  private implementation?: VotingImplementation;
  private proposals: Map<string, VotingProposal> = new Map();

  constructor(nodeId: string, config: Partial<VotingConfig> = {}) {
    super();
    this.nodeId = nodeId;
    this.config = {
      algorithm: config.algorithm ?? 'raft',
      threshold: config.threshold ?? SWARM_CONSTANTS.DEFAULT_VOTING_THRESHOLD,
      timeoutMs: config.timeoutMs ?? SWARM_CONSTANTS.DEFAULT_VOTING_TIMEOUT_MS,
      maxRounds: config.maxRounds ?? 10,
      requireQuorum: config.requireQuorum ?? true,
    };
  }

  async initialize(config?: VotingConfig): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Create implementation based on algorithm
    switch (this.config.algorithm) {
      case 'raft':
        this.implementation = createRaftVoting(this.nodeId, {
          threshold: this.config.threshold,
          timeoutMs: this.config.timeoutMs,
          maxRounds: this.config.maxRounds,
          requireQuorum: this.config.requireQuorum,
        });
        break;

      case 'byzantine':
        this.implementation = createByzantineVoting(this.nodeId, {
          threshold: this.config.threshold,
          timeoutMs: this.config.timeoutMs,
          maxRounds: this.config.maxRounds,
          requireQuorum: this.config.requireQuorum,
        });
        break;

      case 'gossip':
        this.implementation = createGossipVoting(this.nodeId, {
          threshold: this.config.threshold,
          timeoutMs: this.config.timeoutMs,
          maxRounds: this.config.maxRounds,
          requireQuorum: this.config.requireQuorum,
        });
        break;

      case 'paxos':
        // Fall back to Raft for Paxos (similar guarantees)
        this.implementation = createRaftVoting(this.nodeId, {
          threshold: this.config.threshold,
          timeoutMs: this.config.timeoutMs,
          maxRounds: this.config.maxRounds,
          requireQuorum: this.config.requireQuorum,
        });
        break;

      default:
        throw new Error(`Unknown voting algorithm: ${this.config.algorithm}`);
    }

    await this.implementation.initialize();

    // Forward events
    this.implementation.on('voting.achieved', (data) => {
      this.emit('voting.achieved', data);
    });

    this.implementation.on('leader.elected', (data) => {
      this.emit('leader.elected', data);
    });

    this.emit('initialized', {
      nodeId: this.nodeId,
      algorithm: this.config.algorithm
    });
  }

  async shutdown(): Promise<void> {
    if (this.implementation) {
      await this.implementation.shutdown();
    }
    this.emit('shutdown');
  }

  addNode(nodeId: string, options?: { isPrimary?: boolean }): void {
    if (!this.implementation) {
      throw new Error('Voting engine not initialized');
    }

    if (this.implementation instanceof RaftVoting) {
      this.implementation.addPeer(nodeId);
    } else if (this.implementation instanceof ByzantineVoting) {
      this.implementation.addNode(nodeId, options?.isPrimary);
    } else if (this.implementation instanceof GossipVoting) {
      this.implementation.addNode(nodeId);
    }
  }

  removeNode(nodeId: string): void {
    if (!this.implementation) {
      return;
    }

    if (this.implementation instanceof RaftVoting) {
      this.implementation.removePeer(nodeId);
    } else if (this.implementation instanceof ByzantineVoting) {
      this.implementation.removeNode(nodeId);
    } else if (this.implementation instanceof GossipVoting) {
      this.implementation.removeNode(nodeId);
    }
  }

  async propose(value: unknown, proposerId?: string): Promise<VotingProposal> {
    if (!this.implementation) {
      throw new Error('Voting engine not initialized');
    }

    const proposal = await this.implementation.propose(value);
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async vote(proposalId: string, vote: VotingBallot): Promise<void> {
    if (!this.implementation) {
      throw new Error('Voting engine not initialized');
    }

    await this.implementation.vote(proposalId, vote);
  }

  getProposal(proposalId: string): VotingProposal | undefined {
    return this.proposals.get(proposalId);
  }

  async awaitVoting(proposalId: string): Promise<VotingResult> {
    if (!this.implementation) {
      throw new Error('Voting engine not initialized');
    }

    return this.implementation.awaitVoting(proposalId);
  }

  getActiveProposals(): VotingProposal[] {
    return Array.from(this.proposals.values()).filter(
      p => p.status === 'pending'
    );
  }

  // Algorithm-specific queries
  isLeader(): boolean {
    if (this.implementation instanceof RaftVoting) {
      return this.implementation.isLeader();
    }
    if (this.implementation instanceof ByzantineVoting) {
      return this.implementation.isPrimary();
    }
    return false; // Gossip has no leader
  }

  getLeaderId(): string | undefined {
    if (this.implementation instanceof RaftVoting) {
      return this.implementation.getLeaderId();
    }
    return undefined;
  }

  getAlgorithm(): VotingAlgorithm {
    return this.config.algorithm;
  }

  getConfig(): VotingConfig {
    return { ...this.config };
  }

  // Metrics
  getStats(): {
    algorithm: VotingAlgorithm;
    totalProposals: number;
    pendingProposals: number;
    acceptedProposals: number;
    rejectedProposals: number;
    expiredProposals: number;
  } {
    const proposals = Array.from(this.proposals.values());

    return {
      algorithm: this.config.algorithm,
      totalProposals: proposals.length,
      pendingProposals: proposals.filter(p => p.status === 'pending').length,
      acceptedProposals: proposals.filter(p => p.status === 'accepted').length,
      rejectedProposals: proposals.filter(p => p.status === 'rejected').length,
      expiredProposals: proposals.filter(p => p.status === 'expired').length,
    };
  }
}

// Factory function
export function createVotingEngine(
  nodeId: string,
  algorithm: VotingAlgorithm = 'raft',
  config?: Partial<VotingConfig>
): VotingEngine {
  return new VotingEngine(nodeId, { ...config, algorithm });
}

// Helper to select optimal algorithm based on requirements
export function selectOptimalVotingAlgorithm(requirements: {
  faultTolerance: 'crash' | 'byzantine';
  consistency: 'strong' | 'eventual';
  networkScale: 'small' | 'medium' | 'large';
  latencyPriority: 'low' | 'medium' | 'high';
}): VotingAlgorithm {
  const { faultTolerance, consistency, networkScale, latencyPriority } = requirements;

  // Byzantine fault tolerance required
  if (faultTolerance === 'byzantine') {
    return 'byzantine';
  }

  // Eventual consistency acceptable and large scale
  if (consistency === 'eventual' && networkScale === 'large') {
    return 'gossip';
  }

  // Low latency priority with medium scale
  if (latencyPriority === 'high' && networkScale !== 'large') {
    return 'raft';
  }

  // Strong consistency with small/medium scale
  if (consistency === 'strong') {
    return 'raft';
  }

  // Default to Raft
  return 'raft';
}
