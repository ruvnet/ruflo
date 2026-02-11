/**
 * Pattern Coordination Plugin - MCP Tools Tests
 *
 * Tests for MCP tool handlers with mock data
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  neuralCoordinationTools,
  getTool,
  getToolNames,
} from '../src/mcp-tools.js';

describe('neuralCoordinationTools', () => {
  it('should export 5 MCP tools', () => {
    expect(neuralCoordinationTools).toHaveLength(5);
  });

  it('should have unique tool names', () => {
    const names = neuralCoordinationTools.map(t => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('should have required tool properties', () => {
    for (const tool of neuralCoordinationTools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });
});

describe('getTool', () => {
  it('should return tool by name', () => {
    const tool = getTool('coordination/pattern-agreement');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('coordination/pattern-agreement');
  });

  it('should return undefined for unknown tool', () => {
    const tool = getTool('unknown/tool');
    expect(tool).toBeUndefined();
  });
});

describe('getToolNames', () => {
  it('should return array of tool names', () => {
    const names = getToolNames();
    expect(names).toContain('coordination/pattern-agreement');
    expect(names).toContain('coordination/topology-optimize');
    expect(names).toContain('coordination/collective-memory');
    expect(names).toContain('coordination/emergent-protocol');
    expect(names).toContain('coordination/swarm-behavior');
  });
});

describe('coordination/pattern-agreement handler', () => {
  const tool = getTool('coordination/pattern-agreement')!;

  it('should handle valid input', async () => {
    const input = {
      proposal: {
        topic: 'Choose deployment strategy',
        options: [
          { id: 'blue-green', value: { risk: 0.2, speed: 0.8 } },
          { id: 'canary', value: { risk: 0.5, speed: 0.5 } },
        ],
      },
      agents: [
        { id: 'agent-1', preferences: { risk: -0.5, speed: 0.8 } },
        { id: 'agent-2', preferences: { risk: -0.8, speed: 0.3 } },
        { id: 'agent-3', preferences: { risk: 0.2, speed: 0.9 } },
      ],
      protocol: 'neural_voting',
      maxRounds: 5,
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed).toHaveProperty('consensusReached');
    expect(parsed).toHaveProperty('agreementRatio');
    expect(parsed).toHaveProperty('details');
  });

  it('should return error for insufficient agents', async () => {
    const input = {
      proposal: {
        topic: 'Test',
        options: [
          { id: '1', value: 1 },
          { id: '2', value: 2 },
        ],
      },
      agents: [{ id: 'agent-1' }],  // Need at least 2
    };

    const result = await tool.handler(input);

    expect(result.isError).toBe(true);
  });

  it('should handle all protocols', async () => {
    const protocols = ['neural_voting', 'iterative_refinement', 'auction', 'contract_net'];

    for (const protocol of protocols) {
      const input = {
        proposal: {
          topic: 'Test',
          options: [{ id: '1', value: 1 }, { id: '2', value: 2 }],
        },
        agents: [{ id: 'a1' }, { id: 'a2' }],
        protocol,
      };

      const result = await tool.handler(input);
      expect(result.isError).toBeUndefined();
    }
  });

  it('should report divergent agents', async () => {
    const input = {
      proposal: {
        topic: 'Contentious topic',
        options: [
          { id: 'option-a', value: { x: 1 } },
          { id: 'option-b', value: { x: -1 } },
        ],
      },
      agents: [
        { id: 'agent-1', preferences: { x: 1 } },
        { id: 'agent-2', preferences: { x: -1 } },
      ],
      maxRounds: 3,
    };

    const result = await tool.handler(input);
    const parsed = JSON.parse(result.content[0].text!);

    expect(parsed.details).toHaveProperty('divergentAgents');
    expect(Array.isArray(parsed.details.divergentAgents)).toBe(true);
  });
});

describe('coordination/topology-optimize handler', () => {
  const tool = getTool('coordination/topology-optimize')!;

  it('should handle valid input', async () => {
    const input = {
      agents: [
        { id: 'agent-1', capabilities: ['code', 'test'], location: { x: 0, y: 0 } },
        { id: 'agent-2', capabilities: ['review'], location: { x: 1, y: 0 } },
        { id: 'agent-3', capabilities: ['deploy'], location: { x: 0, y: 1 } },
      ],
      objective: 'minimize_latency',
      constraints: {
        maxConnections: 5,
        preferredTopology: 'mesh',
      },
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed).toHaveProperty('topology');
    expect(parsed).toHaveProperty('edges');
    expect(parsed).toHaveProperty('metrics');
  });

  it('should return error for insufficient agents', async () => {
    const input = {
      agents: [{ id: 'agent-1' }],  // Need at least 2
    };

    const result = await tool.handler(input);

    expect(result.isError).toBe(true);
  });

  it('should handle all topology types', async () => {
    const topologies = ['mesh', 'tree', 'ring', 'star', 'hybrid'];

    for (const preferredTopology of topologies) {
      const input = {
        agents: [
          { id: 'a1' },
          { id: 'a2' },
          { id: 'a3' },
        ],
        constraints: { preferredTopology },
      };

      const result = await tool.handler(input);
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.topology).toBe(preferredTopology);
    }
  });

  it('should compute topology metrics', async () => {
    const input = {
      agents: [
        { id: 'a1', capabilities: ['code'] },
        { id: 'a2', capabilities: ['code', 'test'] },
        { id: 'a3', capabilities: ['test'] },
      ],
    };

    const result = await tool.handler(input);
    const parsed = JSON.parse(result.content[0].text!);

    expect(parsed.metrics).toHaveProperty('avgLatency');
    expect(parsed.metrics).toHaveProperty('redundancy');
    expect(parsed.metrics).toHaveProperty('diameter');
    expect(parsed.metrics).toHaveProperty('avgDegree');
  });
});

describe('coordination/collective-memory handler', () => {
  const tool = getTool('coordination/collective-memory')!;

  it('should handle store action', async () => {
    const input = {
      action: 'store',
      memory: {
        key: 'shared-context',
        value: { data: 'test-data' },
        importance: 0.8,
      },
      scope: 'team',
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.action).toBe('store');
    expect(parsed.success).toBe(true);
  });

  it('should handle retrieve action', async () => {
    // First store
    await tool.handler({
      action: 'store',
      memory: { key: 'test-key', value: 'test-value' },
      scope: 'team',
    });

    // Then retrieve
    const result = await tool.handler({
      action: 'retrieve',
      memory: { key: 'test-key' },
      scope: 'team',
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.action).toBe('retrieve');
  });

  it('should handle consolidate action', async () => {
    const input = {
      action: 'consolidate',
      scope: 'team',
      consolidationStrategy: 'ewc',
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.action).toBe('consolidate');
  });

  it('should handle forget action', async () => {
    const input = {
      action: 'forget',
      memory: { key: 'obsolete-key' },
      scope: 'team',
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.action).toBe('forget');
  });

  it('should handle synchronize action', async () => {
    const input = {
      action: 'synchronize',
      scope: 'global',
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.action).toBe('synchronize');
  });

  it('should return error for missing key on store', async () => {
    const input = {
      action: 'store',
      memory: { value: 'data' },  // Missing key
    };

    const result = await tool.handler(input);

    expect(result.isError).toBe(true);
  });
});

describe('coordination/emergent-protocol handler', () => {
  const tool = getTool('coordination/emergent-protocol')!;

  it('should handle valid input', async () => {
    const input = {
      task: {
        type: 'coordination',
        objectives: ['reach consensus', 'minimize messages'],
      },
      communicationBudget: {
        symbolsPerMessage: 5,
        messagesPerRound: 2,
      },
      trainingEpisodes: 100,
      interpretability: true,
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed).toHaveProperty('protocolLearned');
    expect(parsed).toHaveProperty('vocabularySize');
    expect(parsed).toHaveProperty('successRate');
  });

  it('should generate symbols for task objectives', async () => {
    const input = {
      task: {
        type: 'navigation',
        objectives: ['find target', 'avoid obstacles', 'report position'],
      },
      trainingEpisodes: 500,
    };

    const result = await tool.handler(input);
    const parsed = JSON.parse(result.content[0].text!);

    expect(parsed.vocabularySize).toBeGreaterThan(0);
    expect(parsed.details.symbols.length).toBeGreaterThan(0);
  });

  it('should generate composition rules when interpretability enabled', async () => {
    const input = {
      task: {
        type: 'test',
        objectives: ['goal-1'],
      },
      interpretability: true,
    };

    const result = await tool.handler(input);
    const parsed = JSON.parse(result.content[0].text!);

    expect(Array.isArray(parsed.details.compositionRules)).toBe(true);
    expect(parsed.details.compositionRules.length).toBeGreaterThan(0);
  });
});

describe('coordination/swarm-behavior handler', () => {
  const tool = getTool('coordination/swarm-behavior')!;

  it('should handle valid input', async () => {
    const input = {
      behavior: 'flocking',
      parameters: { separationWeight: 1.0 },
      adaptiveRules: true,
      observability: {
        recordTrajectories: true,
        measureEmergence: true,
      },
    };

    const result = await tool.handler(input);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.behaviorActive).toBe(true);
    expect(parsed).toHaveProperty('metrics');
  });

  it('should handle all behavior types', async () => {
    const behaviors = [
      'flocking', 'foraging', 'formation', 'task_allocation',
      'exploration', 'aggregation', 'dispersion',
    ];

    for (const behavior of behaviors) {
      const input = { behavior };
      const result = await tool.handler(input);

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.details.behavior).toBe(behavior);
    }
  });

  it('should compute swarm metrics', async () => {
    const input = {
      behavior: 'flocking',
    };

    const result = await tool.handler(input);
    const parsed = JSON.parse(result.content[0].text!);

    expect(parsed.metrics).toHaveProperty('cohesion');
    expect(parsed.metrics).toHaveProperty('alignment');
    expect(parsed.metrics).toHaveProperty('separation');
    expect(parsed.metrics).toHaveProperty('emergenceScore');

    // All metrics should be in [0, 1] range
    expect(parsed.metrics.cohesion).toBeGreaterThanOrEqual(0);
    expect(parsed.metrics.cohesion).toBeLessThanOrEqual(1);
  });

  it('should return error for invalid behavior', async () => {
    const input = {
      behavior: 'invalid_behavior',
    };

    const result = await tool.handler(input);

    expect(result.isError).toBe(true);
  });
});

describe('Tool metadata', () => {
  it('should have correct categories', () => {
    for (const tool of neuralCoordinationTools) {
      expect(tool.category).toBe('coordination');
    }
  });

  it('should have version numbers', () => {
    for (const tool of neuralCoordinationTools) {
      expect(tool.version).toBeDefined();
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('should have tags', () => {
    for (const tool of neuralCoordinationTools) {
      expect(Array.isArray(tool.tags)).toBe(true);
      expect(tool.tags!.length).toBeGreaterThan(0);
    }
  });
});
