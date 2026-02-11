/**
 * Pattern Coordination Plugin - Types Tests
 *
 * Tests for Zod schemas and type validation
 */

import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  ProposalSchema,
  NeuralConsensusInputSchema,
  TopologyOptimizeInputSchema,
  CollectiveMemoryInputSchema,
  EmergentProtocolInputSchema,
  SwarmBehaviorInputSchema,
  successResult,
  errorResult,
  cosineSimilarity,
  DEFAULT_CONFIG,
} from '../src/types.js';

describe('AgentSchema', () => {
  it('should validate valid agent', () => {
    const validAgent = {
      id: 'agent-1',
      preferences: { speed: 0.8, accuracy: -0.3 },
      capabilities: ['code', 'test'],
      location: { x: 1.0, y: 2.0, z: 3.0 },
      embedding: [0.1, 0.2, 0.3, 0.4],
    };

    const result = AgentSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it('should accept minimal agent with just id', () => {
    const result = AgentSchema.safeParse({ id: 'agent-1' });
    expect(result.success).toBe(true);
  });

  it('should reject agent without id', () => {
    const result = AgentSchema.safeParse({ preferences: {} });
    expect(result.success).toBe(false);
  });

  it('should reject id exceeding max length', () => {
    const result = AgentSchema.safeParse({ id: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('should reject preference values outside [-1, 1]', () => {
    const result = AgentSchema.safeParse({
      id: 'agent-1',
      preferences: { value: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it('should accept 2D location without z', () => {
    const result = AgentSchema.safeParse({
      id: 'agent-1',
      location: { x: 1.0, y: 2.0 },
    });
    expect(result.success).toBe(true);
  });
});

describe('ProposalSchema', () => {
  it('should validate valid proposal', () => {
    const validProposal = {
      topic: 'Select deployment strategy',
      options: [
        { id: 'opt-1', value: 'blue-green' },
        { id: 'opt-2', value: 'canary' },
      ],
      constraints: { maxDowntime: 0 },
    };

    const result = ProposalSchema.safeParse(validProposal);
    expect(result.success).toBe(true);
  });

  it('should require at least 2 options', () => {
    const result = ProposalSchema.safeParse({
      topic: 'Test',
      options: [{ id: 'opt-1', value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject topic exceeding max length', () => {
    const result = ProposalSchema.safeParse({
      topic: 'a'.repeat(1001),
      options: [{ id: '1', value: 1 }, { id: '2', value: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject more than 100 options', () => {
    const options = Array.from({ length: 101 }, (_, i) => ({
      id: `opt-${i}`,
      value: i,
    }));
    const result = ProposalSchema.safeParse({ topic: 'Test', options });
    expect(result.success).toBe(false);
  });
});

describe('NeuralConsensusInputSchema', () => {
  it('should validate valid consensus input', () => {
    const validInput = {
      proposal: {
        topic: 'Choose framework',
        options: [
          { id: '1', value: 'react' },
          { id: '2', value: 'vue' },
        ],
      },
      agents: [
        { id: 'agent-1' },
        { id: 'agent-2' },
      ],
      protocol: 'neural_voting',
      maxRounds: 5,
    };

    const result = NeuralConsensusInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should require at least 2 agents', () => {
    const result = NeuralConsensusInputSchema.safeParse({
      proposal: {
        topic: 'Test',
        options: [{ id: '1', value: 1 }, { id: '2', value: 2 }],
      },
      agents: [{ id: 'agent-1' }],
    });
    expect(result.success).toBe(false);
  });

  it('should use default protocol and maxRounds', () => {
    const input = {
      proposal: {
        topic: 'Test',
        options: [{ id: '1', value: 1 }, { id: '2', value: 2 }],
      },
      agents: [{ id: 'agent-1' }, { id: 'agent-2' }],
    };

    const result = NeuralConsensusInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocol).toBe('iterative_refinement');
      expect(result.data.maxRounds).toBe(10);
    }
  });

  it('should accept all valid protocols', () => {
    const protocols = ['neural_voting', 'iterative_refinement', 'auction', 'contract_net'] as const;

    for (const protocol of protocols) {
      const input = {
        proposal: {
          topic: 'Test',
          options: [{ id: '1', value: 1 }, { id: '2', value: 2 }],
        },
        agents: [{ id: 'a1' }, { id: 'a2' }],
        protocol,
      };
      const result = NeuralConsensusInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });
});

describe('TopologyOptimizeInputSchema', () => {
  it('should validate valid topology input', () => {
    const validInput = {
      agents: [
        { id: 'agent-1', capabilities: ['code'] },
        { id: 'agent-2', capabilities: ['test'] },
      ],
      objective: 'minimize_latency',
      constraints: {
        maxConnections: 5,
        minRedundancy: 0.3,
        preferredTopology: 'mesh',
      },
    };

    const result = TopologyOptimizeInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should use default objective', () => {
    const input = {
      agents: [{ id: 'a1' }, { id: 'a2' }],
    };

    const result = TopologyOptimizeInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objective).toBe('minimize_latency');
    }
  });

  it('should accept all valid objectives', () => {
    const objectives = ['minimize_latency', 'maximize_throughput', 'minimize_hops', 'fault_tolerant'] as const;

    for (const objective of objectives) {
      const input = {
        agents: [{ id: 'a1' }, { id: 'a2' }],
        objective,
      };
      const result = TopologyOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all valid topology types', () => {
    const topologies = ['mesh', 'tree', 'ring', 'star', 'hybrid'] as const;

    for (const preferredTopology of topologies) {
      const input = {
        agents: [{ id: 'a1' }, { id: 'a2' }],
        constraints: { preferredTopology },
      };
      const result = TopologyOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });
});

describe('CollectiveMemoryInputSchema', () => {
  it('should validate valid store action', () => {
    const validInput = {
      action: 'store',
      memory: {
        key: 'shared-context',
        value: { data: 'test' },
        importance: 0.8,
      },
      scope: 'team',
    };

    const result = CollectiveMemoryInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept all valid actions', () => {
    const actions = ['store', 'retrieve', 'consolidate', 'forget', 'synchronize'] as const;

    for (const action of actions) {
      const input = { action };
      const result = CollectiveMemoryInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should use default scope and consolidation strategy', () => {
    const input = { action: 'store' };

    const result = CollectiveMemoryInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe('team');
      expect(result.data.consolidationStrategy).toBe('ewc');
    }
  });

  it('should reject importance outside [0, 1]', () => {
    const result = CollectiveMemoryInputSchema.safeParse({
      action: 'store',
      memory: { importance: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

describe('EmergentProtocolInputSchema', () => {
  it('should validate valid protocol input', () => {
    const validInput = {
      task: {
        type: 'coordination',
        objectives: ['achieve consensus', 'minimize communication'],
      },
      communicationBudget: {
        symbolsPerMessage: 5,
        messagesPerRound: 2,
      },
      trainingEpisodes: 500,
      interpretability: true,
    };

    const result = EmergentProtocolInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should use default training episodes', () => {
    const input = {
      task: {
        type: 'test',
        objectives: ['goal-1'],
      },
    };

    const result = EmergentProtocolInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trainingEpisodes).toBe(1000);
    }
  });

  it('should reject training episodes below minimum', () => {
    const result = EmergentProtocolInputSchema.safeParse({
      task: { type: 'test', objectives: [] },
      trainingEpisodes: 5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject training episodes above maximum', () => {
    const result = EmergentProtocolInputSchema.safeParse({
      task: { type: 'test', objectives: [] },
      trainingEpisodes: 15000,
    });
    expect(result.success).toBe(false);
  });
});

describe('SwarmBehaviorInputSchema', () => {
  it('should validate valid swarm behavior input', () => {
    const validInput = {
      behavior: 'flocking',
      parameters: { separationWeight: 1.0, alignmentWeight: 1.0 },
      adaptiveRules: true,
      observability: {
        recordTrajectories: true,
        measureEmergence: true,
      },
    };

    const result = SwarmBehaviorInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept all valid behavior types', () => {
    const behaviors = [
      'flocking', 'foraging', 'formation', 'task_allocation',
      'exploration', 'aggregation', 'dispersion',
    ] as const;

    for (const behavior of behaviors) {
      const input = { behavior };
      const result = SwarmBehaviorInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should use default adaptiveRules', () => {
    const input = { behavior: 'flocking' };

    const result = SwarmBehaviorInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adaptiveRules).toBe(true);
    }
  });
});

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const vec = [1, 2, 3];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const vec1 = [1, 0];
    const vec2 = [0, 1];
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const vec1 = [1, 0];
    const vec2 = [-1, 0];
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1, 5);
  });

  it('should handle Float32Array inputs', () => {
    const vec1 = new Float32Array([1, 2, 3]);
    const vec2 = new Float32Array([4, 5, 6]);
    const result = cosineSimilarity(vec1, vec2);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('should return 0 for zero vectors', () => {
    const zeroVec = [0, 0, 0];
    const vec = [1, 2, 3];
    expect(cosineSimilarity(zeroVec, vec)).toBe(0);
  });

  it('should throw for vectors of different lengths', () => {
    const vec1 = [1, 2, 3];
    const vec2 = [1, 2];
    expect(() => cosineSimilarity(vec1, vec2)).toThrow();
  });
});

describe('successResult', () => {
  it('should create success result with JSON data', () => {
    const data = { consensus: true, score: 0.95 };
    const result = successResult(data);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.voting).toBe(true);
  });
});

describe('errorResult', () => {
  it('should create error result', () => {
    const result = errorResult(new Error('Consensus failed'));

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('Consensus failed');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('should have valid consensus config', () => {
    expect(DEFAULT_CONFIG.voting.maxRounds).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.voting.convergenceThreshold).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.voting.convergenceThreshold).toBeLessThanOrEqual(1);
  });

  it('should have valid topology config', () => {
    expect(DEFAULT_CONFIG.topology.maxConnections).toBeGreaterThan(0);
  });

  it('should have valid memory config', () => {
    expect(DEFAULT_CONFIG.memory.consolidationInterval).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.memory.maxEntries).toBeGreaterThan(0);
  });

  it('should have valid swarm config', () => {
    expect(DEFAULT_CONFIG.swarm.adaptationRate).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.swarm.adaptationRate).toBeLessThanOrEqual(1);
  });
});
