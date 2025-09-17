import { GovernanceSystem } from '../../src/governance/index.js';
import { GovernanceError } from '../../src/types/index.js';

describe('Governance System', () => {
  let governance: GovernanceSystem;

  beforeEach(() => {
    governance = new GovernanceSystem({
      votingPeriod: 1000, // 1 second for testing
      quorumThreshold: 0.1,
      proposalThreshold: 1,
      executionDelay: 100 // 100ms for testing
    });

    // Set up test voting powers
    governance.setVotingPower('user1', 10);
    governance.setVotingPower('user2', 5);
    governance.setVotingPower('user3', 3);
  });

  describe('Voting Power Management', () => {
    it('should set and get voting power correctly', () => {
      governance.setVotingPower('testuser', 15);
      expect(governance.getVotingPower('testuser')).toBe(15);
    });

    it('should return 0 for unknown users', () => {
      expect(governance.getVotingPower('unknown')).toBe(0);
    });

    it('should reject negative voting power', () => {
      expect(() => governance.setVotingPower('user', -5)).toThrow(GovernanceError);
    });
  });

  describe('Proposal Creation', () => {
    it('should create a proposal successfully', async () => {
      const proposalId = await governance.createProposal(
        'Test Proposal',
        'A test proposal for testing',
        'user1',
        'workflow',
        { action: 'test' }
      );

      expect(proposalId).toBeDefined();
      expect(typeof proposalId).toBe('string');

      const proposal = governance.getProposal(proposalId);
      expect(proposal).toBeDefined();
      expect(proposal?.title).toBe('Test Proposal');
      expect(proposal?.status).toBe('active');
    });

    it('should reject proposals from users with insufficient voting power', async () => {
      governance.setVotingPower('lowpower', 0.5);

      await expect(
        governance.createProposal(
          'Invalid Proposal',
          'Should fail',
          'lowpower',
          'workflow'
        )
      ).rejects.toThrow(GovernanceError);
    });

    it('should validate proposal data', async () => {
      await expect(
        governance.createProposal(
          '', // Empty title
          'Description',
          'user1',
          'workflow'
        )
      ).rejects.toThrow(GovernanceError);
    });
  });

  describe('Voting Process', () => {
    let proposalId: string;

    beforeEach(async () => {
      proposalId = await governance.createProposal(
        'Voting Test Proposal',
        'Test proposal for voting',
        'user1',
        'workflow'
      );
    });

    it('should allow voting on active proposals', async () => {
      await expect(
        governance.vote(proposalId, 'user2', 'for', 'I support this')
      ).resolves.not.toThrow();

      const proposal = governance.getProposal(proposalId);
      expect(proposal?.votes).toHaveLength(1);
      expect(proposal?.votes[0].choice).toBe('for');
      expect(proposal?.votes[0].voter).toBe('user2');
    });

    it('should prevent double voting', async () => {
      await governance.vote(proposalId, 'user2', 'for');

      await expect(
        governance.vote(proposalId, 'user2', 'against')
      ).rejects.toThrow(GovernanceError);
    });

    it('should reject votes from users with no voting power', async () => {
      await expect(
        governance.vote(proposalId, 'nopower', 'for')
      ).rejects.toThrow(GovernanceError);
    });

    it('should calculate voting results correctly', async () => {
      await governance.vote(proposalId, 'user1', 'for'); // 10 votes
      await governance.vote(proposalId, 'user2', 'against'); // 5 votes
      await governance.vote(proposalId, 'user3', 'abstain'); // 3 votes

      const results = governance.getVotingResults(proposalId);

      expect(results.total).toBe(18);
      expect(results.for).toBe(10);
      expect(results.against).toBe(5);
      expect(results.abstain).toBe(3);
      expect(results.quorum).toBeGreaterThan(0.1);
      expect(results.passed).toBe(true);
    });
  });

  describe('Proposal Execution', () => {
    let proposalId: string;

    beforeEach(async () => {
      proposalId = await governance.createProposal(
        'Execution Test',
        'Test proposal execution',
        'user1',
        'workflow',
        { action: 'test_execution' }
      );

      // Vote to pass the proposal
      await governance.vote(proposalId, 'user1', 'for');
      await governance.vote(proposalId, 'user2', 'for');

      // Wait for voting period to end
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    it('should execute passed proposals after delay', async () => {
      // Wait for execution delay
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await governance.executeProposal(proposalId);

      expect(result).toBeDefined();
      expect(result.executed).toBe(true);

      const proposal = governance.getProposal(proposalId);
      expect(proposal?.status).toBe('executed');
    });

    it('should reject execution of non-passed proposals', async () => {
      const failedProposalId = await governance.createProposal(
        'Failed Proposal',
        'This will fail',
        'user1',
        'workflow'
      );

      // Vote against
      await governance.vote(failedProposalId, 'user1', 'against');
      await governance.vote(failedProposalId, 'user2', 'against');

      // Wait for voting to end
      await new Promise(resolve => setTimeout(resolve, 1100));

      await expect(
        governance.executeProposal(failedProposalId)
      ).rejects.toThrow(GovernanceError);
    });
  });

  describe('Governance Statistics', () => {
    it('should provide accurate governance statistics', async () => {
      // Create some proposals
      await governance.createProposal('Prop 1', 'Description 1', 'user1', 'workflow');
      await governance.createProposal('Prop 2', 'Description 2', 'user1', 'config');

      const stats = governance.getGovernanceStats();

      expect(stats.totalProposals).toBe(2);
      expect(stats.activeProposals).toBe(2);
      expect(stats.totalVotingPower).toBe(18); // 10 + 5 + 3
      expect(stats.totalVoters).toBe(3);
    });
  });

  describe('Proposal Filtering', () => {
    beforeEach(async () => {
      await governance.createProposal('Workflow Prop', 'Description', 'user1', 'workflow');
      await governance.createProposal('Config Prop', 'Description', 'user2', 'config');
      await governance.createProposal('Governance Prop', 'Description', 'user1', 'governance');
    });

    it('should filter proposals by type', () => {
      const workflowProposals = governance.getProposals({ type: 'workflow' });
      const configProposals = governance.getProposals({ type: 'config' });

      expect(workflowProposals).toHaveLength(1);
      expect(configProposals).toHaveLength(1);
      expect(workflowProposals[0].type).toBe('workflow');
      expect(configProposals[0].type).toBe('config');
    });

    it('should filter proposals by proposer', () => {
      const user1Proposals = governance.getProposals({ proposer: 'user1' });
      const user2Proposals = governance.getProposals({ proposer: 'user2' });

      expect(user1Proposals).toHaveLength(2);
      expect(user2Proposals).toHaveLength(1);
    });

    it('should filter proposals by status', () => {
      const activeProposals = governance.getProposals({ status: 'active' });

      expect(activeProposals).toHaveLength(3);
      activeProposals.forEach(proposal => {
        expect(proposal.status).toBe('active');
      });
    });
  });
});