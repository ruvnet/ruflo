import { describe, it, expect, beforeEach, afterEach } from 'jest';
import GovernanceSystem from '../../src/governance/index.js';
import { GovernanceConfig, Proposal } from '../../src/types/index.js';

describe('Enhanced Governance System', () => {
  let governance: GovernanceSystem;
  let config: GovernanceConfig;

  beforeEach(() => {
    config = {
      votingPeriod: 24 * 60 * 60 * 1000, // 24 hours
      quorumThreshold: 0.1, // 10%
      proposalThreshold: 1,
      executionDelay: 2 * 60 * 60 * 1000, // 2 hours
      supermajorityThreshold: 0.67,
      multiSigThreshold: 3,
      delegationEnabled: true,
      maxDelegationDepth: 3,
      enableMCPIntegration: true
    };

    governance = new GovernanceSystem(config);

    // Set up test users with voting power
    governance.setVotingPower('alice', 100);
    governance.setVotingPower('bob', 80);
    governance.setVotingPower('charlie', 60);
    governance.setVotingPower('david', 40);
    governance.setVotingPower('eve', 20);

    // Assign roles
    governance.assignRole('alice', 'admin');
    governance.assignRole('bob', 'stakeholder');
    governance.assignRole('charlie', 'member');
  });

  afterEach(() => {
    governance.removeAllListeners();
  });

  describe('Enhanced Proposal Creation', () => {
    it('should create a proposal with enhanced metadata', async () => {
      const proposalId = await governance.createProposal(
        'Test Proposal',
        'A test proposal for enhanced governance',
        'alice',
        'workflow',
        'standard',
        { action: 'test' },
        {
          tags: ['test', 'workflow'],
          priority: 'high',
          estimatedImpact: 'moderate',
          riskLevel: 'low'
        },
        [],
        ['alice', 'bob']
      );

      expect(proposalId).toBeDefined();

      const proposal = governance.getProposal(proposalId);
      expect(proposal).toBeDefined();
      expect(proposal!.category).toBe('standard');
      expect(proposal!.metadata.tags).toContain('test');
      expect(proposal!.metadata.priority).toBe('high');
      expect(proposal!.requiredApprovals).toEqual(['alice', 'bob']);
    });

    it('should initialize multi-sig for critical proposals', async () => {
      const proposalId = await governance.createProposal(
        'Critical Proposal',
        'A critical system change',
        'alice',
        'governance',
        'critical',
        { configChanges: { 'governance.quorumThreshold': 0.2 } },
        { priority: 'critical', riskLevel: 'high' },
        [],
        ['alice', 'bob', 'charlie']
      );

      const multiSigStatus = governance.getMultiSigManager().getSignatureStatus(proposalId);
      expect(multiSigStatus.requiredSignatures).toBe(config.multiSigThreshold);
      expect(multiSigStatus.signatureCount).toBe(0);
    });

    it('should reject proposal from user without permission', async () => {
      governance.assignRole('eve', 'observer');

      await expect(
        governance.createProposal(
          'Unauthorized Proposal',
          'Should fail',
          'eve',
          'governance'
        )
      ).rejects.toThrow('User does not have permission to create proposals');
    });
  });

  describe('Delegation System', () => {
    it('should create and manage delegations', async () => {
      const delegationId = await governance.createDelegation(
        'alice',
        'bob',
        50,
        'all'
      );

      expect(delegationId).toBeDefined();

      const aliceEffectivePower = governance.getEffectiveVotingPower('alice');
      const bobEffectivePower = governance.getEffectiveVotingPower('bob');

      expect(aliceEffectivePower).toBeLessThan(governance.getVotingPower('alice'));
      expect(bobEffectivePower).toBeGreaterThan(governance.getVotingPower('bob'));
    });

    it('should prevent circular delegations', async () => {
      await governance.createDelegation('alice', 'bob', 50);
      await governance.createDelegation('bob', 'charlie', 30);

      await expect(
        governance.createDelegation('charlie', 'alice', 20)
      ).rejects.toThrow('Circular delegation detected');
    });

    it('should enforce delegation depth limits', async () => {
      await governance.createDelegation('alice', 'bob', 50);
      await governance.createDelegation('bob', 'charlie', 30);
      await governance.createDelegation('charlie', 'david', 20);

      await expect(
        governance.createDelegation('david', 'eve', 10)
      ).rejects.toThrow('Maximum delegation depth exceeded');
    });

    it('should revoke delegations', async () => {
      await governance.createDelegation('alice', 'bob', 50);

      const bobPowerBefore = governance.getEffectiveVotingPower('bob');
      expect(bobPowerBefore).toBeGreaterThan(governance.getVotingPower('bob'));

      await governance.revokeDelegation('alice', 'bob');

      const bobPowerAfter = governance.getEffectiveVotingPower('bob');
      expect(bobPowerAfter).toBe(governance.getVotingPower('bob'));
    });
  });

  describe('Enhanced Voting and Consensus', () => {
    let proposalId: string;

    beforeEach(async () => {
      proposalId = await governance.createProposal(
        'Test Voting',
        'Test enhanced voting mechanisms',
        'alice',
        'workflow'
      );
    });

    it('should handle weighted voting with role multipliers', async () => {
      await governance.vote(proposalId, 'alice', 'for', 'Admin support');
      await governance.vote(proposalId, 'bob', 'for', 'Stakeholder support');
      await governance.vote(proposalId, 'charlie', 'against', 'Member opposition');

      const results = governance.getVotingResults(proposalId);

      // Alice (admin) should have 2x multiplier, Bob (stakeholder) 1.5x
      expect(results.consensusResult).toBeDefined();
      expect(results.passed).toBe(true);
    });

    it('should evaluate supermajority consensus for critical proposals', async () => {
      const criticalProposalId = await governance.createProposal(
        'Critical Change',
        'A critical system change',
        'alice',
        'governance',
        'critical'
      );

      // Need supermajority (67%) to pass
      await governance.vote(criticalProposalId, 'alice', 'for');
      await governance.vote(criticalProposalId, 'bob', 'for');
      await governance.vote(criticalProposalId, 'charlie', 'against');

      const results = governance.getVotingResults(criticalProposalId);
      expect(results.consensusResult?.ruleApplied.type).toBe('supermajority');
    });

    it('should handle delegated voting', async () => {
      await governance.createDelegation('david', 'alice', 30);

      await governance.vote(proposalId, 'alice', 'for', 'Voting with delegation');

      const results = governance.getVotingResults(proposalId);
      const aliceVote = results.consensusResult?.votingResults;

      // Alice's effective power should include delegated power
      expect(aliceVote).toBeDefined();
    });
  });

  describe('Multi-Signature Requirements', () => {
    let criticalProposalId: string;

    beforeEach(async () => {
      criticalProposalId = await governance.createProposal(
        'Critical Proposal',
        'Requires multi-sig',
        'alice',
        'governance',
        'critical',
        undefined,
        undefined,
        [],
        ['alice', 'bob', 'charlie']
      );

      // Pass the voting
      await governance.vote(criticalProposalId, 'alice', 'for');
      await governance.vote(criticalProposalId, 'bob', 'for');
      await governance.vote(criticalProposalId, 'charlie', 'for');

      // Advance time to end voting period
      jest.useFakeTimers();
      jest.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours
      jest.useRealTimers();
    });

    it('should require multi-sig for critical proposals', async () => {
      const proposal = governance.getProposal(criticalProposalId);
      expect(proposal!.status).toBe('queued'); // Should be queued pending multi-sig
    });

    it('should collect multi-sig signatures', async () => {
      const signature1 = 'signature_alice';
      const signature2 = 'signature_bob';
      const signature3 = 'signature_charlie';

      await governance.addMultiSigSignature(criticalProposalId, 'alice', signature1);
      await governance.addMultiSigSignature(criticalProposalId, 'bob', signature2);

      const status = governance.getMultiSigManager().getSignatureStatus(criticalProposalId);
      expect(status.signatureCount).toBe(2);
      expect(status.thresholdReached).toBe(false);

      await governance.addMultiSigSignature(criticalProposalId, 'charlie', signature3);

      const finalStatus = governance.getMultiSigManager().getSignatureStatus(criticalProposalId);
      expect(finalStatus.signatureCount).toBe(3);
      expect(finalStatus.thresholdReached).toBe(true);
    });

    it('should prevent duplicate signatures', async () => {
      await governance.addMultiSigSignature(criticalProposalId, 'alice', 'signature1');

      await expect(
        governance.addMultiSigSignature(criticalProposalId, 'alice', 'signature2')
      ).rejects.toThrow('Signer has already signed this proposal');
    });
  });

  describe('MCP Integration', () => {
    it('should handle MCP proposal creation', async () => {
      const mcpIntegration = governance.getMCPIntegration();

      const result = await mcpIntegration.handleCreateProposal({
        title: 'MCP Proposal',
        description: 'Created via MCP',
        proposer: 'alice',
        type: 'workflow',
        category: 'standard',
        externalCallbacks: ['external-system-callback']
      });

      expect(result.success).toBe(true);
      expect(result.proposalId).toBeDefined();
      expect(result.mcpIntegration).toBe(true);
    });

    it('should handle MCP vote casting', async () => {
      const mcpIntegration = governance.getMCPIntegration();

      const proposalId = await governance.createProposal(
        'Test MCP Voting',
        'Test MCP vote integration',
        'alice',
        'workflow'
      );

      const result = await mcpIntegration.handleCastVote({
        proposalId,
        voter: 'bob',
        choice: 'for',
        reason: 'Support via MCP'
      });

      expect(result.success).toBe(true);
      expect(result.proposalId).toBe(proposalId);
      expect(result.voter).toBe('bob');
    });

    it('should execute proposals with external calls', async () => {
      const mcpIntegration = governance.getMCPIntegration();

      // Register a test tool
      mcpIntegration.registerTool({
        name: 'test-external-tool',
        description: 'Test external integration',
        inputSchema: {
          parse: (params: any) => params
        } as any,
        handler: async (params: any) => {
          return { executed: true, params };
        }
      });

      const result = await mcpIntegration.handleExecuteProposal({
        proposalId: 'test-proposal',
        executor: 'alice',
        externalCalls: [
          {
            tool: 'test-external-tool',
            parameters: { action: 'test' }
          }
        ]
      });

      expect(result.success).toBe(true);
      expect(result.executionResults).toHaveLength(1);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should enforce proposal creation permissions', async () => {
      governance.assignRole('eve', 'observer');

      const eveRoles = governance.getUserRoles('eve');
      expect(eveRoles[0].canPropose).toBe(false);

      await expect(
        governance.createProposal(
          'Unauthorized',
          'Should fail',
          'eve',
          'workflow'
        )
      ).rejects.toThrow('User does not have permission to create proposals');
    });

    it('should apply role-based voting power multipliers', async () => {
      const proposalId = await governance.createProposal(
        'Role Multiplier Test',
        'Test role-based multipliers',
        'alice',
        'workflow'
      );

      await governance.vote(proposalId, 'alice', 'for'); // Admin: 2x multiplier
      await governance.vote(proposalId, 'bob', 'for');   // Stakeholder: 1.5x multiplier
      await governance.vote(proposalId, 'charlie', 'against'); // Member: 1x multiplier

      const results = governance.getVotingResults(proposalId);

      // Alice's vote should be weighted more heavily due to admin role
      expect(results.passed).toBe(true);
    });

    it('should manage role assignments', async () => {
      governance.assignRole('david', 'stakeholder');

      const davidRoles = governance.getUserRoles('david');
      expect(davidRoles).toHaveLength(1);
      expect(davidRoles[0].id).toBe('stakeholder');
      expect(davidRoles[0].votingPowerMultiplier).toBe(1.5);
    });
  });

  describe('Governance Statistics and Analytics', () => {
    beforeEach(async () => {
      // Create various proposals for testing
      await governance.createProposal('Proposal 1', 'Description 1', 'alice', 'workflow');
      await governance.createProposal('Proposal 2', 'Description 2', 'bob', 'config');
      await governance.createProposal('Proposal 3', 'Description 3', 'charlie', 'governance', 'critical');

      // Create delegations
      await governance.createDelegation('alice', 'bob', 30);
      await governance.createDelegation('charlie', 'david', 20);
    });

    it('should provide comprehensive governance statistics', () => {
      const stats = governance.getGovernanceStats();

      expect(stats.totalProposals).toBe(3);
      expect(stats.activeProposals).toBe(3);
      expect(stats.totalVoters).toBe(5);
      expect(stats.delegationStats).toBeDefined();
      expect(stats.consensusStats).toBeDefined();
      expect(stats.multiSigStats).toBeDefined();
    });

    it('should provide detailed proposal information', async () => {
      const proposalId = await governance.createProposal(
        'Detailed Test',
        'Test detailed proposal info',
        'alice',
        'workflow'
      );

      await governance.createDelegation('bob', 'alice', 25);
      await governance.vote(proposalId, 'alice', 'for');

      const details = governance.getProposalDetails(proposalId);

      expect(details.proposal).toBeDefined();
      expect(details.votingResults).toBeDefined();
      expect(details.delegationChains).toBeDefined();
      expect(details.delegationChains['alice']).toContain('alice');
    });
  });

  describe('Cleanup and Maintenance', () => {
    it('should clean up expired proposals and delegations', async () => {
      const proposalId = await governance.createProposal(
        'Expiring Proposal',
        'Will expire',
        'alice',
        'workflow'
      );

      await governance.createDelegation(
        'alice',
        'bob',
        50,
        'all',
        [],
        new Date(Date.now() - 1000) // Already expired
      );

      // Advance time to expire proposal
      jest.useFakeTimers();
      jest.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours

      const cleanup = governance.cleanup();

      expect(cleanup.expiredProposals).toBeGreaterThan(0);
      expect(cleanup.expiredDelegations).toBeGreaterThan(0);

      const proposal = governance.getProposal(proposalId);
      expect(proposal!.status).toBe('expired');

      jest.useRealTimers();
    });
  });

  describe('Event System', () => {
    it('should emit events for governance actions', (done) => {
      let eventsReceived = 0;
      const expectedEvents = 3;

      governance.on('proposal:created', () => {
        eventsReceived++;
        if (eventsReceived === expectedEvents) done();
      });

      governance.on('delegation:created', () => {
        eventsReceived++;
        if (eventsReceived === expectedEvents) done();
      });

      governance.on('proposal:voted', () => {
        eventsReceived++;
        if (eventsReceived === expectedEvents) done();
      });

      // Trigger events
      governance.createProposal('Event Test', 'Test events', 'alice', 'workflow')
        .then(proposalId => {
          governance.createDelegation('alice', 'bob', 30);
          governance.vote(proposalId, 'alice', 'for');
        });
    });
  });
});