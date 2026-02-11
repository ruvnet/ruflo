/**
 * Validation script for cognitive-kernel plugin
 * Tests all 5 MCP tools with valid data
 */

import { cognitiveKernelTools, getTool, getToolNames } from '../dist/mcp-tools.js';
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
  console.log('=== Cognitive Kernel Plugin Validation ===\n');

  const toolNames = getToolNames();
  console.log(`Found ${toolNames.length} tools: ${toolNames.join(', ')}\n`);

  let passed = 0;
  let failed = 0;
  const results: { tool: string; status: string; error?: string }[] = [];

  // Test 1: cognition/working-memory
  try {
    console.log('Testing cognition/working-memory...');
    const tool = getTool('cognition/working-memory');
    if (!tool) throw new Error('Tool not found');

    // Allocate
    let rawResult = await tool.handler({
      action: 'allocate',
      slot: {
        content: { type: 'context', data: 'Important reasoning context' },
        priority: 0.8,
        decay: 0.1
      },
      capacity: 7
    });

    let { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    const slotId = data.details?.slotId;
    if (!slotId) throw new Error('No slot ID returned');

    // Retrieve
    rawResult = await tool.handler({
      action: 'retrieve',
      slot: { id: slotId },
      capacity: 7
    });

    ({ success, data, error } = parseResult(rawResult));
    if (!success) throw new Error(error);

    // Clear
    rawResult = await tool.handler({
      action: 'clear',
      slot: { id: slotId },
      capacity: 7
    });

    ({ success, data, error } = parseResult(rawResult));
    if (!success) throw new Error(error);

    console.log(`  OK: Allocate/Retrieve/Clear operations successful`);
    passed++;
    results.push({ tool: 'cognition/working-memory', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'cognition/working-memory', status: 'FAIL', error: e.message });
  }

  // Test 2: cognition/attention-control
  try {
    console.log('Testing cognition/attention-control...');
    const tool = getTool('cognition/attention-control');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      mode: 'selective',
      targets: [
        { entity: 'security_analysis', weight: 0.9, duration: 500 },  // Duration in seconds, max 3600
        { entity: 'performance_metrics', weight: 0.7, duration: 300 }
      ],
      filters: {
        includePatterns: ['security.*', 'auth.*'],
        excludePatterns: ['deprecated.*'],
        noveltyBias: 0.6
      }
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!data.mode) throw new Error('Missing mode in response');
    if (!data.state) throw new Error('Missing state in response');

    console.log(`  OK: Mode: ${data.mode}, breadth: ${data.state.breadth.toFixed(2)}, intensity: ${data.state.intensity.toFixed(2)}`);
    passed++;
    results.push({ tool: 'cognition/attention-control', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'cognition/attention-control', status: 'FAIL', error: e.message });
  }

  // Test 3: cognition/meta-monitor
  try {
    console.log('Testing cognition/meta-monitor...');
    const tool = getTool('cognition/meta-monitor');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      monitoring: [
        'confidence_calibration',
        'reasoning_coherence',
        'goal_tracking',
        'cognitive_load',
        'error_detection'
      ],
      reflection: {
        trigger: 'periodic',
        depth: 'medium'
      },
      interventions: true
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!data.assessment) throw new Error('Missing assessment');
    if (typeof data.assessment.confidence !== 'number') throw new Error('Invalid assessment format');

    console.log(`  OK: Confidence: ${data.assessment.confidence.toFixed(2)}, coherence: ${data.assessment.coherence.toFixed(2)}`);
    passed++;
    results.push({ tool: 'cognition/meta-monitor', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'cognition/meta-monitor', status: 'FAIL', error: e.message });
  }

  // Test 4: cognition/scaffold
  try {
    console.log('Testing cognition/scaffold...');
    const tool = getTool('cognition/scaffold');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      task: {
        description: 'Implement a distributed voting algorithm',
        complexity: 'complex',
        domain: 'distributed_systems'
      },
      scaffoldType: 'decomposition',
      adaptivity: {
        fading: true,
        monitoring: true
      }
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.steps)) throw new Error('Invalid response format');
    if (!data.scaffoldType) throw new Error('Missing scaffoldType');

    console.log(`  OK: ${data.steps.length} scaffold steps generated for ${data.scaffoldType}`);
    passed++;
    results.push({ tool: 'cognition/scaffold', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'cognition/scaffold', status: 'FAIL', error: e.message });
  }

  // Test 5: cognition/cognitive-load
  try {
    console.log('Testing cognition/cognitive-load...');
    const tool = getTool('cognition/cognitive-load');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      assessment: {
        intrinsic: 0.6,
        extraneous: 0.3,
        germane: 0.2
      },
      optimization: 'balanced',
      threshold: 0.8
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!data.currentLoad) throw new Error('Missing currentLoad');
    if (typeof data.overloaded !== 'boolean') throw new Error('Invalid response format');

    console.log(`  OK: Total load: ${(data.currentLoad.total * 100).toFixed(1)}%, overloaded: ${data.overloaded}`);
    passed++;
    results.push({ tool: 'cognition/cognitive-load', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'cognition/cognitive-load', status: 'FAIL', error: e.message });
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
