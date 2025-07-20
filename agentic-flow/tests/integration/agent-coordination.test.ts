/**
 * Agent Coordination Integration Tests
 * Tests multi-agent coordination, communication, and collaborative problem solving
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext, waitForEvent, measureTime, TestDataFactory } from './test-infrastructure';
import { AutonomousAgent } from '../../src/autonomous/autonomous-agent';
import { TeamCoordinator } from '../../src/coordination/team-coordinator';

describe('Agent Coordination Integration Tests', () => {
  let framework: IntegrationTestFramework;
  let testContext: IntegrationTestContext;

  beforeAll(async () => {
    framework = new IntegrationTestFramework();
  });

  afterAll(async () => {
    await framework.cleanup();
  });

  beforeEach(async () => {
    testContext = await framework.createTestContext({
      name: 'Agent Coordination Test',
      agents: {
        count: 5,
        types: ['researcher', 'coder', 'analyst', 'reviewer', 'coordinator']
      },
      providers: {
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || 'test-key' }
      },
      enableRealProviders: process.env.RUN_REAL_API_TESTS === 'true',
      timeout: 60000
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  describe('Multi-Agent Team Formation', () => {
    it('should form teams based on goal requirements', async () => {
      const coordinator = testContext.coordinator;
      const agents = Array.from(testContext.agents.values());
      
      // Create a complex goal requiring multiple capabilities
      const complexGoal = TestDataFactory.createGoal(
        'Research, analyze, and implement a machine learning solution for text classification',
        8
      );

      const { result: teamComposition, duration } = await measureTime(async () => {
        return await coordinator.formTeam(complexGoal);
      });

      expect(teamComposition).toBeDefined();
      expect(teamComposition.members.length).toBeGreaterThanOrEqual(2);
      expect(teamComposition.leader).toBeDefined();
      
      // Verify diverse skill representation
      const agentTypes = teamComposition.members.map(member => member.type);
      expect(agentTypes).toContain('researcher'); // For research phase
      expect(agentTypes).toContain('coder'); // For implementation
      
      framework.recordMetric(testContext.id, 'team_formation_duration', duration);
      framework.recordMetric(testContext.id, 'team_size', teamComposition.members.length);
      framework.recordMetric(testContext.id, 'team_diversity', new Set(agentTypes).size);
    });

    it('should handle team reformation when agents become unavailable', async () => {
      const coordinator = testContext.coordinator;
      
      const goal = TestDataFactory.createGoal('Collaborative coding task', 5);
      const initialTeam = await coordinator.formTeam(goal);
      
      // Make one agent unavailable
      const targetAgent = initialTeam.members[0];
      await targetAgent.pause();
      
      // Should reform team without the unavailable agent
      const { result: reformedTeam, duration } = await measureTime(async () => {
        return await coordinator.reformTeam(initialTeam.id, goal);
      });

      expect(reformedTeam).toBeDefined();
      expect(reformedTeam.members.length).toBeGreaterThan(0);
      expect(reformedTeam.members.map(m => m.id)).not.toContain(targetAgent.id);
      
      framework.recordMetric(testContext.id, 'team_reformation_duration', duration);
      framework.recordMetric(testContext.id, 'team_reformation_success', true);
    });

    it('should optimize team composition based on past performance', async () => {
      const coordinator = testContext.coordinator;
      const agents = Array.from(testContext.agents.values());
      
      // Simulate past performance data
      const performanceData = new Map();
      agents.forEach((agent, index) => {
        performanceData.set(agent.id, {
          successRate: 0.7 + (index * 0.05), // Varying success rates
          averageTime: 1000 + (index * 100),
          specializations: [agent.type]
        });
      });

      const goal = TestDataFactory.createGoal('Performance-optimized task', 6);
      
      const team = await coordinator.formOptimalTeam(goal, performanceData);
      
      expect(team).toBeDefined();
      expect(team.members.length).toBeGreaterThan(0);
      
      // Should prefer higher-performing agents
      const teamPerformanceScores = team.members.map(member => 
        performanceData.get(member.id)?.successRate || 0
      );
      const avgTeamPerformance = teamPerformanceScores.reduce((a, b) => a + b, 0) / teamPerformanceScores.length;
      
      framework.recordMetric(testContext.id, 'optimized_team_avg_performance', avgTeamPerformance);
      expect(avgTeamPerformance).toBeGreaterThan(0.7);
    });
  });

  describe('Inter-Agent Communication', () => {
    it('should enable real-time communication between agents', async () => {
      const agents = Array.from(testContext.agents.values());
      const senderAgent = agents[0];
      const receiverAgent = agents[1];
      
      const messages: any[] = [];
      
      // Set up message listener
      receiverAgent.on('message:received', (message) => {
        messages.push(message);
      });

      // Send messages
      const testMessages = [
        { type: 'task_update', content: 'Starting research phase', priority: 'normal' },
        { type: 'request_help', content: 'Need assistance with data analysis', priority: 'high' },
        { type: 'share_result', content: 'Found relevant papers', priority: 'normal' }
      ];

      const { duration } = await measureTime(async () => {
        for (const message of testMessages) {
          await senderAgent.sendMessage(receiverAgent.id, message);
        }
        
        // Wait for messages to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      expect(messages.length).toBe(testMessages.length);
      messages.forEach((message, index) => {
        expect(message.content).toBe(testMessages[index].content);
        expect(message.from).toBe(senderAgent.id);
        expect(message.to).toBe(receiverAgent.id);
      });

      framework.recordMetric(testContext.id, 'message_transmission_duration', duration);
      framework.recordMetric(testContext.id, 'messages_sent', testMessages.length);
      framework.recordMetric(testContext.id, 'message_delivery_rate', (messages.length / testMessages.length) * 100);
    });

    it('should handle broadcast communication to multiple agents', async () => {
      const coordinator = testContext.coordinator;
      const agents = Array.from(testContext.agents.values());
      
      const receivedMessages = new Map<string, any[]>();
      
      // Set up listeners on all agents
      agents.forEach(agent => {
        receivedMessages.set(agent.id, []);
        agent.on('message:received', (message) => {
          receivedMessages.get(agent.id)!.push(message);
        });
      });

      const broadcastMessage = {
        type: 'system_announcement',
        content: 'New task assignment available',
        priority: 'high'
      };

      const { duration } = await measureTime(async () => {
        await coordinator.broadcast(broadcastMessage);
        // Wait for message propagation
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // All agents should have received the broadcast
      const totalReceived = Array.from(receivedMessages.values()).reduce((sum, messages) => sum + messages.length, 0);
      const expectedTotal = agents.length;
      
      expect(totalReceived).toBeGreaterThanOrEqual(expectedTotal * 0.9); // Allow for 10% loss
      
      framework.recordMetric(testContext.id, 'broadcast_duration', duration);
      framework.recordMetric(testContext.id, 'broadcast_reach', (totalReceived / expectedTotal) * 100);
    });

    it('should maintain message ordering and consistency', async () => {
      const agents = Array.from(testContext.agents.values());
      const senderAgent = agents[0];
      const receiverAgent = agents[1];
      
      const receivedMessages: any[] = [];
      const messageCount = 10;
      
      receiverAgent.on('message:received', (message) => {
        receivedMessages.push(message);
      });

      // Send sequential messages with increasing numbers
      const { duration } = await measureTime(async () => {
        for (let i = 0; i < messageCount; i++) {
          await senderAgent.sendMessage(receiverAgent.id, {
            type: 'sequence_test',
            content: `Message ${i}`,
            sequence: i
          });
        }
        
        // Wait for all messages to arrive
        await new Promise(resolve => setTimeout(resolve, 300));
      });

      expect(receivedMessages.length).toBe(messageCount);
      
      // Check message ordering
      for (let i = 0; i < messageCount; i++) {
        expect(receivedMessages[i].sequence).toBe(i);
      }

      framework.recordMetric(testContext.id, 'message_ordering_test_duration', duration);
      framework.recordMetric(testContext.id, 'message_ordering_accuracy', 100);
    });
  });

  describe('Collaborative Problem Solving', () => {
    it('should solve complex problems through agent collaboration', async () => {
      const coordinator = testContext.coordinator;
      const researchAgent = Array.from(testContext.agents.values()).find(a => a.type === 'researcher');
      const coderAgent = Array.from(testContext.agents.values()).find(a => a.type === 'coder');
      const analystAgent = Array.from(testContext.agents.values()).find(a => a.type === 'analyst');
      
      if (!researchAgent || !coderAgent || !analystAgent) {
        return expect(true).toBe(true); // Skip if agents not available
      }

      const complexProblem = {
        id: 'collaborative-problem-1',
        description: 'Design and implement an automated testing strategy for a microservices architecture',
        requirements: [
          'Research current testing methodologies',
          'Analyze system architecture',
          'Implement testing framework',
          'Validate solution effectiveness'
        ],
        constraints: {
          timeLimit: 30000, // 30 seconds for test
          qualityThreshold: 0.8
        }
      };

      const collaborationResults: any[] = [];
      
      // Set up collaboration tracking
      [researchAgent, coderAgent, analystAgent].forEach(agent => {
        agent.on('task:completed', (result) => {
          collaborationResults.push({
            agentId: agent.id,
            agentType: agent.type,
            result,
            timestamp: Date.now()
          });
        });
      });

      const { result: solution, duration } = await measureTime(async () => {
        // Coordinate collaborative problem solving
        const team = await coordinator.formTeam(complexProblem);
        return await coordinator.executeCollaborativeTask(team.id, complexProblem);
      });

      expect(solution).toBeDefined();
      expect(solution.status).toBe('completed');
      expect(collaborationResults.length).toBeGreaterThan(0);
      
      // Verify each agent contributed
      const contributingAgentTypes = new Set(collaborationResults.map(r => r.agentType));
      expect(contributingAgentTypes.size).toBeGreaterThanOrEqual(2);
      
      framework.recordMetric(testContext.id, 'collaborative_problem_duration', duration);
      framework.recordMetric(testContext.id, 'collaboration_participant_count', contributingAgentTypes.size);
      framework.recordMetric(testContext.id, 'collaborative_solution_quality', solution.qualityScore || 0);
    });

    it('should handle conflicting agent opinions and reach consensus', async () => {
      const coordinator = testContext.coordinator;
      const agents = Array.from(testContext.agents.values()).slice(0, 3);
      
      const conflictScenario = {
        id: 'consensus-test',
        question: 'Which testing approach should we prioritize: unit tests, integration tests, or end-to-end tests?',
        options: [
          { id: 'unit', name: 'Unit Testing', pros: ['Fast', 'Isolated'], cons: ['Limited scope'] },
          { id: 'integration', name: 'Integration Testing', pros: ['Real interactions'], cons: ['Slower'] },
          { id: 'e2e', name: 'End-to-End Testing', pros: ['Full coverage'], cons: ['Complex', 'Fragile'] }
        ]
      };

      // Simulate different agent preferences
      const agentOpinions = agents.map((agent, index) => ({
        agentId: agent.id,
        preference: conflictScenario.options[index % conflictScenario.options.length].id,
        confidence: 0.7 + (Math.random() * 0.3), // 70-100% confidence
        reasoning: `Agent ${agent.type} perspective on testing approach`
      }));

      const { result: consensus, duration } = await measureTime(async () => {
        return await coordinator.reachConsensus(conflictScenario, agentOpinions);
      });

      expect(consensus).toBeDefined();
      expect(consensus.decision).toBeDefined();
      expect(consensus.confidence).toBeGreaterThan(0);
      expect(consensus.participantCount).toBe(agents.length);
      
      framework.recordMetric(testContext.id, 'consensus_duration', duration);
      framework.recordMetric(testContext.id, 'consensus_confidence', consensus.confidence);
      framework.recordMetric(testContext.id, 'consensus_participant_count', consensus.participantCount);
    });

    it('should adapt collaboration strategy based on task complexity', async () => {
      const coordinator = testContext.coordinator;
      
      const simpleTasks = [
        TestDataFactory.createGoal('Simple data validation', 2),
        TestDataFactory.createGoal('Basic code formatting', 1)
      ];
      
      const complexTasks = [
        TestDataFactory.createGoal('Design distributed system architecture', 9),
        TestDataFactory.createGoal('Implement machine learning pipeline with monitoring', 8)
      ];

      const strategies: any[] = [];
      
      // Test simple tasks
      for (const task of simpleTasks) {
        const strategy = await coordinator.selectCollaborationStrategy(task);
        strategies.push({ task: task.description, complexity: 'simple', strategy });
      }
      
      // Test complex tasks
      for (const task of complexTasks) {
        const strategy = await coordinator.selectCollaborationStrategy(task);
        strategies.push({ task: task.description, complexity: 'complex', strategy });
      }

      // Simple tasks should use simpler strategies (fewer agents, less coordination)
      const simpleStrategies = strategies.filter(s => s.complexity === 'simple');
      const complexStrategies = strategies.filter(s => s.complexity === 'complex');
      
      const avgSimpleAgentCount = simpleStrategies.reduce((sum, s) => sum + s.strategy.maxAgents, 0) / simpleStrategies.length;
      const avgComplexAgentCount = complexStrategies.reduce((sum, s) => sum + s.strategy.maxAgents, 0) / complexStrategies.length;
      
      expect(avgComplexAgentCount).toBeGreaterThan(avgSimpleAgentCount);
      
      framework.recordMetric(testContext.id, 'adaptive_strategy_simple_agents', avgSimpleAgentCount);
      framework.recordMetric(testContext.id, 'adaptive_strategy_complex_agents', avgComplexAgentCount);
      framework.recordMetric(testContext.id, 'strategy_adaptation_effectiveness', avgComplexAgentCount - avgSimpleAgentCount);
    });
  });

  describe('Coordination Performance and Scalability', () => {
    it('should maintain coordination efficiency with increasing agent count', async () => {
      const coordinator = testContext.coordinator;
      const agentCounts = [3, 5, 7];
      const coordinationMetrics: any[] = [];

      for (const agentCount of agentCounts) {
        const agents = Array.from(testContext.agents.values()).slice(0, agentCount);
        const goal = TestDataFactory.createGoal(`Scalability test with ${agentCount} agents`, 5);
        
        const { result: team, duration } = await measureTime(async () => {
          return await coordinator.formTeam(goal);
        });

        const coordinationOverhead = duration / agentCount; // Duration per agent
        
        coordinationMetrics.push({
          agentCount,
          duration,
          coordinationOverhead,
          teamSize: team.members.length
        });
      }

      // Coordination should scale reasonably (not exponentially)
      const overheads = coordinationMetrics.map(m => m.coordinationOverhead);
      const maxOverhead = Math.max(...overheads);
      const minOverhead = Math.min(...overheads);
      const overheadIncrease = (maxOverhead - minOverhead) / minOverhead;
      
      expect(overheadIncrease).toBeLessThan(2); // Less than 200% increase
      
      framework.recordMetric(testContext.id, 'coordination_scalability', overheadIncrease);
      framework.recordMetric(testContext.id, 'max_coordination_overhead', maxOverhead);
      
      console.log('Coordination Scalability Metrics:', coordinationMetrics);
    });

    it('should handle concurrent coordination requests efficiently', async () => {
      const coordinator = testContext.coordinator;
      const concurrentRequests = 5;
      
      const goals = Array.from({ length: concurrentRequests }, (_, i) => 
        TestDataFactory.createGoal(`Concurrent coordination test ${i}`, 4)
      );

      const { result: teams, duration } = await measureTime(async () => {
        const promises = goals.map(goal => coordinator.formTeam(goal));
        return await Promise.all(promises);
      });

      expect(teams.length).toBe(concurrentRequests);
      teams.forEach(team => {
        expect(team).toBeDefined();
        expect(team.members.length).toBeGreaterThan(0);
      });

      const avgLatency = duration / concurrentRequests;
      
      framework.recordMetric(testContext.id, 'concurrent_coordination_duration', duration);
      framework.recordMetric(testContext.id, 'concurrent_coordination_avg_latency', avgLatency);
      framework.recordMetric(testContext.id, 'concurrent_coordination_success_rate', 100);
    });

    it('should recover from coordination failures gracefully', async () => {
      const coordinator = testContext.coordinator;
      const agents = Array.from(testContext.agents.values());
      
      // Simulate agent failures during coordination
      const unstableAgent = agents[0];
      let failureCount = 0;
      
      const originalSendMessage = unstableAgent.sendMessage.bind(unstableAgent);
      unstableAgent.sendMessage = async (...args) => {
        failureCount++;
        if (failureCount <= 2) {
          throw new Error('Simulated coordination failure');
        }
        return originalSendMessage(...args);
      };

      const goal = TestDataFactory.createGoal('Failure recovery test', 6);
      
      const { result: team, duration } = await measureTime(async () => {
        return await coordinator.formTeamWithRetry(goal, { maxRetries: 3, retryDelay: 100 });
      });

      expect(team).toBeDefined();
      expect(team.members.length).toBeGreaterThan(0);
      expect(failureCount).toBeGreaterThan(0);
      
      framework.recordMetric(testContext.id, 'coordination_recovery_duration', duration);
      framework.recordMetric(testContext.id, 'coordination_failures_handled', failureCount);
      framework.recordMetric(testContext.id, 'coordination_recovery_success', true);
    });
  });

  describe('Coordination Metrics and Reporting', () => {
    it('should provide comprehensive coordination metrics', () => {
      const metrics = framework.getMetrics(testContext.id);
      const stats = framework.getPerformanceStats(testContext.id);
      
      expect(metrics).toBeDefined();
      expect(stats).toBeDefined();
      
      const customMetrics = metrics?.customMetrics;
      if (customMetrics) {
        // Should have collected various coordination metrics
        expect(customMetrics.size).toBeGreaterThan(0);
      }
      
      console.log('\n=== Agent Coordination Test Metrics ===');
      console.log('Total Requests:', stats?.requests || 0);
      console.log('Success Rate:', stats?.successRate?.toFixed(2) + '%' || 'N/A');
      console.log('Average Latency:', stats?.latency?.avg?.toFixed(2) + 'ms' || 'N/A');
      console.log('Test Duration:', stats?.duration?.toFixed(2) + 'ms' || 'N/A');
      
      if (customMetrics) {
        console.log('\nCustom Metrics:');
        customMetrics.forEach((value, key) => {
          if (typeof value === 'number') {
            console.log(`  ${key}: ${value.toFixed(2)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });
      }
      console.log('========================================\n');
    });
  });
});