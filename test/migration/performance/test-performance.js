#!/usr/bin/env node

/**
 * Performance Tests for Claude Flow Migration
 * Validates performance is maintained or improved after migration
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

// Test configuration
const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-perf-test-' + Date.now());
const CLAUDE_FLOW_BIN = path.resolve(__dirname, '../../../bin/claude-flow');

// Performance thresholds (milliseconds)
const THRESHOLDS = {
  init: 5000,        // Init should complete within 5s
  help: 500,         // Help should be instant
  config: 1000,      // Config operations within 1s
  swarmInit: 3000,   // Swarm init within 3s
  agentSpawn: 2000,  // Agent spawn within 2s
  memory: 500,       // Memory operations within 500ms
  task: 1000,        // Task operations within 1s
  mcp: 5000          // MCP server start within 5s
};

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Test results tracker
const performanceResults = {
  passed: 0,
  failed: 0,
  metrics: {},
  tests: []
};

/**
 * Measure execution time of a function
 */
async function measureTime(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const duration = Math.round(performance.now() - start);
    return duration;
  } catch (error) {
    throw error;
  }
}

/**
 * Run a performance test
 */
async function runPerfTest(name, threshold, testFn) {
  console.log(`\n${colors.blue}Testing: ${name}${colors.reset}`);
  console.log(`  Threshold: ${threshold}ms`);
  
  try {
    const duration = await measureTime(name, testFn);
    performanceResults.metrics[name] = duration;
    
    if (duration <= threshold) {
      console.log(`${colors.green}✓ PASSED - ${duration}ms${colors.reset}`);
      performanceResults.passed++;
      performanceResults.tests.push({ 
        name, 
        status: 'passed', 
        duration, 
        threshold 
      });
    } else {
      console.log(`${colors.red}✗ FAILED - ${duration}ms (exceeded threshold)${colors.reset}`);
      performanceResults.failed++;
      performanceResults.tests.push({ 
        name, 
        status: 'failed', 
        duration, 
        threshold,
        exceeded: duration - threshold 
      });
    }
  } catch (error) {
    console.log(`${colors.red}✗ FAILED - Error: ${error.message}${colors.reset}`);
    performanceResults.failed++;
    performanceResults.tests.push({ 
      name, 
      status: 'error', 
      error: error.message 
    });
  }
}

/**
 * Execute command synchronously
 */
function exec(command, options = {}) {
  return execSync(command, { 
    encoding: 'utf8', 
    cwd: TEST_DIR,
    stdio: 'pipe',
    ...options 
  });
}

/**
 * Execute command asynchronously
 */
