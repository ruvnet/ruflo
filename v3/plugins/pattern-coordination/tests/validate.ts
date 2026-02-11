/**
 * Validation script for pattern-coordination plugin
 * Tests all 5 MCP tools with valid data
 */

import { neuralCoordinationTools, getTool, getToolNames } from '../dist/mcp-tools.js';
import type { MCPToolResult } from '../dist/types.js';

// Helper to parse MCP result
function parseResult(result: MCPToolResult): { success: boolean; data: any; error?: string } {
  if (result.isError) {
    const parsed = JSON.parse(result.content[0]?.text || '{}');
    return { success: false, data: null, error: parsed.message || 'Unknown error' };
  }
  const data = JSON.parse(result.content[0]?.text || '{}');
  return { success: true, data };
}

async function validate() {
  console.log('=== Pattern Coordination Plugin Validation ===\n');

  const toolNames = getToolNames();
  console.log(`Found ${toolNames.length} tools: ${toolNames.join(', ')}\n`);

  let passed = 0;
  let failed = 0;
  const results: { tool: string; status: string; error?: string }[] = [];

  // Test 1: coordination/pattern-agreement
  try {
    console.log('Testing coordination/pattern-agreement...');
    const tool = getTool('coordination/pattern-agreement');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      proposal: {
        topic: 'Select optimal caching strategy',
        options: [
          { id: 'redis', value: { latency: 5, cost: 100 } },
          { id: 'memcached', value: { latency: 3, cost: 80 } },
          { id: 'in-memory', value: { latency: 1, cost: 50 } },
        ],
        constraints: { maxCost: 200 }
      },
      agents: [
        { id: 'agent-1', preferences: { latency: 0.8, cost: 0.2 } },
        { id: 'agent-2', preferences: { latency: 0.3, cost: 0.7 } },
        { id: 'agent-3', preferences: { latency: 0.5, cost: 0.5 } },
      ],
      protocol: 'iterative_refinement',
      maxRounds: 10
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (typeof data.consensusReached !== 'boolean') throw new Error('Invalid response format');
    if (typeof data.agreementRatio !== 'number') throw new Error('Missing agreementRatio');

    console.log(`  OK: Consensus reached: ${data.consensusReached}, agreement: ${(data.agreementRatio * 100).toFixed(1)}%`);
    passed++;
    results.push({ tool: 'coordination/pattern-agreement', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'coordination/pattern-agreement', status: 'FAIL', error: e.message });
  }

  // Test 2: coordination/topology-optimize
  try {
    console.log('Testing coordination/topology-optimize...');
    const tool = getTool('coordination/topology-optimize');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      agents: [
        { id: 'coder-1', capabilities: ['typescript', 'testing'], location: { x: 0, y: 0 } },
        { id: 'coder-2', capabilities: ['python', 'ml'], location: { x: 10, y: 0 } },
        { id: 'reviewer', capabilities: ['typescript', 'python', 'security'], location: { x: 5, y: 5 } },
        { id: 'architect', capabilities: ['design', 'typescript'], location: { x: 5, y: 0 } },
      ],
      objective: 'minimize_latency',
      constraints: {
        maxConnections: 10,
        minRedundancy: 0.3,
        preferredTopology: 'hybrid'
      }
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.edges)) throw new Error('Invalid response format');
    if (!data.metrics) throw new Error('Missing metrics');

    console.log(`  OK: ${data.edges.length} edges, avg latency: ${data.metrics.avgLatency.toFixed(3)}`);
    passed++;
    results.push({ tool: 'coordination/topology-optimize', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'coordination/topology-optimize', status: 'FAIL', error: e.message });
  }

  // Test 3: coordination/collective-memory
  try {
    console.log('Testing coordination/collective-memory...');
    const tool = getTool('coordination/collective-memory');
    if (!tool) throw new Error('Tool not found');

    // Store operation
    let rawResult = await tool.handler({
      action: 'store',
      memory: {
        key: 'test-key-1',
        value: { data: 'test data', timestamp: Date.now() },
        importance: 0.8
      },
      scope: 'team'
    });

    let { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);

    // Retrieve operation
    rawResult = await tool.handler({
      action: 'retrieve',
      memory: { key: 'test-key-1' },
      scope: 'team'
    });

    ({ success, data, error } = parseResult(rawResult));
    if (!success) throw new Error(error);

    // Consolidate operation
    rawResult = await tool.handler({
      action: 'consolidate',
      scope: 'team',
      consolidationStrategy: 'ewc'
    });

    ({ success, data, error } = parseResult(rawResult));
    if (!success) throw new Error(error);

    console.log(`  OK: Store/Retrieve/Consolidate operations successful`);
    passed++;
    results.push({ tool: 'coordination/collective-memory', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'coordination/collective-memory', status: 'FAIL', error: e.message });
  }

  // Test 4: coordination/emergent-protocol
  try {
    console.log('Testing coordination/emergent-protocol...');
    const tool = getTool('coordination/emergent-protocol');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      task: {
        type: 'coordination',
        objectives: ['task_assignment', 'status_reporting', 'resource_sharing'],
        constraints: { maxMessageLength: 100 }
      },
      communicationBudget: {
        symbolsPerMessage: 10,
        messagesPerRound: 3
      },
      trainingEpisodes: 1000,
      interpretability: true
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (typeof data.protocolLearned !== 'boolean') throw new Error('Invalid response format');
    if (typeof data.vocabularySize !== 'number') throw new Error('Missing vocabularySize');

    console.log(`  OK: Protocol learned: ${data.protocolLearned}, vocab size: ${data.vocabularySize}`);
    passed++;
    results.push({ tool: 'coordination/emergent-protocol', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'coordination/emergent-protocol', status: 'FAIL', error: e.message });
  }

  // Test 5: coordination/swarm-behavior
  try {
    console.log('Testing coordination/swarm-behavior...');
    const tool = getTool('coordination/swarm-behavior');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      behavior: 'task_allocation',
      parameters: {
        agentCount: 10,
        taskQueue: ['task1', 'task2', 'task3']
      },
      adaptiveRules: true,
      observability: {
        recordTrajectories: true,
        measureEmergence: true
      }
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (typeof data.behaviorActive !== 'boolean') throw new Error('Invalid response format');
    if (!data.metrics) throw new Error('Missing metrics');

    console.log(`  OK: Behavior active: ${data.behaviorActive}, emergence: ${(data.metrics.emergenceScore * 100).toFixed(1)}%`);
    passed++;
    results.push({ tool: 'coordination/swarm-behavior', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'coordination/swarm-behavior', status: 'FAIL', error: e.message });
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}/${toolNames.length}`);
  console.log(`Failed: ${failed}/${toolNames.length}`);

  if (failed > 0) {
    console.log('\nFailed tools:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.tool}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\nAll tools validated successfully!');
}

validate().catch(e => {
  console.error('Validation error:', e);
  process.exit(1);
});
