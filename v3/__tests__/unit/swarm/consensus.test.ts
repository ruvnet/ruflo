/**
 * V3 Claude-Flow Consensus Manager Unit Tests
 *
 * London School TDD - Behavior Verification
 * Tests Raft-based consensus for swarm coordination
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock, type MockedInterface } from '../../helpers/create-mock';

/**
 * Consensus manager interface (to be implemented)
 */
interface IConsensusManager {
  initialize(nodeId: string, peers: string[]): Promise<void>;
  propose(proposal: Proposal): Promise<boolean>;
  getState(): ConsensusState;
  getLeader(): string | null;
  isLeader(nodeId: string): boolean;
  stepDown(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Raft log interface (collaborator)
 */
interface IRaftLog {
  append(entry: LogEntry): Promise<number>;
  getEntry(index: number): Promise<LogEntry | null>;
  getLastIndex(): number;
  getLastTerm(): number;
  truncateAfter(index: number): Promise<void>;
}

/**
 * Election timer interface (collaborator)
 */
interface IElectionTimer {
  start(): void;
  reset(): void;
  stop(): void;
  onTimeout(callback: () => void): void;
}

/**
 * Heartbeat sender interface (collaborator)
 */
interface IHeartbeatSender {
  start(interval: number): void;
  stop(): void;
  sendHeartbeat(peers: string[]): Promise<HeartbeatResponse[]>;
}

/**
 * RPC client interface (collaborator)
 */
interface IRPCClient {
  requestVote(peer: string, request: VoteRequest): Promise<VoteResponse>;
  appendEntries(peer: string, request: AppendEntriesRequest): Promise<AppendEntriesResponse>;
}

interface Proposal {
  type: string;
  payload: unknown;
  proposerId: string;
}

interface ConsensusState {
  currentTerm: number;
  votedFor: string | null;
  role: 'follower' | 'candidate' | 'leader';
  commitIndex: number;
  lastApplied: number;
}

interface LogEntry {
  term: number;
  index: number;
  command: unknown;
}

interface HeartbeatResponse {
  peerId: string;
  success: boolean;
  term: number;
}

interface VoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

interface VoteResponse {
  term: number;
  voteGranted: boolean;
}

interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

interface AppendEntriesResponse {
  term: number;
  success: boolean;
}

/**
 * Consensus manager implementation for testing (Raft-based)
 */
class RaftConsensusManager implements IConsensusManager {
  private nodeId: string = '';
  private peers: string[] = [];
  private state: ConsensusState = {
    currentTerm: 0,
    votedFor: null,
    role: 'follower',
    commitIndex: 0,
    lastApplied: 0,
  };
  private leaderId: string | null = null;
  private initialized = false;

  constructor(
    private readonly log: IRaftLog,
    private readonly electionTimer: IElectionTimer,
    private readonly heartbeatSender: IHeartbeatSender,
    private readonly rpcClient: IRPCClient
  ) {}

  async initialize(nodeId: string, peers: string[]): Promise<void> {
    if (this.initialized) {
      throw new Error('Already initialized');
    }

    this.nodeId = nodeId;
    this.peers = peers;

    // Set up election timeout handler
    this.electionTimer.onTimeout(() => {
      this.startElection();
    });

    // Start election timer
    this.electionTimer.start();

    this.initialized = true;
  }

  async propose(proposal: Proposal): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Not initialized');
    }

    // Only leader can accept proposals
    if (this.state.role !== 'leader') {
      return false;
    }

    // Create log entry
    const entry: LogEntry = {
      term: this.state.currentTerm,
      index: this.log.getLastIndex() + 1,
      command: proposal,
    };

    // Append to local log
    await this.log.append(entry);

    // Replicate to peers
    const replicationResults = await this.replicateEntry(entry);

    // Check if majority achieved
    const successCount = replicationResults.filter((r) => r).length + 1; // +1 for self
    const majority = Math.floor((this.peers.length + 1) / 2) + 1;

    if (successCount >= majority) {
      // Update commit index
      this.state.commitIndex = entry.index;
      return true;
    }

    return false;
  }

  getState(): ConsensusState {
    return { ...this.state };
  }

  getLeader(): string | null {
    return this.leaderId;
  }

  isLeader(nodeId: string): boolean {
    return this.state.role === 'leader' && this.nodeId === nodeId;
  }

  async stepDown(): Promise<void> {
    if (this.state.role === 'leader') {
      this.heartbeatSender.stop();
      this.state.role = 'follower';
      this.leaderId = null;
      this.electionTimer.start();
    }
  }