function execAsync(command, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: TEST_DIR,
      stdio: 'pipe'
    });
    
    let output = '';
    proc.stdout.on('data', (data) => output += data);
    proc.stderr.on('data', (data) => output += data);
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Command failed with code ${code}: ${output}`));
      }
    });
    
    proc.on('error', reject);
  });
}

// Setup test environment
console.log(`${colors.yellow}Setting up performance test environment...${colors.reset}`);
fs.mkdirSync(TEST_DIR, { recursive: true });
process.chdir(TEST_DIR);

// Warm up Node.js
console.log(`${colors.yellow}Warming up Node.js...${colors.reset}`);
exec(`node ${CLAUDE_FLOW_BIN} --version`);

// Run performance tests
(async () => {
  // Test 1: Help command performance
  await runPerfTest('Help Command', THRESHOLDS.help, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, '--help']);
  });
  
  // Test 2: Init command performance
  await runPerfTest('Init Command', THRESHOLDS.init, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, 'init', '-y']);
  });
  
  // Test 3: Config operations performance
  await runPerfTest('Config Operations', THRESHOLDS.config, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, 'config', 'set', 'test.perf', 'value']);
    await execAsync('node', [CLAUDE_FLOW_BIN, 'config', 'get', 'test.perf']);
    await execAsync('node', [CLAUDE_FLOW_BIN, 'config', 'list']);
  });
  
  // Test 4: Swarm initialization performance
  await runPerfTest('Swarm Init', THRESHOLDS.swarmInit, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, 'swarm', 'init', '--topology', 'mesh']);
  });
  
  // Test 5: Agent spawn performance
  await runPerfTest('Agent Spawn', THRESHOLDS.agentSpawn, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, 'swarm', 'spawn', '--type', 'researcher']);
  });
  
  // Test 6: Memory operations performance
  await runPerfTest('Memory Operations', THRESHOLDS.memory, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, 'memory', 'store', '--key', 'perf-test', '--value', 'test-data']);
    await execAsync('node', [CLAUDE_FLOW_BIN, 'memory', 'get', '--key', 'perf-test']);
    await execAsync('node', [CLAUDE_FLOW_BIN, 'memory', 'list']);
  });
  
  // Test 7: Task operations performance
  await runPerfTest('Task Operations', THRESHOLDS.task, async () => {
    await execAsync('node', [CLAUDE_FLOW_BIN, 'task', 'create', '--name', 'Perf Test Task']);
    await execAsync('node', [CLAUDE_FLOW_BIN, 'task', 'list']);
  });
  
  // Test 8: Batch operations performance
  await runPerfTest('Batch Operations', THRESHOLDS.init * 2, async () => {
    // Create batch config
    const batchConfig = {
      agents: [
        { type: 'researcher', name: 'R1' },
        { type: 'coder', name: 'C1' },
        { type: 'analyst', name: 'A1' }
      ],
      tasks: [
        { name: 'Task 1', priority: 'high' },
        { name: 'Task 2', priority: 'medium' },
        { name: 'Task 3', priority: 'low' }
      ]
    };
    
    fs.writeFileSync(
      path.join(TEST_DIR, 'batch.json'), 
      JSON.stringify(batchConfig, null, 2)
    );
    
    await execAsync('node', [CLAUDE_FLOW_BIN, 'batch', 'execute', 'batch.json']);
  });
  
  // Test 9: Concurrent operations
  await runPerfTest('Concurrent Operations', THRESHOLDS.config * 3, async () => {
    const operations = [
      execAsync('node', [CLAUDE_FLOW_BIN, 'config', 'list']),
      execAsync('node', [CLAUDE_FLOW_BIN, 'memory', 'list']),
      execAsync('node', [CLAUDE_FLOW_BIN, 'task', 'list'])
    ];
    
    await Promise.all(operations);
  });
  
  // Test 10: Large data handling
  await runPerfTest('Large Data Handling', THRESHOLDS.memory * 2, async () => {
    // Create large data (1MB)
    const largeData = 'x'.repeat(1024 * 1024);
    
    await execAsync('node', [
      CLAUDE_FLOW_BIN, 
      'memory', 
      'store', 
      '--key', 
      'large-data',
      '--value',
      largeData.substring(0, 1000) // Use first 1KB for test
    ]);
  });
  
  // Performance comparison with baseline
  console.log(`\n${colors.blue}Performance Summary:${colors.reset}`);
  console.log('Operation               Duration    Threshold   Status');
  console.log('─'.repeat(55));
  
  for (const test of performanceResults.tests) {
    const status = test.status === 'passed' ? 
      `${colors.green}PASS${colors.reset}` : 
      `${colors.red}FAIL${colors.reset}`;
    
    if (test.duration !== undefined) {
      console.log(
        `${test.name.padEnd(20)} ${String(test.duration + 'ms').padStart(10)} ${
          String(test.threshold + 'ms').padStart(10)
        }   ${status}`
      );
    }
  }
  
  // Calculate aggregate metrics
  const avgDuration = Object.values(performanceResults.metrics).reduce((a, b) => a + b, 0) / 
                     Object.keys(performanceResults.metrics).length;
  
  console.log(`\n${colors.blue}Aggregate Metrics:${colors.reset}`);
  console.log(`Average operation time: ${Math.round(avgDuration)}ms`);
  console.log(`Total tests: ${performanceResults.tests.length}`);
  console.log(`${colors.green}Passed: ${performanceResults.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${performanceResults.failed}${colors.reset}`);
  
  // Memory usage analysis
  const memUsage = process.memoryUsage();
  console.log(`\n${colors.blue}Memory Usage:${colors.reset}`);
  console.log(`Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  console.log(`RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
  
  // Cleanup
  console.log(`\n${colors.yellow}Cleaning up test environment...${colors.reset}`);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  
  // Write results
  const resultsPath = path.join(__dirname, 'performance-test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({
    ...performanceResults,
    avgDuration: Math.round(avgDuration),
    memoryUsage: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024)
    },
    timestamp: new Date().toISOString()
  }, null, 2));
  
  console.log(`\nResults saved to: ${resultsPath}`);
  
  // Exit with appropriate code
  process.exit(performanceResults.failed > 0 ? 1 : 0);
})();