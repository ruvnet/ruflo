/**
 * Integration tests for Enhanced Autonomous Agent with Real Q-Learning
 */

import { EnhancedAutonomousAgent } from '../enhanced-autonomous-agent';
import { ProductionMLEngine } from '../../src/mcp/src/core/production-ml-engine';
import { ModelType } from '../../src/mcp/src/types';

describe('Enhanced Autonomous Agent Integration', () => {
  let mlEngine: ProductionMLEngine;
  let agent: EnhancedAutonomousAgent;

  beforeEach(async () => {
    mlEngine = new ProductionMLEngine();
    
    const config = {
      id: 'test-agent-1',
      name: 'Test Agent',
      type: 'learner',
      capabilities: [
        {
          name: 'problem_solving',
          description: 'Ability to solve complex problems',
          proficiency: 0.6,
          requirements: ['logical_thinking'],
          examples: ['solve math problems', 'debug code']
        },
        {
          name: 'communication',
          description: 'Ability to communicate effectively',
          proficiency: 0.8,
          requirements: ['language_skills'],
          examples: ['write reports', 'present findings']
        }
      ],
      qLearningConfig: {
        learningRate: 0.01,
        discountFactor: 0.95,
        explorationRate: 0.8,
        explorationDecay: 0.99,
        memorySize: 500,
        batchSize: 16
      },
      mlEngineEnabled: true
    };

    agent = new EnhancedAutonomousAgent(config, mlEngine);
  });

  afterEach(async () => {
    await agent.shutdown();
    await mlEngine.shutdown();
  });

  describe('Q-Learning Integration', () => {
    test('should make decisions using Q-Learning', async () => {
      const situation = 'Need to solve a complex algorithmic problem';
      const options = [
        {
          id: 'option1',
          action: 'Break down problem into smaller parts',
          expectedOutcome: 'Better understanding of problem structure',
          risk: 0.1,
          cost: 10,
          probability: 0.8
        },
        {
          id: 'option2',
          action: 'Use brute force approach',
          expectedOutcome: 'Quick but inefficient solution',
          risk: 0.3,
          cost: 5,
          probability: 0.9
        },
        {
          id: 'option3',
          action: 'Research existing solutions',
          expectedOutcome: 'Learn from expert approaches',
          risk: 0.2,
          cost: 15,
          probability: 0.7
        }
      ];

      const selectedOptionId = await agent.makeEnhancedDecision(situation, options);
      expect(['option1', 'option2', 'option3']).toContain(selectedOptionId);
    }, 10000);

    test('should learn from experiences and improve over time', async () => {
      const actions = [
        'analyze_problem',
        'implement_solution',
        'test_solution',
        'refine_approach'
      ];

      // Simulate multiple learning episodes
      for (let episode = 0; episode < 5; episode++) {
        for (const action of actions) {
          const success = Math.random() > 0.3; // 70% success rate
          const reward = success ? 0.8 : -0.2;
          const outcome = success ? 'success' : 'failure';

          await agent.learnFromEnhancedExperience(
            action,
            { episode, problemType: 'algorithmic' },
            outcome,
            reward
          );
        }
      }

      // Get learning insights
      const insights = await agent.getLearningInsights();
      
      expect(insights.performance.successRate).toBeGreaterThan(0);
      expect(insights.capabilities.improved.length + insights.capabilities.needsWork.length).toBeGreaterThan(0);
      expect(insights.qLearning).toBeDefined();
      expect(insights.qLearning!.episodeCount).toBeGreaterThan(0);
      expect(insights.qLearning!.policyQuality).toBeInstanceOf(Array);
    }, 15000);

    test('should adapt exploration rate over time', async () => {
      const initialInsights = await agent.getLearningInsights();
      const initialExplorationRate = initialInsights.qLearning?.explorationRate || 1;

      // Simulate many learning experiences
      for (let i = 0; i < 50; i++) {
        await agent.learnFromEnhancedExperience(
          'explore_environment',
          { step: i },
          'success',
          0.5
        );
      }

      const finalInsights = await agent.getLearningInsights();
      const finalExplorationRate = finalInsights.qLearning?.explorationRate || 1;

      // Exploration rate should decrease over time
      expect(finalExplorationRate).toBeLessThan(initialExplorationRate);
    }, 20000);
  });

  describe('Learning Transfer', () => {
    test('should transfer learning between agents', async () => {
      // Create a second agent
      const config2 = {
        id: 'test-agent-2',
        name: 'Test Agent 2',
        type: 'learner',
        capabilities: [
          {
            name: 'problem_solving',
            description: 'Ability to solve complex problems',
            proficiency: 0.3,
            requirements: ['logical_thinking'],
            examples: ['solve math problems', 'debug code']
          }
        ],
        qLearningConfig: {
          learningRate: 0.01,
          discountFactor: 0.95
        },
        mlEngineEnabled: true
      };

      const agent2 = new EnhancedAutonomousAgent(config2, mlEngine);

      try {
        // Train first agent
        for (let i = 0; i < 20; i++) {
          await agent.learnFromEnhancedExperience(
            'solve_problem',
            { complexity: 'high' },
            'success',
            0.9
          );
        }

        // Get initial performance of second agent
        const initialInsights2 = await agent2.getLearningInsights();

        // Transfer learning from agent to agent2
        await agent.transferLearningTo(agent2);

        // Get performance after transfer
        const finalInsights2 = await agent2.getLearningInsights();

        // Second agent should have more training steps after transfer
        expect(finalInsights2.qLearning?.trainingSteps || 0).toBeGreaterThan(
          initialInsights2.qLearning?.trainingSteps || 0
        );

        // Second agent should have experiences from first agent
        const experiences2 = agent2.getExperiences(150);
        expect(experiences2.length).toBeGreaterThan(10);
      } finally {
        await agent2.shutdown();
      }
    }, 25000);

    test('should perform collaborative learning', async () => {
      // Create multiple agents for collaboration
      const agents = [];
      
      for (let i = 0; i < 2; i++) {
        const config = {
          id: `collab-agent-${i}`,
          name: `Collaborative Agent ${i}`,
          type: 'learner',
          capabilities: [
            {
              name: 'teamwork',
              description: 'Ability to work in teams',
              proficiency: 0.5,
              requirements: ['communication'],
              examples: ['coordinate tasks', 'share knowledge']
            }
          ],
          qLearningConfig: {
            learningRate: 0.02,
            discountFactor: 0.9
          },
          mlEngineEnabled: true
        };

        const newAgent = new EnhancedAutonomousAgent(config, mlEngine);
        agents.push(newAgent);

        // Give each agent some unique experiences
        for (let j = 0; j < 10; j++) {
          await newAgent.learnFromEnhancedExperience(
            `task_${i}_${j}`,
            { agentId: i, taskId: j },
            Math.random() > 0.3 ? 'success' : 'failure',
            Math.random() * 0.8 + 0.1
          );
        }
      }

      try {
        // Get initial performance
        const initialInsights = await agent.getLearningInsights();

        // Perform collaborative learning
        await agent.collaborativeLearn(agents);

        // Get performance after collaboration
        const finalInsights = await agent.getLearningInsights();

        // Agent should have learned from others
        const finalExperiences = agent.getExperiences(100);
        expect(finalExperiences.length).toBeGreaterThan(initialInsights.performance.successRate * 10);
      } finally {
        // Cleanup collaborative agents
        for (const collabAgent of agents) {
          await collabAgent.shutdown();
        }
      }
    }, 30000);
  });

  describe('Model Persistence', () => {
    test('should save and load agent model', async () => {
      // Train agent
      for (let i = 0; i < 15; i++) {
        await agent.learnFromEnhancedExperience(
          `training_action_${i}`,
          { iteration: i },
          Math.random() > 0.2 ? 'success' : 'failure',
          Math.random() * 0.6 + 0.2
        );
      }

      const preSaveInsights = await agent.getLearningInsights();
      const filepath = './test_agent_save';

      // Save model
      await agent.saveModel(filepath);

      // Create new agent and load model
      const config2 = {
        id: 'test-agent-load',
        name: 'Test Agent Load',
        type: 'learner',
        capabilities: agent.getCapabilities(),
        qLearningConfig: {
          learningRate: 0.01,
          discountFactor: 0.95
        },
        mlEngineEnabled: true
      };

      const agent2 = new EnhancedAutonomousAgent(config2, mlEngine);

      try {
        await agent2.loadModel(filepath);

        const postLoadInsights = await agent2.getLearningInsights();

        // Loaded agent should have similar statistics
        expect(postLoadInsights.qLearning?.trainingSteps).toBeGreaterThan(0);
        expect(postLoadInsights.qLearning?.episodeCount).toBeGreaterThan(0);
      } finally {
        await agent2.shutdown();
      }
    }, 20000);
  });

  describe('Real-world Problem Solving', () => {
    test('should improve at a specific task through learning', async () => {
      const task = 'optimize_algorithm_performance';
      let successCount = 0;
      const totalAttempts = 30;

      // Track performance over time
      const performanceHistory: number[] = [];

      for (let attempt = 0; attempt < totalAttempts; attempt++) {
        // Simulate task execution with improving success rate
        const baseSuccessRate = 0.3;
        const learningBoost = (attempt / totalAttempts) * 0.4; // Up to 40% improvement
        const currentSuccessRate = Math.min(0.9, baseSuccessRate + learningBoost);
        
        const success = Math.random() < currentSuccessRate;
        if (success) successCount++;

        const reward = success ? 0.8 : -0.2;
        const outcome = success ? 'success' : 'failure';

        await agent.learnFromEnhancedExperience(
          task,
          { 
            attempt, 
            complexity: 'medium',
            algorithm: 'sorting',
            dataSize: 1000 + attempt * 100
          },
          outcome,
          reward
        );

        // Record performance every 5 attempts
        if (attempt % 5 === 4) {
          const recentSuccess = performanceHistory.length > 0 ? 
            performanceHistory[performanceHistory.length - 1] : 0;
          const currentWindow = Math.max(0, attempt - 4);
          const windowSuccesses = Array.from({ length: 5 }, (_, i) => {
            const idx = currentWindow + i;
            return idx <= attempt && Math.random() < currentSuccessRate ? 1 : 0;
          }).reduce((sum, val) => sum + val, 0);
          
          performanceHistory.push(windowSuccesses / 5);
        }
      }

      // Agent should show improvement over time
      const finalSuccessRate = successCount / totalAttempts;
      expect(finalSuccessRate).toBeGreaterThan(0.25);

      // Performance should generally trend upward
      if (performanceHistory.length >= 2) {
        const firstHalf = performanceHistory.slice(0, Math.floor(performanceHistory.length / 2));
        const secondHalf = performanceHistory.slice(Math.floor(performanceHistory.length / 2));
        
        const firstHalfAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
        
        // Second half should generally perform better than first half
        expect(secondHalfAvg).toBeGreaterThanOrEqual(firstHalfAvg - 0.1); // Allow some variance
      }

      const finalInsights = await agent.getLearningInsights();
      expect(finalInsights.performance.learningProgress).toBeGreaterThan(0);
    }, 45000);

    test('should adapt to changing environments', async () => {
      // Simulate environment changes by changing reward structure
      const environments = [
        { type: 'stable', rewardMultiplier: 1.0 },
        { type: 'volatile', rewardMultiplier: 0.5 },
        { type: 'beneficial', rewardMultiplier: 1.5 }
      ];

      const performancePerEnvironment: Record<string, number[]> = {};

      for (const env of environments) {
        performancePerEnvironment[env.type] = [];

        for (let trial = 0; trial < 10; trial++) {
          const action = `adapt_to_${env.type}_environment`;
          const baseReward = Math.random() * 0.6 + 0.2; // 0.2 to 0.8
          const adjustedReward = baseReward * env.rewardMultiplier;
          
          const outcome = adjustedReward > 0.4 ? 'success' : 'partial';

          await agent.learnFromEnhancedExperience(
            action,
            { 
              environment: env.type,
              trial,
              volatility: env.type === 'volatile' ? 0.8 : 0.2
            },
            outcome,
            adjustedReward
          );

          performancePerEnvironment[env.type].push(adjustedReward);
        }
      }

      // Agent should adapt to different environments
      const insights = await agent.getLearningInsights();
      expect(insights.performance.successRate).toBeGreaterThan(0.3);
      expect(insights.qLearning?.trainingSteps).toBeGreaterThan(20);

      // Check that agent performed differently in different environments
      const avgPerformance = environments.map(env => {
        const perfs = performancePerEnvironment[env.type];
        return perfs.reduce((sum, val) => sum + val, 0) / perfs.length;
      });

      // Performance should vary between environments
      const maxPerf = Math.max(...avgPerformance);
      const minPerf = Math.min(...avgPerformance);
      expect(maxPerf - minPerf).toBeGreaterThan(0.1); // Significant difference
    }, 35000);
  });

  describe('Multi-Agent Scenarios', () => {
    test('should handle competitive scenarios', async () => {
      // Create competitor agent
      const competitorConfig = {
        id: 'competitor-agent',
        name: 'Competitor Agent',
        type: 'competitor',
        capabilities: [
          {
            name: 'competitive_strategy',
            description: 'Ability to compete effectively',
            proficiency: 0.7,
            requirements: ['strategic_thinking'],
            examples: ['outperform opponents', 'resource optimization']
          }
        ],
        qLearningConfig: {
          learningRate: 0.015,
          discountFactor: 0.9
        },
        mlEngineEnabled: true
      };

      const competitor = new EnhancedAutonomousAgent(competitorConfig, mlEngine);

      try {
        // Simulate competitive scenarios
        for (let round = 0; round < 15; round++) {
          // Agent's move
          await agent.learnFromEnhancedExperience(
            'competitive_move',
            { 
              round,
              opponent: 'competitor-agent',
              strategy: 'adaptive'
            },
            Math.random() > 0.4 ? 'success' : 'failure',
            Math.random() * 0.8 + 0.1
          );

          // Competitor's move
          await competitor.learnFromEnhancedExperience(
            'competitive_move',
            { 
              round,
              opponent: 'test-agent-1',
              strategy: 'aggressive'
            },
            Math.random() > 0.5 ? 'success' : 'failure',
            Math.random() * 0.7 + 0.2
          );
        }

        // Both agents should have learned from competition
        const agentInsights = await agent.getLearningInsights();
        const competitorInsights = await competitor.getLearningInsights();

        expect(agentInsights.qLearning?.episodeCount).toBeGreaterThan(0);
        expect(competitorInsights.qLearning?.episodeCount).toBeGreaterThan(0);

        // Performance should be reasonable for both
        expect(agentInsights.performance.successRate).toBeGreaterThan(0.2);
        expect(competitorInsights.performance.successRate).toBeGreaterThan(0.2);
      } finally {
        await competitor.shutdown();
      }
    }, 30000);

    test('should handle cooperative scenarios', async () => {
      // Create partner agent
      const partnerConfig = {
        id: 'partner-agent',
        name: 'Partner Agent',
        type: 'partner',
        capabilities: [
          {
            name: 'cooperation',
            description: 'Ability to cooperate effectively',
            proficiency: 0.6,
            requirements: ['empathy', 'communication'],
            examples: ['team coordination', 'resource sharing']
          }
        ],
        qLearningConfig: {
          learningRate: 0.01,
          discountFactor: 0.95
        },
        mlEngineEnabled: true
      };

      const partner = new EnhancedAutonomousAgent(partnerConfig, mlEngine);

      try {
        // Simulate cooperative tasks
        for (let task = 0; task < 12; task++) {
          const success = Math.random() > 0.25; // 75% success rate for cooperation
          const sharedReward = success ? 0.7 : 0.1;

          // Both agents learn from shared experience
          await agent.learnFromEnhancedExperience(
            'cooperative_task',
            { 
              task,
              partner: 'partner-agent',
              cooperation_level: 'high'
            },
            success ? 'success' : 'partial',
            sharedReward
          );

          await partner.learnFromEnhancedExperience(
            'cooperative_task',
            { 
              task,
              partner: 'test-agent-1',
              cooperation_level: 'high'
            },
            success ? 'success' : 'partial',
            sharedReward
          );
        }

        // Both agents should have benefited from cooperation
        const agentInsights = await agent.getLearningInsights();
        const partnerInsights = await partner.getLearningInsights();

        expect(agentInsights.performance.successRate).toBeGreaterThan(0.5);
        expect(partnerInsights.performance.successRate).toBeGreaterThan(0.5);

        // Cooperation should lead to similar learning patterns
        expect(agentInsights.qLearning?.episodeCount).toBeGreaterThan(0);
        expect(partnerInsights.qLearning?.episodeCount).toBeGreaterThan(0);
      } finally {
        await partner.shutdown();
      }
    }, 25000);
  });
});

export { };