  async shutdown(): Promise<void> {
    this.electionTimer.stop();
    this.heartbeatSender.stop();
    this.initialized = false;
  }

  // Simulate receiving vote request
  async handleVoteRequest(request: VoteRequest): Promise<VoteResponse> {
    // If term is higher, update and become follower
    if (request.term > this.state.currentTerm) {
      this.state.currentTerm = request.term;
      this.state.role = 'follower';
      this.state.votedFor = null;
    }

    // Grant vote if:
    // 1. Request term >= current term
    // 2. Haven't voted yet or voted for this candidate
    // 3. Candidate's log is at least as up-to-date
    const logUpToDate =
      request.lastLogTerm > this.log.getLastTerm() ||
      (request.lastLogTerm === this.log.getLastTerm() &&
        request.lastLogIndex >= this.log.getLastIndex());

    if (
      request.term >= this.state.currentTerm &&
      (this.state.votedFor === null || this.state.votedFor === request.candidateId) &&
      logUpToDate
    ) {
      this.state.votedFor = request.candidateId;
      this.electionTimer.reset();
      return { term: this.state.currentTerm, voteGranted: true };
    }

    return { term: this.state.currentTerm, voteGranted: false };
  }

  // Simulate receiving append entries (heartbeat)
  async handleAppendEntries(request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
    // If term is higher, become follower
    if (request.term > this.state.currentTerm) {
      this.state.currentTerm = request.term;
      this.state.role = 'follower';
      this.state.votedFor = null;
    }

    // Reset election timer on valid heartbeat
    if (request.term >= this.state.currentTerm) {
      this.leaderId = request.leaderId;
      this.electionTimer.reset();

      // Append entries if log check passes
      const prevEntry = await this.log.getEntry(request.prevLogIndex);
      if (request.prevLogIndex === 0 || (prevEntry && prevEntry.term === request.prevLogTerm)) {
        // Append new entries
        for (const entry of request.entries) {
          await this.log.append(entry);
        }

        // Update commit index
        if (request.leaderCommit > this.state.commitIndex) {
          this.state.commitIndex = Math.min(request.leaderCommit, this.log.getLastIndex());
        }

        return { term: this.state.currentTerm, success: true };
      }
    }

    return { term: this.state.currentTerm, success: false };
  }

  private async startElection(): Promise<void> {
    // Increment term and become candidate
    this.state.currentTerm++;
    this.state.role = 'candidate';
    this.state.votedFor = this.nodeId;

    // Request votes from peers
    const votePromises = this.peers.map((peer) =>
      this.rpcClient.requestVote(peer, {
        term: this.state.currentTerm,
        candidateId: this.nodeId,
        lastLogIndex: this.log.getLastIndex(),
        lastLogTerm: this.log.getLastTerm(),
      })
    );

    const responses = await Promise.all(votePromises);

    // Count votes (including self vote)
    const votesReceived = responses.filter((r) => r.voteGranted).length + 1;
    const majority = Math.floor((this.peers.length + 1) / 2) + 1;

    // Check if we received a higher term
    const maxTerm = Math.max(...responses.map((r) => r.term), this.state.currentTerm);
    if (maxTerm > this.state.currentTerm) {
      this.state.currentTerm = maxTerm;
      this.state.role = 'follower';
      this.state.votedFor = null;
      return;
    }

    // Check if elected
    if (votesReceived >= majority) {
      this.becomeLeader();
    } else {
      // Restart election timer
      this.electionTimer.reset();
    }
  }

  private becomeLeader(): void {
    this.state.role = 'leader';
    this.leaderId = this.nodeId;
    this.electionTimer.stop();
    this.heartbeatSender.start(1000); // 1 second heartbeat
  }

  private async replicateEntry(entry: LogEntry): Promise<boolean[]> {
    const results = await Promise.all(
      this.peers.map(async (peer) => {
        const response = await this.rpcClient.appendEntries(peer, {
          term: this.state.currentTerm,
          leaderId: this.nodeId,
          prevLogIndex: entry.index - 1,
          prevLogTerm: entry.index > 1 ? (await this.log.getEntry(entry.index - 1))?.term ?? 0 : 0,
          entries: [entry],
          leaderCommit: this.state.commitIndex,
        });

        return response.success;
      })
    );

    return results;
  }
}

