/**
 * Validation script for perf-optimizer plugin
 * Tests all 5 MCP tools with valid data
 */

import { perfOptimizerTools, getTool, getToolNames } from '../dist/mcp-tools.js';
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
  console.log('=== Perf Optimizer Plugin Validation ===\n');

  const toolNames = getToolNames();
  console.log(`Found ${toolNames.length} tools: ${toolNames.join(', ')}\n`);

  let passed = 0;
  let failed = 0;
  const results: { tool: string; status: string; error?: string }[] = [];

  // Test 1: perf/bottleneck-detect
  try {
    console.log('Testing perf/bottleneck-detect...');
    const tool = getTool('perf/bottleneck-detect');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      traceData: {
        format: 'otlp',
        spans: [
          { spanId: 's1', parentSpanId: null, serviceName: 'api', operationName: 'GET /users', duration: 150, status: 'ok', startTime: 1000 },
          { spanId: 's2', parentSpanId: 's1', serviceName: 'db', operationName: 'SELECT users', duration: 120, status: 'ok', startTime: 1010 },
          { spanId: 's3', parentSpanId: 's1', serviceName: 'cache', operationName: 'redis.get', duration: 5, status: 'ok', startTime: 1005 },
        ],
        metrics: {}
      },
      analysisScope: ['all'],
      threshold: { latencyP95: 100, errorRate: 0.01 }
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.bottlenecks)) throw new Error('Invalid response format');
    if (typeof data.overallScore !== 'number') throw new Error('Missing overallScore');

    console.log(`  OK: Found ${data.bottlenecks.length} bottlenecks, score: ${data.overallScore.toFixed(2)}`);
    passed++;
    results.push({ tool: 'perf/bottleneck-detect', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'perf/bottleneck-detect', status: 'FAIL', error: e.message });
  }

  // Test 2: perf/memory-analyze
  try {
    console.log('Testing perf/memory-analyze...');
    const tool = getTool('perf/memory-analyze');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      heapSnapshot: 'mock-snapshot',
      timeline: [
        { timestamp: 0, heapUsed: 100000000 },
        { timestamp: 1000, heapUsed: 120000000 },
        { timestamp: 2000, heapUsed: 80000000 },
      ],
      analysis: ['leak_detection', 'allocation_hotspots']
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.leaks)) throw new Error('Invalid response format');
    if (typeof data.gcPressure !== 'number') throw new Error('Missing gcPressure');

    console.log(`  OK: Found ${data.leaks.length} leaks, GC pressure: ${data.gcPressure.toFixed(2)}`);
    passed++;
    results.push({ tool: 'perf/memory-analyze', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'perf/memory-analyze', status: 'FAIL', error: e.message });
  }

  // Test 3: perf/query-optimize
  try {
    console.log('Testing perf/query-optimize...');
    const tool = getTool('perf/query-optimize');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      queries: [
        { sql: 'SELECT * FROM users WHERE id = 1', duration: 5, resultSize: 1 },
        { sql: 'SELECT * FROM users WHERE id = 2', duration: 150, resultSize: 1 },
        { sql: 'SELECT * FROM users WHERE id = 3', duration: 180, resultSize: 1 },
        { sql: 'SELECT * FROM orders WHERE user_id = 1', duration: 200, resultSize: 50 },
      ],
      patterns: ['n_plus_1', 'missing_index'],
      suggestIndexes: true
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.patterns)) throw new Error('Invalid response format');
    if (typeof data.totalQueries !== 'number') throw new Error('Missing totalQueries');

    console.log(`  OK: Found ${data.patterns.length} patterns from ${data.totalQueries} queries`);
    passed++;
    results.push({ tool: 'perf/query-optimize', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'perf/query-optimize', status: 'FAIL', error: e.message });
  }

  // Test 4: perf/bundle-optimize
  try {
    console.log('Testing perf/bundle-optimize...');
    const tool = getTool('perf/bundle-optimize');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      bundleStats: './stats.json',
      analysis: ['tree_shaking', 'duplicate_deps', 'large_modules', 'code_splitting'],
      targets: { maxSize: 1000 }
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.optimizations)) throw new Error('Invalid response format');
    if (typeof data.totalSize !== 'number') throw new Error('Missing totalSize');

    console.log(`  OK: Found ${data.optimizations.length} optimizations, savings: ${(data.potentialSavings / 1024).toFixed(0)}KB`);
    passed++;
    results.push({ tool: 'perf/bundle-optimize', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'perf/bundle-optimize', status: 'FAIL', error: e.message });
  }

  // Test 5: perf/config-optimize
  try {
    console.log('Testing perf/config-optimize...');
    const tool = getTool('perf/config-optimize');
    if (!tool) throw new Error('Tool not found');

    const rawResult = await tool.handler({
      workloadProfile: {
        type: 'api',
        metrics: { avgLatency: 50, rps: 1000 },
        constraints: { maxLatency: 100, minRps: 500 }
      },
      configSpace: {
        connectionPoolSize: { type: 'number', range: [10, 100], current: 20 },
        cacheSize: { type: 'number', range: [100, 10000], current: 500 },
        timeout: { type: 'number', range: [1000, 30000], current: 5000 }
      },
      objective: 'latency'
    });

    const { success, data, error } = parseResult(rawResult);
    if (!success) throw new Error(error);
    if (!Array.isArray(data.recommendations)) throw new Error('Invalid response format');
    if (!data.predictedImprovement) throw new Error('Missing predictedImprovement');

    console.log(`  OK: ${data.recommendations.length} recommendations, predicted latency improvement: ${data.predictedImprovement.latency}%`);
    passed++;
    results.push({ tool: 'perf/config-optimize', status: 'PASS' });
  } catch (e: any) {
    console.log(`  FAIL: ${e.message}`);
    failed++;
    results.push({ tool: 'perf/config-optimize', status: 'FAIL', error: e.message });
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
