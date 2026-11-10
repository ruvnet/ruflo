/**
 * Regression test (#4458): RaftConsensus.checkConsensus() computed quorum as
 * floor(totalVoters * 0.66), which is 1 for 2- and 3-voter clusters. The
 * leader's own self-vote (cast inside propose()) then accepted the proposal
 * even after a peer explicitly rejected it. Quorum is now at least a strict
 * majority of approvals.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { RaftConsensus, createRaftConsensus } from '../src/consensus/raft.js';

const vote = (voterId: string, approve: boolean) => ({
  voterId,
  approve,
  confidence: 1.0,
  timestamp: new Date(),
});

async function electedLeader(peerCount: number): Promise<RaftConsensus> {
  const raft = createRaftConsensus('leader', {
    threshold: 0.66,
    timeoutMs: 1000,
    electionTimeoutMinMs: 20,
    electionTimeoutMaxMs: 40,
    heartbeatIntervalMs: 25,
  });
  const elected = new Promise<void>(resolve => raft.once('leader.elected', () => resolve()));
  await raft.initialize();
  for (let i = 0; i < peerCount; i++) raft.addPeer(`peer-${i}`);
  await elected;
  expect(raft.isLeader()).toBe(true);
  return raft;
}

describe('Raft quorum is a strict majority (#4458)', () => {
  let raft: RaftConsensus | undefined;

  afterEach(async () => {
    await raft?.shutdown();
    raft = undefined;
  });

  it('2 voters: a peer rejection is final — the leader self-vote cannot accept alone', async () => {
    raft = await electedLeader(1);
    const proposal = await raft.propose({ op: 'two-voter' });
    expect(proposal.status).toBe('pending');

    await raft.vote(proposal.id, vote('peer-0', false));

    // Resolved by the explicit reject transition, not by timeout/expiry.
    expect(proposal.status).toBe('rejected');
    expect((await raft.awaitConsensus(proposal.id)).approved).toBe(false);
  });

  it('2 voters: accepts when the peer approves', async () => {
    raft = await electedLeader(1);
    const proposal = await raft.propose({ op: 'two-voter-ok' });

    await raft.vote(proposal.id, vote('peer-0', true));

    expect(proposal.status).toBe('accepted');
  });

  it('3 voters: leader + one rejecting peer is not a quorum; second rejection rejects', async () => {
    raft = await electedLeader(2);
    const proposal = await raft.propose({ op: 'three-voter' });

    await raft.vote(proposal.id, vote('peer-0', false));
    expect(proposal.status).toBe('pending');

    await raft.vote(proposal.id, vote('peer-1', false));
    expect(proposal.status).toBe('rejected');
    expect((await raft.awaitConsensus(proposal.id)).approved).toBe(false);
  });

  it('3 voters: leader + one approving peer is a majority even if the other rejects', async () => {
    raft = await electedLeader(2);
    const proposal = await raft.propose({ op: 'three-voter-ok' });

    await raft.vote(proposal.id, vote('peer-0', false));
    await raft.vote(proposal.id, vote('peer-1', true));

    expect(proposal.status).toBe('accepted');
  });

  it('5 voters: needs 3 approvals; 3 rejections reject', async () => {
    raft = await electedLeader(4);
    const accept = await raft.propose({ op: 'five-voter-ok' });
    await raft.vote(accept.id, vote('peer-0', true));
    expect(accept.status).toBe('pending'); // 2 of 5
    await raft.vote(accept.id, vote('peer-1', false));
    expect(accept.status).toBe('pending');
    await raft.vote(accept.id, vote('peer-2', true));
    expect(accept.status).toBe('accepted'); // 3 of 5

    const reject = await raft.propose({ op: 'five-voter-reject' });
    await raft.vote(reject.id, vote('peer-0', false));
    await raft.vote(reject.id, vote('peer-1', false));
    expect(reject.status).toBe('pending'); // 3 approvals still reachable
    await raft.vote(reject.id, vote('peer-2', false));
    expect(reject.status).toBe('rejected');
  });
});