describe('RaftConsensusManager', () => {
  let mockLog: MockedInterface<IRaftLog>;
  let mockElectionTimer: MockedInterface<IElectionTimer>;
  let mockHeartbeatSender: MockedInterface<IHeartbeatSender>;
  let mockRPCClient: MockedInterface<IRPCClient>;
  let consensusManager: RaftConsensusManager;

  beforeEach(() => {
    mockLog = createMock<IRaftLog>();
    mockElectionTimer = createMock<IElectionTimer>();
    mockHeartbeatSender = createMock<IHeartbeatSender>();
    mockRPCClient = createMock<IRPCClient>();

    // Configure default mock behavior
    mockLog.append.mockResolvedValue(1);
    mockLog.getEntry.mockResolvedValue(null);
    mockLog.getLastIndex.mockReturnValue(0);
    mockLog.getLastTerm.mockReturnValue(0);
    mockLog.truncateAfter.mockResolvedValue(undefined);

    mockElectionTimer.start.mockReturnValue(undefined);
    mockElectionTimer.reset.mockReturnValue(undefined);
    mockElectionTimer.stop.mockReturnValue(undefined);
    mockElectionTimer.onTimeout.mockReturnValue(undefined);

    mockHeartbeatSender.start.mockReturnValue(undefined);
    mockHeartbeatSender.stop.mockReturnValue(undefined);
    mockHeartbeatSender.sendHeartbeat.mockResolvedValue([]);

    mockRPCClient.requestVote.mockResolvedValue({ term: 1, voteGranted: true });
    mockRPCClient.appendEntries.mockResolvedValue({ term: 1, success: true });

    consensusManager = new RaftConsensusManager(
      mockLog,
      mockElectionTimer,
      mockHeartbeatSender,
      mockRPCClient
    );
  });

  describe('initialize', () => {
    it('should set up election timeout handler', async () => {
      // When
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);

      // Then
      expect(mockElectionTimer.onTimeout).toHaveBeenCalled();
    });

    it('should start election timer', async () => {
      // When
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);

      // Then
      expect(mockElectionTimer.start).toHaveBeenCalled();
    });

    it('should throw error if already initialized', async () => {
      // Given
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);

      // When/Then
      await expect(
        consensusManager.initialize('node-1', ['node-2', 'node-3'])
      ).rejects.toThrow('Already initialized');
    });
  });

  describe('propose', () => {
    beforeEach(async () => {
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);
    });

    it('should throw error if not initialized', async () => {
      // Given
      const uninitializedManager = new RaftConsensusManager(
        mockLog,
        mockElectionTimer,
        mockHeartbeatSender,
        mockRPCClient
      );

      const proposal: Proposal = {
        type: 'TaskCoordination',
        payload: {},
        proposerId: 'coordinator',
      };

      // When/Then
      await expect(uninitializedManager.propose(proposal)).rejects.toThrow(
        'Not initialized'
      );
    });

    it('should return false if not leader', async () => {
      // Given - default role is follower
      const proposal: Proposal = {
        type: 'TaskCoordination',
        payload: {},
        proposerId: 'coordinator',
      };

      // When
      const result = await consensusManager.propose(proposal);

      // Then
      expect(result).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return initial state', async () => {
      // When
      const state = consensusManager.getState();

      // Then
      expect(state).toEqual({
        currentTerm: 0,
        votedFor: null,
        role: 'follower',
        commitIndex: 0,
        lastApplied: 0,
      });
    });

    it('should return copy of state', async () => {
      // Given
      const state1 = consensusManager.getState();
      state1.currentTerm = 100;

      // When
      const state2 = consensusManager.getState();

      // Then
      expect(state2.currentTerm).toBe(0);
    });
  });

  describe('getLeader', () => {
    it('should return null initially', async () => {
      // When
      const leader = consensusManager.getLeader();

      // Then
      expect(leader).toBeNull();
    });
  });

  describe('isLeader', () => {
    it('should return false when not leader', async () => {
      // Given
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);

      // When
      const result = consensusManager.isLeader('node-1');

      // Then
      expect(result).toBe(false);
    });
  });

  describe('stepDown', () => {
    beforeEach(async () => {
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);
    });

    it('should do nothing if not leader', async () => {
      // When
      await consensusManager.stepDown();

      // Then
      expect(mockHeartbeatSender.stop).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);
    });

    it('should stop election timer', async () => {
      // When
      await consensusManager.shutdown();

      // Then
      expect(mockElectionTimer.stop).toHaveBeenCalled();
    });

    it('should stop heartbeat sender', async () => {
      // When
      await consensusManager.shutdown();

      // Then
      expect(mockHeartbeatSender.stop).toHaveBeenCalled();
    });
  });

  describe('handleVoteRequest', () => {
    beforeEach(async () => {
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);
    });

    it('should grant vote if criteria met', async () => {
      // Given
      const request: VoteRequest = {
        term: 1,
        candidateId: 'node-2',
        lastLogIndex: 0,
        lastLogTerm: 0,
      };

      // When
      const response = await consensusManager.handleVoteRequest(request);

      // Then
      expect(response.voteGranted).toBe(true);
    });

    it('should reset election timer when granting vote', async () => {
      // Given
      const request: VoteRequest = {
        term: 1,
        candidateId: 'node-2',
        lastLogIndex: 0,
        lastLogTerm: 0,
      };

      // When
      await consensusManager.handleVoteRequest(request);

      // Then
      expect(mockElectionTimer.reset).toHaveBeenCalled();
    });

    it('should update term if request has higher term', async () => {
      // Given
      const request: VoteRequest = {
        term: 5,
        candidateId: 'node-2',
        lastLogIndex: 0,
        lastLogTerm: 0,
      };

      // When
      await consensusManager.handleVoteRequest(request);
      const state = consensusManager.getState();

      // Then
      expect(state.currentTerm).toBe(5);
    });

    it('should deny vote if already voted for different candidate', async () => {
      // Given - first vote
      await consensusManager.handleVoteRequest({
        term: 1,
        candidateId: 'node-2',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      // When - second vote request in same term
      const response = await consensusManager.handleVoteRequest({
        term: 1,
        candidateId: 'node-3',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      // Then
      expect(response.voteGranted).toBe(false);
    });

    it('should deny vote if candidate log is not up-to-date', async () => {
      // Given - node has entries
      mockLog.getLastIndex.mockReturnValue(5);
      mockLog.getLastTerm.mockReturnValue(2);

      const request: VoteRequest = {
        term: 3,
        candidateId: 'node-2',
        lastLogIndex: 3, // Behind
        lastLogTerm: 1, // Behind
      };

      // When
      const response = await consensusManager.handleVoteRequest(request);

      // Then
      expect(response.voteGranted).toBe(false);
    });
  });

  describe('handleAppendEntries', () => {
    beforeEach(async () => {
      await consensusManager.initialize('node-1', ['node-2', 'node-3']);
    });

    it('should reset election timer on valid heartbeat', async () => {
      // Given
      const request: AppendEntriesRequest = {
        term: 1,
        leaderId: 'node-2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      };

      // When
      await consensusManager.handleAppendEntries(request);

      // Then
      expect(mockElectionTimer.reset).toHaveBeenCalled();
    });

    it('should update leader id', async () => {
      // Given
      const request: AppendEntriesRequest = {
        term: 1,
        leaderId: 'node-2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      };

      // When
      await consensusManager.handleAppendEntries(request);

      // Then
      expect(consensusManager.getLeader()).toBe('node-2');
    });

    it('should append entries to log', async () => {
      // Given
      const entry: LogEntry = { term: 1, index: 1, command: { type: 'test' } };
      const request: AppendEntriesRequest = {
        term: 1,
        leaderId: 'node-2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [entry],
        leaderCommit: 0,
      };

      // When
      await consensusManager.handleAppendEntries(request);

      // Then
      expect(mockLog.append).toHaveBeenCalledWith(entry);
    });

    it('should update commit index', async () => {
      // Given
      mockLog.getLastIndex.mockReturnValue(5);
      const request: AppendEntriesRequest = {
        term: 1,
        leaderId: 'node-2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 3,
      };

      // When
      await consensusManager.handleAppendEntries(request);
      const state = consensusManager.getState();

      // Then
      expect(state.commitIndex).toBe(3);
    });

    it('should become follower if higher term received', async () => {
      // Given
      const request: AppendEntriesRequest = {
        term: 5,
        leaderId: 'node-2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
      };

      // When
      await consensusManager.handleAppendEntries(request);
      const state = consensusManager.getState();

      // Then
      expect(state.role).toBe('follower');
      expect(state.currentTerm).toBe(5);
    });

    it('should return false if log check fails', async () => {
      // Given
      mockLog.getEntry.mockResolvedValue({ term: 1, index: 1, command: {} });
      const request: AppendEntriesRequest = {
        term: 1,
        leaderId: 'node-2',
        prevLogIndex: 1,
        prevLogTerm: 2, // Mismatch
        entries: [],
        leaderCommit: 0,
      };

      // When
      const response = await consensusManager.handleAppendEntries(request);

      // Then
      expect(response.success).toBe(false);
    });
  });
});
